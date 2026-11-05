"""
Phase 5 Task 5.2 Tests: Server Playback State Machine

Covers:
1. PlaybackManager unit tests:
   - Initial state (is_playing=False, current_time=0.0, speed=1.0, seq=0)
   - PLAY action updates is_playing, advances time, increments sequence_number
   - PAUSE action updates is_playing to False and records position
   - SEEK action updates current_time to specified non-negative position
   - RATE_CHANGE action updates playback_speed within bounds [0.25, 4.0]
   - Time progression calculation when is_playing=True
   - Time does not progress when is_playing=False
   - Rejection of invalid actions (unknown string, non-string)
   - Rejection of negative timestamps
   - Rejection of invalid rates (negative, zero, > 4.0, < 0.25)
   - Rejection of missing timestamp on SEEK
   - Rejection of missing rate on RATE_CHANGE
2. Socket handler integration tests (playback_action):
   - Unauthenticated socket rejected
   - Room code mismatch rejected (room isolation)
   - Unverified participant rejected (readiness gate)
   - Verified/Watching participant succeeds for PLAY, PAUSE, SEEK, RATE_CHANGE
   - Authoritative playback_sync broadcast emitted to room with originating_socket_id
   - Sequence number monotonically increments across consecutive actions
"""
import asyncio
import time
import uuid
import secrets
from unittest.mock import AsyncMock, patch
import pytest
import pytest_asyncio
from sqlalchemy import select

from backend.app.database import init_db, AsyncSessionLocal
from backend.app.models.room import Room
from backend.app.models.participant import Participant, ParticipantStatus
from backend.app.services.room_manager import generate_room_code
from backend.app.sockets.playback_manager import (
    PlaybackManager,
    RoomPlaybackState,
    playback_manager,
)
from backend.app.sockets.connection_manager import connection_manager
from backend.app.sockets.server import (
    playback_action,
    get_playback_state,
    buffering_start,
    buffering_end,
    disconnect,
    ping_check,
    sio,
)


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()
    connection_manager._sid_to_session.clear()
    connection_manager._participant_sockets.clear()
    connection_manager._room_participants.clear()
    playback_manager.clear()
    yield
    connection_manager._sid_to_session.clear()
    connection_manager._participant_sockets.clear()
    connection_manager._room_participants.clear()
    playback_manager.clear()


async def _make_room(name: str = "Sync Room") -> Room:
    async with AsyncSessionLocal() as db:
        while True:
            code = generate_room_code()
            res = await db.execute(select(Room).where(Room.code == code))
            if not res.scalar_one_or_none():
                break
        room = Room(id=str(uuid.uuid4()), code=code, name=name, is_active=True)
        db.add(room)
        await db.commit()
        await db.refresh(room)
        return room


async def _make_participant(
    room_id: str,
    username: str = "Viewer",
    status: ParticipantStatus = ParticipantStatus.WATCHING,
) -> Participant:
    async with AsyncSessionLocal() as db:
        p = Participant(
            id=str(uuid.uuid4()),
            room_id=room_id,
            username=username,
            session_token=secrets.token_hex(32),
            is_host=False,
            status=status,
        )
        db.add(p)
        await db.commit()
        await db.refresh(p)
        return p


# ---------------------------------------------------------------------------
# 1. PlaybackManager Unit Tests
# ---------------------------------------------------------------------------

def test_playback_manager_initial_state():
    mgr = PlaybackManager()
    state = mgr.get_or_create_state("RM1001")
    assert state.room_code == "RM1001"
    assert state.is_playing is False
    assert state.current_time == 0.0
    assert state.playback_speed == 1.0
    assert state.sequence_number == 0


def test_playback_manager_play_action():
    mgr = PlaybackManager()
    state, err = mgr.process_action("RM1001", "PLAY", timestamp=10.5)
    assert err is None
    assert state.is_playing is True
    assert state.current_time == 10.5
    assert state.sequence_number == 1

    # Second action increments sequence
    state, err = mgr.process_action("RM1001", "PLAY")
    assert err is None
    assert state.sequence_number == 2


def test_playback_manager_pause_action():
    mgr = PlaybackManager()
    mgr.process_action("RM1001", "PLAY", timestamp=0.0)
    state, err = mgr.process_action("RM1001", "PAUSE", timestamp=25.0)
    assert err is None
    assert state.is_playing is False
    assert state.current_time == 25.0
    assert state.sequence_number == 2


def test_playback_manager_seek_action():
    mgr = PlaybackManager()
    # Seek requires valid timestamp
    state, err = mgr.process_action("RM1001", "SEEK", timestamp=120.0)
    assert err is None
    assert state.current_time == 120.0
    assert state.sequence_number == 1

    # Missing timestamp rejected
    _, err_missing = mgr.process_action("RM1001", "SEEK")
    assert "requires a timestamp" in err_missing


def test_playback_manager_rate_change():
    mgr = PlaybackManager()
    state, err = mgr.process_action("RM1001", "RATE_CHANGE", playback_rate=1.5)
    assert err is None
    assert state.playback_speed == 1.5
    assert state.sequence_number == 1

    # Out of bounds rejected
    _, err_low = mgr.process_action("RM1001", "RATE_CHANGE", playback_rate=0.1)
    assert "must be between" in err_low

    _, err_high = mgr.process_action("RM1001", "RATE_CHANGE", playback_rate=5.0)
    assert "must be between" in err_high


def test_playback_manager_invalid_actions_and_values():
    mgr = PlaybackManager()
    # Invalid action string
    _, err = mgr.process_action("RM1001", "EXPLODE")
    assert "Invalid playback action" in err

    # Negative timestamp on seek
    _, err = mgr.process_action("RM1001", "SEEK", timestamp=-5.0)
    assert "non-negative" in err

    # Non-numeric timestamp
    _, err = mgr.process_action("RM1001", "PLAY", timestamp="invalid")
    assert "valid number" in err


def test_playback_manager_time_progression():
    mgr = PlaybackManager()
    state, _ = mgr.process_action("RM1001", "PLAY", timestamp=10.0)

    # Simulated elapsed time
    future_time = state.updated_at + 5.0
    computed = state.compute_current_time(now=future_time)
    assert abs(computed - 15.0) < 0.01

    # When paused, time stays static
    state, _ = mgr.process_action("RM1001", "PAUSE", timestamp=15.0)
    future_time2 = state.updated_at + 10.0
    assert state.compute_current_time(now=future_time2) == 15.0


# ---------------------------------------------------------------------------
# 2. Socket Handler Integration Tests (playback_action)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_socket_playback_action_unauthenticated():
    """Unregistered/unauthenticated socket cannot invoke playback actions."""
    res = await playback_action("unauth_sid", {"action": "PLAY"})
    assert res["status"] == "ERROR"
    assert "unauthenticated" in res["message"]


@pytest.mark.asyncio
async def test_socket_playback_action_room_isolation_mismatch():
    """Socket session in Room A cannot issue playback action targeting Room B."""
    room_a = await _make_room("Room A")
    participant_a = await _make_participant(room_a.id, "Alice", ParticipantStatus.WATCHING)

    sid = "sid_alice"
    await connection_manager.register_connection(
        sid=sid, room_code=room_a.code, room_id=room_a.id,
        participant_id=participant_a.id, username="Alice", is_host=True
    )

    # Send action with explicit mismatched room_code
    res = await playback_action(sid, {"action": "PLAY", "room_code": "WRONG9"})
    assert res["status"] == "ERROR"
    assert "Room code mismatch" in res["message"]

    await connection_manager.unregister_connection(sid)


@pytest.mark.asyncio
async def test_socket_playback_action_readiness_gate_rejection():
    """Participant with WAITING_FOR_FILE or VERIFICATION_FAILED cannot control playback."""
    room = await _make_room("Room Gate")
    participant = await _make_participant(room.id, "UnverifiedBob", ParticipantStatus.WAITING_FOR_FILE)

    sid = "sid_bob"
    await connection_manager.register_connection(
        sid=sid, room_code=room.code, room_id=room.id,
        participant_id=participant.id, username="Bob", is_host=False
    )

    res = await playback_action(sid, {"action": "PLAY", "timestamp": 0.0})
    assert res["status"] == "ERROR"
    assert "File must be verified first" in res["message"]

    await connection_manager.unregister_connection(sid)


@pytest.mark.asyncio
async def test_socket_playback_action_play_pause_seek_rate_lifecycle():
    """Full lifecycle: PLAY -> PAUSE -> SEEK -> RATE_CHANGE broadcasts playback_sync."""
    room = await _make_room("Watch Room")
    participant = await _make_participant(room.id, "Carol", ParticipantStatus.WATCHING)

    sid = "sid_carol"
    await connection_manager.register_connection(
        sid=sid, room_code=room.code, room_id=room.id,
        participant_id=participant.id, username="Carol", is_host=True
    )

    with patch.object(sio, "emit", new_callable=AsyncMock) as mock_emit:
        # 1. PLAY action
        res_play = await playback_action(sid, {"action": "PLAY", "timestamp": 0.0})
        assert res_play["status"] == "OK"
        assert res_play["sequence_number"] == 1
        assert res_play["state"]["is_playing"] is True

        # Verify playback_sync broadcast
        calls = [c for c in mock_emit.call_args_list if c[0][0] == "playback_sync"]
        assert len(calls) == 1
        payload = calls[0][0][1]
        assert payload["action"] == "PLAY"
        assert payload["room_code"] == room.code
        assert payload["originating_socket_id"] == sid
        assert payload["server_sequence"] == 1

        # 2. PAUSE action
        res_pause = await playback_action(sid, {"action": "PAUSE", "timestamp": 12.4})
        assert res_pause["status"] == "OK"
        assert res_pause["sequence_number"] == 2
        assert res_pause["state"]["is_playing"] is False

        calls = [c for c in mock_emit.call_args_list if c[0][0] == "playback_sync"]
        assert len(calls) == 2
        assert calls[1][0][1]["action"] == "PAUSE"
        assert calls[1][0][1]["server_sequence"] == 2

        # 3. SEEK action
        res_seek = await playback_action(sid, {"action": "SEEK", "timestamp": 150.0})
        assert res_seek["status"] == "OK"
        assert res_seek["sequence_number"] == 3
        assert res_seek["state"]["current_time"] == 150.0

        calls = [c for c in mock_emit.call_args_list if c[0][0] == "playback_sync"]
        assert len(calls) == 3
        assert calls[2][0][1]["action"] == "SEEK"
        assert calls[2][0][1]["timestamp"] == 150.0

        # 4. RATE_CHANGE action
        res_rate = await playback_action(sid, {"action": "RATE_CHANGE", "playback_rate": 1.25})
        assert res_rate["status"] == "OK"
        assert res_rate["sequence_number"] == 4
        assert res_rate["state"]["playback_speed"] == 1.25

        calls = [c for c in mock_emit.call_args_list if c[0][0] == "playback_sync"]
        assert len(calls) == 4
        assert calls[3][0][1]["action"] == "RATE_CHANGE"
        assert calls[3][0][1]["playback_rate"] == 1.25

        # 5. get_playback_state test
        res_state = await get_playback_state(sid)
        assert res_state["status"] == "OK"
        assert res_state["state"]["sequence_number"] == 4
        assert res_state["state"]["playback_speed"] == 1.25

    await connection_manager.unregister_connection(sid)


# ---------------------------------------------------------------------------
# 3. Two-Participant Watch Party Coordination Tests (Task 5.3)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_two_participants_playback_sync_and_echo_suppression():
    """
    Simulates two participants (Host and Friend) watching in the same room:
    1. Host emits PLAY -> Server broadcasts to room with origin_sid = sid_host.
       - Host ignores own broadcast (loop prevention).
       - Friend applies remote PLAY.
    2. Friend emits PAUSE -> Server broadcasts with origin_sid = sid_friend.
       - Friend ignores own broadcast.
       - Host applies remote PAUSE.
    3. Monotonic sequence increments on each action.
    """
    room = await _make_room("Duo Party")
    host = await _make_participant(room.id, "HostUser", ParticipantStatus.WATCHING)
    friend = await _make_participant(room.id, "FriendUser", ParticipantStatus.WATCHING)

    sid_host = "sid_host_tab1"
    sid_friend = "sid_friend_tab2"

    await connection_manager.register_connection(
        sid=sid_host, room_code=room.code, room_id=room.id,
        participant_id=host.id, username="HostUser", is_host=True
    )
    await connection_manager.register_connection(
        sid=sid_friend, room_code=room.code, room_id=room.id,
        participant_id=friend.id, username="FriendUser", is_host=False
    )

    with patch.object(sio, "emit", new_callable=AsyncMock) as mock_emit:
        # Step 1: Host presses Play
        res_play = await playback_action(sid_host, {
            "action": "PLAY",
            "timestamp": 0.0,
            "room_code": room.code
        })
        assert res_play["status"] == "OK"
        assert res_play["sequence_number"] == 1

        # Check broadcast payload sent to room
        calls = [c for c in mock_emit.call_args_list if c[0][0] == "playback_sync"]
        assert len(calls) == 1
        sync_1 = calls[0][0][1]
        assert sync_1["room_code"] == room.code
        assert sync_1["action"] == "PLAY"
        assert sync_1["originating_socket_id"] == sid_host
        assert sync_1["server_sequence"] == 1

        # Verify client-side loop prevention rules:
        # Host: origin matches own sid -> SUPPRESS (no feedback loop)
        assert sync_1["originating_socket_id"] == sid_host
        # Friend: origin does NOT match friend's sid -> APPLY
        assert sync_1["originating_socket_id"] != sid_friend

        # Step 2: Friend presses Pause at 23.5s
        res_pause = await playback_action(sid_friend, {
            "action": "PAUSE",
            "timestamp": 23.5,
            "room_code": room.code
        })
        assert res_pause["status"] == "OK"
        assert res_pause["sequence_number"] == 2

        calls = [c for c in mock_emit.call_args_list if c[0][0] == "playback_sync"]
        assert len(calls) == 2
        sync_2 = calls[1][0][1]
        assert sync_2["action"] == "PAUSE"
        assert sync_2["timestamp"] == 23.5
        assert sync_2["originating_socket_id"] == sid_friend
        assert sync_2["server_sequence"] == 2

        # Friend ignores own pause; Host applies friend's pause
        assert sync_2["originating_socket_id"] == sid_friend
        assert sync_2["originating_socket_id"] != sid_host

    await connection_manager.unregister_connection(sid_host)
    await connection_manager.unregister_connection(sid_friend)


@pytest.mark.asyncio
async def test_cross_room_playback_isolation():
    """Playback action in Room 1 must only emit to Room 1 channel, never to Room 2."""
    room_1 = await _make_room("Room One")
    room_2 = await _make_room("Room Two")
    p1 = await _make_participant(room_1.id, "User1", ParticipantStatus.WATCHING)
    p2 = await _make_participant(room_2.id, "User2", ParticipantStatus.WATCHING)

    sid_1 = "sid_r1"
    sid_2 = "sid_r2"
    await connection_manager.register_connection(
        sid=sid_1, room_code=room_1.code, room_id=room_1.id,
        participant_id=p1.id, username="User1", is_host=True
    )
    await connection_manager.register_connection(
        sid=sid_2, room_code=room_2.code, room_id=room_2.id,
        participant_id=p2.id, username="User2", is_host=True
    )

    with patch.object(sio, "emit", new_callable=AsyncMock) as mock_emit:
        res = await playback_action(sid_1, {"action": "PLAY", "timestamp": 0.0})
        assert res["status"] == "OK"

        calls = [c for c in mock_emit.call_args_list if c[0][0] == "playback_sync"]
        assert len(calls) == 1
        # Target room must be room_1.code strictly
        assert calls[0][1]["room"] == room_1.code
        assert calls[0][1]["room"] != room_2.code

    await connection_manager.unregister_connection(sid_1)
    await connection_manager.unregister_connection(sid_2)


@pytest.mark.asyncio
async def test_get_playback_state_socket_handler():
    """get_playback_state socket event returns authoritative room state."""
    room = await _make_room("State Room")
    p = await _make_participant(room.id, "Host", ParticipantStatus.WATCHING)
    sid = "sid_state_test"
    await connection_manager.register_connection(
        sid=sid, room_code=room.code, room_id=room.id,
        participant_id=p.id, username="Host", is_host=True
    )

    # Initial state before action
    res = await get_playback_state(sid, {})
    assert res["status"] == "OK"
    assert res["state"]["is_playing"] is False
    assert res["state"]["playback_speed"] == 1.0
    assert res["state"]["sequence_number"] == 0

    # Start playback
    await playback_action(sid, {"action": "PLAY", "timestamp": 12.0})

    # Updated state
    res2 = await get_playback_state(sid, {})
    assert res2["status"] == "OK"
    assert res2["state"]["is_playing"] is True
    assert res2["state"]["current_time"] >= 12.0
    assert res2["state"]["sequence_number"] == 1

    await connection_manager.unregister_connection(sid)


def test_authoritative_drift_formula_consistency():
    """Server-authoritative compute_current_time matches client drift model."""
    state = RoomPlaybackState(
        room_code="DRIFT01",
        is_playing=True,
        current_time=10.0,
        playback_speed=1.0,
        updated_at=100.0,
        sequence_number=1,
    )
    # Elapsed = 5.0 seconds -> authoritative time = 15.0
    auth_time = state.compute_current_time(now=105.0)
    assert auth_time == 15.0

    # Local player at 14.5s -> drift = 14.5 - 15.0 = -0.5s (behind, requires +5% speedup)
    drift = 14.5 - auth_time
    assert drift == -0.5

    # Local player at 17.0s -> drift = 17.0 - 15.0 = +2.0s (hard seek required)
    drift_macro = 17.0 - auth_time
    assert drift_macro == 2.0


# ---------------------------------------------------------------------------
# Phase 5 Task 5.5: Buffering Detection & Recovery Tests
# ---------------------------------------------------------------------------

def test_playback_manager_buffering_coordination_and_recovery():
    """PlaybackManager coordinates shared pause when buffering and resumes when all ready."""
    pm = PlaybackManager()
    room = "BUF_ROOM"

    # 1. Start playback
    state = pm.get_or_create_state(room)
    state.is_playing = True
    state.current_time = 10.0
    state.updated_at = time.time()
    state.sequence_number = 1

    # 2. Participant 1 starts buffering -> shared pause
    was_paused, state = pm.add_buffering_participant(room, "p1", "User1")
    assert was_paused is True
    assert state.is_playing is False
    assert state.paused_for_buffering is True
    assert state.sequence_number == 2
    assert pm.is_room_buffering(room) is True
    assert pm.get_buffering_usernames(room) == ["User1"]

    # 3. Participant 2 also starts buffering -> no second pause, but recorded
    was_paused2, state = pm.add_buffering_participant(room, "p2", "User2")
    assert was_paused2 is False
    assert state.is_playing is False
    assert state.sequence_number == 2  # No duplicate sequence increment
    assert set(pm.get_buffering_usernames(room)) == {"User1", "User2"}

    # 4. Participant 1 finishes buffering -> p2 still buffering, do NOT resume
    was_removed, should_resume, state = pm.remove_buffering_participant(room, "p1")
    assert was_removed is True
    assert should_resume is False
    assert state.is_playing is False
    assert state.paused_for_buffering is True
    assert pm.get_buffering_usernames(room) == ["User2"]

    # 5. Participant 2 finishes buffering -> all ready, auto-resumes!
    was_removed2, should_resume2, state = pm.remove_buffering_participant(room, "p2")
    assert was_removed2 is True
    assert should_resume2 is True
    assert state.is_playing is True
    assert state.paused_for_buffering is False
    assert state.sequence_number == 3
    assert pm.is_room_buffering(room) is False


def test_playback_manager_buffering_while_paused_no_autoresume():
    """Buffering while playback is already paused should NOT trigger auto-resume."""
    pm = PlaybackManager()
    room = "PAUSED_BUF"

    state = pm.get_or_create_state(room)
    state.is_playing = False
    state.current_time = 5.0
    state.sequence_number = 1

    # Participant buffers while paused (e.g. seeking)
    was_paused, state = pm.add_buffering_participant(room, "p1", "User1")
    assert was_paused is False
    assert state.paused_for_buffering is False
    assert state.sequence_number == 1

    # Buffering finishes -> must NOT start playing
    was_removed, should_resume, state = pm.remove_buffering_participant(room, "p1")
    assert was_removed is True
    assert should_resume is False
    assert state.is_playing is False


def test_playback_manager_manual_pause_overrides_buffering_resume():
    """If user manually pauses while video was paused for buffering, do NOT auto-resume."""
    pm = PlaybackManager()
    room = "OVERRIDE_BUF"

    state = pm.get_or_create_state(room)
    state.is_playing = True
    pm.add_buffering_participant(room, "p1", "User1")
    assert state.paused_for_buffering is True

    # User explicitly clicks PAUSE
    pm.process_action(room, "PAUSE", timestamp=10.0)
    assert state.paused_for_buffering is False

    # Buffering finishes -> must remain paused
    was_removed, should_resume, state = pm.remove_buffering_participant(room, "p1")
    assert was_removed is True
    assert should_resume is False
    assert state.is_playing is False


@pytest.mark.asyncio
async def test_socket_buffering_start_and_end_lifecycle():
    """Socket handlers buffering_start and buffering_end coordinate shared pause and resume."""
    room = await _make_room("Buffering Socket Room")
    p1 = await _make_participant(room.id, "Host", ParticipantStatus.WATCHING)
    p2 = await _make_participant(room.id, "Friend", ParticipantStatus.WATCHING)

    sid1 = "sid_host_buf"
    sid2 = "sid_friend_buf"
    await connection_manager.register_connection(
        sid=sid1, room_code=room.code, room_id=room.id,
        participant_id=p1.id, username="Host", is_host=True
    )
    await connection_manager.register_connection(
        sid=sid2, room_code=room.code, room_id=room.id,
        participant_id=p2.id, username="Friend", is_host=False
    )

    # Start playback
    await playback_action(sid1, {"action": "PLAY", "timestamp": 10.0})

    with patch.object(sio, "emit", new_callable=AsyncMock) as mock_emit:
        # Friend buffers -> shared pause broadcast
        res = await buffering_start(sid2, {"room_code": room.code, "current_time": 10.5})
        assert res["status"] == "OK"
        assert res["is_buffering"] is True
        assert res["paused"] is True

        calls = mock_emit.call_args_list
        sync_calls = [c for c in calls if c[0][0] == "playback_sync"]
        buf_calls = [c for c in calls if c[0][0] == "buffering_update"]

        assert len(sync_calls) == 1
        assert sync_calls[0][0][1]["action"] == "PAUSE"
        assert sync_calls[0][0][1]["reason"] == "buffering"

        assert len(buf_calls) == 1
        assert buf_calls[0][0][1]["is_buffering"] is True
        assert buf_calls[0][0][1]["buffering_participants"] == ["Friend"]

    with patch.object(sio, "emit", new_callable=AsyncMock) as mock_emit_resume:
        # Friend finishes buffering -> shared resume broadcast
        res_end = await buffering_end(sid2, {"room_code": room.code, "current_time": 10.5})
        assert res_end["status"] == "OK"
        assert res_end["resumed"] is True

        calls_res = mock_emit_resume.call_args_list
        sync_calls_res = [c for c in calls_res if c[0][0] == "playback_sync"]
        buf_calls_res = [c for c in calls_res if c[0][0] == "buffering_update"]

        assert len(sync_calls_res) == 1
        assert sync_calls_res[0][0][1]["action"] == "PLAY"
        assert sync_calls_res[0][0][1]["originating_socket_id"] == "server"
        assert sync_calls_res[0][0][1]["reason"] == "buffering_resolved"

        assert len(buf_calls_res) == 1
        assert buf_calls_res[0][0][1]["is_buffering"] is False
        assert buf_calls_res[0][0][1]["buffering_participants"] == []

    await connection_manager.unregister_connection(sid1)
    await connection_manager.unregister_connection(sid2)


@pytest.mark.asyncio
async def test_socket_buffering_multiple_participants_coordination():
    """Resume occurs only when ALL buffering participants in room have finished."""
    room = await _make_room("Multi Buf Room")
    p1 = await _make_participant(room.id, "Host", ParticipantStatus.WATCHING)
    p2 = await _make_participant(room.id, "Friend", ParticipantStatus.WATCHING)

    sid1 = "sid_multi_1"
    sid2 = "sid_multi_2"
    await connection_manager.register_connection(
        sid=sid1, room_code=room.code, room_id=room.id,
        participant_id=p1.id, username="Host", is_host=True
    )
    await connection_manager.register_connection(
        sid=sid2, room_code=room.code, room_id=room.id,
        participant_id=p2.id, username="Friend", is_host=False
    )

    # Playing
    await playback_action(sid1, {"action": "PLAY", "timestamp": 20.0})

    # Both start buffering
    await buffering_start(sid1, {"room_code": room.code})
    await buffering_start(sid2, {"room_code": room.code})

    with patch.object(sio, "emit", new_callable=AsyncMock) as mock_emit:
        # Host finishes buffering -> Friend is still buffering -> NO resume
        res = await buffering_end(sid1, {"room_code": room.code})
        assert res["status"] == "OK"
        assert res["resumed"] is False

        # Ensure NO playback_sync PLAY was emitted
        play_calls = [
            c for c in mock_emit.call_args_list
            if c[0][0] == "playback_sync" and c[0][1].get("action") == "PLAY"
        ]
        assert len(play_calls) == 0

    with patch.object(sio, "emit", new_callable=AsyncMock) as mock_emit_final:
        # Friend finishes buffering -> LAST buffering participant -> RESUMES
        res2 = await buffering_end(sid2, {"room_code": room.code})
        assert res2["status"] == "OK"
        assert res2["resumed"] is True

        play_calls2 = [
            c for c in mock_emit_final.call_args_list
            if c[0][0] == "playback_sync" and c[0][1].get("action") == "PLAY"
        ]
        assert len(play_calls2) == 1
        assert play_calls2[0][0][1]["originating_socket_id"] == "server"

    await connection_manager.unregister_connection(sid1)
    await connection_manager.unregister_connection(sid2)


@pytest.mark.asyncio
async def test_socket_buffering_disconnect_recovery():
    """When a buffering participant disconnects, remaining viewers resume playback cleanly."""
    room = await _make_room("Disconnect Buf Room")
    p1 = await _make_participant(room.id, "Host", ParticipantStatus.WATCHING)
    p2 = await _make_participant(room.id, "Friend", ParticipantStatus.WATCHING)

    sid1 = "sid_disc_host"
    sid2 = "sid_disc_friend"
    await connection_manager.register_connection(
        sid=sid1, room_code=room.code, room_id=room.id,
        participant_id=p1.id, username="Host", is_host=True
    )
    await connection_manager.register_connection(
        sid=sid2, room_code=room.code, room_id=room.id,
        participant_id=p2.id, username="Friend", is_host=False
    )

    # Start playing
    await playback_action(sid1, {"action": "PLAY", "timestamp": 35.0})

    # Friend starts buffering -> room pauses
    await buffering_start(sid2, {"room_code": room.code})

    state = playback_manager.get_or_create_state(room.code)
    assert state.is_playing is False
    assert state.paused_for_buffering is True

    # Friend disconnects unexpectedly!
    with patch.object(sio, "emit", new_callable=AsyncMock) as mock_emit:
        await disconnect(sid2)

        # Remaining viewer (Host) must receive playback_sync PLAY resume
        play_calls = [
            c for c in mock_emit.call_args_list
            if c[0][0] == "playback_sync" and c[0][1].get("action") == "PLAY"
        ]
        assert len(play_calls) == 1
        assert play_calls[0][0][1]["reason"] == "buffering_disconnect_recovery"

        state_after = playback_manager.get_or_create_state(room.code)
        assert state_after.is_playing is True
        assert state_after.paused_for_buffering is False

    await connection_manager.unregister_connection(sid1)


@pytest.mark.asyncio
async def test_socket_buffering_unverified_rejected():
    """Unverified participant cannot trigger buffering coordination."""
    room = await _make_room("Unverified Buf Room")
    p = await _make_participant(room.id, "Guest", ParticipantStatus.WAITING_FOR_FILE)
    sid = "sid_unverified_buf"
    await connection_manager.register_connection(
        sid=sid, room_code=room.code, room_id=room.id,
        participant_id=p.id, username="Guest", is_host=False
    )

    res = await buffering_start(sid, {"room_code": room.code})
    assert res["status"] == "ERROR"
    assert "cannot participate in buffering sync" in res["message"]

    await connection_manager.unregister_connection(sid)


# ---------------------------------------------------------------------------
# Phase 5 Task 5.6: Ping Latency & Manual Resync Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ping_check_latency_measurement():
    """ping_check socket handler echoes client timestamp and returns server time."""
    client_send_ms = 1730000000123
    res = await ping_check("any_sid", {"client_time": client_send_ms})
    assert res["status"] == "OK"
    assert res["client_time"] == client_send_ms
    assert isinstance(res["server_time"], float)
    assert res["server_time"] > 0


@pytest.mark.asyncio
async def test_manual_resync_alignment_playing():
    """Manual Resync while playing returns authoritative time and active playing status."""
    room = await _make_room("Resync Play Room")
    p1 = await _make_participant(room.id, "Host", ParticipantStatus.WATCHING)
    p2 = await _make_participant(room.id, "Friend", ParticipantStatus.WATCHING)

    sid1 = "sid_resync_h"
    sid2 = "sid_resync_f"
    await connection_manager.register_connection(
        sid=sid1, room_code=room.code, room_id=room.id,
        participant_id=p1.id, username="Host", is_host=True
    )
    await connection_manager.register_connection(
        sid=sid2, room_code=room.code, room_id=room.id,
        participant_id=p2.id, username="Friend", is_host=False
    )

    # Host starts playback at 40.0s
    await playback_action(sid1, {"action": "PLAY", "timestamp": 40.0})

    # Friend performs manual Resync via get_playback_state
    res = await get_playback_state(sid2, {})
    assert res["status"] == "OK"
    state = res["state"]
    assert state["is_playing"] is True
    assert state["current_time"] >= 40.0
    assert state["playback_speed"] == 1.0
    assert state["paused_for_buffering"] is False
    assert state["sequence_number"] == 1

    await connection_manager.unregister_connection(sid1)
    await connection_manager.unregister_connection(sid2)


@pytest.mark.asyncio
async def test_manual_resync_alignment_paused():
    """Manual Resync while paused returns exact static position and is_playing=False."""
    room = await _make_room("Resync Pause Room")
    p = await _make_participant(room.id, "Host", ParticipantStatus.WATCHING)
    sid = "sid_resync_pause"
    await connection_manager.register_connection(
        sid=sid, room_code=room.code, room_id=room.id,
        participant_id=p.id, username="Host", is_host=True
    )

    # Play then pause at 15.5s
    await playback_action(sid, {"action": "PLAY", "timestamp": 10.0})
    await playback_action(sid, {"action": "PAUSE", "timestamp": 15.5})

    # Resync query
    res = await get_playback_state(sid, {})
    assert res["status"] == "OK"
    state = res["state"]
    assert state["is_playing"] is False
    assert state["current_time"] == 15.5
    assert state["paused_for_buffering"] is False

    await connection_manager.unregister_connection(sid)


@pytest.mark.asyncio
async def test_manual_resync_alignment_buffering_preservation():
    """Manual Resync while room is paused for buffering preserves paused_for_buffering flag."""
    room = await _make_room("Resync Buf Room")
    p1 = await _make_participant(room.id, "Host", ParticipantStatus.WATCHING)
    p2 = await _make_participant(room.id, "Friend", ParticipantStatus.WATCHING)

    sid1 = "sid_buf_resync_h"
    sid2 = "sid_buf_resync_f"
    await connection_manager.register_connection(
        sid=sid1, room_code=room.code, room_id=room.id,
        participant_id=p1.id, username="Host", is_host=True
    )
    await connection_manager.register_connection(
        sid=sid2, room_code=room.code, room_id=room.id,
        participant_id=p2.id, username="Friend", is_host=False
    )

    # Start playback
    await playback_action(sid1, {"action": "PLAY", "timestamp": 25.0})

    # Friend buffers -> shared pause
    await buffering_start(sid2, {"room_code": room.code})

    # Host triggers manual Resync while friend is buffering
    res = await get_playback_state(sid1, {})
    assert res["status"] == "OK"
    state = res["state"]
    assert state["is_playing"] is False
    assert state["paused_for_buffering"] is True
    # Crucial: local player will remain paused because paused_for_buffering is True

    await connection_manager.unregister_connection(sid1)
    await connection_manager.unregister_connection(sid2)





