"""
AnimeSync — Authorized Episode Download Manager API
"""
import shutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models.download import DownloadTask, DownloadStatus
from backend.app.services.download_manager import (
    download_manager,
    serialize_download_task,
    _sanitize_filename,
    _resolve_safe_download_path,
)
from backend.app.services.url_security import validate_external_media_url

router = APIRouter(prefix="/downloads", tags=["downloads"])


class CreateDownloadRequest(BaseModel):
    anime_title: str
    episode_number: int = 1
    source_url: str


@router.get("")
async def list_downloads(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(DownloadTask).order_by(DownloadTask.created_at.desc()))
    tasks = list(res.scalars().all())
    download_root = Path(settings.DOWNLOAD_DIR)
    download_root.mkdir(parents=True, exist_ok=True)
    used_bytes = sum(f.stat().st_size for f in download_root.glob("*") if f.is_file())
    total, _, free = shutil.disk_usage(download_root)
    return {
        "downloads": [serialize_download_task(t) for t in tasks],
        "storage": {
            "download_dir_bytes": used_bytes,
            "disk_free_bytes": free,
            "disk_total_bytes": total,
        },
    }


@router.post("", status_code=201)
async def start_download(payload: CreateDownloadRequest, db: AsyncSession = Depends(get_db)):
    check = validate_external_media_url(payload.source_url, resolve_dns=False)
    if not check["valid"]:
        raise HTTPException(status_code=400, detail=check["error"])

    if check["format"] == "hls":
        raise HTTPException(
            status_code=400,
            detail="HLS (.m3u8) playlists are not directly downloadable single video files.",
        )

    filename = _sanitize_filename(payload.anime_title, max(1, payload.episode_number), check["format"])
    safe_path = _resolve_safe_download_path(filename)
    # Ensure unique filename if already exists
    if safe_path.exists():
        stem = safe_path.stem
        suffix = safe_path.suffix
        import uuid
        safe_path = _resolve_safe_download_path(f"{stem}_{str(uuid.uuid4())[:6]}{suffix}")

    task = DownloadTask(
        anime_title=payload.anime_title.strip()[:200] or "Downloaded Anime",
        episode_number=max(1, payload.episode_number),
        source_url=check["url"],
        filename=safe_path.name,
        file_path=str(safe_path),
        status=DownloadStatus.PENDING,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    download_manager.start_background_download(task.id)
    return serialize_download_task(task)


@router.post("/{task_id}/pause")
async def pause_download(task_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(DownloadTask).where(DownloadTask.id == task_id))
    task = res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Download task not found")

    download_manager.cancel_background_task(task_id)
    if task.status in (DownloadStatus.PENDING, DownloadStatus.DOWNLOADING):
        task.status = DownloadStatus.PAUSED
        await db.commit()
    return serialize_download_task(task)


@router.post("/{task_id}/resume")
async def resume_download(task_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(DownloadTask).where(DownloadTask.id == task_id))
    task = res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Download task not found")
    if task.status == DownloadStatus.COMPLETED:
        return serialize_download_task(task)

    task.status = DownloadStatus.PENDING
    task.error_message = None
    await db.commit()
    download_manager.start_background_download(task.id)
    return serialize_download_task(task)


@router.post("/{task_id}/retry")
async def retry_download(task_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(DownloadTask).where(DownloadTask.id == task_id))
    task = res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Download task not found")

    task.status = DownloadStatus.PENDING
    task.error_message = None
    await db.commit()
    download_manager.start_background_download(task.id)
    return serialize_download_task(task)


@router.delete("/{task_id}")
async def delete_download(task_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(DownloadTask).where(DownloadTask.id == task_id))
    task = res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Download task not found")

    download_manager.cancel_background_task(task_id)
    root = Path(settings.DOWNLOAD_DIR).resolve()
    target = Path(task.file_path).resolve()
    if target.exists() and target.is_file() and str(target).startswith(str(root)):
        target.unlink(missing_ok=True)

    await db.delete(task)
    await db.commit()
    return {"success": True, "deleted_id": task_id}


@router.get("/{task_id}/file")
async def get_downloaded_file(task_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(DownloadTask).where(DownloadTask.id == task_id))
    task = res.scalar_one_or_none()
    if not task or task.status != DownloadStatus.COMPLETED:
        raise HTTPException(status_code=404, detail="Completed download file not found")

    root = Path(settings.DOWNLOAD_DIR).resolve()
    target = Path(task.file_path).resolve()
    if not target.exists() or not str(target).startswith(str(root)):
        raise HTTPException(status_code=404, detail="File missing on disk")

    return FileResponse(path=str(target), filename=task.filename)
