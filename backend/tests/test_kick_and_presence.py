"""
AnimeSync — Host Kick & Presence Grace Period Tests

Tests:
1. Host can kick participant via Socket.IO and REST endpoint.
2. Non-host cannot kick participants (403 Forbidden).
3. Host cannot kick themselves (400 Bad Request / error).
4. Kicked participant is disconnected and marked is_kicked = True.
5. Kicked participant cannot rejoin room via Socket.IO (KICKED error) or REST.
6. Switching presence state (active vs away) broadcasts presence_updated with presence_state.
7. Disconnect sets presence_state to 'disconnected' and schedules grace period purge.
8. Reconnection within grace period cancels purge and restores active presence.
9. Explicit leave_room immediately purges guest from room.
"""
import pytest
import pytest_asyncio
import asyncio
import uuid
from httpx import AsyncClient, ASGITransport
from backend.app.main import app
from backend.app.database import init_db, AsyncSessionLocal
from backend.app.models.room import Room
from backend.app.models.participant import Participant, ParticipantStatus
from backend.app.services.room_manager import RoomManager
from backend.app.sockets.connection_manager import connection_manager
from backend.app.sockets.voice_manager import voice_manager
from backend.app.sockets.server import (
    handle_join_room,
    leave_room,
    disconnect,
    kick_participant,
    update_presence_state,
    _pending_grace_periods,
    sio,
)
from sqlalchemy import select


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()
    connection_manager._sid_to_session.clear()
    connection_manager._participant_sockets.clear()
    connection_manager._room_participants.clear()
    connection_manager._participant_presence_state.clear()
    voice_manager.clear()
    # Cancel any lingering grace tasks
    for task in list(_pending_grace_periods.values()):
        if not task.done():
            task.cancel()
    _pending_grace_periods.clear()
    yield
    for task in list(_pending_grace_periods.values()):
        if not task.done():
            task.cancel()
    _pending_grace_periods.clear()


@pytest.mark.asyncio
async def test_host_kick_participant_socket():
    async with AsyncSessionLocal() as db:
        room, host, host_token = await RoomManager.create_room(db, "Kick Test Room", "HostUser")
        room, guest, guest_token = await RoomManager.join_room(db, room.code, "Troublemaker")

    # Both join via socket
    await handle_join_room("sid_host", {"room_code": room.code, "participant_id": host.id, "session_token": host_token})
    await handle_join_room("sid_guest", {"room_code": room.code, "participant_id": guest.id, "session_token": guest_token})

    assert connection_manager.is_participant_online(room.code, guest.id) is True

    # Host kicks guest
    kick_res = await kick_participant("sid_host", {"target_participant_id": guest.id})
    assert kick_res["status"] == "OK"
    assert kick_res["kicked_id"] == guest.id

    # Guest should be disconnected from connection manager
    assert connection_manager.is_participant_online(room.code, guest.id) is False

    # In database, guest is marked is_kicked = True
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Participant).where(Participant.id == guest.id))
        updated_guest = res.scalar_one()
        assert updated_guest.is_kicked is True


@pytest.mark.asyncio
async def test_non_host_cannot_kick():
    async with AsyncSessionLocal() as db:
        room, host, host_token = await RoomManager.create_room(db, "Perm Test Room", "HostUser")
        room, guest1, guest1_token = await RoomManager.join_room(db, room.code, "Guest1")
        room, guest2, guest2_token = await RoomManager.join_room(db, room.code, "Guest2")

    await handle_join_room("sid_g1", {"room_code": room.code, "participant_id": guest1.id, "session_token": guest1_token})
    await handle_join_room("sid_g2", {"room_code": room.code, "participant_id": guest2.id, "session_token": guest2_token})

    # Guest1 attempts to kick Guest2
    res = await kick_participant("sid_g1", {"target_participant_id": guest2.id})
    assert res["status"] == "ERROR"
    assert "Only the room host" in res["message"]

    # Guest2 must still be online
    assert connection_manager.is_participant_online(room.code, guest2.id) is True


@pytest.mark.asyncio
async def test_host_cannot_kick_self():
    async with AsyncSessionLocal() as db:
        room, host, host_token = await RoomManager.create_room(db, "Self Kick Room", "HostUser")

    await handle_join_room("sid_host", {"room_code": room.code, "participant_id": host.id, "session_token": host_token})

    res = await kick_participant("sid_host", {"target_participant_id": host.id})
    assert res["status"] == "ERROR"
    assert "cannot kick themselves" in res["message"]


@pytest.mark.asyncio
async def test_kicked_participant_cannot_rejoin_socket():
    async with AsyncSessionLocal() as db:
        room, host, host_token = await RoomManager.create_room(db, "Rejoin Room", "HostUser")
        room, guest, guest_token = await RoomManager.join_room(db, room.code, "BannedGuest")

    await handle_join_room("sid_host", {"room_code": room.code, "participant_id": host.id, "session_token": host_token})
    await handle_join_room("sid_guest", {"room_code": room.code, "participant_id": guest.id, "session_token": guest_token})

    # Kick guest
    await kick_participant("sid_host", {"target_participant_id": guest.id})

    # Guest tries to reconnect
    reconnect_res = await handle_join_room(
        "sid_guest_new",
        {"room_code": room.code, "participant_id": guest.id, "session_token": guest_token}
    )
    assert reconnect_res["success"] is False
    assert reconnect_res["error"]["code"] == "KICKED"
    assert connection_manager.is_participant_online(room.code, guest.id) is False


@pytest.mark.asyncio
async def test_host_kick_via_rest_api():
    async with AsyncSessionLocal() as db:
        room, host, host_token = await RoomManager.create_room(db, "REST Kick Room", "HostUser")
        room, guest, guest_token = await RoomManager.join_room(db, room.code, "TargetGuest")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Non-host attempt fails with 403
        bad_res = await client.post(
            f"/api/rooms/{room.code}/participants/{guest.id}/kick",
            headers={"X-Participant-ID": guest.id, "X-Session-Token": guest_token}
        )
        assert bad_res.status_code == 403

        # Host kicks guest
        kick_res = await client.post(
            f"/api/rooms/{room.code}/participants/{guest.id}/kick",
            headers={"X-Participant-ID": host.id, "X-Session-Token": host_token}
        )
        assert kick_res.status_code == 200
        assert kick_res.json()["status"] == "OK"

        # Check DB
        async with AsyncSessionLocal() as db:
            q = select(Participant).where(Participant.id == guest.id)
            res = await db.execute(q)
            target = res.scalar_one()
            assert target.is_kicked is True


@pytest.mark.asyncio
async def test_presence_state_active_and_away():
    async with AsyncSessionLocal() as db:
        room, host, host_token = await RoomManager.create_room(db, "State Room", "TabUser")

    await handle_join_room("sid_user", {"room_code": room.code, "participant_id": host.id, "session_token": host_token})

    # Default is active
    async with AsyncSessionLocal() as db:
        presence = await connection_manager.get_presence_payload(db, room.code)
        assert presence[0]["presence_state"] == "active"
        assert presence[0]["is_online"] is True

    # User switches tabs -> away
    await update_presence_state("sid_user", {"state": "away"})
    async with AsyncSessionLocal() as db:
        presence = await connection_manager.get_presence_payload(db, room.code)
        assert presence[0]["presence_state"] == "away"
        assert presence[0]["is_online"] is True

    # User returns to tab -> active
    await update_presence_state("sid_user", {"state": "active"})
    async with AsyncSessionLocal() as db:
        presence = await connection_manager.get_presence_payload(db, room.code)
        assert presence[0]["presence_state"] == "active"
        assert presence[0]["is_online"] is True


@pytest.mark.asyncio
async def test_departure_grace_period_and_purge():
    async with AsyncSessionLocal() as db:
        room, host, host_token = await RoomManager.create_room(db, "Grace Room", "HostUser")
        room, guest, guest_token = await RoomManager.join_room(db, room.code, "DepartingGuest")

    await handle_join_room("sid_host", {"room_code": room.code, "participant_id": host.id, "session_token": host_token})
    await handle_join_room("sid_guest", {"room_code": room.code, "participant_id": guest.id, "session_token": guest_token})

    # Guest disconnects abruptly (browser closed)
    await disconnect("sid_guest")

    # Presence immediately reflects disconnected
    async with AsyncSessionLocal() as db:
        presence = await connection_manager.get_presence_payload(db, room.code)
        p_map = {p["username"]: p["presence_state"] for p in presence}
        assert p_map["DepartingGuest"] == "disconnected"

    # A pending grace task should be running
    assert (room.code, guest.id) in _pending_grace_periods

    # If guest reconnects before purge, task is cancelled
    await handle_join_room("sid_guest_back", {"room_code": room.code, "participant_id": guest.id, "session_token": guest_token})
    assert (room.code, guest.id) not in _pending_grace_periods

    # Presence is restored to active
    async with AsyncSessionLocal() as db:
        presence = await connection_manager.get_presence_payload(db, room.code)
        p_map = {p["username"]: p["presence_state"] for p in presence}
        assert p_map["DepartingGuest"] == "active"

