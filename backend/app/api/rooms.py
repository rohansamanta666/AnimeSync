from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.database import get_db
from backend.app.services.room_manager import RoomManager
from backend.app.schemas.room import (
    RoomCreateRequest,
    RoomJoinRequest,
    RoomCreateResponse,
    RoomJoinResponse,
    RoomResponse,
)

router = APIRouter(prefix="/rooms", tags=["Rooms"])

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

