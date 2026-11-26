"""
AnimeSync — AniList GraphQL Metadata Service

Fetches legitimate anime discovery metadata (trending, popular, recently updated,
search with pagination, and detailed anime pages) completely separated from media sources.
"""
import html
import re
from typing import Any, Dict, List, Optional
import httpx
from backend.app.config import settings

HTML_TAG_RE = re.compile(r"<[^>]+>")

ANILIST_DISCOVER_QUERY = """
query ($page: Int, $perPage: Int, $sort: [MediaSort], $search: String, $status: MediaStatus) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      total
      currentPage
      lastPage
      hasNextPage
    }
    media(type: ANIME, sort: $sort, search: $search, status: $status, isAdult: false) {
      id
      title {
        romaji
        english
        native
      }
      description(asHtml: false)
      episodes
      status
      seasonYear
      startDate {
        year
      }
      averageScore
      genres
      coverImage {
        large
        extraLarge
      }
      bannerImage
      nextAiringEpisode {
        episode
      }
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
    duration
    status
    season
    seasonYear
    startDate {
      year
    }
    averageScore
    popularity
    genres
    studios(isMain: true) {
      nodes {
        name
      }
    }
    coverImage {
      large
      extraLarge
    }
    bannerImage
    nextAiringEpisode {
      episode
    }
  }
}
"""


def _strip_html(text: Optional[str]) -> str:
    if not text:
        return ""
    return html.unescape(HTML_TAG_RE.sub("", text)).strip()


def normalize_anilist_item(media: Dict[str, Any], include_episodes: bool = False) -> Dict[str, Any]:
    title_obj = media.get("title") or {}
    display_title = (
        title_obj.get("english")
        or title_obj.get("romaji")
        or title_obj.get("native")
        or "Untitled Anime"
    )
    release_year = media.get("seasonYear") or (media.get("startDate") or {}).get("year")
    next_ep = (media.get("nextAiringEpisode") or {}).get("episode")
    total_eps = media.get("episodes") or (next_ep - 1 if next_ep and next_ep > 1 else 12)

    item: Dict[str, Any] = {
        "id": str(media["id"]),
        "anilist_id": media["id"],
        "source": "anilist",
        "title": display_title,
        "romaji_title": title_obj.get("romaji"),
        "native_title": title_obj.get("native"),
        "description": _strip_html(media.get("description")),
        "cover_image": (media.get("coverImage") or {}).get("extraLarge")
        or (media.get("coverImage") or {}).get("large"),
        "banner_image": media.get("bannerImage"),
        "genres": media.get("genres") or [],
        "status": media.get("status") or "UNKNOWN",
        "release_year": release_year,
        "rating": media.get("averageScore"),
        "episodes_count": media.get("episodes") or total_eps,
        "duration_minutes": media.get("duration"),
        "studios": [
            s.get("name")
            for s in ((media.get("studios") or {}).get("nodes") or [])
            if s.get("name")
        ],
        "supports_sub_dub_selection": True,
    }

    if include_episodes:
        count = min(max(int(total_eps or 1), 1), 200)
        item["episodes"] = [
            {
                "episode_number": ep_num,
                "title": f"Episode {ep_num}",
            }
            for ep_num in range(1, count + 1)
        ]

    return item


async def _post_anilist(query: str, variables: Dict[str, Any]) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.post(
            settings.ANILIST_API_URL,
            json={"query": query, "variables": variables},
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()


async def discover_anime(
    category: str = "trending",
    page: int = 1,
    per_page: int = 18,
) -> Dict[str, Any]:
    """
    Fetches trending, popular, or recently updated anime from AniList.
    """
    cat = category.lower().strip()
    sort_map = {
        "trending": ["TRENDING_DESC", "POPULARITY_DESC"],
        "popular": ["POPULARITY_DESC"],
        "recent": ["UPDATED_AT_DESC"],
    }
    sort_order = sort_map.get(cat, sort_map["trending"])
    variables: Dict[str, Any] = {
        "page": max(1, page),
        "perPage": min(max(1, per_page), 30),
        "sort": sort_order,
    }
    if cat == "recent":
        variables["status"] = "RELEASING"

    try:
        payload = await _post_anilist(ANILIST_DISCOVER_QUERY, variables)
        page_data = (payload.get("data") or {}).get("Page") or {}
        page_info = page_data.get("pageInfo") or {}
        media_list = page_data.get("media") or []
        return {
            "category": cat,
            "page": page_info.get("currentPage", page),
            "per_page": variables["perPage"],
            "total": page_info.get("total", len(media_list)),
            "last_page": page_info.get("lastPage", 1),
            "has_next_page": bool(page_info.get("hasNextPage", False)),
            "results": [normalize_anilist_item(m) for m in media_list],
            "metadata_available": True,
        }
    except Exception as exc:
        return {
            "category": cat,
            "page": page,
            "per_page": variables["perPage"],
            "total": 0,
            "last_page": 1,
            "has_next_page": False,
            "results": [],
            "metadata_available": False,
            "error": f"Unable to reach AniList metadata service: {exc}",
        }


async def search_anime(
    query: str,
    page: int = 1,
    per_page: int = 18,
) -> Dict[str, Any]:
    """
    Searches AniList for anime matching `query` with pagination.
    """
    clean_q = (query or "").strip()
    if not clean_q:
        return await discover_anime(category="popular", page=page, per_page=per_page)

    variables = {
        "page": max(1, page),
        "perPage": min(max(1, per_page), 30),
        "sort": ["SEARCH_MATCH", "POPULARITY_DESC"],
        "search": clean_q,
    }
    try:
        payload = await _post_anilist(ANILIST_DISCOVER_QUERY, variables)
        page_data = (payload.get("data") or {}).get("Page") or {}
        page_info = page_data.get("pageInfo") or {}
        media_list = page_data.get("media") or []
        return {
            "query": clean_q,
            "page": page_info.get("currentPage", page),
            "per_page": variables["perPage"],
            "total": page_info.get("total", len(media_list)),
            "last_page": page_info.get("lastPage", 1),
            "has_next_page": bool(page_info.get("hasNextPage", False)),
            "results": [normalize_anilist_item(m) for m in media_list],
            "metadata_available": True,
        }
    except Exception as exc:
        return {
            "query": clean_q,
            "page": page,
            "per_page": variables["perPage"],
            "total": 0,
            "last_page": 1,
            "has_next_page": False,
            "results": [],
            "metadata_available": False,
            "error": f"Unable to reach AniList metadata service: {exc}",
        }


async def get_anime_details(anime_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetches full AniList metadata and episode list for a given AniList ID.
    """
    if not anime_id or not str(anime_id).isdigit():
        return None
    try:
        payload = await _post_anilist(ANILIST_DETAIL_QUERY, {"id": int(anime_id)})
        media = (payload.get("data") or {}).get("Media")
        if not media:
            return None
        return normalize_anilist_item(media, include_episodes=True)
    except Exception:
        return None
