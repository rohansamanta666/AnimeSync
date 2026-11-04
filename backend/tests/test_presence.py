import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch
from backend.app.database import init_db, AsyncSessionLocal
from backend.app.services.room_manager import RoomManager
from backend.app.sockets.server import handle_join_room, leave_room, disconnect, sio
from backend.app.sockets.connection_manager import connection_manager

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()
    # Reset connection manager state between tests
    connection_manager._sid_to_session.clear()
    connection_manager._participant_sockets.clear()
    connection_manager._room_participants.clear()
    yield

@pytest.mark.asyncio
async def test_two_participants_join_same_room():
    async with AsyncSessionLocal() as db:
        room, host, host_token = await RoomManager.create_room(db, "Watch Party", "HostUser")
        room, friend, friend_token = await RoomManager.join_room(db, room.code, "FriendUser")

    # Host joins via Socket.IO
    host_res = await handle_join_room(
        "sid_host",
        {"room_code": room.code, "participant_id": host.id, "session_token": host_token}
    )
    assert host_res["success"] is True
    assert connection_manager.is_participant_online(room.code, host.id) is True

    # Friend joins via Socket.IO
    friend_res = await handle_join_room(
        "sid_friend",
        {"room_code": room.code, "participant_id": friend.id, "session_token": friend_token}
    )
    assert friend_res["success"] is True
    assert connection_manager.is_participant_online(room.code, friend.id) is True

    # Verify authoritative presence list from DB contains both online participants
    async with AsyncSessionLocal() as db:
        presence = await connection_manager.get_presence_payload(db, room.code)
        assert len(presence) == 2
        usernames = {p["username"]: p["is_online"] for p in presence}
        assert usernames["HostUser"] is True
        assert usernames["FriendUser"] is True

@pytest.mark.asyncio
async def test_room_isolation_different_rooms():
    async with AsyncSessionLocal() as db:
        room1, host1, token1 = await RoomManager.create_room(db, "Room 1", "User1")
        room2, host2, token2 = await RoomManager.create_room(db, "Room 2", "User2")

    await handle_join_room(
        "sid_user1",
        {"room_code": room1.code, "participant_id": host1.id, "session_token": token1}
    )
    await handle_join_room(
        "sid_user2",
        {"room_code": room2.code, "participant_id": host2.id, "session_token": token2}
    )

    assert connection_manager.is_participant_online(room1.code, host1.id) is True
    assert connection_manager.is_participant_online(room1.code, host2.id) is False

    assert connection_manager.is_participant_online(room2.code, host2.id) is True
    assert connection_manager.is_participant_online(room2.code, host1.id) is False

    # Check active participants per room
    assert connection_manager.get_room_active_participant_ids(room1.code) == {host1.id}
    assert connection_manager.get_room_active_participant_ids(room2.code) == {host2.id}

@pytest.mark.asyncio
async def test_unauthorized_room_access():
    async with AsyncSessionLocal() as db:
        room, host, host_token = await RoomManager.create_room(db, "Secure Room", "HostUser")

    # 1. Non-existent room code
    res_fake_room = await handle_join_room(
        "sid_bad1",
        {"room_code": "NONEX1", "participant_id": host.id, "session_token": host_token}
    )
    assert res_fake_room["success"] is False
    assert res_fake_room["error"]["code"] == "ROOM_NOT_FOUND"

    # 2. Invalid session token
    res_bad_token = await handle_join_room(
        "sid_bad2",
        {"room_code": room.code, "participant_id": host.id, "session_token": "wrong_token_123"}
    )
    assert res_bad_token["success"] is False
    assert res_bad_token["error"]["code"] == "AUTH_FAILED"

    # 3. Non-existent participant ID
    res_bad_id = await handle_join_room(
        "sid_bad3",
        {"room_code": room.code, "participant_id": "00000000-0000-0000-0000-000000000000", "session_token": host_token}
    )
    assert res_bad_id["success"] is False
    assert res_bad_id["error"]["code"] == "AUTH_FAILED"

    # Ensure no unauthorized connection was registered
    assert connection_manager.is_participant_online(room.code, host.id) is False
    assert len(connection_manager._sid_to_session) == 0

@pytest.mark.asyncio
async def test_multiple_tabs_and_duplicate_connections():
    async with AsyncSessionLocal() as db:
        room, host, token = await RoomManager.create_room(db, "MultiTab Room", "MultiUser")

    # Tab 1 connects
    res1 = await handle_join_room(
        "sid_tab1",
        {"room_code": room.code, "participant_id": host.id, "session_token": token}
    )
    assert res1["success"] is True
    assert connection_manager.get_participant_socket_count(room.code, host.id) == 1
    assert connection_manager.is_participant_online(room.code, host.id) is True

    # Tab 2 connects (same participant)
    res2 = await handle_join_room(
        "sid_tab2",
        {"room_code": room.code, "participant_id": host.id, "session_token": token}
    )
    assert res2["success"] is True
    assert connection_manager.get_participant_socket_count(room.code, host.id) == 2
    assert connection_manager.is_participant_online(room.code, host.id) is True

    # Tab 1 closes
    await disconnect("sid_tab1")
    # Participant MUST still be online because Tab 2 is active
    assert connection_manager.get_participant_socket_count(room.code, host.id) == 1
    assert connection_manager.is_participant_online(room.code, host.id) is True

    # Tab 2 closes
    await disconnect("sid_tab2")
    # Participant should now be marked offline
    assert connection_manager.get_participant_socket_count(room.code, host.id) == 0
    assert connection_manager.is_participant_online(room.code, host.id) is False

@pytest.mark.asyncio
async def test_unexpected_disconnect_and_reconnection():
    async with AsyncSessionLocal() as db:
        room, host, token = await RoomManager.create_room(db, "Recon Room", "ReconUser")

    # Initial connection
    await handle_join_room(
        "sid_initial",
        {"room_code": room.code, "participant_id": host.id, "session_token": token}
    )
    assert connection_manager.is_participant_online(room.code, host.id) is True

    # Sudden disconnect (e.g. Wi-Fi drop)
    await disconnect("sid_initial")
    assert connection_manager.is_participant_online(room.code, host.id) is False

    # Reconnection with new socket ID
    reconnect_res = await handle_join_room(
        "sid_reconnected",
        {"room_code": room.code, "participant_id": host.id, "session_token": token}
    )
    assert reconnect_res["success"] is True
    assert connection_manager.is_participant_online(room.code, host.id) is True
    assert connection_manager.get_participant_socket_count(room.code, host.id) == 1

@pytest.mark.asyncio
async def test_explicit_leave_room():
    async with AsyncSessionLocal() as db:
        room, host, token = await RoomManager.create_room(db, "Leave Room", "LeavingUser")

    await handle_join_room(
        "sid_leave",
        {"room_code": room.code, "participant_id": host.id, "session_token": token}
    )
    assert connection_manager.is_participant_online(room.code, host.id) is True

    leave_res = await leave_room("sid_leave")
    assert leave_res["success"] is True
    assert connection_manager.is_participant_online(room.code, host.id) is False

