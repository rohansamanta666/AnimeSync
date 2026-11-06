"""
AnimeSync — Voice Channel Manager (Phase 7 Tasks 7.2 – 7.6)

Tracks active voice participants per room and manages voice channel state:
- Participant tracking (participant_id, username, socket_id, mute state)
- Voice join/leave lifecycles
- Mute state updates
- Socket disconnection cleanup
"""
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass
class VoiceParticipant:
    participant_id: str
    username: str
    socket_id: str
    is_muted: bool = False

    def to_dict(self) -> dict:
        return {
            "participant_id": self.participant_id,
            "username": self.username,
            "socket_id": self.socket_id,
            "is_muted": self.is_muted,
        }


class VoiceManager:
    def __init__(self):
        # room_code -> {participant_id: VoiceParticipant}
        self._rooms: Dict[str, Dict[str, VoiceParticipant]] = {}

    def get_participants(self, room_code: str) -> List[VoiceParticipant]:
        """Returns all voice participants in a room."""
        return list(self._rooms.get(room_code.upper(), {}).values())

    def get_participant_dicts(self, room_code: str) -> List[dict]:
        """Returns list of serialized participant dicts in a room."""
        return [p.to_dict() for p in self.get_participants(room_code)]

    def is_in_voice(self, room_code: str, participant_id: str) -> bool:
        """Checks if participant is currently in voice."""
        return participant_id in self._rooms.get(room_code.upper(), {})

    def join_voice(
        self,
        room_code: str,
        participant_id: str,
        username: str,
        socket_id: str,
        is_muted: bool = False,
    ) -> VoiceParticipant:
        """Registers a participant in the room voice channel."""
        code = room_code.upper()
        if code not in self._rooms:
            self._rooms[code] = {}
        vp = VoiceParticipant(
            participant_id=participant_id,
            username=username,
            socket_id=socket_id,
            is_muted=is_muted,
        )
        self._rooms[code][participant_id] = vp
        return vp

    def leave_voice(self, room_code: str, participant_id: str) -> Optional[VoiceParticipant]:
        """Unregisters a participant from the room voice channel."""
        code = room_code.upper()
        if code in self._rooms and participant_id in self._rooms[code]:
            return self._rooms[code].pop(participant_id)
        return None

    def remove_by_socket_id(self, socket_id: str) -> List[Tuple[str, VoiceParticipant]]:
        """
        Removes any voice entries associated with socket_id (used on disconnect).
        Returns list of (room_code, VoiceParticipant) tuples.
        """
        removed = []
        for code, participants in list(self._rooms.items()):
            for pid, vp in list(participants.items()):
                if vp.socket_id == socket_id:
                    del participants[pid]
                    removed.append((code, vp))
        return removed

    def set_mute(
        self, room_code: str, participant_id: str, is_muted: bool
    ) -> Optional[VoiceParticipant]:
        """Updates the mute status of a voice participant."""
        code = room_code.upper()
        if code in self._rooms and participant_id in self._rooms[code]:
            vp = self._rooms[code][participant_id]
            vp.is_muted = is_muted
            return vp
        return None

    def clear(self) -> None:
        """Clears all voice tracking state (used in tests)."""
        self._rooms.clear()


voice_manager = VoiceManager()
