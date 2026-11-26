"""
AnimeSync — Browse & Authorized Media Source API
"""
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from backend.app.services.anime_metadata_service import (
    discover_anime,
    search_anime,
    get_anime_details,
)
from backend.app.services.media_providers import (
    get_all_provider_catalogs,
    UserUrlMediaProvider,
)

router = APIRouter(prefix="/browse", tags=["browse"])


class ValidateSourceRequest(BaseModel):
    stream_url: str
    subtitle_url: Optional[str] = None
    audio_track: str = "sub"


@router.get("/discover")
async def discover(
    category: str = Query("trending", pattern="^(trending|popular|recent)$"),
    page: int = Query(1, ge=1, le=50),
    per_page: int = Query(18, ge=1, le=30),
):
    return await discover_anime(category=category, page=page, per_page=per_page)


@router.get("/search")
async def search(
    q: str = Query("", max_length=120),
    page: int = Query(1, ge=1, le=50),
    per_page: int = Query(18, ge=1, le=30),
):
    return await search_anime(query=q, page=page, per_page=per_page)


@router.get("/anime/{anime_id}")
async def anime_details(anime_id: str):
    # Check authorized provider catalogs first (e.g., open-sintel)
    catalog_items = await get_all_provider_catalogs()
    for item in catalog_items:
        if str(item.get("id")) == str(anime_id):
            return item

    details = await get_anime_details(anime_id)
    if not details:
        raise HTTPException(status_code=404, detail="Anime not found")
    return details


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
