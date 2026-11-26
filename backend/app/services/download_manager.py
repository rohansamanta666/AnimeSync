"""
AnimeSync — Authorized Direct-Download Episode Manager

Handles downloading authorized direct video files (.mp4 / .webm) into storage/downloads/:
- Rejects HLS (.m3u8) playlists (not directly downloadable single video files)
- Enforces SSRF validation (including DNS resolution check) before backend fetch
- Enforces strict path containment within settings.DOWNLOAD_DIR
- Supports progress tracking, pause/resume (HTTP Range when supported), retry, and SHA-256 verification
"""
import asyncio
import hashlib
import re
from pathlib import Path
from typing import Any, Dict, List, Optional
import httpx
from sqlalchemy import select, delete
from backend.app.config import settings
from backend.app.database import AsyncSessionLocal
from backend.app.models.download import DownloadTask, DownloadStatus
from backend.app.services.url_security import validate_external_media_url

SAFE_FILENAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")
CHUNK_SIZE = 64 * 1024  # 64KB


def _sanitize_filename(anime_title: str, episode_number: int, fmt: str) -> str:
    ext = ".webm" if fmt == "webm" else ".mp4"
    slug = SAFE_FILENAME_RE.sub("_", anime_title.strip()).strip("_")[:60] or "episode"
    return f"{slug}_ep{episode_number}{ext}"


def _resolve_safe_download_path(filename: str) -> Path:
    root = Path(settings.DOWNLOAD_DIR).resolve()
    root.mkdir(parents=True, exist_ok=True)
    target = (root / Path(filename).name).resolve()
    if not str(target).startswith(str(root)):
        raise ValueError("Invalid download path outside storage/downloads.")
    return target


def serialize_download_task(task: DownloadTask) -> Dict[str, Any]:
    progress = 0.0
    if task.total_bytes and task.total_bytes > 0:
        progress = min(100.0, round((task.downloaded_bytes / task.total_bytes) * 100.0, 2))
    elif task.status == DownloadStatus.COMPLETED:
        progress = 100.0

    return {
        "id": task.id,
        "anime_title": task.anime_title,
        "episode_number": task.episode_number,
        "source_url": task.source_url,
        "filename": task.filename,
        "total_bytes": task.total_bytes,
        "downloaded_bytes": task.downloaded_bytes,
        "progress_percent": progress,
        "sha256_hash": task.sha256_hash,
        "supports_range": task.supports_range,
        "status": task.status.value if hasattr(task.status, "value") else str(task.status),
        "error_message": task.error_message,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


def _compute_file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            buf = f.read(CHUNK_SIZE)
            if not buf:
                break
            h.update(buf)
    return h.hexdigest()


class EpisodeDownloadManager:
    def __init__(self) -> None:
        self._active_tasks: Dict[str, asyncio.Task] = {}

    def start_background_download(self, task_id: str) -> None:
        existing = self._active_tasks.get(task_id)
        if existing and not existing.done():
            return
        self._active_tasks[task_id] = asyncio.create_task(self._run_download(task_id))

    def cancel_background_task(self, task_id: str) -> None:
        task = self._active_tasks.get(task_id)
        if task and not task.done():
            task.cancel()

    async def _run_download(self, task_id: str) -> None:
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(DownloadTask).where(DownloadTask.id == task_id))
                task = res.scalar_one_or_none()
                if not task:
                    return

                check = validate_external_media_url(task.source_url, resolve_dns=True)
                if not check["valid"]:
                    task.status = DownloadStatus.FAILED
                    task.error_message = check["error"]
                    await db.commit()
                    return

                if check["format"] == "hls":
                    task.status = DownloadStatus.FAILED
                    task.error_message = "HLS (.m3u8) playlists cannot be downloaded as a single video file."
                    await db.commit()
                    return

                target_path = Path(task.file_path).resolve()
                root = Path(settings.DOWNLOAD_DIR).resolve()
                if not str(target_path).startswith(str(root)):
                    task.status = DownloadStatus.FAILED
                    task.error_message = "Unsafe file path rejected."
                    await db.commit()
                    return

                existing_bytes = target_path.stat().st_size if target_path.exists() else 0
                headers: Dict[str, str] = {}
                mode = "wb"
                if existing_bytes > 0 and task.supports_range:
                    headers["Range"] = f"bytes={existing_bytes}-"
                    mode = "ab"
                else:
                    existing_bytes = 0

                task.status = DownloadStatus.DOWNLOADING
                task.error_message = None
                await db.commit()

                async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                    async with client.stream("GET", check["url"], headers=headers) as resp:
                        if resp.status_code >= 400:
                            task.status = DownloadStatus.FAILED
                            task.error_message = f"Remote server returned HTTP {resp.status_code}."
                            await db.commit()
                            return

                        # If server ignored Range and returned 200, restart cleanly
                        if resp.status_code == 200 and mode == "ab":
                            mode = "wb"
                            existing_bytes = 0

                        accept_ranges = resp.headers.get("accept-ranges", "").lower()
                        task.supports_range = accept_ranges == "bytes" or resp.status_code == 206

                        content_len = resp.headers.get("content-length")
                        if content_len and content_len.isdigit():
                            task.total_bytes = existing_bytes + int(content_len)

                        downloaded = existing_bytes
                        await db.commit()

                        with open(target_path, mode) as out_file:
                            async for chunk in resp.aiter_bytes(chunk_size=CHUNK_SIZE):
                                out_file.write(chunk)
                                downloaded += len(chunk)
                                # Update progress periodically
                                if downloaded - task.downloaded_bytes >= 256 * 1024:
                                    task.downloaded_bytes = downloaded
                                    await db.commit()

                        task.downloaded_bytes = downloaded
                        if not task.total_bytes:
                            task.total_bytes = downloaded

                # Compute SHA-256 integrity hash on completed file
                task.sha256_hash = _compute_file_sha256(target_path)
                task.status = DownloadStatus.COMPLETED
                await db.commit()

        except asyncio.CancelledError:
            # Pause / cancellation requested cleanly
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(DownloadTask).where(DownloadTask.id == task_id))
                task = res.scalar_one_or_none()
                if task and task.status == DownloadStatus.DOWNLOADING:
                    target_path = Path(task.file_path)
                    if target_path.exists():
                        task.downloaded_bytes = target_path.stat().st_size
                    task.status = DownloadStatus.PAUSED
                    await db.commit()
        except Exception as exc:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(DownloadTask).where(DownloadTask.id == task_id))
                task = res.scalar_one_or_none()
                if task:
                    task.status = DownloadStatus.FAILED
                    task.error_message = str(exc)[:450]
                    await db.commit()
        finally:
            self._active_tasks.pop(task_id, None)


download_manager = EpisodeDownloadManager()
