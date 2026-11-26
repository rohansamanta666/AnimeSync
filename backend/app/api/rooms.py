from typing import Optional
from pathlib import Path
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.database import get_db
from backend.app.models.participant import Participant, ParticipantStatus
from backend.app.services.room_manager import RoomManager
from backend.app.services.queue_manager import QueueManager
from backend.app.services.chat_service import ChatService
from backend.app.services.storage import StorageService
from backend.app.schemas.room import (
    RoomCreateRequest,
    RoomJoinRequest,
    RoomCreateResponse,
    RoomJoinResponse,
    RoomResponse,
    EpisodeResponse,
    QueueResponse,
    QueueReorderRequest,
    QueueSelectRequest,
    StorageUsageSchema,
    MediaEpisodeSchema,
    MediaStorageResponse,
    MediaDeleteResponse,
    MediaPurgeResponse,
)
from backend.app.schemas.message import (
    MessageCreate,
    MessageResponse,
    MessageListResponse,
)
from backend.app.sockets import sio
from backend.app.sockets.server import invalidate_room_readiness

router = APIRouter(prefix="/rooms", tags=["Rooms"])

async def _authenticate_participant(
    db: AsyncSession,
    room_id: str,
    participant_id: Optional[str],
    token: Optional[str],
    require_host: bool = False
) -> Participant:
    if not participant_id or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing participant authentication credentials"
        )
    participant = await RoomManager.authenticate_participant(
        db, room_id=room_id, participant_id=participant_id, token=token
    )
    if not participant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid participant credentials for this room"
        )
    if getattr(participant, "is_kicked", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You have been removed from this room by the host."
        )
    if require_host and not participant.is_host:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the room host can perform this action"
        )
    return participant

@router.post("", response_model=RoomCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_room(req: RoomCreateRequest, db: AsyncSession = Depends(get_db)):
    try:
        room, host, token = await RoomManager.create_room(db, req.name, req.host_username)
        return RoomCreateResponse(
            room=RoomResponse.model_validate(room),
            participant_id=host.id,
            session_token=token,
            is_host=True
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create room: {str(e)}")

@router.get("/{code}", response_model=RoomResponse)
async def get_room(code: str, db: AsyncSession = Depends(get_db)):
    room = await RoomManager.get_room_by_code(db, code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return RoomResponse.model_validate(room)

@router.post("/{code}/join", response_model=RoomJoinResponse)
async def join_room(code: str, req: RoomJoinRequest, db: AsyncSession = Depends(get_db)):
    try:
        room, participant, token = await RoomManager.join_room(db, code, req.username)
        return RoomJoinResponse(
            room=RoomResponse.model_validate(room),
            participant_id=participant.id,
            session_token=token,
            is_host=False
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to join room: {str(e)}")


@router.post("/{code}/participants/{participant_id}/kick")
async def kick_participant_api(
    code: str,
    participant_id: str,
    host_participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db)
):
    room = await RoomManager.get_room_by_code(db, code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    host = await _authenticate_participant(
        db, room.id, host_participant_id, session_token, require_host=True
    )

    if participant_id == host.id:
        raise HTTPException(status_code=400, detail="Host cannot kick themselves")

    from sqlalchemy import select
    res = await db.execute(
        select(Participant).where(
            Participant.id == participant_id,
            Participant.room_id == room.id
        )
    )
    target = res.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Participant not found")

    target.is_kicked = True
    target.status = ParticipantStatus.DISCONNECTED
    await db.commit()

    # Cancel any grace task
    from backend.app.sockets.server import _pending_grace_periods
    grace = _pending_grace_periods.pop((room.code, participant_id), None)
    if grace:
        grace.cancel()

    # Socket teardown and broadcasts
    from backend.app.sockets.connection_manager import connection_manager
    from backend.app.sockets.voice_manager import voice_manager
    from backend.app.sockets.playback_manager import playback_manager
    import time

    target_sids = connection_manager.get_participant_sids(room.code, participant_id)
    for sid in target_sids:
        await sio.emit(
            "kicked",
            {"reason": "You have been removed from the room by the host.", "room_code": room.code},
            to=sid
        )

    voice_manager.leave_voice(room.code, participant_id)
    await sio.emit(
        "voice_peer_left",
        {
            "participant_id": participant_id,
            "username": target.username,
            "socket_id": list(target_sids)[0] if target_sids else ""
        },
        room=room.code
    )
    playback_manager.clear_buffering_for_participant(room.code, participant_id)
    await connection_manager.remove_participant_from_room(room.code, participant_id)

    for sid in target_sids:
        try:
            await sio.disconnect(sid)
        except Exception:
            pass

    await sio.emit(
        "user_left",
        {
            "participant_id": participant_id,
            "username": target.username,
            "timestamp": time.time(),
            "reason": "kicked"
        },
        room=room.code
    )
    presence = await connection_manager.get_presence_payload(db, room.code)
    await sio.emit(
        "presence_updated",
        {"room_code": room.code, "participants": presence},
        room=room.code
    )

    return {"status": "OK", "message": f"{target.username} was kicked from the room"}


@router.get("/{code}/queue", response_model=QueueResponse)
async def get_room_queue(code: str, db: AsyncSession = Depends(get_db)):
    """Fetches the current episode queue for a room."""
    room = await RoomManager.get_room_by_code(db, code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    episodes = await QueueManager.get_queue(db, room.id)
    return QueueResponse(
        room_code=room.code,
        current_episode_id=room.current_episode_id,
        episodes=[EpisodeResponse.model_validate(ep) for ep in episodes],
    )


@router.delete("/{code}/queue/{episode_id}", response_model=QueueResponse)
async def remove_from_queue(
    code: str,
    episode_id: str,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db),
):
    """Removes an episode from the queue (host only)."""
    room = await RoomManager.get_room_by_code(db, code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    await _authenticate_participant(db, room.id, participant_id, session_token, require_host=True)

    previous_current_id = room.current_episode_id
    success, new_current_id, remaining = await QueueManager.remove_from_queue(db, room.id, episode_id)
    if not success:
        raise HTTPException(status_code=404, detail="Episode not found in room queue")

    # Broadcast queue update to room participants
    queue_dicts = [QueueManager.serialize_episode(ep) for ep in remaining]
    await sio.emit(
        "queue_updated",
        {
            "room_code": room.code,
            "episodes": queue_dicts,
            "current_episode_id": new_current_id,
        },
        room=room.code,
    )

    # If the active episode was removed, reset readiness and notify clients
    if previous_current_id == episode_id:
        await invalidate_room_readiness(
            room.code, reason="Active episode was removed from queue", reset_watching=True
        )

    return QueueResponse(
        room_code=room.code,
        current_episode_id=new_current_id,
        episodes=[EpisodeResponse.model_validate(ep) for ep in remaining],
    )


@router.put("/{code}/queue/reorder", response_model=QueueResponse)
async def reorder_queue(
    code: str,
    req: QueueReorderRequest,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db),
):
    """Reorders the episode queue according to the provided list of IDs (host only)."""
    room = await RoomManager.get_room_by_code(db, code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    await _authenticate_participant(db, room.id, participant_id, session_token, require_host=True)

    reordered = await QueueManager.reorder_queue(db, room.id, req.ordered_episode_ids)

    # Broadcast queue update
    queue_dicts = [QueueManager.serialize_episode(ep) for ep in reordered]
    await sio.emit(
        "queue_updated",
        {
            "room_code": room.code,
            "episodes": queue_dicts,
            "current_episode_id": room.current_episode_id,
        },
        room=room.code,
    )

    return QueueResponse(
        room_code=room.code,
        current_episode_id=room.current_episode_id,
        episodes=[EpisodeResponse.model_validate(ep) for ep in reordered],
    )


@router.post("/{code}/queue/select", response_model=QueueResponse)
async def select_current_episode(
    code: str,
    req: QueueSelectRequest,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db),
):
    """Selects an episode to become the current active episode for the room (host only)."""
    room = await RoomManager.get_room_by_code(db, code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    await _authenticate_participant(db, room.id, participant_id, session_token, require_host=True)

    success, episode = await QueueManager.set_current_episode(db, room.id, req.episode_id)
    if not success:
        raise HTTPException(status_code=404, detail="Episode not found in room queue")

    # Invalidate readiness so participants must verify the new episode
    await invalidate_room_readiness(
        room.code, reason="Host selected a different episode", reset_watching=True
    )

    episodes = await QueueManager.get_queue(db, room.id)
    queue_dicts = [QueueManager.serialize_episode(ep) for ep in episodes]
    await sio.emit(
        "queue_updated",
        {
            "room_code": room.code,
            "episodes": queue_dicts,
            "current_episode_id": episode.id,
        },
        room=room.code,
    )

    return QueueResponse(
        room_code=room.code,
        current_episode_id=episode.id,
        episodes=[EpisodeResponse.model_validate(ep) for ep in episodes],
    )


# ---------------------------------------------------------------------------
# Phase 7: Text Chat API Endpoints (Task 7.1)
# ---------------------------------------------------------------------------

@router.get("/{code}/messages", response_model=MessageListResponse)
async def get_room_messages(
    code: str,
    limit: int = 100,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db),
):
    """Fetches chronological chat history for a room."""
    room = await RoomManager.get_room_by_code(db, code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    await _authenticate_participant(db, room.id, participant_id, session_token)
    messages = await ChatService.get_recent_messages(db, room.id, limit=limit)

    return MessageListResponse(
        room_code=room.code,
        messages=[MessageResponse.model_validate(m) for m in messages],
    )


@router.post("/{code}/messages", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def send_room_message(
    code: str,
    req: MessageCreate,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db),
):
    """Sends a chat message, sanitizes input, persists, and broadcasts over Socket.IO."""
    room = await RoomManager.get_room_by_code(db, code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    participant = await _authenticate_participant(db, room.id, participant_id, session_token)

    try:
        msg = await ChatService.create_message(
            db=db,
            room_id=room.id,
            participant_id=participant.id,
            username=participant.username,
            content=req.content,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    msg_dict = ChatService.serialize_message(msg)
    await sio.emit("new_message", {"message": msg_dict}, room=room.code)

    return MessageResponse.model_validate(msg)


# ---------------------------------------------------------------------------
# Phase 8: Media Management Dashboard Endpoints (Task 8.6)
# ---------------------------------------------------------------------------

@router.get("/{code}/media", response_model=MediaStorageResponse)
async def get_media_dashboard(
    code: str,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Phase 8 Task 8.6: Returns host storage usage and episode files status for the room.
    """
    room = await RoomManager.get_room_by_code(db, code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    await _authenticate_participant(db, room.id, participant_id, session_token)

    storage_stats = StorageService.get_storage_usage()
    episodes = await QueueManager.get_queue(db, room.id)

    media_episodes = []
    for ep in episodes:
        path = Path(ep.file_path) if ep.file_path else None
        exists = path is not None and path.exists() and path.is_file()
        media_episodes.append(
            MediaEpisodeSchema(
                id=ep.id,
                anime_title=ep.anime_title,
                season=ep.season,
                episode_number=ep.episode_number,
                display_title=ep.display_title,
                filename=ep.filename,
                file_size_bytes=ep.file_size_bytes,
                sha256_hash=ep.sha256_hash,
                duration_seconds=ep.duration_seconds,
                upload_status=ep.upload_status.value if hasattr(ep.upload_status, "value") else str(ep.upload_status),
                queue_position=ep.queue_position,
                created_at=ep.created_at,
                is_active=(room.current_episode_id == ep.id),
                file_exists_on_disk=exists,
            )
        )

    return MediaStorageResponse(
        room_code=room.code,
        storage=StorageUsageSchema(**storage_stats),
        episodes=media_episodes,
    )


@router.delete("/{code}/media/{episode_id}", response_model=MediaDeleteResponse)
async def delete_media_file(
    code: str,
    episode_id: str,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Phase 8 Task 8.6: Permanently deletes an episode file from host disk and queue (host only).
    """
    room = await RoomManager.get_room_by_code(db, code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    await _authenticate_participant(db, room.id, participant_id, session_token, require_host=True)

    target_ep = await QueueManager.get_episode_by_id(db, episode_id)
    if not target_ep or target_ep.room_id != room.id:
        raise HTTPException(status_code=404, detail="Episode not found in room")

    path = Path(target_ep.file_path) if target_ep.file_path else None
    freed_bytes = path.stat().st_size if path and path.exists() else target_ep.file_size_bytes

    previous_current_id = room.current_episode_id
    success, new_current_id, remaining = await QueueManager.remove_from_queue(db, room.id, episode_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to remove episode from storage")

    # Broadcast updated queue to all room clients
    queue_dicts = [QueueManager.serialize_episode(ep) for ep in remaining]
    await sio.emit(
        "queue_updated",
        {
            "room_code": room.code,
            "episodes": queue_dicts,
            "current_episode_id": new_current_id,
        },
        room=room.code,
    )

    if previous_current_id == episode_id:
        await invalidate_room_readiness(
            room.code, reason="Active episode was deleted by host", reset_watching=True
        )

    return MediaDeleteResponse(
        success=True,
        message=f"Deleted '{target_ep.filename}' successfully",
        freed_bytes=freed_bytes,
        remaining_episodes_count=len(remaining),
    )


@router.post("/{code}/media/purge", response_model=MediaPurgeResponse)
async def purge_temp_media(
    code: str,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Phase 8 Task 8.6: Purges temporary upload chunks and orphaned files (host only).
    """
    room = await RoomManager.get_room_by_code(db, code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    await _authenticate_participant(db, room.id, participant_id, session_token, require_host=True)

    purge_result = StorageService.purge_temp_storage(max_age_seconds=0)

    return MediaPurgeResponse(
        success=True,
        message=f"Purged {purge_result['purged_count']} temporary session(s)",
        freed_bytes=purge_result["freed_bytes"],
        purged_count=purge_result["purged_count"],
    )


class StreamEpisodeCreateRequest(BaseModel):
    anime_title: str
    season: int = 1
    episode_number: int = 1
    display_title: Optional[str] = None
    stream_url: str
    subtitle_url: Optional[str] = None
    set_active: bool = True


@router.post("/{code}/stream-episode")
async def add_stream_episode(
    code: str,
    payload: StreamEpisodeCreateRequest,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db),
):
    """Adds an authorized stream episode (.mp4/.webm/.m3u8) to a room (host only) and optionally activates it."""
    from backend.app.models.episode import Episode, UploadStatus
    from backend.app.services.streaming_service import validate_stream_url_syntax
    from backend.app.sockets.playback_manager import playback_manager
    from backend.app.sockets import sio

    room = await RoomManager.get_room_by_code(db, code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    await _authenticate_participant(db, room.id, participant_id, session_token, require_host=True)

    url_check = validate_stream_url_syntax(payload.stream_url)
    if not url_check["valid"]:
        raise HTTPException(status_code=400, detail=url_check["error"])

    clean_sub_url = None
    if payload.subtitle_url and payload.subtitle_url.strip():
        sub_check = validate_stream_url_syntax(payload.subtitle_url)
        if not sub_check["valid"]:
            raise HTTPException(status_code=400, detail=f"Invalid subtitle URL: {sub_check['error']}")
        clean_sub_url = sub_check["url"]

    existing = await QueueManager.get_queue(db, room.id)
    next_pos = len(existing)
    fmt = url_check["format"]
    mime = "application/vnd.apple.mpegurl" if fmt == "hls" else ("video/webm" if fmt == "webm" else "video/mp4")

    ep = Episode(
        room_id=room.id,
        anime_title=payload.anime_title.strip()[:200] or "Streamed Anime",
        season=max(1, payload.season),
        episode_number=max(1, payload.episode_number),
        display_title=(payload.display_title or "").strip()[:200] or f"Episode {payload.episode_number}",
        filename=f"stream_ep{payload.episode_number}",
        file_path="",
        file_size_bytes=0,
        sha256_hash=None,
        mime_type=mime,
        upload_status=UploadStatus.COMPLETED,
        queue_position=next_pos,
        source_type="stream",
        stream_url=url_check["url"],
        subtitle_url=clean_sub_url,
    )
    db.add(ep)
    await db.commit()
    await db.refresh(ep)

    if payload.set_active:
        room.current_episode_id = ep.id
        await db.commit()
        playback_manager.reset_state(room.code)

    episodes = await QueueManager.get_queue(db, room.id)
    queue_dicts = [QueueManager.serialize_episode(item) for item in episodes]

    await sio.emit(
        "queue_updated",
        {
            "room_code": room.code,
            "episodes": queue_dicts,
            "current_episode_id": room.current_episode_id,
        },
        room=room.code,
    )

    if payload.set_active:
        await sio.emit(
            "playback_sync",
            {
                "room_code": room.code,
                "action": "PAUSE",
                "timestamp": 0.0,
                "playback_speed": 1.0,
                "is_playing": False,
                "sequence_number": 0,
                "originating_socket_id": "server",
                "updated_at": playback_manager.get_or_create_state(room.code).updated_at,
                "paused_for_buffering": False,
            },
            room=room.code,
        )

    return {
        "episode": QueueManager.serialize_episode(ep),
        "current_episode_id": room.current_episode_id,
        "episodes": queue_dicts,
    }


