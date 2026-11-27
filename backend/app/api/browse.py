"""
AnimeSync — Browse & Authorized Media Source API
"""
import asyncio
from typing import Optional
import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from backend.app.services.anime_metadata_service import (
    discover_anime,
    search_anime,
    get_anime_details,
)
from backend.app.services.anime_provider_service import (
    ProviderServiceError,
    discover_provider_anime,
    get_provider_anime_details,
    rewrite_m3u8_playlist,
    search_provider_anime,
)
from backend.app.services.media_providers import (
    get_all_provider_catalogs,
    UserUrlMediaProvider,
)
from backend.app.services.url_security import validate_external_media_url

router = APIRouter(prefix="/browse", tags=["browse"])

_PROXY_CLIENT: Optional[httpx.AsyncClient] = None
_PROXY_SEMAPHORE = asyncio.Semaphore(4)
_RETRYABLE_STATUSES = {429, 500, 502, 503, 504}


def _get_proxy_client() -> httpx.AsyncClient:
    global _PROXY_CLIENT
    if _PROXY_CLIENT is None or _PROXY_CLIENT.is_closed:
        _PROXY_CLIENT = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            follow_redirects=True,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=40),
        )
    return _PROXY_CLIENT


class ValidateSourceRequest(BaseModel):
    stream_url: str
    subtitle_url: Optional[str] = None
    audio_track: str = "sub"


@router.get("/discover")
async def discover(
    category: str = Query("trending", pattern="^(trending|popular|recent)$"),
    page: int = Query(1, ge=1, le=50),
    per_page: int = Query(18, ge=1, le=30),
    source: str = Query("auto", pattern="^(auto|provider|anilist)$"),
):
    if source in ("auto", "provider"):
        try:
            return await discover_provider_anime(category=category, page=page, per_page=per_page)
        except ProviderServiceError as exc:
            if source == "provider":
                raise HTTPException(status_code=exc.status_code, detail=exc.message)
    return await discover_anime(category=category, page=page, per_page=per_page)


@router.get("/search")
async def search(
    q: str = Query("", max_length=120),
    page: int = Query(1, ge=1, le=50),
    per_page: int = Query(18, ge=1, le=30),
    source: str = Query("auto", pattern="^(auto|provider|anilist)$"),
):
    if source in ("auto", "provider"):
        try:
            return await search_provider_anime(query=q, page=page, per_page=per_page)
        except ProviderServiceError as exc:
            if source == "provider":
                raise HTTPException(status_code=exc.status_code, detail=exc.message)
    return await search_anime(query=q, page=page, per_page=per_page)


@router.get("/anime/{anime_id}")
async def anime_details(anime_id: str):
    # Check authorized provider catalogs first (e.g., open-sintel)
    catalog_items = await get_all_provider_catalogs()
    for item in catalog_items:
        if str(item.get("id")) == str(anime_id):
            return item

    # Numeric IDs resolve via AniList; slug IDs resolve via integrated anime-provider
    if anime_id.isdigit():
        details = await get_anime_details(anime_id)
        if details:
            return details

    try:
        provider_details = await get_provider_anime_details(anime_id)
        if provider_details:
            return provider_details
    except ProviderServiceError:
        pass

    if not anime_id.isdigit():
        details = await get_anime_details(anime_id)
        if details:
            return details

    raise HTTPException(status_code=404, detail="Anime not found")


@router.get("/stream-proxy")
async def stream_proxy(
    request: Request,
    url: str = Query(..., min_length=1, max_length=2000),
    referer: Optional[str] = Query(None, max_length=2000),
    format: Optional[str] = Query(None, max_length=20),
):
    """
    SSRF-guarded media & HLS (.m3u8) streaming proxy.
    Rewrites relative URIs inside .m3u8 manifests and forwards Range headers for direct video seeking.
    """
    check = validate_external_media_url(url, resolve_dns=True)
    if not check["valid"]:
        raise HTTPException(status_code=400, detail=check["error"])

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }
    if referer and referer.strip():
        ref_check = validate_external_media_url(referer, resolve_dns=False)
        if not ref_check["valid"]:
            raise HTTPException(status_code=400, detail=f"Invalid referer URL: {ref_check['error']}")
        headers["Referer"] = ref_check["url"]

    range_header = request.headers.get("range")
    if range_header:
        headers["Range"] = range_header

    target_url = check["url"]
    is_m3u8_hint = check["format"] == "hls" or (format or "").lower() == "hls"
    client = _get_proxy_client()

    if is_m3u8_hint:
        upstream = None
        last_exc: Optional[Exception] = None
        for attempt in range(4):
            try:
                async with _PROXY_SEMAPHORE:
                    upstream = await client.get(target_url, headers=headers)
                if upstream.status_code not in _RETRYABLE_STATUSES:
                    break
                retry_after = upstream.headers.get("retry-after")
                delay = float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() else 0.4 * (2 ** attempt)
            except Exception as exc:
                last_exc = exc
                delay = 0.4 * (2 ** attempt)
            await asyncio.sleep(min(delay, 3.0))

        if upstream is None:
            raise HTTPException(status_code=502, detail=f"Stream upstream error: {last_exc}")

        if upstream.status_code >= 400:
            raise HTTPException(status_code=upstream.status_code, detail="Upstream playlist fetch failed")

        rewritten = rewrite_m3u8_playlist(upstream.text, str(upstream.url), referer=referer)
        return Response(
            content=rewritten,
            media_type="application/vnd.apple.mpegurl",
            headers={"Cache-Control": "no-cache"},
        )

    upstream = None
    last_exc = None
    for attempt in range(4):
        try:
            async with _PROXY_SEMAPHORE:
                req = client.build_request("GET", target_url, headers=headers)
                cand = await client.send(req, stream=True)
            if cand.status_code not in _RETRYABLE_STATUSES or attempt == 3:
                upstream = cand
                break
            retry_after = cand.headers.get("retry-after")
            delay = float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() else 0.4 * (2 ** attempt)
            await cand.aclose()
        except Exception as exc:
            last_exc = exc
            delay = 0.4 * (2 ** attempt)
        await asyncio.sleep(min(delay, 3.0))

    if upstream is None:
        raise HTTPException(status_code=502, detail=f"Stream upstream error: {last_exc}")

    content_type = upstream.headers.get("content-type", "application/octet-stream")
    if "mpegurl" in content_type.lower() or "x-mpegurl" in content_type.lower():
        try:
            raw_bytes = await upstream.aread()
            final_url = str(upstream.url)
        finally:
            await upstream.aclose()
        rewritten = rewrite_m3u8_playlist(raw_bytes.decode("utf-8", errors="replace"), final_url, referer=referer)
        return Response(
            content=rewritten,
            media_type="application/vnd.apple.mpegurl",
            headers={"Cache-Control": "no-cache"},
        )

    passthrough_headers = {}
    for h in ("content-range", "accept-ranges", "content-length"):
        if h in upstream.headers:
            passthrough_headers[h] = upstream.headers[h]

    async def _iter_stream():
        try:
            async for chunk in upstream.aiter_bytes(chunk_size=65536):
                yield chunk
        except httpx.HTTPError:
            return
        finally:
            await upstream.aclose()

    return StreamingResponse(
        _iter_stream(),
        status_code=upstream.status_code,
        media_type=content_type,
        headers=passthrough_headers,
    )


@router.get("/providers/catalog")
async def provider_catalog():
    items = await get_all_provider_catalogs()
    return {"count": len(items), "results": items}


@router.post("/sources/validate")
async def validate_source(payload: ValidateSourceRequest):
    result = UserUrlMediaProvider.validate_source(
        stream_url=payload.stream_url,
        subtitle_url=payload.subtitle_url,
        audio_track=payload.audio_track,
    )
    if not result["valid"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result
