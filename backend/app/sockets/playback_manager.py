"""
AnimeSync — Playback State Machine (Phase 5 Task 5.2)

Tracks and coordinates server-authoritative playback state per room:
- is_playing: boolean
- current_time: authoritative video position in seconds
- playback_speed: playback multiplier (e.g. 1.0, 1.25)
- updated_at: server monotonic/epoch timestamp of last state change
- sequence_number: monotonically increasing integer on every valid action
"""
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

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
        }


class PlaybackManager:
    """In-memory manager tracking playback state for all active rooms."""

    def __init__(self):
        self._states: Dict[str, RoomPlaybackState] = {}

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
        )
        self._states[code] = state
        return state

    def clear(self) -> None:
        """Clear all room playback states (used for test isolation)."""
        self._states.clear()

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

