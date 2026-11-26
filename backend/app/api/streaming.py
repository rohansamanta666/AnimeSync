"""
AnimeSync — Streaming Catalog & Authorized URL Validation API
"""
from typing import Optional
import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from backend.app.services.streaming_service import (
    search_catalog_and_anilist,
    get_anime_details,
    validate_stream_url_syntax,
)

router = APIRouter(prefix="/streaming", tags=["streaming"])


class ValidateUrlRequest(BaseModel):
    stream_url: str
    subtitle_url: Optional[str] = None
    probe: bool = False


@router.get("/search")
async def search_anime(
    q: str = Query("", max_length=120),
    limit: int = Query(12, ge=1, le=25),
):
    results = await search_catalog_and_anilist(q, limit=limit)
    return {
        "query": q,
        "count": len(results),
        "results": results,
    }


@router.get("/anime/{anime_id}")
async def anime_details(anime_id: str):
    details = await get_anime_details(anime_id)
    if not details:
        raise HTTPException(status_code=404, detail="Anime not found")
    return details


@router.post("/validate-url")
async def validate_stream_url(payload: ValidateUrlRequest):
    check = validate_stream_url_syntax(payload.stream_url)
    if not check["valid"]:
        raise HTTPException(status_code=400, detail=check["error"])

    subtitle_check = None
    if payload.subtitle_url and payload.subtitle_url.strip():
        subtitle_check = validate_stream_url_syntax(payload.subtitle_url)
        if not subtitle_check["valid"]:
            raise HTTPException(status_code=400, detail=f"Invalid subtitle URL: {subtitle_check['error']}")

    reachable = None
    content_type = None
    if payload.probe:
        try:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                resp = await client.head(check["url"])
                reachable = resp.status_code < 400
                content_type = resp.headers.get("content-type")
        except Exception:
            reachable = False

    return {
        "valid": True,
        "stream_url": check["url"],
        "format": check["format"],
        "subtitle_url": subtitle_check["url"] if subtitle_check else None,
        "reachable": reachable,
        "content_type": content_type,
    }
