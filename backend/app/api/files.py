import os
import re
import mimetypes
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header, Query, UploadFile, File, Form, status, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import aiofiles
from backend.app.database import get_db
from backend.app.config import settings
from backend.app.models.room import Room
from backend.app.models.participant import Participant
from backend.app.models.episode import Episode
from backend.app.services.room_manager import RoomManager
from backend.app.services.storage import StorageService, sanitize_filename
from backend.app.services.queue_manager import QueueManager
from backend.app.schemas.episode import (
    UploadInitRequest,
    UploadInitResponse,
    UploadCompleteRequest,
)
from backend.app.schemas.room import EpisodeResponse
from backend.app.sockets import sio
from backend.app.sockets.server import invalidate_room_readiness

router = APIRouter(prefix="/files", tags=["Files"])

async def verify_participant_auth(
    db: AsyncSession,
    room_id: str,
    participant_id: Optional[str] = None,
    token: Optional[str] = None,
    auth_header: Optional[str] = None
) -> Participant:
    # Resolve token from Bearer header if present
    extracted_token = token
    if auth_header and auth_header.startswith("Bearer "):
        extracted_token = auth_header.split(" ")[1].strip()

    if not participant_id or not extracted_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing participant credentials"
        )

    participant = await RoomManager.authenticate_participant(
        db, room_id=room_id, participant_id=participant_id, token=extracted_token
    )
    if not participant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid participant session for this room"
        )
    return participant

@router.post("/upload/init", response_model=UploadInitResponse)
async def init_upload(
    req: UploadInitRequest,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db)
):
    await verify_participant_auth(db, req.room_id, participant_id, session_token)

    try:
        res = StorageService.init_upload(
            room_id=req.room_id,
            filename=req.filename,
            file_size_bytes=req.file_size_bytes,
            anime_title=req.anime_title,
            season=req.season,
            episode_number=req.episode_number,
            display_title=req.display_title,
            mime_type=req.mime_type or "video/mp4"
        )
        return UploadInitResponse(**res)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.post("/upload/chunk")
async def upload_chunk(
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    chunk_file: UploadFile = File(...),
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db)
):
    # Retrieve metadata to verify room authorization
    upload_dir = StorageService.get_upload_dir(upload_id)
    meta_file = upload_dir / "metadata.json"
    if not meta_file.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found")

    import json
    with open(meta_file, "r") as f:
        meta = json.load(f)

    await verify_participant_auth(db, meta["room_id"], participant_id, session_token)

    chunk_bytes = await chunk_file.read()
    try:
        res = await StorageService.save_chunk(upload_id, chunk_index, chunk_bytes)
        return res
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.get("/upload/{upload_id}/status")
async def get_upload_status(
    upload_id: str,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db)
):
    try:
        status_data = StorageService.get_upload_status(upload_id)
        room_id = status_data["metadata"]["room_id"]
        await verify_participant_auth(db, room_id, participant_id, session_token)
        return status_data
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found")

@router.post("/upload/complete", response_model=EpisodeResponse)
async def complete_upload(
    req: UploadCompleteRequest,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db)
):
    upload_dir = StorageService.get_upload_dir(req.upload_id)
    meta_file = upload_dir / "metadata.json"
    if not meta_file.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found")

    import json
    with open(meta_file, "r") as f:
        meta = json.load(f)

    await verify_participant_auth(db, meta["room_id"], participant_id, session_token)

    try:
        episode = await StorageService.finalize_upload(db, req.upload_id)

        # Look up room code to broadcast over Socket.IO
        room_res = await db.execute(select(Room).where(Room.id == episode.room_id))
        room = room_res.scalar_one_or_none()
        if room:
            episode_dict = QueueManager.serialize_episode(episode)
            await sio.emit("episode_added", {"episode": episode_dict}, room=room.code)

            # Broadcast updated episode queue
            all_eps = await QueueManager.get_queue(db, room.id)
            queue_list = [QueueManager.serialize_episode(ep) for ep in all_eps]
            await sio.emit(
                "queue_updated",
                {
                    "room_code": room.code,
                    "episodes": queue_list,
                    "current_episode_id": room.current_episode_id,
                },
                room=room.code,
            )

            # Only reset readiness if this newly uploaded episode is the room's current active episode
            if room.current_episode_id == episode.id:
                await invalidate_room_readiness(room.code, reason="New episode uploaded by host")

        return EpisodeResponse.model_validate(episode)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.post("/upload/{upload_id}/cancel")
async def cancel_upload(
    upload_id: str,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db)
):
    try:
        status_data = StorageService.get_upload_status(upload_id)
        room_id = status_data["metadata"]["room_id"]
        await verify_participant_auth(db, room_id, participant_id, session_token)
        StorageService.cancel_upload(upload_id)
        return {"success": True, "message": "Upload cancelled"}
    except FileNotFoundError:
        return {"success": True, "message": "Session already cleaned up"}

@router.get("/download/{episode_id}")
async def download_file(
    episode_id: str,
    range_header: Optional[str] = Header(None, alias="Range"),
    participant_id: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
    auth_header: Optional[str] = Header(None, alias="Authorization"),
    x_participant_id: Optional[str] = Header(None, alias="X-Participant-ID"),
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db)
):
    # Resolve participant credentials from Query or Header
    effective_participant_id = participant_id or x_participant_id
    effective_token = token or x_session_token

    # Lookup episode in database
    query = select(Episode).where(Episode.id == episode_id)
    res = await db.execute(query)
    episode = res.scalar_one_or_none()
    if not episode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found")

    # Authenticate that user belongs to the episode's room
    await verify_participant_auth(
        db,
        room_id=episode.room_id,
        participant_id=effective_participant_id,
        token=effective_token,
        auth_header=auth_header
    )

    file_path = Path(episode.file_path).resolve()
    storage_root = Path(settings.STORAGE_DIR).resolve()
    if not str(file_path).startswith(str(storage_root)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: file path is outside the allowed storage directory"
        )

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video file missing from host disk")

    file_size = file_path.stat().st_size
    content_type, _ = mimetypes.guess_type(str(file_path))
    content_type = content_type or episode.mime_type or "video/mp4"

    # Handle HTTP Range requests for resumable downloads
    start = 0
    end = file_size - 1
    status_code = status.HTTP_200_OK

    if range_header:
        range_match = re.match(r"^bytes=(\d+)-(\d*)$", range_header.strip())
        if range_match:
            start_str, end_str = range_match.groups()
            start = int(start_str)
            if end_str:
                end = int(end_str)
            if start >= file_size or end >= file_size or start > end:
                return Response(
                    status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
                    headers={"Content-Range": f"bytes */{file_size}"}
                )
            status_code = status.HTTP_206_PARTIAL_CONTENT

    content_length = end - start + 1

    async def stream_file_range(path: Path, offset: int, length: int):
        async with aiofiles.open(path, "rb") as f:
            await f.seek(offset)
            remaining = length
            chunk_size = 65536  # 64 KB streaming buffer
            while remaining > 0:
                read_amount = min(chunk_size, remaining)
                data = await f.read(read_amount)
                if not data:
                    break
                remaining -= len(data)
                yield data

    headers = {
        "Content-Disposition": f'attachment; filename="{episode.filename}"',
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
        "Content-Type": content_type,
        "X-SHA256": episode.sha256_hash or "",
    }

    if status_code == status.HTTP_206_PARTIAL_CONTENT:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    return StreamingResponse(
        stream_file_range(file_path, start, content_length),
        status_code=status_code,
        headers=headers,
        media_type=content_type
    )

@router.delete("/{episode_id}")
async def delete_episode(
    episode_id: str,
    participant_id: str = Header(..., alias="X-Participant-ID"),
    session_token: str = Header(..., alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db)
):
    query = select(Episode).where(Episode.id == episode_id)
    res = await db.execute(query)
    episode = res.scalar_one_or_none()
    if not episode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found")

    participant = await verify_participant_auth(db, episode.room_id, participant_id, session_token)
    if not participant.is_host:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the room host can delete episodes")

    file_path = Path(episode.file_path).resolve()
    storage_root = Path(settings.STORAGE_DIR).resolve()
    freed_bytes = 0
    if str(file_path).startswith(str(storage_root)) and file_path.exists() and file_path.is_file():
        freed_bytes = file_path.stat().st_size
        file_path.unlink()

    await db.delete(episode)
    await db.commit()

    return {"success": True, "freed_bytes": freed_bytes}

