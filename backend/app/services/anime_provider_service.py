"""
AnimeSync — Anime Provider Integration Service

Async client for the local `anime-provider` Hono server (/api/v2/*),
providing unified browse/search/episode/server responses and optional
direct stream resolution from embed URLs.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urljoin

import httpx

from backend.app.config import settings
from backend.app.services.provider_process import provider_process_manager
from backend.app.services.url_security import validate_external_media_url

M3U8_URL_RE = re.compile(r"""https?://[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?""", re.IGNORECASE)
MP4_URL_RE = re.compile(r"""https?://[^\s"'<>\\]+\.(?:mp4|webm)(?:\?[^\s"'<>\\]*)?""", re.IGNORECASE)
VTT_URL_RE = re.compile(r"""https?://[^\s"'<>\\]+\.(?:vtt|srt|ass)(?:\?[^\s"'<>\\]*)?""", re.IGNORECASE)
SOURCES_URL_RE = re.compile(r"""var\s+sourcesUrl\s*=\s*["']([^"']+)["']""")
YEAR_RE = re.compile(r"(19\d{2}|20\d{2})")

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class ProviderServiceError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


async def _ensure_provider_ready() -> None:
    if not await provider_process_manager.is_healthy(timeout=0.8):
        await provider_process_manager.ensure_started()


async def provider_get(
    path: str,
    params: Optional[Dict[str, Any]] = None,
    allow_404_empty: bool = False,
    timeout: float = 15.0,
) -> Any:
    await _ensure_provider_ready()
    base = settings.ANIME_PROVIDER_URL.rstrip("/")
    clean_path = path if path.startswith("/") else f"/{path}"
    url = f"{base}{clean_path}"

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url, params=params)
    except Exception as exc:
        raise ProviderServiceError(503, f"Anime provider unreachable: {exc}") from exc

    if resp.status_code == 404 and allow_404_empty:
        return None

    try:
        payload = resp.json()
    except Exception as exc:
        raise ProviderServiceError(
            resp.status_code if resp.status_code >= 400 else 502,
            f"Invalid response from anime provider (HTTP {resp.status_code})",
        ) from exc

    if resp.status_code >= 400 or not payload.get("success", False):
        msg = payload.get("message") or f"Anime provider error (HTTP {resp.status_code})"
        raise ProviderServiceError(resp.status_code if resp.status_code >= 400 else 502, msg)

    return payload.get("data")


async def check_provider_health() -> Dict[str, Any]:
    base = settings.ANIME_PROVIDER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{base}/ping")
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "available": True,
                    "url": base,
                    "status": data.get("status", "ok"),
                    "environment": data.get("environment", "self-hosted"),
                }
    except Exception as exc:
        return {"available": False, "url": base, "error": str(exc)}
    return {"available": False, "url": base, "error": "Unhealthy response"}


def _extract_year(text: Optional[str]) -> Optional[int]:
    if not text:
        return None
    m = YEAR_RE.search(str(text))
    return int(m.group(1)) if m else None


def normalize_provider_card(raw: Dict[str, Any]) -> Dict[str, Any]:
    eps = raw.get("episodes") or {}
    sub_count = eps.get("sub")
    dub_count = eps.get("dub")
    total_eps = eps.get("eps") or sub_count or dub_count or 0
    return {
        "id": str(raw.get("id") or ""),
        "source": "anime_provider",
        "provider": "anime_provider",
        "title": raw.get("title") or raw.get("alternativeTitle") or "Untitled Anime",
        "romaji_title": raw.get("alternativeTitle"),
        "native_title": None,
        "description": raw.get("synopsis") or "",
        "cover_image": raw.get("poster"),
        "banner_image": None,
        "genres": [],
        "status": raw.get("type") or "ANIME",
        "type": raw.get("type"),
        "duration": raw.get("duration"),
        "release_year": _extract_year(raw.get("aired")),
        "rating": None,
        "episodes_count": int(total_eps or 0),
        "sub_count": sub_count,
        "dub_count": dub_count,
        "supports_sub_dub_selection": True,
    }


def normalize_provider_detail(
    detail: Dict[str, Any],
    episodes: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    eps_meta = detail.get("episodes") or {}
    sub_count = eps_meta.get("sub")
    dub_count = eps_meta.get("dub")
    total_eps = eps_meta.get("eps") or (len(episodes) if episodes else 0) or sub_count or dub_count or 0

    mal_score_raw = detail.get("MAL_score")
    rating_100: Optional[int] = None
    if mal_score_raw:
        try:
            rating_100 = int(round(float(str(mal_score_raw).strip()) * 10))
        except ValueError:
            rating_100 = None

    aired = detail.get("aired") or {}
    release_year = _extract_year(aired.get("from")) or _extract_year(detail.get("premiered"))

    normalized_episodes: List[Dict[str, Any]] = []
    for idx, ep in enumerate(episodes or []):
        ep_num = ep.get("episodeNumber")
        if ep_num is None:
            ep_num = idx + 1
        ep_id = ep.get("id")
        normalized_episodes.append(
            {
                "episode_number": int(ep_num),
                "episode_id": str(ep_id) if ep_id is not None else None,
                "title": ep.get("title") or f"Episode {ep_num}",
                "alternative_title": ep.get("alternativeTitle"),
                "is_filler": bool(ep.get("isFiller", False)),
                "sub": bool(ep.get("sub", True)),
                "dub": bool(ep.get("dub", False)),
                "embed_id": ep.get("embedId"),
                "ani_id": ep.get("aniId"),
                "mal_id": ep.get("malId"),
                "fx_sub": ep.get("fxSub"),
                "fx_dub": ep.get("fxDub"),
                "format": "embed",
                "downloadable": False,
            }
        )

    return {
        "id": str(detail.get("id") or ""),
        "source": "anime_provider",
        "provider": "anime_provider",
        "title": detail.get("title") or detail.get("alternativeTitle") or "Untitled Anime",
        "romaji_title": detail.get("alternativeTitle"),
        "native_title": detail.get("japanese"),
        "description": detail.get("synopsis") or "",
        "cover_image": detail.get("poster"),
        "banner_image": None,
        "genres": detail.get("genres") or [],
        "status": detail.get("status") or detail.get("type") or "UNKNOWN",
        "type": detail.get("type"),
        "age_rating": detail.get("rating"),
        "duration": detail.get("duration"),
        "premiered": detail.get("premiered"),
        "aired": aired,
        "release_year": release_year,
        "rating": rating_100,
        "episodes_count": int(total_eps or 0),
        "sub_count": sub_count,
        "dub_count": dub_count,
        "studios": detail.get("studios") or [],
        "supports_sub_dub_selection": True,
        "episodes": normalized_episodes,
        "more_seasons": detail.get("moreSeasons") or [],
        "related": [normalize_provider_card(r) for r in (detail.get("related") or []) if r.get("id")],
        "recommended": [normalize_provider_card(r) for r in (detail.get("recommended") or []) if r.get("id")],
    }


async def discover_provider_anime(
    category: str = "trending",
    page: int = 1,
    per_page: int = 18,
) -> Dict[str, Any]:
    cat = (category or "trending").lower().strip()
    query_map = {
        "trending": "top-airing",
        "popular": "most-popular",
        "recent": "recently-updated",
    }
    provider_query = query_map.get(cat, cat)
    data = await provider_get(f"/api/v2/animes/{quote(provider_query)}", params={"page": page})
    page_info = (data or {}).get("pageInfo") or {}
    items = (data or {}).get("response") or []
    return {
        "category": cat,
        "page": page_info.get("currentPage", page),
        "per_page": per_page,
        "total": len(items) * max(1, page_info.get("totalPages", 1)),
        "last_page": page_info.get("totalPages", 1),
        "has_next_page": bool(page_info.get("hasNextPage", False)),
        "results": [normalize_provider_card(item) for item in items],
        "metadata_available": True,
        "source": "anime_provider",
    }


async def search_provider_anime(
    query: str,
    page: int = 1,
    per_page: int = 18,
) -> Dict[str, Any]:
    clean_q = (query or "").strip()
    if not clean_q:
        return await discover_provider_anime(category="popular", page=page, per_page=per_page)

    data = await provider_get(
        "/api/v2/search",
        params={"keyword": clean_q, "page": page},
        allow_404_empty=True,
    )
    if not data:
        return {
            "query": clean_q,
            "page": page,
            "per_page": per_page,
            "total": 0,
            "last_page": 1,
            "has_next_page": False,
            "results": [],
            "metadata_available": True,
            "source": "anime_provider",
        }

    page_info = data.get("pageInfo") or {}
    items = data.get("response") or []
    return {
        "query": clean_q,
        "page": page_info.get("currentPage", page),
        "per_page": per_page,
        "total": len(items) * max(1, page_info.get("totalPages", 1)),
        "last_page": page_info.get("totalPages", 1),
        "has_next_page": bool(page_info.get("hasNextPage", False)),
        "results": [normalize_provider_card(item) for item in items],
        "metadata_available": True,
        "source": "anime_provider",
    }


async def get_provider_anime_details(anime_id: str) -> Optional[Dict[str, Any]]:
    if not anime_id:
        return None
    detail = await provider_get(f"/api/v2/anime/{quote(anime_id)}")
    if not detail:
        return None
    try:
        episodes = await provider_get(f"/api/v2/episodes/{quote(anime_id)}")
    except ProviderServiceError:
        episodes = []
    return normalize_provider_detail(detail, episodes or [])


async def resolve_stream_from_iframe(iframe_url: str) -> Dict[str, Any]:
    """
    Extracts direct ad-free HLS/MP4 stream URLs and subtitle tracks from an embed URL
    (e.g., NovusCloud `/stream/getSources?t=...`), falling back cleanly to `mode: "iframe"`
    only when the embed host uses JS challenge protection or exposes no direct stream.
    """
    check = validate_external_media_url(iframe_url, resolve_dns=True)
    if not check["valid"]:
        raise ProviderServiceError(400, check["error"])

    clean_url = check["url"]
    fmt = check["format"]
    if fmt in ("hls", "mp4", "webm"):
        return {
            "mode": "stream",
            "format": fmt,
            "stream_url": clean_url,
            "proxy_stream_url": f"/api/browse/stream-proxy?url={quote(clean_url, safe='')}&format={fmt}",
            "iframe_url": clean_url,
            "subtitle_url": None,
            "subtitles": [],
            "tracks": [],
        }

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(
                clean_url,
                headers={**BROWSER_HEADERS, "Referer": "https://zanix.tr/"},
            )
            html = resp.text or ""
            if resp.status_code >= 400 or "Just a moment..." in html:
                return {
                    "mode": "iframe",
                    "format": "embed",
                    "iframe_url": clean_url,
                    "stream_url": None,
                    "proxy_stream_url": None,
                    "subtitle_url": None,
                    "subtitles": [],
                    "tracks": [],
                }

            # 1. NovusCloud `/stream/getSources?t=...` API extraction
            src_match = SOURCES_URL_RE.search(html)
            if src_match:
                sources_api_url = urljoin(str(resp.url), src_match.group(1))
                api_check = validate_external_media_url(sources_api_url, resolve_dns=False)
                if api_check["valid"]:
                    api_resp = await client.get(
                        api_check["url"],
                        headers={
                            **BROWSER_HEADERS,
                            "Accept": "application/json, text/plain, */*",
                            "Referer": str(resp.url),
                            "X-Requested-With": "XMLHttpRequest",
                        },
                    )
                    if api_resp.status_code == 200:
                        payload = api_resp.json()
                        sources = payload.get("sources") or []
                        if not sources and isinstance(payload.get("link"), dict):
                            sources = [payload["link"]]
                        raw_file = (sources[0].get("file") if sources else None) or payload.get("file")
                        if raw_file:
                            abs_stream = urljoin(str(resp.url), raw_file)
                            stream_check = validate_external_media_url(abs_stream, resolve_dns=False)
                            if stream_check["valid"]:
                                stype = (sources[0].get("type") if sources else None) or "hls"
                                if stype not in ("hls", "mp4", "webm"):
                                    stype = stream_check["format"] if stream_check["format"] != "unknown" else "hls"

                                tracks: List[Dict[str, Any]] = []
                                sub_urls: List[str] = []
                                for tr in payload.get("tracks") or []:
                                    if tr.get("kind") == "thumbnails" or not tr.get("file"):
                                        continue
                                    abs_tr = urljoin(str(resp.url), tr["file"])
                                    tr_check = validate_external_media_url(abs_tr, resolve_dns=False)
                                    if not tr_check["valid"]:
                                        continue
                                    proxy_tr = (
                                        f"/api/browse/stream-proxy?url={quote(tr_check['url'], safe='')}"
                                        f"&referer={quote(str(resp.url), safe='')}"
                                    )
                                    tr_fmt = (tr.get("format") or "").lower()
                                    if not tr_fmt:
                                        if ".srt" in abs_tr.lower():
                                            tr_fmt = "srt"
                                        elif ".vtt" in abs_tr.lower():
                                            tr_fmt = "vtt"
                                        elif ".ass" in abs_tr.lower():
                                            tr_fmt = "ass"
                                    tracks.append(
                                        {
                                            "label": tr.get("label") or "Subtitles",
                                            "format": tr_fmt or "vtt",
                                            "default": bool(tr.get("default", False)),
                                            "url": tr_check["url"],
                                            "proxy_url": proxy_tr,
                                        }
                                    )
                                    sub_urls.append(proxy_tr)

                                # Prefer default track, or SRT/VTT, or first caption track
                                preferred_sub = None
                                for t in tracks:
                                    if t["default"]:
                                        preferred_sub = t["proxy_url"]
                                        break
                                if not preferred_sub:
                                    for t in tracks:
                                        if t["format"] in ("vtt", "srt"):
                                            preferred_sub = t["proxy_url"]
                                            break
                                if not preferred_sub and tracks:
                                    preferred_sub = tracks[0]["proxy_url"]

                                return {
                                    "mode": "stream",
                                    "format": stype,
                                    "stream_url": stream_check["url"],
                                    "proxy_stream_url": (
                                        f"/api/browse/stream-proxy?url={quote(stream_check['url'], safe='')}"
                                        f"&referer={quote(str(resp.url), safe='')}&format={stype}"
                                    ),
                                    "iframe_url": clean_url,
                                    "subtitle_url": preferred_sub,
                                    "subtitles": sub_urls,
                                    "tracks": tracks,
                                }
    except Exception:
        return {
            "mode": "iframe",
            "format": "embed",
            "iframe_url": clean_url,
            "stream_url": None,
            "proxy_stream_url": None,
            "subtitle_url": None,
            "subtitles": [],
            "tracks": [],
        }

    m3u8_matches = M3U8_URL_RE.findall(html)
    mp4_matches = MP4_URL_RE.findall(html)
    sub_matches = list(dict.fromkeys(VTT_URL_RE.findall(html)))

    candidate = m3u8_matches[0] if m3u8_matches else (mp4_matches[0] if mp4_matches else None)
    if candidate:
        cand_check = validate_external_media_url(candidate, resolve_dns=False)
        if cand_check["valid"]:
            resolved_fmt = "hls" if m3u8_matches else cand_check["format"]
            return {
                "mode": "stream",
                "format": resolved_fmt,
                "stream_url": cand_check["url"],
                "proxy_stream_url": (
                    f"/api/browse/stream-proxy?url={quote(cand_check['url'], safe='')}"
                    f"&referer={quote(clean_url, safe='')}&format={resolved_fmt}"
                ),
                "iframe_url": clean_url,
                "subtitle_url": sub_matches[0] if sub_matches else None,
                "subtitles": sub_matches,
                "tracks": [],
            }

    return {
        "mode": "iframe",
        "format": "embed",
        "iframe_url": clean_url,
        "stream_url": None,
        "proxy_stream_url": None,
        "subtitle_url": None,
        "subtitles": sub_matches,
        "tracks": [],
    }


async def resolve_best_direct_stream(servers: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Prioritizes ad-free direct stream servers (e.g., s-3 / s-4 NovusCloud) and returns
    the first resolved direct stream payload, or None if only iframe embeds are available.
    """
    if not servers:
        return None

    def _priority(srv: Dict[str, Any]) -> int:
        name = (srv.get("serverName") or "").lower()
        iframe = (srv.get("iframe") or "").lower()
        if "novuscloud" in iframe or name == "s-3":
            return 0
        if name == "s-4":
            return 1
        return 2

    ordered = sorted(servers, key=_priority)
    for srv in ordered:
        iframe = srv.get("iframe")
        if not iframe:
            continue
        try:
            resolved = await resolve_stream_from_iframe(iframe)
        except ProviderServiceError:
            continue
        if resolved.get("mode") == "stream" and resolved.get("proxy_stream_url"):
            return {
                "serverName": srv.get("serverName"),
                "serverId": srv.get("serverId"),
                "stream_url": resolved["proxy_stream_url"],
                "raw_stream_url": resolved["stream_url"],
                "format": resolved["format"],
                "subtitle_url": resolved.get("subtitle_url"),
                "tracks": resolved.get("tracks") or [],
                "iframe_url": iframe,
            }
    return None


def rewrite_m3u8_playlist(content: str, base_url: str, referer: Optional[str] = None) -> str:
    """Rewrites relative and absolute URIs inside an M3U8 playlist to go through /api/browse/stream-proxy."""
    ref_suffix = f"&referer={quote(referer, safe='')}" if referer else ""
    lines = []
    uri_attr_re = re.compile(r'URI="([^"]+)"')

    def _proxy(target: str) -> str:
        abs_url = urljoin(base_url, target.strip())
        return f"/api/browse/stream-proxy?url={quote(abs_url, safe='')}{ref_suffix}"

    for raw_line in content.splitlines():
        stripped = raw_line.strip()
        if not stripped:
            lines.append(raw_line)
            continue
        if stripped.startswith("#"):
            lines.append(uri_attr_re.sub(lambda m: f'URI="{_proxy(m.group(1))}"', raw_line))
        else:
            lines.append(_proxy(stripped))
    return "\n".join(lines)
