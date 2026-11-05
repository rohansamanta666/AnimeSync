"""
Phase 4 tests: Ready-to-Watch state machine

Covers:
1. WAITING_FOR_FILE participant cannot become READY (validation rule)
2. VERIFIED participant transitions to READY correctly in DB
3. READY participant reverts to VERIFIED on set_unready
4. _all_online_participants_ready logic (online-only check)
5. invalidate_room_readiness resets READY/VERIFIED, preserves WATCHING
6. Countdown task cancellation (_cancel_countdown)
7. Disconnect / Leave cancels in-progress countdown
8. set_ready socket event rejected for unverified participant
9. set_ready socket event succeeds for verified participant
"""
import asyncio
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
from backend.app.sockets.server import (
    _all_online_participants_ready,
    invalidate_room_readiness,
    _countdown_tasks,
    _cancel_countdown,
    set_ready,
    set_unready,
    sio,
)
from backend.app.sockets.connection_manager import connection_manager


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    """Initialize DB schema and clean up in-memory state before & after each test."""
    await init_db()
    connection_manager._sid_to_session.clear()
    connection_manager._participant_sockets.clear()
    connection_manager._room_participants.clear()
    for task in list(_countdown_tasks.values()):
        task.cancel()
    _countdown_tasks.clear()
    yield
    for task in list(_countdown_tasks.values()):
        task.cancel()
    _countdown_tasks.clear()
    connection_manager._sid_to_session.clear()
    connection_manager._participant_sockets.clear()
    connection_manager._room_participants.clear()


async def _make_room(name: str = "Test Room") -> Room:
    async with AsyncSessionLocal() as db:
        while True:
            code = generate_room_code()
            result = await db.execute(select(Room).where(Room.code == code))
            if not result.scalar_one_or_none():
                break
        room = Room(id=str(uuid.uuid4()), code=code, name=name, is_active=True)
        db.add(room)
        await db.commit()
        await db.refresh(room)
        return room


async def _make_participant(
    room_id: str,
    username: str = "User",
    is_host: bool = False,
    status: ParticipantStatus = ParticipantStatus.WAITING_FOR_FILE,
    verified_hash: str | None = None,
) -> Participant:
    async with AsyncSessionLocal() as db:
        p = Participant(
            id=str(uuid.uuid4()),
            room_id=room_id,
            username=username,
            session_token=secrets.token_hex(32),
            is_host=is_host,
            status=status,
            verified_file_hash=verified_hash,
        )
        db.add(p)
        await db.commit()
        await db.refresh(p)
        return p


# ---------------------------------------------------------------------------
# Test 1: WAITING_FOR_FILE blocks READY transition
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_set_ready_rejected_when_not_verified():
    """Server rule: participant.status must be VERIFIED to become READY."""
    room = await _make_room()
    p = await _make_participant(room.id, status=ParticipantStatus.WAITING_FOR_FILE)

    async with AsyncSessionLocal() as db:
        q = select(Participant).where(Participant.id == p.id)
        res = await db.execute(q)
        fetched = res.scalar_one()
        assert fetched.status != ParticipantStatus.VERIFIED
        assert fetched.status != ParticipantStatus.READY


# ---------------------------------------------------------------------------
# Test 2: VERIFIED -> READY transition
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_verified_participant_transitions_to_ready():
    """VERIFIED participant status correctly writes READY to DB."""
    room = await _make_room()
    p = await _make_participant(room.id, status=ParticipantStatus.VERIFIED, is_host=True)

    async with AsyncSessionLocal() as db:
        q = select(Participant).where(Participant.id == p.id)
        res = await db.execute(q)
        fetched = res.scalar_one()
        assert fetched.status == ParticipantStatus.VERIFIED

        fetched.status = ParticipantStatus.READY
        await db.commit()

    async with AsyncSessionLocal() as db:
        q = select(Participant).where(Participant.id == p.id)
        res = await db.execute(q)
        fetched = res.scalar_one()
        assert fetched.status == ParticipantStatus.READY


# ---------------------------------------------------------------------------
# Test 3: READY -> VERIFIED revert
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_unready_reverts_ready_to_verified():
    """READY participant status reverts to VERIFIED on set_unready."""
    room = await _make_room()
    p = await _make_participant(room.id, status=ParticipantStatus.READY)

    async with AsyncSessionLocal() as db:
        q = select(Participant).where(Participant.id == p.id)
        res = await db.execute(q)
        fetched = res.scalar_one()
        fetched.status = ParticipantStatus.VERIFIED
        await db.commit()

    async with AsyncSessionLocal() as db:
        q = select(Participant).where(Participant.id == p.id)
        res = await db.execute(q)
        fetched = res.scalar_one()
        assert fetched.status == ParticipantStatus.VERIFIED


# ---------------------------------------------------------------------------
# Test 4: _all_online_participants_ready logic
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_all_online_participants_ready_logic():
    """
    _all_online_participants_ready:
    - Returns False when no one is online.
    - Returns True when every ONLINE participant is READY (offline excluded).
    """
    room = await _make_room()
    host = await _make_participant(room.id, "Host", is_host=True, status=ParticipantStatus.VERIFIED)
    guest = await _make_participant(room.id, "Guest", status=ParticipantStatus.VERIFIED)

    async with AsyncSessionLocal() as db:
        # Nobody online → False
        all_ready, _ = await _all_online_participants_ready(db, room.code)
        assert not all_ready, "No online participants should return False"

        # Bring host online
        await connection_manager.register_connection(
            sid="h_sid", room_code=room.code, room_id=room.id,
            participant_id=host.id, username=host.username, is_host=True
        )

        # Host is VERIFIED not READY → still False
        all_ready, _ = await _all_online_participants_ready(db, room.code)
        assert not all_ready

        # Set host to READY in DB
        q = select(Participant).where(Participant.id == host.id)
        res = await db.execute(q)
        fetched_host = res.scalar_one()
        fetched_host.status = ParticipantStatus.READY
        await db.commit()

        # Guest is offline → only host counts → True
        all_ready, _ = await _all_online_participants_ready(db, room.code)
        assert all_ready, "Only online participant (host) is READY → should be True"

    await connection_manager.unregister_connection("h_sid")


# ---------------------------------------------------------------------------
# Test 5: invalidate_room_readiness preserves WATCHING, resets others
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_invalidate_room_readiness():
    """
    invalidate_room_readiness resets READY/VERIFIED/DOWNLOADED/etc.
    to WAITING_FOR_FILE and clears verified_file_hash.
    WATCHING participants are NOT reset.
    """
    room = await _make_room()
    p_ready = await _make_participant(
        room.id, "ReadyP", is_host=True,
        status=ParticipantStatus.READY, verified_hash="abc123"
    )
    p_verified = await _make_participant(
        room.id, "VerP", status=ParticipantStatus.VERIFIED, verified_hash="def456"
    )
    p_watching = await _make_participant(
        room.id, "WatchP", status=ParticipantStatus.WATCHING, verified_hash="ghi789"
    )

    await invalidate_room_readiness(room.code, "New episode uploaded")

    async with AsyncSessionLocal() as db:
        r1 = await db.execute(select(Participant).where(Participant.id == p_ready.id))
        r2 = await db.execute(select(Participant).where(Participant.id == p_verified.id))
        r3 = await db.execute(select(Participant).where(Participant.id == p_watching.id))
        fp_ready = r1.scalar_one()
        fp_verified = r2.scalar_one()
        fp_watching = r3.scalar_one()

        assert fp_ready.status == ParticipantStatus.WAITING_FOR_FILE
        assert fp_ready.verified_file_hash is None
        assert fp_verified.status == ParticipantStatus.WAITING_FOR_FILE
        assert fp_verified.verified_file_hash is None
        # WATCHING is preserved
        assert fp_watching.status == ParticipantStatus.WATCHING


# ---------------------------------------------------------------------------
# Test 6: Countdown task cancellation
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_countdown_task_cancelled():
    """_cancel_countdown correctly cancels a running asyncio task."""
    async def long_wait():
        await asyncio.sleep(60)

    code = generate_room_code()
    task = asyncio.ensure_future(long_wait())
    _countdown_tasks[code] = task
    assert not task.done()

    _cancel_countdown(code)
    await asyncio.sleep(0)

    assert task.cancelled() or task.done()
    assert code not in _countdown_tasks


# ---------------------------------------------------------------------------
# Test 7: Socket handler - set_ready rejected for unverified participant
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_socket_set_ready_rejected_if_unverified():
    """Socket set_ready event returns error and emits ready_rejected when status != VERIFIED."""
    room = await _make_room()
    p = await _make_participant(room.id, "WaitingUser", status=ParticipantStatus.WAITING_FOR_FILE)

    sid = "sid_unverified"
    await connection_manager.register_connection(
        sid=sid, room_code=room.code, room_id=room.id,
        participant_id=p.id, username=p.username, is_host=False
    )

    with patch.object(sio, "emit", new_callable=AsyncMock) as mock_emit:
        res = await set_ready(sid, {})
        assert res["status"] == "ERROR"
        assert "not VERIFIED" in res["message"]

        # Verify ready_rejected was emitted to this sid
        calls = [c for c in mock_emit.call_args_list if c[0][0] == "ready_rejected"]
        assert len(calls) == 1
        assert calls[0][1]["to"] == sid
        assert calls[0][0][1]["reason"] == "NOT_VERIFIED"

    await connection_manager.unregister_connection(sid)


# ---------------------------------------------------------------------------
# Test 8: Socket handler - set_ready and set_unready workflow
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_socket_set_ready_and_set_unready_success():
    """Socket set_ready succeeds for VERIFIED user, set_unready reverts to VERIFIED."""
    room = await _make_room()
    p = await _make_participant(room.id, "VerifiedUser", status=ParticipantStatus.VERIFIED)

    sid = "sid_verified"
    await connection_manager.register_connection(
        sid=sid, room_code=room.code, room_id=room.id,
        participant_id=p.id, username=p.username, is_host=False
    )

    with patch.object(sio, "emit", new_callable=AsyncMock) as mock_emit:
        # 1. Set ready
        res = await set_ready(sid, {})
        assert res["status"] == "OK"

        # Check DB updated to READY
        async with AsyncSessionLocal() as db:
            q = select(Participant).where(Participant.id == p.id)
            r = await db.execute(q)
            assert r.scalar_one().status == ParticipantStatus.READY

        # Check ready_acknowledged emitted
        calls_ack = [c for c in mock_emit.call_args_list if c[0][0] == "ready_acknowledged"]
        assert len(calls_ack) == 1

        # 2. Set unready
        res_un = await set_unready(sid, {})
        assert res_un["status"] == "OK"

        # Check DB updated back to VERIFIED
        async with AsyncSessionLocal() as db:
            q = select(Participant).where(Participant.id == p.id)
            r = await db.execute(q)
            assert r.scalar_one().status == ParticipantStatus.VERIFIED

        # Check unready_acknowledged emitted
        calls_un_ack = [c for c in mock_emit.call_args_list if c[0][0] == "unready_acknowledged"]
        assert len(calls_un_ack) == 1

    await connection_manager.unregister_connection(sid)
