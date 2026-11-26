"""
AnimeSync — Modular Authorized Media Provider Architecture

Keeps media sources strictly separated from anime metadata:
- OpenCatalogMediaProvider: Public-domain & Creative Commons sample/open media
- SelfHostedCatalogMediaProvider: Optional self-hosted JSON catalog via SELF_HOSTED_CATALOG_URL
- UserUrlMediaProvider: User-provided direct MP4/WebM or authorized HLS (.m3u8) URLs
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
import httpx
from backend.app.config import settings
from backend.app.services.url_security import validate_external_media_url


class MediaProvider(ABC):
    provider_id: str
    display_name: str

    @abstractmethod
    async def list_catalog(self) -> List[Dict[str, Any]]:
        """Returns authorized playable media entries provided by this provider."""
        raise NotImplementedError


class OpenCatalogMediaProvider(MediaProvider):
    provider_id = "open_catalog"
    display_name = "Open-Licensed / Creative Commons Catalog"

    OPEN_ITEMS: List[Dict[str, Any]] = [
        {
            "id": "open-sintel",
            "provider": "open_catalog",
            "title": "Sintel (CC BY 3.0 Open Movie)",
            "description": "Open-licensed fantasy animated short film by the Blender Foundation.",
            "cover_image": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Sintel_poster.jpg/440px-Sintel_poster.jpg",
            "genres": ["Fantasy", "Action", "Adventure"],
            "release_year": 2010,
            "status": "FINISHED",
            "episodes": [
                {
                    "episode_number": 1,
                    "title": "Sintel — HLS Stream (.m3u8)",
                    "stream_url": "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
                    "subtitle_url": None,
                    "format": "hls",
                    "downloadable": False,
                    "audio_track": "en",
                },
                {
                    "episode_number": 2,
                    "title": "Sintel — Direct MP4",
                    "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
                    "subtitle_url": None,
                    "format": "mp4",
                    "downloadable": True,
                    "audio_track": "en",
                },
            ],
        },
        {
            "id": "open-tears-of-steel",
            "provider": "open_catalog",
            "title": "Tears of Steel (CC BY 3.0 Open Sci-Fi)",
            "description": "Open-licensed sci-fi short film produced by the Blender Foundation.",
            "cover_image": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Tos-poster.png/440px-Tos-poster.png",
            "genres": ["Sci-Fi", "Action"],
            "release_year": 2012,
            "status": "FINISHED",
            "episodes": [
                {
                    "episode_number": 1,
                    "title": "Tears of Steel — HLS Stream (.m3u8)",
                    "stream_url": "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
                    "subtitle_url": None,
                    "format": "hls",
                    "downloadable": False,
                    "audio_track": "en",
                },
                {
                    "episode_number": 2,
                    "title": "Tears of Steel — Direct MP4",
                    "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
                    "subtitle_url": None,
                    "format": "mp4",
                    "downloadable": True,
                    "audio_track": "en",
                },
            ],
        },
        {
            "id": "open-big-buck-bunny",
            "provider": "open_catalog",
            "title": "Big Buck Bunny (CC BY 3.0 Open Animation)",
            "description": "Open-licensed animated comedy short by the Blender Institute.",
            "cover_image": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/440px-Big_buck_bunny_poster_big.jpg",
            "genres": ["Animation", "Comedy"],
            "release_year": 2008,
            "status": "FINISHED",
            "episodes": [
                {
                    "episode_number": 1,
                    "title": "Big Buck Bunny — HLS Stream (.m3u8)",
                    "stream_url": "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
                    "subtitle_url": None,
                    "format": "hls",
                    "downloadable": False,
                    "audio_track": "en",
                },
                {
                    "episode_number": 2,
                    "title": "Big Buck Bunny — Direct MP4",
                    "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
                    "subtitle_url": None,
                    "format": "mp4",
                    "downloadable": True,
                    "audio_track": "en",
                },
            ],
        },
    ]

    async def list_catalog(self) -> List[Dict[str, Any]]:
        return self.OPEN_ITEMS


class SelfHostedCatalogMediaProvider(MediaProvider):
    provider_id = "self_hosted_catalog"
    display_name = "Self-Hosted Media Catalog"

    async def list_catalog(self) -> List[Dict[str, Any]]:
        url = (settings.SELF_HOSTED_CATALOG_URL or "").strip()
        if not url:
            return []
        check = validate_external_media_url(url, resolve_dns=True)
        if not check["valid"]:
            return []
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(check["url"])
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, list):
                        return data
        except Exception:
            pass
        return []


class UserUrlMediaProvider:
    provider_id = "user_url"
    display_name = "User-Provided Authorized URL"

    @staticmethod
    def validate_source(
        stream_url: str,
        subtitle_url: Optional[str] = None,
        audio_track: str = "sub",
    ) -> Dict[str, Any]:
        video_check = validate_external_media_url(stream_url, resolve_dns=False)
        if not video_check["valid"]:
            return {"valid": False, "error": video_check["error"]}

        sub_url = None
        if subtitle_url and subtitle_url.strip():
            sub_check = validate_external_media_url(subtitle_url, resolve_dns=False)
            if not sub_check["valid"]:
                return {"valid": False, "error": f"Invalid subtitle URL: {sub_check['error']}"}
            sub_url = sub_check["url"]

        fmt = video_check["format"]
        return {
            "valid": True,
            "provider": "user_url",
            "stream_url": video_check["url"],
            "subtitle_url": sub_url,
            "format": fmt,
            "downloadable": fmt in ("mp4", "webm"),
            "audio_track": audio_track if audio_track in ("sub", "dub") else "sub",
        }


async def get_all_provider_catalogs() -> List[Dict[str, Any]]:
    providers: List[MediaProvider] = [
        OpenCatalogMediaProvider(),
        SelfHostedCatalogMediaProvider(),
    ]
    items: List[Dict[str, Any]] = []
    for p in providers:
        items.extend(await p.list_catalog())
    return items
