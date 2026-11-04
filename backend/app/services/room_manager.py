import secrets
import string
import uuid
from typing import Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from backend.app.models.room import Room
from backend.app.models.participant import Participant, ParticipantStatus

# Non-ambiguous uppercase characters for room code
ROOM_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

def generate_room_code(length: int = 6) -> str:
    return "".join(secrets.choice(ROOM_CODE_CHARS) for _ in range(length))

def generate_session_token() -> str:
    return secrets.token_hex(32)

class RoomManager:
    @staticmethod
    async def create_room(
        db: AsyncSession, name: str, host_username: str
    ) -> Tuple[Room, Participant, str]:
        # Generate unique room code
        while True:
            code = generate_room_code()
            result = await db.execute(select(Room).where(Room.code == code))
            if not result.scalar_one_or_none():
                break

        room_id = str(uuid.uuid4())
        participant_id = str(uuid.uuid4())
        session_token = generate_session_token()

        room = Room(
            id=room_id,
            code=code,
            name=name.strip(),
            host_id=participant_id,
            is_active=True
        )
        db.add(room)

        host_participant = Participant(
            id=participant_id,
            room_id=room_id,
            username=host_username.strip(),
            session_token=session_token,
            is_host=True,
            status=ParticipantStatus.WAITING_FOR_FILE
        )
        db.add(host_participant)

        await db.commit()
        await db.refresh(room)
        await db.refresh(host_participant)

        # Re-fetch room with participants
        fetched_room = await RoomManager.get_room_by_code(db, code)
        return fetched_room, host_participant, session_token

    @staticmethod
    async def get_room_by_code(db: AsyncSession, code: str) -> Optional[Room]:
        query = (
            select(Room)
            .where(Room.code == code.upper())
            .options(
                selectinload(Room.participants),
                selectinload(Room.episodes),
            )
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def join_room(
        db: AsyncSession, code: str, username: str
    ) -> Tuple[Room, Participant, str]:
        room = await RoomManager.get_room_by_code(db, code)
        if not room:
            raise ValueError("Room not found")
        if not room.is_active:
            raise ValueError("Room is no longer active")

        # Check existing active participants limit (max 10, recommended 2 for 1-on-1 watch party)
        active_count = len([p for p in room.participants if p.status != ParticipantStatus.DISCONNECTED])
        if active_count >= 10:
            raise ValueError("Room is currently full")

        participant_id = str(uuid.uuid4())
        session_token = generate_session_token()

        participant = Participant(
            id=participant_id,
            room_id=room.id,
            username=username.strip(),
            session_token=session_token,
            is_host=False,
            status=ParticipantStatus.WAITING_FOR_FILE
        )
        db.add(participant)
        await db.commit()
        await db.refresh(participant)

        updated_room = await RoomManager.get_room_by_code(db, code)
        return updated_room, participant, session_token

    @staticmethod
    async def authenticate_participant(
        db: AsyncSession, room_id: str, participant_id: str, token: str
    ) -> Optional[Participant]:
        query = select(Participant).where(
            Participant.room_id == room_id,
            Participant.id == participant_id,
            Participant.session_token == token
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

