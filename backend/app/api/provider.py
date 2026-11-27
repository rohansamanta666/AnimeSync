"""
AnimeSync — Anime Provider API Router

Exposes all endpoints of the integrated `anime-provider` server under `/api/provider/*`
so the frontend and Watch Together clients can access everything over the single backend port.
"""
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query

from backend.app.services import anime_provider_service
from backend.app.services.anime_provider_service import (
    ProviderServiceError,
    check_provider_health,
    discover_provider_anime,
    get_provider_anime_details,
    normalize_provider_card,
    resolve_best_direct_stream,
    resolve_stream_from_iframe,
    search_provider_anime,
)

router = APIRouter(prefix="/provider", tags=["provider"])


def _raise_provider(exc: ProviderServiceError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("/health")
async def provider_health():
    return await check_provider_health()


@router.get("/home")
async def provider_home():
    try:
        data = await anime_provider_service.provider_get("/api/v2/home")
    except ProviderServiceError as exc:
        _raise_provider(exc)

    normalized: dict = dict(data or {})
    for key in (
        "spotlight",
        "trending",
        "topAiring",
        "mostPopular",
        "mostFavorite",
        "latestCompleted",
        "latestEpisode",
        "newAdded",
        "topUpcoming",
    ):
        items = (data or {}).get(key) or []
        normalized[f"{key}_cards"] = [
            normalize_provider_card(item) for item in items if isinstance(item, dict) and item.get("id")
        ]
    return normalized


@router.get("/search")
async def provider_search(
    keyword: Optional[str] = Query(None, max_length=120),
    q: Optional[str] = Query(None, max_length=120),
    page: int = Query(1, ge=1, le=100),
    per_page: int = Query(20, ge=1, le=40),
):
    term = (keyword if keyword is not None else q) or ""
    try:
        return await search_provider_anime(query=term, page=page, per_page=per_page)
    except ProviderServiceError as exc:
        _raise_provider(exc)


@router.get("/suggestion")
async def provider_suggestion(
    keyword: Optional[str] = Query(None, max_length=120),
    q: Optional[str] = Query(None, max_length=120),
):
    term = ((keyword if keyword is not None else q) or "").strip()
    if not term:
        return {"suggestions": []}
    try:
        data = await anime_provider_service.provider_get("/api/v2/suggestion", params={"keyword": term}, allow_404_empty=True)
        return {"suggestions": data or []}
    except ProviderServiceError as exc:
        _raise_provider(exc)


@router.get("/animes/{query}")
@router.get("/animes/{query}/{category}")
async def provider_list(
    query: str,
    category: Optional[str] = None,
    page: int = Query(1, ge=1, le=100),
):
    path = f"/api/v2/animes/{quote(query)}"
    if category:
        path = f"{path}/{quote(category)}"
    try:
        data = await anime_provider_service.provider_get(path, params={"page": page})
    except ProviderServiceError as exc:
        _raise_provider(exc)

    page_info = (data or {}).get("pageInfo") or {}
    items = (data or {}).get("response") or []
    return {
        "query": query,
        "category": category,
        "page": page_info.get("currentPage", page),
        "last_page": page_info.get("totalPages", 1),
        "has_next_page": bool(page_info.get("hasNextPage", False)),
        "results": [normalize_provider_card(item) for item in items],
        "top10": (data or {}).get("top10"),
        "genres": (data or {}).get("genres") or [],
    }


@router.get("/filter/options")
async def provider_filter_options():
    try:
        return await anime_provider_service.provider_get("/api/v2/filter/options")
    except ProviderServiceError as exc:
        _raise_provider(exc)


@router.get("/filter")
async def provider_filter(
    keyword: Optional[str] = None,
    sort: Optional[str] = None,
    genres: Optional[str] = None,
    type: Optional[str] = None,
    status: Optional[str] = None,
    rated: Optional[str] = None,
    score: Optional[str] = None,
    season: Optional[str] = None,
    language: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = Query(1, ge=1, le=100),
):
    params = {
        k: v
        for k, v in {
            "keyword": keyword,
            "sort": sort,
            "genres": genres,
            "type": type,
            "status": status,
            "rated": rated,
            "score": score,
            "season": season,
            "language": language,
            "start_date": start_date,
            "end_date": end_date,
            "page": page,
        }.items()
        if v is not None and v != ""
    }
    try:
        data = await anime_provider_service.provider_get("/api/v2/filter", params=params, allow_404_empty=True)
    except ProviderServiceError as exc:
        _raise_provider(exc)

    if not data:
        return {"page": page, "last_page": 1, "has_next_page": False, "results": []}

    page_info = data.get("pageInfo") or {}
    items = data.get("response") or []
    return {
        "page": page_info.get("currentPage", page),
        "last_page": page_info.get("totalPages", 1),
        "has_next_page": bool(page_info.get("hasNextPage", False)),
        "results": [normalize_provider_card(item) for item in items],
    }


@router.get("/anime/{anime_id}")
async def provider_anime_detail(anime_id: str):
    try:
        details = await get_provider_anime_details(anime_id)
    except ProviderServiceError as exc:
        _raise_provider(exc)
    if not details:
        raise HTTPException(status_code=404, detail="Anime not found")
    return details


@router.get("/episodes/{anime_id}")
async def provider_episodes(anime_id: str):
    try:
        episodes = await anime_provider_service.provider_get(f"/api/v2/episodes/{quote(anime_id)}")
        return {"anime_id": anime_id, "episodes": episodes or []}
    except ProviderServiceError as exc:
        _raise_provider(exc)


@router.get("/servers/{episode_id}")
async def provider_servers(
    episode_id: str,
    type: str = Query("sub", pattern="^(sub|dub)$"),
    ani: Optional[str] = None,
    mal: Optional[str] = None,
    fx: Optional[str] = None,
    resolve: bool = Query(False),
):
    params: dict = {"type": type}
    if ani:
        params["ani"] = ani
    if mal:
        params["mal"] = mal
    if fx:
        params["fx"] = fx
    try:
        data = await anime_provider_service.provider_get(
            f"/api/v2/servers/{quote(episode_id)}", params=params
        )
    except ProviderServiceError as exc:
        _raise_provider(exc)

    if resolve and isinstance(data, dict):
        direct = await resolve_best_direct_stream(data.get("servers") or [])
        return {**data, "direct": direct}
    return data


@router.get("/resolve")
async def provider_resolve_stream(iframe_url: str = Query(..., min_length=1)):
    try:
        return await resolve_stream_from_iframe(iframe_url)
    except ProviderServiceError as exc:
        _raise_provider(exc)


@router.get("/schedules")
async def provider_schedules(date: Optional[str] = None):
    params = {"date": date} if date else None
    try:
        return await anime_provider_service.provider_get("/api/v2/schedules", params=params)
    except ProviderServiceError as exc:
        _raise_provider(exc)


@router.get("/schedule/next/{anime_id}")
async def provider_next_schedule(anime_id: str):
    try:
        return await anime_provider_service.provider_get(f"/api/v2/schedule/next/{quote(anime_id)}")
    except ProviderServiceError as exc:
        _raise_provider(exc)


@router.get("/genres")
async def provider_genres():
    try:
        genres = await anime_provider_service.provider_get("/api/v2/genres")
        return {"genres": genres or []}
    except ProviderServiceError as exc:
        _raise_provider(exc)


@router.get("/top-search")
async def provider_top_search():
    try:
        items = await anime_provider_service.provider_get("/api/v2/top-search")
        return {"results": items or []}
    except ProviderServiceError as exc:
        _raise_provider(exc)


@router.get("/random")
async def provider_random():
    try:
        return await anime_provider_service.provider_get("/api/v2/random")
    except ProviderServiceError as exc:
        _raise_provider(exc)


@router.get("/characters/{anime_id}")
async def provider_characters(anime_id: str, page: int = Query(1, ge=1, le=50)):
    try:
        return await anime_provider_service.provider_get(f"/api/v2/characters/{quote(anime_id)}", params={"page": page})
    except ProviderServiceError as exc:
        _raise_provider(exc)


@router.get("/character/{char_id}")
async def provider_character_detail(char_id: str):
    try:
        return await anime_provider_service.provider_get(f"/api/v2/character/{quote(char_id)}")
    except ProviderServiceError as exc:
        _raise_provider(exc)


@router.get("/news")
async def provider_news(page: int = Query(1, ge=1, le=50)):
    try:
        return await anime_provider_service.provider_get("/api/v2/news", params={"page": page})
    except ProviderServiceError as exc:
        _raise_provider(exc)
