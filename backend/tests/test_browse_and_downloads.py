"""
Tests for AnimeSync Browse Discovery, Media Providers, SSRF Protection,
Episode Download Manager, and Watch Together Online Mode
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import delete

from backend.app.main import fastapi_app
from backend.app.database import init_db, AsyncSessionLocal
from backend.app.models.room import Room
from backend.app.models.participant import Participant
from backend.app.models.episode import Episode
from backend.app.models.download import DownloadTask
from backend.app.services.url_security import validate_external_media_url
from backend.app.sockets.playback_manager import playback_manager
from backend.app.sockets.server import sio, join_room, playback_action, get_playback_state, select_episode


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()
    async with AsyncSessionLocal() as db:
        await db.execute(delete(DownloadTask))
        await db.execute(delete(Episode))
        await db.execute(delete(Participant))
        await db.execute(delete(Room))
        await db.commit()
    playback_manager.clear()
    yield
    playback_manager.clear()


def test_url_security_ssrf_and_scheme_guards():
    assert validate_external_media_url("https://example.com/ep1.mp4")["format"] == "mp4"
    assert validate_external_media_url("https://cdn.example.com/playlist.m3u8")["format"] == "hls"
    assert validate_external_media_url("https://cdn.example.com/ep1.webm")["format"] == "webm"

    for bad_url in [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "http://localhost:8000/video.mp4",
        "http://127.0.0.1:8080/video.mp4",
        "http://192.168.1.50/video.mp4",
        "http://10.0.0.1/video.mp4",
        "http://169.254.169.254/latest/meta-data/",
        "http://myserver.local/video.mp4",
    ]:
        res = validate_external_media_url(bad_url)
        assert res["valid"] is False


@pytest.mark.asyncio
async def test_browse_discover_and_search_anilist_mocked(monkeypatch):
    from backend.app.services import anime_metadata_service

    async def fake_post_anilist(query, variables):
        return {
            "data": {
                "Page": {
                    "pageInfo": {"total": 40, "currentPage": variables.get("page", 1), "lastPage": 3, "hasNextPage": True},
                    "media": [
                        {
                            "id": 21,
                            "title": {"english": "One Piece", "romaji": "One Piece", "native": "ワンピース"},
                            "description": "<b>Pirates</b> adventure.",
                            "episodes": 1100,
                            "status": "RELEASING",
                            "seasonYear": 1999,
                            "averageScore": 88,
                            "genres": ["Action", "Adventure"],
                            "coverImage": {"large": "https://img.example.com/op.jpg"},
                            "bannerImage": None,
                        }
                    ],
                }
            }
        }

    monkeypatch.setattr(anime_metadata_service, "_post_anilist", fake_post_anilist)

    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        disc = await client.get("/api/browse/discover?category=trending&page=1")
        assert disc.status_code == 200
        data = disc.json()
        assert data["category"] == "trending"
        assert data["has_next_page"] is True
        assert data["results"][0]["title"] == "One Piece"
        assert data["results"][0]["description"] == "Pirates adventure."

        srch = await client.get("/api/browse/search?q=One+Piece&page=2")
        assert srch.status_code == 200
        sdata = srch.json()
        assert sdata["page"] == 2
        assert sdata["results"][0]["release_year"] == 1999


@pytest.mark.asyncio
async def test_provider_catalog_and_source_validation():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cat_res = await client.get("/api/browse/providers/catalog")
        assert cat_res.status_code == 200
        cat_data = cat_res.json()
        assert cat_data["count"] >= 3

        det_res = await client.get("/api/browse/anime/open-sintel")
        assert det_res.status_code == 200
        assert det_res.json()["provider"] == "open_catalog"

        val_ok = await client.post(
            "/api/browse/sources/validate",
            json={
                "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
                "subtitle_url": "https://example.com/en.vtt",
                "audio_track": "dub",
            },
        )
        assert val_ok.status_code == 200
        assert val_ok.json()["downloadable"] is True
        assert val_ok.json()["audio_track"] == "dub"

        val_hls = await client.post(
            "/api/browse/sources/validate",
            json={"stream_url": "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"},
        )
        assert val_hls.status_code == 200
        assert val_hls.json()["downloadable"] is False

        val_ssrf = await client.post(
            "/api/browse/sources/validate",
            json={"stream_url": "http://127.0.0.1:8000/secret.mp4"},
        )
        assert val_ssrf.status_code == 400


@pytest.mark.asyncio
async def test_download_manager_rejects_hls_and_ssrf_and_tracks_tasks(monkeypatch):
    from backend.app.services.download_manager import download_manager

    # Prevent real network call during background task in unit test
    monkeypatch.setattr(download_manager, "start_background_download", lambda task_id: None)

    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Reject HLS
        hls_dl = await client.post(
            "/api/downloads",
            json={
                "anime_title": "Sintel",
                "episode_number": 1,
                "source_url": "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
            },
        )
        assert hls_dl.status_code == 400

        # Reject SSRF
        ssrf_dl = await client.post(
            "/api/downloads",
            json={
                "anime_title": "Internal",
                "episode_number": 1,
                "source_url": "http://192.168.1.1/test.mp4",
            },
        )
        assert ssrf_dl.status_code == 400

        # Create valid MP4 download task
        ok_dl = await client.post(
            "/api/downloads",
            json={
                "anime_title": "Sintel",
                "episode_number": 2,
                "source_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
            },
        )
        assert ok_dl.status_code == 201
        task_id = ok_dl.json()["id"]

        # List downloads
        list_res = await client.get("/api/downloads")
        assert list_res.status_code == 200
        assert len(list_res.json()["downloads"]) == 1

        # Pause & Delete
        pause_res = await client.post(f"/api/downloads/{task_id}/pause")
        assert pause_res.status_code == 200
        assert pause_res.json()["status"] == "PAUSED"

        del_res = await client.delete(f"/api/downloads/{task_id}")
        assert del_res.status_code == 200


@pytest.mark.asyncio
async def test_watch_together_online_episode_sync(monkeypatch):
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
        create_res = await client.post("/api/rooms", json={"name": "Online Watch", "host_username": "HostUser"})
        assert create_res.status_code == 201
        host_auth = create_res.json()
        code = host_auth["room"]["code"]

        join_res = await client.post(f"/api/rooms/{code}/join", json={"username": "GuestUser"})
        assert join_res.status_code == 200
        guest_auth = join_res.json()

        # Non-host rejected
        bad_ep = await client.post(
            f"/api/rooms/{code}/online-episode",
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
        assert bad_ep.status_code == 403

        # Host adds Ep 1 & Ep 2
        ep1 = await client.post(
            f"/api/rooms/{code}/online-episode",
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
        assert ep1.status_code == 200
        assert ep1.json()["episode"]["source_type"] == "online"

        ep2 = await client.post(
            f"/api/rooms/{code}/online-episode",
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
        assert ep2.status_code == 200
        ep2_id = ep2.json()["episode"]["id"]

    await join_room(
        "sid-host",
        {"room_code": code, "participant_id": host_auth["participant_id"], "session_token": host_auth["session_token"]},
    )
    await join_room(
        "sid-guest",
        {"room_code": code, "participant_id": guest_auth["participant_id"], "session_token": guest_auth["session_token"]},
    )
    emitted.clear()

    # Both participants can control playback
    play_ack = await playback_action("sid-host", {"room_code": code, "action": "PLAY", "timestamp": 10.0})
    assert play_ack["status"] == "OK"
    assert any(e["event"] == "playback_sync" and e["data"]["action"] == "PLAY" for e in emitted)

    seek_ack = await playback_action("sid-guest", {"room_code": code, "action": "SEEK", "timestamp": 32.5})
    assert seek_ack["status"] == "OK"

    # Reconnection / late-joiner state check
    state_res = await get_playback_state("sid-guest", {"room_code": code})
    assert state_res["status"] == "OK"
    assert state_res["state"]["is_playing"] is True
    assert state_res["state"]["current_time"] >= 32.5

    # Episode switching resets playback state
    sw = await select_episode("sid-host", {"episode_id": ep2_id})
    assert sw["status"] == "OK"
    assert playback_manager.get_state(code).is_playing is False
