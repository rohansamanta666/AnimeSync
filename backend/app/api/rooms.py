from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.database import get_db
from backend.app.models.participant import Participant
from backend.app.services.room_manager import RoomManager
from backend.app.services.queue_manager import QueueManager
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

