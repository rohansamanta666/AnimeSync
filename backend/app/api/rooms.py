from typing import Optional
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.database import get_db
from backend.app.models.participant import Participant
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


