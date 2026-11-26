"""
Tests for AnimeSync Authorized Streaming API & Watch-Together Stream Sync
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from backend.app.main import fastapi_app
from backend.app.database import init_db, AsyncSessionLocal
from backend.app.models.room import Room
from backend.app.models.participant import Participant
from backend.app.models.episode import Episode
from backend.app.sockets.playback_manager import playback_manager
from backend.app.sockets.server import sio, join_room, playback_action, get_playback_state, select_episode
from sqlalchemy import delete


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Episode))
        await db.execute(delete(Participant))
        await db.execute(delete(Room))
        await db.commit()
    playback_manager.clear()
    yield
    playback_manager.clear()


@pytest.mark.asyncio
async def test_search_authorized_catalog():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/streaming/search?q=")
        assert res.status_code == 200
        data = res.json()
        assert data["count"] >= 3
        ids = [r["id"] for r in data["results"]]
        assert "open-sintel" in ids
        assert "open-big-buck-bunny" in ids


@pytest.mark.asyncio
async def test_search_authorized_catalog_filtered():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/streaming/search?q=sintel")
        assert res.status_code == 200
        data = res.json()
        assert any(r["id"] == "open-sintel" for r in data["results"])


@pytest.mark.asyncio
async def test_get_anime_details_catalog_and_not_found():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ok_res = await client.get("/api/streaming/anime/open-sintel")
        assert ok_res.status_code == 200
        details = ok_res.json()
        assert details["title"].startswith("Sintel")
        assert len(details["episodes"]) == 2
        assert details["episodes"][0]["format"] == "hls"

        not_found = await client.get("/api/streaming/anime/nonexistent-id-999")
        assert not_found.status_code == 404


@pytest.mark.asyncio
async def test_validate_stream_url_valid_and_invalid():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        hls_res = await client.post(
            "/api/streaming/validate-url",
            json={"stream_url": "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8"},
        )
        assert hls_res.status_code == 200
        assert hls_res.json()["format"] == "hls"

        mp4_res = await client.post(
            "/api/streaming/validate-url",
            json={
                "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
                "subtitle_url": "https://example.com/subtitles/en.vtt",
            },
        )
        assert mp4_res.status_code == 200
        assert mp4_res.json()["format"] == "mp4"
        assert mp4_res.json()["subtitle_url"] == "https://example.com/subtitles/en.vtt"

        bad_scheme = await client.post(
            "/api/streaming/validate-url",
            json={"stream_url": "javascript:alert(1)"},
        )
        assert bad_scheme.status_code == 400

        bad_file = await client.post(
            "/api/streaming/validate-url",
            json={"stream_url": "file:///etc/passwd"},
        )
        assert bad_file.status_code == 400


@pytest.mark.asyncio
async def test_room_stream_episode_and_two_user_sync(monkeypatch):
    emitted = []

    async def fake_emit(event, data=None, room=None, to=None, **kwargs):
        emitted.append({"event": event, "data": data, "room": room, "to": to})

    async def fake_enter_room(sid, room_code):
        return None

    async def fake_leave_room(sid, room_code):
        return None

    monkeypatch.setattr(sio, "emit", fake_emit)
    monkeypatch.setattr(sio, "enter_room", fake_enter_room)
    monkeypatch.setattr(sio, "leave_room", fake_leave_room)

    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Host creates room
        create_res = await client.post("/api/rooms", json={"name": "Stream Night", "host_username": "HostUser"})
        assert create_res.status_code == 201
        host_auth = create_res.json()
        code = host_auth["room"]["code"]

        # 2. Guest joins room
        join_res = await client.post(f"/api/rooms/{code}/join", json={"username": "GuestUser"})
        assert join_res.status_code == 200
        guest_auth = join_res.json()

        # 3. Non-host cannot add stream episode
        forbidden_res = await client.post(
            f"/api/rooms/{code}/stream-episode",
            headers={
                "X-Participant-ID": guest_auth["participant_id"],
                "X-Session-Token": guest_auth["session_token"],
            },
            json={
                "anime_title": "Sintel",
                "episode_number": 1,
                "stream_url": "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
            },
        )
        assert forbidden_res.status_code == 403

        # 4. Host adds Episode 1 & Episode 2 stream episodes
        ep1_res = await client.post(
            f"/api/rooms/{code}/stream-episode",
            headers={
                "X-Participant-ID": host_auth["participant_id"],
                "X-Session-Token": host_auth["session_token"],
            },
            json={
                "anime_title": "Sintel",
                "episode_number": 1,
                "stream_url": "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
                "set_active": True,
            },
        )
        assert ep1_res.status_code == 200
        ep1_id = ep1_res.json()["episode"]["id"]
        assert ep1_res.json()["episode"]["source_type"] == "stream"

        ep2_res = await client.post(
            f"/api/rooms/{code}/stream-episode",
            headers={
                "X-Participant-ID": host_auth["participant_id"],
                "X-Session-Token": host_auth["session_token"],
            },
            json={
                "anime_title": "Sintel",
                "episode_number": 2,
                "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
                "set_active": False,
            },
        )
        assert ep2_res.status_code == 200
        ep2_id = ep2_res.json()["episode"]["id"]

    # 5. Host & Guest join Socket.IO room
    await join_room(
        "sid-host",
        {
            "room_code": code,
            "participant_id": host_auth["participant_id"],
            "session_token": host_auth["session_token"],
        },
    )
    await join_room(
        "sid-guest",
        {
            "room_code": code,
            "participant_id": guest_auth["participant_id"],
            "session_token": guest_auth["session_token"],
        },
    )

    emitted.clear()

    # 6. Host triggers PLAY and SEEK in stream mode (even with WAITING_FOR_FILE status)
    play_ack = await playback_action("sid-host", {"room_code": code, "action": "PLAY", "timestamp": 12.5})
    assert play_ack["status"] == "OK"
    assert any(e["event"] == "playback_sync" and e["data"]["action"] == "PLAY" for e in emitted)

    seek_ack = await playback_action("sid-guest", {"room_code": code, "action": "SEEK", "timestamp": 45.0})
    assert seek_ack["status"] == "OK"
    assert any(e["event"] == "playback_sync" and e["data"]["timestamp"] == 45.0 for e in emitted)

    # 7. Late-joiner / state sync check
    state_res = await get_playback_state("sid-guest", {"room_code": code})
    assert state_res["status"] == "OK"
    assert state_res["state"]["is_playing"] is True
    assert state_res["state"]["current_time"] >= 45.0

    # 8. Host switches to Episode 2 -> resets playback state
    switch_res = await select_episode("sid-host", {"episode_id": ep2_id})
    assert switch_res["status"] == "OK"
    assert switch_res["current_episode_id"] == ep2_id
    assert playback_manager.get_state(code).is_playing is False
    assert ep1_id != ep2_id
