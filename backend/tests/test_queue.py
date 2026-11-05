"""
AnimeSync — Episode Queue & Auto-Next Verification Suite (Phase 6 Tasks 6.1 – 6.5)

Covers:
- QueueManager data model methods: add, reorder, remove, compact, next episode
- REST Queue API endpoints: GET /queue, PUT /queue/reorder, DELETE /queue/{id}, POST /queue/select
- Socket.IO queue events: get_queue, reorder_queue, remove_from_queue, select_episode
- Video ended coordination and duplicate protection (Task 6.3)
- Intermission screen workflow, countdown, cancel, and skip (Task 6.4)
- Auto-next transition and readiness gate reset enforcement (Task 6.5)
"""
import pytest
import asyncio
import uuid
import time
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from backend.app.main import app
from backend.app.database import init_db, AsyncSessionLocal
from backend.app.models.room import Room
from backend.app.models.participant import Participant, ParticipantStatus
from backend.app.models.episode import Episode, UploadStatus
from backend.app.services.queue_manager import QueueManager
from backend.app.sockets.connection_manager import connection_manager
from backend.app.sockets.playback_manager import playback_manager
from backend.app.sockets.server import (
    playback_ended,
    skip_intermission,
    cancel_intermission,
    get_queue,
    reorder_queue,
    remove_from_queue,
    select_episode,
    invalidate_room_readiness,
    _intermission_tasks,
)


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()
    connection_manager.clear()
    playback_manager.clear()
    for task in _intermission_tasks.values():
        task.cancel()
    _intermission_tasks.clear()
    yield
    for task in _intermission_tasks.values():
        task.cancel()
    _intermission_tasks.clear()


async def _make_room(name: str = "Queue Test Room") -> Room:
    code = f"Q{uuid.uuid4().hex[:5].upper()}"
    room = Room(id=str(uuid.uuid4()), code=code, name=name, is_active=True)
    async with AsyncSessionLocal() as db:
        db.add(room)
        await db.commit()
        await db.refresh(room)
    return room


async def _make_participant(
    room_id: str,
    username: str,
    status: ParticipantStatus = ParticipantStatus.WAITING_FOR_FILE,
    is_host: bool = False,
    token: str = None,
) -> Participant:
    p = Participant(
        id=str(uuid.uuid4()),
        room_id=room_id,
        username=username,
        session_token=token or str(uuid.uuid4()),
        is_host=is_host,
        status=status,
    )
    async with AsyncSessionLocal() as db:
        db.add(p)
        await db.commit()
        await db.refresh(p)
    return p


async def _make_episode(
    room_id: str,
    anime_title: str,
    ep_num: int,
    queue_pos: int,
    file_size: int = 50_000_000,
) -> Episode:
    ep = Episode(
        id=str(uuid.uuid4()),
        room_id=room_id,
        anime_title=anime_title,
        season=1,
        episode_number=ep_num,
        filename=f"ep_{ep_num}.mp4",
        file_path=f"/fake/storage/ep_{ep_num}.mp4",
        file_size_bytes=file_size,
        sha256_hash=f"hash_{ep_num:064d}",
        upload_status=UploadStatus.COMPLETED,
        queue_position=queue_pos,
    )
    async with AsyncSessionLocal() as db:
        db.add(ep)
        await db.commit()
        await db.refresh(ep)
    return ep


# ---------------------------------------------------------------------------
# 1. QueueManager Service Tests (Task 6.1)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_queue_manager_get_and_order():
    room = await _make_room("Order Room")
    ep1 = await _make_episode(room.id, "Demon Slayer", 1, queue_pos=0)
    ep2 = await _make_episode(room.id, "Demon Slayer", 2, queue_pos=1)
    ep3 = await _make_episode(room.id, "Demon Slayer", 3, queue_pos=2)

    async with AsyncSessionLocal() as db:
        queue = await QueueManager.get_queue(db, room.id)
        assert len(queue) == 3
        assert [e.episode_number for e in queue] == [1, 2, 3]
        assert [e.queue_position for e in queue] == [0, 1, 2]


@pytest.mark.asyncio
async def test_queue_manager_reorder():
    room = await _make_room("Reorder Room")
    ep1 = await _make_episode(room.id, "Demon Slayer", 1, queue_pos=0)
    ep2 = await _make_episode(room.id, "Demon Slayer", 2, queue_pos=1)
    ep3 = await _make_episode(room.id, "Demon Slayer", 3, queue_pos=2)

    async with AsyncSessionLocal() as db:
        # Reorder to [ep3, ep1, ep2]
        reordered = await QueueManager.reorder_queue(db, room.id, [ep3.id, ep1.id, ep2.id])
        assert [e.id for e in reordered] == [ep3.id, ep1.id, ep2.id]
        assert [e.queue_position for e in reordered] == [0, 1, 2]


@pytest.mark.asyncio
async def test_queue_manager_remove_and_compact():
    room = await _make_room("Remove Room")
    ep1 = await _make_episode(room.id, "Attack on Titan", 1, queue_pos=0)
    ep2 = await _make_episode(room.id, "Attack on Titan", 2, queue_pos=1)
    ep3 = await _make_episode(room.id, "Attack on Titan", 3, queue_pos=2)

    async with AsyncSessionLocal() as db:
        # Set room.current_episode_id = ep1.id
        room_obj = await db.get(Room, room.id)
        room_obj.current_episode_id = ep1.id
        await db.commit()

        # Remove ep1 (the current episode)
        success, new_curr, remaining = await QueueManager.remove_from_queue(db, room.id, ep1.id)
        assert success is True
        # Current advances to ep2
        assert new_curr == ep2.id
        assert len(remaining) == 2
        # Positions re-compacted to 0 and 1
        assert [e.queue_position for e in remaining] == [0, 1]
        assert [e.episode_number for e in remaining] == [2, 3]


@pytest.mark.asyncio
async def test_queue_manager_get_next_episode():
    room = await _make_room("Next Ep Room")
    ep1 = await _make_episode(room.id, "Jujutsu Kaisen", 1, queue_pos=0)
    ep2 = await _make_episode(room.id, "Jujutsu Kaisen", 2, queue_pos=1)

    async with AsyncSessionLocal() as db:
        next_ep = await QueueManager.get_next_episode(db, room.id, ep1.id)
        assert next_ep is not None
        assert next_ep.id == ep2.id

        # At the end of queue, returns None
        last_ep = await QueueManager.get_next_episode(db, room.id, ep2.id)
        assert last_ep is None


# ---------------------------------------------------------------------------
# 2. REST API Queue Tests (Task 6.1 & 6.2)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_rest_queue_endpoints_lifecycle():
    room = await _make_room("REST Queue Room")
    host = await _make_participant(room.id, "HostUser", is_host=True)
    guest = await _make_participant(room.id, "GuestUser", is_host=False)

    ep1 = await _make_episode(room.id, "Frieren", 1, queue_pos=0)
    ep2 = await _make_episode(room.id, "Frieren", 2, queue_pos=1)

    host_headers = {
        "X-Participant-ID": host.id,
        "X-Session-Token": host.session_token,
    }
    guest_headers = {
        "X-Participant-ID": guest.id,
        "X-Session-Token": guest.session_token,
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. GET /api/rooms/{code}/queue
        res = await client.get(f"/api/rooms/{room.code}/queue")
        assert res.status_code == 200
        data = res.json()
        assert len(data["episodes"]) == 2
        assert data["episodes"][0]["id"] == ep1.id

        # 2. Guest attempts to reorder -> 403 Forbidden (host only)
        res_reorder_forbidden = await client.put(
            f"/api/rooms/{room.code}/queue/reorder",
            json={"ordered_episode_ids": [ep2.id, ep1.id]},
            headers=guest_headers,
        )
        assert res_reorder_forbidden.status_code == 403

        # 3. Host reorders -> 200 OK
        res_reorder = await client.put(
            f"/api/rooms/{room.code}/queue/reorder",
            json={"ordered_episode_ids": [ep2.id, ep1.id]},
            headers=host_headers,
        )
        assert res_reorder.status_code == 200
        reorder_data = res_reorder.json()
        assert [e["id"] for e in reorder_data["episodes"]] == [ep2.id, ep1.id]

        # 4. Host selects ep1 as current -> 200 OK
        res_select = await client.post(
            f"/api/rooms/{room.code}/queue/select",
            json={"episode_id": ep1.id},
            headers=host_headers,
        )
        assert res_select.status_code == 200
        assert res_select.json()["current_episode_id"] == ep1.id

        # 5. Host deletes ep2 from queue -> 200 OK
        res_del = await client.delete(
            f"/api/rooms/{room.code}/queue/{ep2.id}",
            headers=host_headers,
        )
        assert res_del.status_code == 200
        del_data = res_del.json()
        assert len(del_data["episodes"]) == 1
        assert del_data["episodes"][0]["id"] == ep1.id


# ---------------------------------------------------------------------------
# 3. Video Ended & Duplicate Protection Tests (Task 6.3)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_socket_playback_ended_duplicate_protection():
    room = await _make_room("Dup Protect Room")
    host = await _make_participant(room.id, "Host", status=ParticipantStatus.WATCHING, is_host=True)
    friend = await _make_participant(room.id, "Friend", status=ParticipantStatus.WATCHING, is_host=False)

    ep1 = await _make_episode(room.id, "One Piece", 1, queue_pos=0)
    ep2 = await _make_episode(room.id, "One Piece", 2, queue_pos=1)

    async with AsyncSessionLocal() as db:
        room_obj = await db.get(Room, room.id)
        room_obj.current_episode_id = ep1.id
        await db.commit()

    sid_host = "sid_host_end"
    sid_friend = "sid_friend_end"

    await connection_manager.register_connection(
        sid=sid_host, room_code=room.code, room_id=room.id,
        participant_id=host.id, username="Host", is_host=True
    )
    await connection_manager.register_connection(
        sid=sid_friend, room_code=room.code, room_id=room.id,
        participant_id=friend.id, username="Friend", is_host=False
    )

    # 1. Host reaches end of video and emits playback_ended
    res1 = await playback_ended(sid_host, {"episode_id": ep1.id})
    assert res1["status"] == "OK"
    assert res1["has_next"] is True
    assert res1["next_episode"]["id"] == ep2.id

    # 2. Friend reaches end 100ms later and emits playback_ended -> DUPLICATE PROTECTED!
    res2 = await playback_ended(sid_friend, {"episode_id": ep1.id})
    assert res2["status"] == "ALREADY_HANDLED"
    assert "already coordinated" in res2["message"]

    await connection_manager.unregister_connection(sid_host)
    await connection_manager.unregister_connection(sid_friend)


@pytest.mark.asyncio
async def test_socket_playback_ended_last_episode():
    room = await _make_room("Last Ep Room")
    host = await _make_participant(room.id, "Host", status=ParticipantStatus.WATCHING, is_host=True)
    ep_single = await _make_episode(room.id, "Solo Episode", 1, queue_pos=0)

    async with AsyncSessionLocal() as db:
        room_obj = await db.get(Room, room.id)
        room_obj.current_episode_id = ep_single.id
        await db.commit()

    sid = "sid_single_ep"
    await connection_manager.register_connection(
        sid=sid, room_code=room.code, room_id=room.id,
        participant_id=host.id, username="Host", is_host=True
    )

    res = await playback_ended(sid, {"episode_id": ep_single.id})
    assert res["status"] == "OK"
    assert res["has_next"] is False
    assert res["message"] == "Queue finished"

    await connection_manager.unregister_connection(sid)


# ---------------------------------------------------------------------------
# 4. Intermission Countdown, Cancel & Skip (Task 6.4)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_socket_intermission_cancel_and_skip():
    room = await _make_room("Intermission Room")
    host = await _make_participant(room.id, "Host", status=ParticipantStatus.WATCHING, is_host=True)

    ep1 = await _make_episode(room.id, "Naruto", 1, queue_pos=0)
    ep2 = await _make_episode(room.id, "Naruto", 2, queue_pos=1)

    async with AsyncSessionLocal() as db:
        room_obj = await db.get(Room, room.id)
        room_obj.current_episode_id = ep1.id
        await db.commit()

    sid = "sid_intermission"
    await connection_manager.register_connection(
        sid=sid, room_code=room.code, room_id=room.id,
        participant_id=host.id, username="Host", is_host=True
    )

    # Trigger intermission
    end_res = await playback_ended(sid, {"episode_id": ep1.id})
    assert end_res["status"] == "OK"
    assert room.code in _intermission_tasks

    # 1. Cancel intermission
    cancel_res = await cancel_intermission(sid, {})
    assert cancel_res["status"] == "OK"
    assert cancel_res["was_cancelled"] is True
    assert room.code not in _intermission_tasks

    # 2. Skip intermission (manual advance)
    skip_res = await skip_intermission(sid, {})
    assert skip_res["status"] == "OK"
    assert skip_res["episode"]["id"] == ep2.id

    # Verify database current_episode_id updated
    async with AsyncSessionLocal() as db:
        room_obj = await db.get(Room, room.id)
        assert room_obj.current_episode_id == ep2.id

    await connection_manager.unregister_connection(sid)


# ---------------------------------------------------------------------------
# 5. Auto-Next Readiness Reset Enforcement (Task 6.5)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_auto_next_readiness_reset_enforcement():
    """
    When the queue advances to the next episode, ALL participants (including WATCHING)
    must be reset to WAITING_FOR_FILE and their verified_file_hash cleared.
    They cannot mark READY until they verify the new episode file.
    """
    room = await _make_room("Readiness Reset Room")
    host = await _make_participant(
        room.id, "Host", status=ParticipantStatus.WATCHING, is_host=True, token="h_tok"
    )
    guest = await _make_participant(
        room.id, "Guest", status=ParticipantStatus.WATCHING, is_host=False, token="g_tok"
    )

    ep1 = await _make_episode(room.id, "Chainsaw Man", 1, queue_pos=0)
    ep2 = await _make_episode(room.id, "Chainsaw Man", 2, queue_pos=1)

    async with AsyncSessionLocal() as db:
        room_obj = await db.get(Room, room.id)
        room_obj.current_episode_id = ep1.id
        await db.commit()

    sid_host = "sid_host_reset"
    sid_guest = "sid_guest_reset"

    await connection_manager.register_connection(
        sid=sid_host, room_code=room.code, room_id=room.id,
        participant_id=host.id, username="Host", is_host=True
    )
    await connection_manager.register_connection(
        sid=sid_guest, room_code=room.code, room_id=room.id,
        participant_id=guest.id, username="Guest", is_host=False
    )

    # Host advances to ep2
    await skip_intermission(sid_host, {})

    # Check database participant statuses
    async with AsyncSessionLocal() as db:
        h_db = await db.get(Participant, host.id)
        g_db = await db.get(Participant, guest.id)
        assert h_db.status == ParticipantStatus.WAITING_FOR_FILE
        assert h_db.verified_file_hash is None
        assert g_db.status == ParticipantStatus.WAITING_FOR_FILE
        assert g_db.verified_file_hash is None

    await connection_manager.unregister_connection(sid_host)
    await connection_manager.unregister_connection(sid_guest)


# ---------------------------------------------------------------------------
# 6. Socket Queue CRUD Event Handlers (Task 6.1)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_socket_queue_crud_events():
    room = await _make_room("Socket CRUD Room")
    host = await _make_participant(room.id, "Host", is_host=True)

    ep1 = await _make_episode(room.id, "Bleach", 1, queue_pos=0)
    ep2 = await _make_episode(room.id, "Bleach", 2, queue_pos=1)
    ep3 = await _make_episode(room.id, "Bleach", 3, queue_pos=2)

    sid = "sid_crud"
    await connection_manager.register_connection(
        sid=sid, room_code=room.code, room_id=room.id,
        participant_id=host.id, username="Host", is_host=True
    )

    # 1. get_queue
    q_res = await get_queue(sid, {})
    assert q_res["status"] == "OK"
    assert len(q_res["episodes"]) == 3

    # 2. reorder_queue: [ep3, ep2, ep1]
    reorder_res = await reorder_queue(sid, {"ordered_episode_ids": [ep3.id, ep2.id, ep1.id]})
    assert reorder_res["status"] == "OK"
    assert [e["id"] for e in reorder_res["episodes"]] == [ep3.id, ep2.id, ep1.id]

    # 3. select_episode: ep3
    sel_res = await select_episode(sid, {"episode_id": ep3.id})
    assert sel_res["status"] == "OK"
    assert sel_res["current_episode_id"] == ep3.id

    # 4. remove_from_queue: ep2
    rem_res = await remove_from_queue(sid, {"episode_id": ep2.id})
    assert rem_res["status"] == "OK"
    assert len(rem_res["episodes"]) == 2

    await connection_manager.unregister_connection(sid)
