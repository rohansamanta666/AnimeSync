"""
AnimeSync — Playback State Machine (Phase 5 Tasks 5.2 & 5.5)

Tracks and coordinates server-authoritative playback state and buffering per room:
- is_playing: boolean
- current_time: authoritative video position in seconds
- playback_speed: playback multiplier (e.g. 1.0, 1.25)
- updated_at: server monotonic/epoch timestamp of last state change
- sequence_number: monotonically increasing integer on every valid action
- paused_for_buffering: whether the playback was automatically paused due to buffering
- buffering_participants: tracking participants who are currently buffering
"""
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

VALID_ACTIONS = {"PLAY", "PAUSE", "SEEK", "RATE_CHANGE"}
MIN_PLAYBACK_SPEED = 0.25
MAX_PLAYBACK_SPEED = 4.0


@dataclass
class RoomPlaybackState:
    room_code: str
    is_playing: bool = False
    current_time: float = 0.0
    playback_speed: float = 1.0
    updated_at: float = 0.0
    sequence_number: int = 0
    paused_for_buffering: bool = False

    def compute_current_time(self, now: Optional[float] = None) -> float:
        """
        Computes the authoritative elapsed playback position.
        If playing, advances time by (elapsed_seconds * playback_speed).
        If paused, returns the static current_time.
        """
        if not self.is_playing:
            return max(0.0, float(self.current_time))
        if now is None:
            now = time.time()
        elapsed = max(0.0, now - self.updated_at)
        return max(0.0, float(self.current_time) + (elapsed * float(self.playback_speed)))

    def to_dict(self) -> dict:
        return {
            "room_code": self.room_code,
            "is_playing": self.is_playing,
            "current_time": round(self.compute_current_time(), 3),
            "playback_speed": self.playback_speed,
            "updated_at": self.updated_at,
            "sequence_number": self.sequence_number,
            "paused_for_buffering": self.paused_for_buffering,
        }


class PlaybackManager:
    """In-memory manager tracking playback state and buffering coordination for all active rooms."""

    def __init__(self):
        self._states: Dict[str, RoomPlaybackState] = {}
        # room_code -> {participant_id: username}
        self._buffering_participants: Dict[str, Dict[str, str]] = {}

    def get_state(self, room_code: str) -> Optional[RoomPlaybackState]:
        return self._states.get(room_code.upper())

    def get_or_create_state(self, room_code: str) -> RoomPlaybackState:
        code = room_code.upper()
        if code not in self._states:
            self._states[code] = RoomPlaybackState(
                room_code=code,
                is_playing=False,
                current_time=0.0,
                playback_speed=1.0,
                updated_at=time.time(),
                sequence_number=0,
                paused_for_buffering=False,
            )
        return self._states[code]

    def reset_state(self, room_code: str) -> RoomPlaybackState:
        code = room_code.upper()
        state = RoomPlaybackState(
            room_code=code,
            is_playing=False,
            current_time=0.0,
            playback_speed=1.0,
            updated_at=time.time(),
            sequence_number=0,
            paused_for_buffering=False,
        )
        self._states[code] = state
        self.clear_room_buffering(code)
        return state

    def clear(self) -> None:
        """Clear all room playback states and buffering info (used for test isolation)."""
        self._states.clear()
        self._buffering_participants.clear()

    # ---------------------------------------------------------------------------
    # Buffering Tracking & Shared Pause / Resume Coordination
    # ---------------------------------------------------------------------------

    def get_buffering_participants(self, room_code: str) -> Dict[str, str]:
        """Returns mapping of participant_id -> username for currently buffering participants."""
        return dict(self._buffering_participants.get(room_code.upper(), {}))

    def get_buffering_usernames(self, room_code: str) -> List[str]:
        return list(self.get_buffering_participants(room_code).values())

    def get_buffering_participant_ids(self, room_code: str) -> List[str]:
        return list(self.get_buffering_participants(room_code).keys())

    def is_room_buffering(self, room_code: str) -> bool:
        return len(self._buffering_participants.get(room_code.upper(), {})) > 0

    def add_buffering_participant(
        self, room_code: str, participant_id: str, username: str
    ) -> Tuple[bool, RoomPlaybackState]:
        """
        Records that participant_id is buffering.
        If room was actively playing, automatically pauses playback for buffering.
        Returns: (was_paused_by_this_call, state).
        """
        code = room_code.upper()
        if code not in self._buffering_participants:
            self._buffering_participants[code] = {}
        self._buffering_participants[code][participant_id] = username

        state = self.get_or_create_state(code)
        was_playing = state.is_playing
        if was_playing:
            now = time.time()
            state.current_time = state.compute_current_time(now)
            state.is_playing = False
            state.paused_for_buffering = True
            state.updated_at = now
            state.sequence_number += 1
            return True, state
        return False, state

    def remove_buffering_participant(
        self, room_code: str, participant_id: str
    ) -> Tuple[bool, bool, RoomPlaybackState]:
        """
        Removes participant_id from buffering set.
        If no buffering participants remain AND room was paused for buffering,
        automatically resumes playback and increments sequence.
        Returns: (was_removed, should_resume, state).
        """
        code = room_code.upper()
        room_buf = self._buffering_participants.get(code, {})
        was_removed = participant_id in room_buf
        if was_removed:
            del room_buf[participant_id]

        state = self.get_or_create_state(code)
        remaining = len(room_buf)
        should_resume = False

        if was_removed and remaining == 0 and state.paused_for_buffering:
            now = time.time()
            state.paused_for_buffering = False
            state.is_playing = True
            state.updated_at = now
            state.sequence_number += 1
            should_resume = True

        return was_removed, should_resume, state

    def clear_buffering_for_participant(
        self, room_code: str, participant_id: str
    ) -> Tuple[bool, bool, RoomPlaybackState]:
        """Alias for remove_buffering_participant, used on disconnect or departure."""
        return self.remove_buffering_participant(room_code, participant_id)

    def clear_room_buffering(self, room_code: str) -> None:
        code = room_code.upper()
        if code in self._buffering_participants:
            self._buffering_participants[code].clear()

    # ---------------------------------------------------------------------------
    # Action Processor
    # ---------------------------------------------------------------------------

    def process_action(
        self,
        room_code: str,
        action: str,
        timestamp: Optional[float] = None,
        playback_rate: Optional[float] = None,
    ) -> Tuple[Optional[RoomPlaybackState], Optional[str]]:
        """
        Validates and applies a playback action.
        Returns: (updated_state, error_message).
        If error_message is not None, the action was rejected.
        """
        if not action or not isinstance(action, str):
            return None, "Action must be a non-empty string"

        norm_action = action.strip().upper()
        if norm_action not in VALID_ACTIONS:
            return None, f"Invalid playback action '{action}'. Allowed: {sorted(VALID_ACTIONS)}"

        state = self.get_or_create_state(room_code)
        now = time.time()

        if norm_action == "PLAY":
            if timestamp is not None:
                try:
                    ts = float(timestamp)
                    if ts < 0 or ts != ts or ts == float("inf"):
                        return None, "Timestamp must be a non-negative finite number"
                    state.current_time = ts
                except (ValueError, TypeError):
                    return None, "Timestamp must be a valid number"
            else:
                state.current_time = state.compute_current_time(now)

            state.is_playing = True
            state.paused_for_buffering = False  # Explicit play overrides buffering pause
            state.updated_at = now
            state.sequence_number += 1
            return state, None

        elif norm_action == "PAUSE":
            if timestamp is not None:
                try:
                    ts = float(timestamp)
                    if ts < 0 or ts != ts or ts == float("inf"):
                        return None, "Timestamp must be a non-negative finite number"
                    state.current_time = ts
                except (ValueError, TypeError):
                    return None, "Timestamp must be a valid number"
            else:
                state.current_time = state.compute_current_time(now)

            state.is_playing = False
            state.paused_for_buffering = False  # Explicit pause overrides buffering pause
            state.updated_at = now
            state.sequence_number += 1
            return state, None

        elif norm_action == "SEEK":
            if timestamp is None:
                return None, "SEEK action requires a timestamp parameter"
            try:
                ts = float(timestamp)
                if ts < 0 or ts != ts or ts == float("inf"):
                    return None, "Seek timestamp must be a non-negative finite number"
            except (ValueError, TypeError):
                return None, "Seek timestamp must be a valid number"

            state.current_time = ts
            state.updated_at = now
            state.sequence_number += 1
            return state, None

        elif norm_action == "RATE_CHANGE":
            if playback_rate is None:
                return None, "RATE_CHANGE action requires a playback_rate parameter"
            try:
                rate = float(playback_rate)
                if rate != rate or rate == float("inf") or rate <= 0:
                    return None, "Playback rate must be a positive finite number"
                if rate < MIN_PLAYBACK_SPEED or rate > MAX_PLAYBACK_SPEED:
                    return (
                        None,
                        f"Playback rate must be between {MIN_PLAYBACK_SPEED} and {MAX_PLAYBACK_SPEED}",
                    )
            except (ValueError, TypeError):
                return None, "Playback rate must be a valid number"

            # Compute current time before speed change so timeline remains accurate
            state.current_time = state.compute_current_time(now)
            state.playback_speed = rate
            state.updated_at = now
            state.sequence_number += 1
            return state, None

        return None, "Unhandled playback action"


# Authoritative playback manager singleton
playback_manager = PlaybackManager()
