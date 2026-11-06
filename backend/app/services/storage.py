import os
import re
import json
import uuid
import shutil
import hashlib
import time
import aiofiles
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.app.config import settings
from backend.app.models.episode import Episode, UploadStatus
from backend.app.models.room import Room

# Safe filename pattern: letters, digits, underscores, dashes, dots
FILENAME_REGEX = re.compile(r'[^a-zA-Z0-9_.-]')

def sanitize_filename(filename: str) -> str:
    # Strip any directory path components to prevent path traversal attacks
    clean_name = os.path.basename(filename).strip()
    clean_name = FILENAME_REGEX.sub('_', clean_name)
    # Ensure filename isn't empty or just dots
    clean_name = clean_name.lstrip('.')
    if not clean_name:
        clean_name = f"episode_{uuid.uuid4().hex[:8]}.mp4"
    return clean_name

class StorageService:
    @staticmethod
    def get_upload_dir(upload_id: str) -> Path:
        # Prevent path traversal in upload_id
        safe_id = re.sub(r'[^a-zA-Z0-9-]', '', upload_id or '')
        if not safe_id:
            raise ValueError("Invalid or empty upload session ID")
        return Path(settings.TEMP_UPLOAD_DIR) / safe_id

    @staticmethod
    def get_chunks_dir(upload_id: str) -> Path:
        return StorageService.get_upload_dir(upload_id) / "chunks"

    @staticmethod
    def init_upload(
        room_id: str,
        filename: str,
        file_size_bytes: int,
        anime_title: str,
        season: int = 1,
        episode_number: int = 1,
        display_title: Optional[str] = None,
        mime_type: str = "video/mp4"
    ) -> Dict[str, Any]:
        # Validate file size constraint
        max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
        if file_size_bytes > max_bytes:
            raise ValueError(f"File size exceeds maximum allowed limit ({settings.MAX_UPLOAD_SIZE_MB} MB)")

        upload_id = str(uuid.uuid4())
        upload_dir = StorageService.get_upload_dir(upload_id)
        chunks_dir = StorageService.get_chunks_dir(upload_id)

        upload_dir.mkdir(parents=True, exist_ok=True)
        chunks_dir.mkdir(parents=True, exist_ok=True)

        chunk_size = settings.CHUNK_SIZE_BYTES
        total_chunks = (file_size_bytes + chunk_size - 1) // chunk_size

        metadata = {
            "upload_id": upload_id,
            "room_id": room_id,
            "filename": sanitize_filename(filename),
            "file_size_bytes": file_size_bytes,
            "chunk_size_bytes": chunk_size,
            "total_chunks": total_chunks,
            "anime_title": anime_title.strip(),
            "season": season,
            "episode_number": episode_number,
            "display_title": display_title.strip() if display_title else None,
            "mime_type": mime_type,
            "created_at": os.path.getctime(upload_dir)
        }

        with open(upload_dir / "metadata.json", "w") as f:
            json.dump(metadata, f)

        return {
            "upload_id": upload_id,
            "chunk_size_bytes": chunk_size,
            "total_chunks": total_chunks,
            "received_chunks": []
        }

    @staticmethod
    async def save_chunk(upload_id: str, chunk_index: int, chunk_bytes: bytes) -> Dict[str, Any]:
        upload_dir = StorageService.get_upload_dir(upload_id)
        meta_file = upload_dir / "metadata.json"

        if not meta_file.exists():
            raise FileNotFoundError("Upload session not found or expired")

        with open(meta_file, "r") as f:
            metadata = json.load(f)

        total_chunks = metadata["total_chunks"]
        if chunk_index < 0 or chunk_index >= total_chunks:
            raise ValueError(f"Invalid chunk index {chunk_index} (total: {total_chunks})")

        # Defense-in-depth: Reject abnormally large individual chunks
        max_chunk = settings.CHUNK_SIZE_BYTES * 2
        if len(chunk_bytes) > max_chunk:
            raise ValueError(f"Chunk payload exceeds maximum size limit ({max_chunk} bytes)")

        chunk_path = StorageService.get_chunks_dir(upload_id) / f"{chunk_index}.chunk"

        async with aiofiles.open(chunk_path, "wb") as f:
            await f.write(chunk_bytes)

        received_chunks = StorageService.get_received_chunks(upload_id)

        return {
            "upload_id": upload_id,
            "chunk_index": chunk_index,
            "received_chunks": received_chunks,
            "total_chunks": total_chunks,
            "is_complete": len(received_chunks) == total_chunks
        }

    @staticmethod
    def get_received_chunks(upload_id: str) -> List[int]:
        chunks_dir = StorageService.get_chunks_dir(upload_id)
        if not chunks_dir.exists():
            return []

        received = []
        for file in chunks_dir.glob("*.chunk"):
            try:
                idx = int(file.stem)
                received.append(idx)
            except ValueError:
                continue
        return sorted(received)

    @staticmethod
    def get_upload_status(upload_id: str) -> Dict[str, Any]:
        upload_dir = StorageService.get_upload_dir(upload_id)
        meta_file = upload_dir / "metadata.json"

        if not meta_file.exists():
            raise FileNotFoundError("Upload session not found")

        with open(meta_file, "r") as f:
            metadata = json.load(f)

        received = StorageService.get_received_chunks(upload_id)
        return {
            "metadata": metadata,
            "received_chunks": received,
            "total_chunks": metadata["total_chunks"],
            "progress": round(len(received) / metadata["total_chunks"], 4) if metadata["total_chunks"] > 0 else 0
        }

    @staticmethod
    async def finalize_upload(db: AsyncSession, upload_id: str) -> Episode:
        upload_dir = StorageService.get_upload_dir(upload_id)
        meta_file = upload_dir / "metadata.json"

        if not meta_file.exists():
            raise FileNotFoundError("Upload session not found")

        with open(meta_file, "r") as f:
            metadata = json.load(f)

        total_chunks = metadata["total_chunks"]
        received = StorageService.get_received_chunks(upload_id)

        if len(received) != total_chunks:
            missing = set(range(total_chunks)) - set(received)
            raise ValueError(f"Cannot finalize upload. Missing {len(missing)} chunks: {sorted(list(missing))[:10]}")

        episode_id = str(uuid.uuid4())
        safe_name = metadata["filename"]
        target_filename = f"{episode_id}_{safe_name}"
        target_path = Path(settings.STORAGE_DIR) / target_filename

        # Stream chunks into destination file and compute SHA-256 incrementally
        hasher = hashlib.sha256()
        total_written = 0
        chunks_dir = StorageService.get_chunks_dir(upload_id)

        try:
            async with aiofiles.open(target_path, "wb") as out_file:
                for idx in range(total_chunks):
                    chunk_file = chunks_dir / f"{idx}.chunk"
                    if not chunk_file.exists():
                        raise FileNotFoundError(f"Missing chunk {idx} during assembly")

                    async with aiofiles.open(chunk_file, "rb") as in_chunk:
                        while True:
                            block = await in_chunk.read(65536)  # 64 KB block
                            if not block:
                                break
                            hasher.update(block)
                            await out_file.write(block)
                            total_written += len(block)

            # Validate total assembled file size matches expected size
            if total_written != metadata["file_size_bytes"]:
                if target_path.exists():
                    target_path.unlink()
                raise ValueError(
                    f"Assembled file size mismatch: expected {metadata['file_size_bytes']} bytes, got {total_written} bytes"
                )

            computed_sha256 = hasher.hexdigest().lower()

            # Create Episode record in Database
            # Determine queue position
            queue_query = (
                select(Episode)
                .where(Episode.room_id == metadata["room_id"])
                .order_by(Episode.queue_position.desc())
            )
            q_res = await db.execute(queue_query)
            last_ep = q_res.scalars().first()
            next_pos = (last_ep.queue_position + 1) if last_ep else 0

            episode = Episode(
                id=episode_id,
                room_id=metadata["room_id"],
                anime_title=metadata["anime_title"],
                season=metadata["season"],
                episode_number=metadata["episode_number"],
                display_title=metadata["display_title"],
                filename=safe_name,
                file_path=str(target_path),
                file_size_bytes=total_written,
                sha256_hash=computed_sha256,
                mime_type=metadata.get("mime_type", "video/mp4"),
                upload_status=UploadStatus.COMPLETED,
                queue_position=next_pos
            )
            db.add(episode)

            # Check if room needs current_episode_id set
            room_res = await db.execute(select(Room).where(Room.id == metadata["room_id"]))
            room = room_res.scalar_one_or_none()
            if room and not room.current_episode_id:
                room.current_episode_id = episode_id

            await db.commit()
            await db.refresh(episode)

            # Clean up temp upload directory
            shutil.rmtree(upload_dir, ignore_errors=True)

            return episode

        except Exception as e:
            # Clean up partially assembled target file on error
            if target_path.exists():
                target_path.unlink()
            raise e

    @staticmethod
    def cancel_upload(upload_id: str) -> bool:
        upload_dir = StorageService.get_upload_dir(upload_id)
        if upload_dir.exists():
            shutil.rmtree(upload_dir, ignore_errors=True)
            return True
        return False

    @staticmethod
    def get_storage_usage() -> Dict[str, Any]:
        """
        Phase 8 Task 8.6: Computes host disk storage metrics:
        - Total disk capacity
        - Free disk space
        - Total bytes utilized by AnimeSync (videos + temp chunks)
        - Video storage bytes
        - Temp upload storage bytes
        """
        storage_path = Path(settings.STORAGE_DIR)
        storage_path.mkdir(parents=True, exist_ok=True)
        temp_path = Path(settings.TEMP_UPLOAD_DIR)
        temp_path.mkdir(parents=True, exist_ok=True)

        disk = shutil.disk_usage(str(storage_path))

        video_bytes = 0
        if storage_path.exists():
            for f in storage_path.rglob("*"):
                if f.is_file():
                    try:
                        video_bytes += f.stat().st_size
                    except OSError:
                        pass

        temp_bytes = 0
        if temp_path.exists():
            for f in temp_path.rglob("*"):
                if f.is_file():
                    try:
                        temp_bytes += f.stat().st_size
                    except OSError:
                        pass

        animesync_total = video_bytes + temp_bytes

        return {
            "total_disk_bytes": disk.total,
            "free_disk_bytes": disk.free,
            "animesync_used_bytes": animesync_total,
            "video_storage_bytes": video_bytes,
            "temp_storage_bytes": temp_bytes,
        }

    @staticmethod
    def purge_temp_storage(max_age_seconds: int = 3600) -> Dict[str, Any]:
        """
        Phase 8 Task 8.6: Purges temporary upload folders and orphaned chunks
        older than max_age_seconds (or all if max_age_seconds == 0).
        """
        temp_path = Path(settings.TEMP_UPLOAD_DIR)
        if not temp_path.exists():
            return {"freed_bytes": 0, "purged_count": 0}

        now = time.time()
        freed_bytes = 0
        purged_count = 0

        for item in temp_path.iterdir():
            try:
                if item.is_dir():
                    mtime = item.stat().st_mtime
                    if max_age_seconds <= 0 or (now - mtime) >= max_age_seconds:
                        for f in item.rglob("*"):
                            if f.is_file():
                                try:
                                    freed_bytes += f.stat().st_size
                                except OSError:
                                    pass
                        shutil.rmtree(item, ignore_errors=True)
                        purged_count += 1
                elif item.is_file():
                    if item.name == ".gitkeep":
                        continue
                    mtime = item.stat().st_mtime
                    if max_age_seconds <= 0 or (now - mtime) >= max_age_seconds:
                        freed_bytes += item.stat().st_size
                        item.unlink(missing_ok=True)
                        purged_count += 1
            except OSError:
                pass

        return {"freed_bytes": freed_bytes, "purged_count": purged_count}

