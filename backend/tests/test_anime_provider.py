"""
Tests for Integrated Anime Provider Server Bridge, Exposed Endpoints,
M3U8 Stream Proxy Rewriting, SSRF Guards, and Room Episode Serialization.
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
from backend.app.services import anime_provider_service
from backend.app.services.anime_provider_service import rewrite_m3u8_playlist
from backend.app.services.provider_process import provider_process_manager


@pytest_asyncio.fixture(autouse=True)
async def clean_db():
    await init_db()
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Episode))
        await db.execute(delete(Participant))
        await db.execute(delete(Room))
        await db.commit()
    yield


def test_rewrite_m3u8_playlist_rewrites_segments_and_keys():
    raw = (
        "#EXTM3U\n"
        "#EXT-X-VERSION:3\n"
        '#EXT-X-KEY:METHOD=AES-128,URI="enc.key"\n'
        "#EXTINF:6.0,\n"
        "seg001.ts\n"
        "#EXTINF:6.0,\n"
        "https://cdn.example.com/hls/seg002.ts?token=abc\n"
    )
    rewritten = rewrite_m3u8_playlist(
        raw,
        base_url="https://cdn.example.com/hls/index.m3u8",
        referer="https://embed.example.com/e/1",
    )
    lines = rewritten.splitlines()
    assert '/api/browse/stream-proxy?url=https%3A%2F%2Fcdn.example.com%2Fhls%2Fenc.key&referer=' in lines[2]
    assert lines[4].startswith("/api/browse/stream-proxy?url=https%3A%2F%2Fcdn.example.com%2Fhls%2Fseg001.ts")
    assert "referer=https%3A%2F%2Fembed.example.com%2Fe%2F1" in lines[4]
    assert lines[6].startswith("/api/browse/stream-proxy?url=https%3A%2F%2Fcdn.example.com%2Fhls%2Fseg002.ts%3Ftoken%3Dabc")


@pytest.mark.asyncio
async def test_stream_proxy_rejects_ssrf_urls():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for bad in (
            "http://127.0.0.1:5000/api/v2/home",
            "http://localhost:8000/secret.m3u8",
            "http://169.254.169.254/latest/meta-data/",
            "file:///etc/passwd",
        ):
            res = await client.get("/api/browse/stream-proxy", params={"url": bad})
            assert res.status_code == 400


@pytest.mark.asyncio
async def test_provider_endpoints_expose_search_details_episodes_and_servers(monkeypatch):
    async def fake_provider_get(path, params=None, allow_404_empty=False, timeout=15.0):
        if path == "/api/v2/search":
            if (params or {}).get("keyword") == "nothinghere":
                return None
            return {
                "pageInfo": {"currentPage": 1, "hasNextPage": False, "totalPages": 1},
                "response": [
                    {
                        "id": "frieren-beyond-journeys-end-18542",
                        "title": "Frieren: Beyond Journey's End",
                        "alternativeTitle": "Sousou no Frieren",
                        "poster": "https://cdn.example.com/frieren.jpg",
                        "type": "TV",
                        "duration": "24m",
                        "episodes": {"sub": 28, "dub": 28, "eps": 28},
                    }
                ],
            }
        if path == "/api/v2/suggestion":
            return [{"id": "frieren-beyond-journeys-end-18542", "title": "Frieren", "type": "TV"}]
        if path == "/api/v2/anime/frieren-beyond-journeys-end-18542":
            return {
                "id": "frieren-beyond-journeys-end-18542",
                "title": "Frieren: Beyond Journey's End",
                "alternativeTitle": "Sousou no Frieren",
                "japanese": "葬送のフリーレン",
                "poster": "https://cdn.example.com/frieren.jpg",
                "rating": "PG-13",
                "type": "TV",
                "episodes": {"sub": 28, "dub": 28, "eps": 28},
                "synopsis": "After the party of heroes defeated the Demon King...",
                "aired": {"from": "Sep 29, 2023", "to": "Mar 22, 2024"},
                "duration": "24m",
                "status": "Finished Airing",
                "MAL_score": "9.3",
                "genres": ["Adventure", "Drama", "Fantasy"],
                "studios": ["madhouse"],
                "moreSeasons": [],
                "related": [],
                "recommended": [],
            }
        if path == "/api/v2/episodes/frieren-beyond-journeys-end-18542":
            return [
                {
                    "id": "101",
                    "episodeNumber": 1,
                    "title": "The Journey's End",
                    "alternativeTitle": "Bouken no Owari",
                    "isFiller": False,
                    "sub": True,
                    "dub": True,
                    "aniId": "154587/1",
                    "malId": "52991/1",
                    "fxSub": "fx-sub-1",
                    "fxDub": "fx-dub-1",
                }
            ]
        if path == "/api/v2/servers/101":
            return {
                "episodeId": "101",
                "type": (params or {}).get("type", "sub"),
                "servers": [
                    {
                        "serverName": "s-1",
                        "serverId": "101-s1",
                        "iframe": "https://flixera.example.com/embed/ani/154587/1/sub?autoplay=0",
                    }
                ],
            }
        if path == "/api/v2/genres":
            return ["action", "adventure", "fantasy"]
        if path == "/api/v2/random":
            return {"id": "frieren-beyond-journeys-end-18542"}
        return {}

    monkeypatch.setattr(anime_provider_service, "provider_get", fake_provider_get)

    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        srch = await client.get("/api/provider/search?keyword=frieren")
        assert srch.status_code == 200
        assert srch.json()["results"][0]["id"] == "frieren-beyond-journeys-end-18542"
        assert srch.json()["results"][0]["sub_count"] == 28

        empty = await client.get("/api/provider/search?keyword=nothinghere")
        assert empty.status_code == 200
        assert empty.json()["results"] == []

        sugg = await client.get("/api/provider/suggestion?keyword=frieren")
        assert sugg.status_code == 200
        assert len(sugg.json()["suggestions"]) == 1

        det = await client.get("/api/browse/anime/frieren-beyond-journeys-end-18542")
        assert det.status_code == 200
        ddata = det.json()
        assert ddata["provider"] == "anime_provider"
        assert ddata["rating"] == 93
        assert ddata["episodes"][0]["episode_id"] == "101"
        assert ddata["episodes"][0]["sub"] is True
        assert ddata["episodes"][0]["dub"] is True

        srvs = await client.get("/api/provider/servers/101?type=sub&ani=154587/1")
        assert srvs.status_code == 200
        assert srvs.json()["servers"][0]["serverName"] == "s-1"

        genres = await client.get("/api/provider/genres")
        assert genres.status_code == 200
        assert "fantasy" in genres.json()["genres"]

        rnd = await client.get("/api/provider/random")
        assert rnd.status_code == 200
        assert rnd.json()["id"] == "frieren-beyond-journeys-end-18542"


@pytest.mark.asyncio
async def test_room_rest_endpoints_preserve_online_episode_fields():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_res = await client.post("/api/rooms", json={"name": "Provider Room", "host_username": "Host"})
        assert create_res.status_code == 201
        auth = create_res.json()
        code = auth["room"]["code"]

        add_res = await client.post(
            f"/api/rooms/{code}/online-episode",
            headers={
                "X-Participant-ID": auth["participant_id"],
                "X-Session-Token": auth["session_token"],
            },
            json={
                "anime_title": "Frieren",
                "episode_number": 1,
                "display_title": "The Journey's End",
                "stream_url": "https://flixera.example.com/embed/ani/154587/1/sub?autoplay=0",
                "set_active": True,
            },
        )
        assert add_res.status_code == 200

        room_res = await client.get(f"/api/rooms/{code}")
        assert room_res.status_code == 200
        episodes = room_res.json()["episodes"]
        assert len(episodes) == 1
        assert episodes[0]["source_type"] == "online"
        assert episodes[0]["stream_url"] == "https://flixera.example.com/embed/ani/154587/1/sub?autoplay=0"

        queue_res = await client.get(f"/api/rooms/{code}/queue")
        assert queue_res.status_code == 200
        q_eps = queue_res.json()["episodes"]
        assert q_eps[0]["source_type"] == "online"
        assert q_eps[0]["stream_url"].startswith("https://flixera.example.com/embed/")


def test_provider_process_manager_resolves_node_bundle():
    cmd = provider_process_manager._resolve_command()
    assert cmd is not None
    assert cmd[-1].endswith("dist-node/index.js") or cmd[-1].endswith("index.ts")


@pytest.mark.asyncio
async def test_resolve_stream_extracts_novuscloud_hls_and_tracks(monkeypatch):
    class FakeResp:
        def __init__(self, status_code=200, text="", json_data=None, url="https://novuscloud.buzz/embed/hd-1/ani/21/1/sub?k=1"):
            self.status_code = status_code
            self.text = text
            self._json = json_data
            self.url = url

        def json(self):
            return self._json

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, headers=None):
            if "/stream/getSources" in url:
                return FakeResp(
                    200,
                    json_data={
                        "sources": [{"file": "/p?t=master123", "type": "hls"}],
                        "tracks": [
                            {"file": "/p/track.ass?t=sub1", "label": "English (Full)", "kind": "captions", "format": "ass", "default": True},
                            {"file": "/p/thumb.vtt?t=th1", "label": "thumbnails", "kind": "thumbnails"},
                        ],
                    },
                    url=url,
                )
            return FakeResp(
                200,
                text="<html><script>var sourcesUrl = '/stream/getSources?t=tok123';</script></html>",
                url="https://novuscloud.buzz/embed/hd-1/ani/21/1/sub?k=1",
            )

    monkeypatch.setattr(anime_provider_service, "validate_external_media_url", lambda url, resolve_dns=False: {"valid": True, "url": url, "format": "unknown"})
    monkeypatch.setattr(anime_provider_service.httpx, "AsyncClient", FakeAsyncClient)

    res = await anime_provider_service.resolve_stream_from_iframe(
        "https://novuscloud.buzz/embed/hd-1/ani/21/1/sub?k=1"
    )
    assert res["mode"] == "stream"
    assert res["format"] == "hls"
    assert res["stream_url"] == "https://novuscloud.buzz/p?t=master123"
    assert "/api/browse/stream-proxy?" in res["proxy_stream_url"]
    assert "&format=hls" in res["proxy_stream_url"]
    assert len(res["tracks"]) == 1
    assert res["tracks"][0]["label"] == "English (Full)"
    assert res["subtitle_url"] == res["tracks"][0]["proxy_url"]


@pytest.mark.asyncio
async def test_online_episode_accepts_stream_proxy_and_blocks_ssrf_proxy():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_res = await client.post("/api/rooms", json={"name": "HLS Proxy Room", "host_username": "Host"})
        auth = create_res.json()
        code = auth["room"]["code"]
        headers = {
            "X-Participant-ID": auth["participant_id"],
            "X-Session-Token": auth["session_token"],
        }

        ok_res = await client.post(
            f"/api/rooms/{code}/online-episode",
            headers=headers,
            json={
                "anime_title": "One Piece",
                "episode_number": 1,
                "stream_url": "/api/browse/stream-proxy?url=https%3A%2F%2Fnovuscloud.buzz%2Fp%3Ft%3Dabc&referer=https%3A%2F%2Fnovuscloud.buzz%2Fembed&format=hls",
                "subtitle_url": "/api/browse/stream-proxy?url=https%3A%2F%2Fnovuscloud.buzz%2Fp%2Ftrack.ass%3Ft%3Dxyz",
                "set_active": True,
            },
        )
        assert ok_res.status_code == 200
        assert ok_res.json()["episode"]["source_type"] == "online"

        bad_res = await client.post(
            f"/api/rooms/{code}/online-episode",
            headers=headers,
            json={
                "anime_title": "Bad",
                "episode_number": 1,
                "stream_url": "/api/browse/stream-proxy?url=http%3A%2F%2F127.0.0.1%3A8000%2Fsecret.m3u8",
                "set_active": True,
            },
        )
        assert bad_res.status_code == 400
