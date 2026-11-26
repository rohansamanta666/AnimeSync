"""
AnimeSync — Authorized Streaming & Metadata Service

Provides:
1. Search & details via AniList's free public GraphQL API (no API key required)
   with graceful offline/fallback handling.
2. Built-in authorized open-licensed / Creative Commons media catalog (HLS .m3u8 & MP4)
   plus optional custom authorized catalog URL via STREAMING_CATALOG_URL.
3. Safe URL validation for user-supplied authorized stream & subtitle URLs.
"""
import html
import ipaddress
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
import httpx
from backend.app.config import settings

HTML_TAG_RE = re.compile(r"<[^>]+>")

# Built-in authorized Creative Commons / public test streams (HLS & MP4)
AUTHORIZED_OPEN_CATALOG: List[Dict[str, Any]] = [
    {
        "id": "open-sintel",
        "source": "authorized_catalog",
        "title": "Sintel (Open Movie - CC BY 3.0)",
        "native_title": "Sintel",
        "description": "An independently produced open-licensed fantasy short film by the Blender Foundation.",
        "cover_image": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Sintel_poster.jpg/440px-Sintel_poster.jpg",
        "banner_image": None,
        "genres": ["Fantasy", "Action", "Adventure"],
        "episodes_count": 2,
        "status": "FINISHED",
        "episodes": [
            {
                "episode_number": 1,
                "title": "Episode 1 — Sintel (HLS Stream)",
                "stream_url": "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
                "subtitle_url": None,
                "format": "hls",
            },
            {
                "episode_number": 2,
                "title": "Episode 2 — Sintel (MP4 Direct)",
                "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
                "subtitle_url": None,
                "format": "mp4",
            },
        ],
    },
    {
        "id": "open-tears-of-steel",
        "source": "authorized_catalog",
        "title": "Tears of Steel (Open Sci-Fi - CC BY 3.0)",
        "native_title": "Tears of Steel",
        "description": "Open-licensed sci-fi short film produced by the Blender Foundation (HLS adaptive stream).",
        "cover_image": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Tos-poster.png/440px-Tos-poster.png",
        "banner_image": None,
        "genres": ["Sci-Fi", "Action"],
        "episodes_count": 2,
        "status": "FINISHED",
        "episodes": [
            {
                "episode_number": 1,
                "title": "Episode 1 — Tears of Steel (HLS)",
                "stream_url": "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
                "subtitle_url": None,
                "format": "hls",
            },
            {
                "episode_number": 2,
                "title": "Episode 2 — Tears of Steel (MP4)",
                "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
                "subtitle_url": None,
                "format": "mp4",
            },
        ],
    },
    {
        "id": "open-big-buck-bunny",
        "source": "authorized_catalog",
        "title": "Big Buck Bunny (Open Animation - CC BY 3.0)",
        "native_title": "Big Buck Bunny",
        "description": "Open-licensed animated comedy short by the Blender Institute.",
        "cover_image": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/440px-Big_buck_bunny_poster_big.jpg",
        "banner_image": None,
        "genres": ["Animation", "Comedy"],
        "episodes_count": 2,
        "status": "FINISHED",
        "episodes": [
            {
                "episode_number": 1,
                "title": "Episode 1 — Big Buck Bunny (HLS)",
                "stream_url": "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
                "subtitle_url": None,
                "format": "hls",
            },
            {
                "episode_number": 2,
                "title": "Episode 2 — Big Buck Bunny (MP4)",
                "stream_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
                "subtitle_url": None,
                "format": "mp4",
            },
        ],
    },
]

ANILIST_SEARCH_QUERY = """
query ($search: String, $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
      id
      title {
        romaji
        english
        native
      }
      description(asHtml: false)
      episodes
      status
      genres
      coverImage {
        large
      }
      bannerImage
    }
  }
}
"""

ANILIST_DETAIL_QUERY = """
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title {
      romaji
      english
      native
    }
    description(asHtml: false)
    episodes
    status
    genres
    coverImage {
      large
    }
    bannerImage
  }
}
"""


def _strip_html(text: Optional[str]) -> str:
    if not text:
        return ""
    cleaned = HTML_TAG_RE.sub("", text)
    return html.unescape(cleaned).strip()


def detect_stream_format(url: str) -> str:
    lower = url.lower().split("?")[0].split("#")[0]
    if lower.endswith(".m3u8"):
        return "hls"
    if lower.endswith(".webm"):
        return "webm"
    if lower.endswith(".mp4") or lower.endswith(".m4v"):
        return "mp4"
    if ".m3u8" in url.lower():
        return "hls"
    return "unknown"


def validate_stream_url_syntax(url: str) -> Dict[str, Any]:
    """
    Validates that a stream URL is syntactically safe (http/https, valid host, non-empty).
    Blocks dangerous schemes like javascript:, file:, data:.
    """
    if not url or not isinstance(url, str):
        return {"valid": False, "error": "Stream URL is required."}

    trimmed = url.strip()
    if len(trimmed) > 2000:
        return {"valid": False, "error": "Stream URL exceeds maximum length (2000 characters)."}

    parsed = urlparse(trimmed)
    if parsed.scheme.lower() not in ("http", "https"):
        return {"valid": False, "error": "Only http:// and https:// stream URLs are supported."}

    if not parsed.netloc or not parsed.hostname:
        return {"valid": False, "error": "Stream URL must contain a valid hostname."}

    # Block obvious cloud metadata / link-local IPs
    try:
        ip = ipaddress.ip_address(parsed.hostname)
        if ip.is_link_local or ip.is_multicast:
            return {"valid": False, "error": "Link-local or multicast addresses are not permitted."}
    except ValueError:
        pass  # Hostname is a domain name

    return {
        "valid": True,
        "url": trimmed,
        "format": detect_stream_format(trimmed),
    }


def _normalize_anilist_media(media: Dict[str, Any]) -> Dict[str, Any]:
    title_obj = media.get("title") or {}
    display_title = title_obj.get("english") or title_obj.get("romaji") or title_obj.get("native") or "Untitled Anime"
    ep_count = media.get("episodes") or 12
    episodes = [
        {
            "episode_number": i,
            "title": f"Episode {i}",
            "stream_url": None,
            "subtitle_url": None,
            "format": None,
        }
        for i in range(1, min(int(ep_count), 100) + 1)
    ]
    return {
        "id": f"anilist-{media['id']}",
        "source": "anilist",
        "title": display_title,
        "native_title": title_obj.get("native"),
        "description": _strip_html(media.get("description")),
        "cover_image": (media.get("coverImage") or {}).get("large"),
        "banner_image": media.get("bannerImage"),
        "genres": media.get("genres") or [],
        "episodes_count": media.get("episodes") or len(episodes),
        "status": media.get("status") or "UNKNOWN",
        "episodes": episodes,
    }


async def search_catalog_and_anilist(query: str, limit: int = 12) -> List[Dict[str, Any]]:
    """
    Searches the built-in authorized open catalog first, then queries AniList public GraphQL API
    for metadata. Falls back cleanly to catalog results if offline or if AniList fails.
    """
    q = (query or "").strip()
    results: List[Dict[str, Any]] = []

    # 1. Search built-in authorized open catalog
    if not q:
        results.extend(AUTHORIZED_OPEN_CATALOG)
    else:
        q_lower = q.lower()
        for item in AUTHORIZED_OPEN_CATALOG:
            if (
                q_lower in item["title"].lower()
                or q_lower in item["description"].lower()
                or any(q_lower in g.lower() for g in item.get("genres", []))
            ):
                results.append(item)

    # 2. Optional external authorized catalog JSON URL
    if settings.STREAMING_CATALOG_URL:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(settings.STREAMING_CATALOG_URL)
                if resp.status_code == 200:
                    external_items = resp.json()
                    if isinstance(external_items, list):
                        for item in external_items:
                            if not q or q.lower() in str(item.get("title", "")).lower():
                                results.append(item)
        except Exception:
            pass

    # 3. Query AniList GraphQL API when query is non-empty
    if q:
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.post(
                    settings.ANILIST_API_URL,
                    json={
                        "query": ANILIST_SEARCH_QUERY,
                        "variables": {"search": q, "perPage": limit},
                    },
                    headers={"Content-Type": "application/json", "Accept": "application/json"},
                )
                if resp.status_code == 200:
                    payload = resp.json()
                    media_list = ((payload.get("data") or {}).get("Page") or {}).get("media") or []
                    for m in media_list:
                        results.append(_normalize_anilist_media(m))
        except Exception:
            pass

    return results[:limit]


async def get_anime_details(anime_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieves full details and episode list for either an authorized catalog entry or an AniList ID.
    """
    for item in AUTHORIZED_OPEN_CATALOG:
        if item["id"] == anime_id:
            return item

    if anime_id.startswith("anilist-"):
        raw_id = anime_id.replace("anilist-", "", 1)
        if raw_id.isdigit():
            try:
                async with httpx.AsyncClient(timeout=6.0) as client:
                    resp = await client.post(
                        settings.ANILIST_API_URL,
                        json={
                            "query": ANILIST_DETAIL_QUERY,
                            "variables": {"id": int(raw_id)},
                        },
                        headers={"Content-Type": "application/json", "Accept": "application/json"},
                    )
                    if resp.status_code == 200:
                        payload = resp.json()
                        media = (payload.get("data") or {}).get("Media")
                        if media:
                            return _normalize_anilist_media(media)
            except Exception:
                return None
    return None
