import asyncio
import time
from dataclasses import dataclass
from typing import Dict, Set, Optional, List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from backend.app.models.room import Room
from backend.app.models.participant import Participant, ParticipantStatus

@dataclass
class SocketSession:
    sid: str
    room_code: str
    room_id: str
    participant_id: str
    username: str
    is_host: bool
    connected_at: float

class ConnectionManager:
    def __init__(self):
        # sid -> SocketSession
        self._sid_to_session: Dict[str, SocketSession] = {}
        # (room_code, participant_id) -> Set[sid]
        self._participant_sockets: Dict[Tuple[str, str], Set[str]] = {}
        # room_code -> Set[participant_id]
        self._room_participants: Dict[str, Set[str]] = {}
        self._lock = asyncio.Lock()

    async def register_connection(
        self,
        sid: str,
        room_code: str,
        room_id: str,
        participant_id: str,
        username: str,
        is_host: bool
    ) -> bool:
        """
        Registers a socket connection for a participant in a room.
        Returns True if this is the participant's FIRST active connection (newly online),
        or False if they already had another active connection (e.g. second tab).
        """
        async with self._lock:
            room_code = room_code.upper()
            session = SocketSession(
                sid=sid,
                room_code=room_code,
                room_id=room_id,
                participant_id=participant_id,
                username=username,
                is_host=is_host,
                connected_at=time.time()
            )
            self._sid_to_session[sid] = session

            key = (room_code, participant_id)
            if key not in self._participant_sockets:
                self._participant_sockets[key] = set()

            was_offline = len(self._participant_sockets[key]) == 0
            self._participant_sockets[key].add(sid)

            if room_code not in self._room_participants:
                self._room_participants[room_code] = set()
            self._room_participants[room_code].add(participant_id)

            return was_offline

    async def unregister_connection(self, sid: str) -> Optional[Tuple[SocketSession, bool]]:
        """
        Unregisters a socket connection.
        Returns (session, is_now_offline) if found, or None.
        is_now_offline is True if the participant has no remaining active connections.
        """
        async with self._lock:
            session = self._sid_to_session.pop(sid, None)
            if not session:
                return None

            key = (session.room_code, session.participant_id)
            if key in self._participant_sockets:
                self._participant_sockets[key].discard(sid)
                is_now_offline = len(self._participant_sockets[key]) == 0
                if is_now_offline:
                    del self._participant_sockets[key]
                    if session.room_code in self._room_participants:
                        self._room_participants[session.room_code].discard(session.participant_id)
            else:
                is_now_offline = True

            return session, is_now_offline

    def get_session(self, sid: str) -> Optional[SocketSession]:
        return self._sid_to_session.get(sid)

    def is_participant_online(self, room_code: str, participant_id: str) -> bool:
        key = (room_code.upper(), participant_id)
        return len(self._participant_sockets.get(key, set())) > 0

    def get_participant_socket_count(self, room_code: str, participant_id: str) -> int:
        key = (room_code.upper(), participant_id)
        return len(self._participant_sockets.get(key, set()))

    def get_room_active_participant_ids(self, room_code: str) -> Set[str]:
        return set(self._room_participants.get(room_code.upper(), set()))

    async def get_presence_payload(self, db: AsyncSession, room_code: str) -> List[dict]:
        """
        Builds authoritative presence list for all participants registered in the room.
        """
        room_code = room_code.upper()
        query = (
            select(Room)
            .where(Room.code == room_code)
            .options(
                selectinload(Room.participants),
                selectinload(Room.episodes)
            )
        )
        result = await db.execute(query)
        room = result.scalar_one_or_none()
        if not room:
            return []

        presence = []
        for p in room.participants:
            conn_count = self.get_participant_socket_count(room_code, p.id)
            is_online = conn_count > 0
            presence.append({
                "id": p.id,
                "username": p.username,
                "is_host": p.is_host,
                "is_online": is_online,
                "status": p.status.value if hasattr(p.status, "value") else str(p.status),
                "active_connections": conn_count,
                "last_seen": p.last_seen.isoformat() if p.last_seen else None
            })
        return presence

# Global connection manager instance
connection_manager = ConnectionManager()

