"""
AnimeSync — Queue Manager Service (Phase 6 Task 6.1)

Manages the room's episode queue:
- Ordering by queue_position
- Adding episodes
- Removing episodes and re-compacting indices
- Reordering queue items
- Switching active / current episode
- Querying next episode for auto-next workflow
"""
import os
from pathlib import Path
from typing import List, Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from backend.app.config import settings
from backend.app.models.room import Room
from backend.app.models.episode import Episode


class QueueManager:
    @staticmethod
    def serialize_episode(ep: Episode) -> dict:
        """Serializes an Episode model to a dictionary suitable for API and Socket.IO emission."""
        return {
            "id": ep.id,
            "room_id": ep.room_id,
            "anime_title": ep.anime_title,
            "season": ep.season,
            "episode_number": ep.episode_number,
            "display_title": ep.display_title,
            "filename": ep.filename,
            "file_size_bytes": ep.file_size_bytes,
            "sha256_hash": ep.sha256_hash,
            "mime_type": ep.mime_type,
            "duration_seconds": ep.duration_seconds,
            "upload_status": ep.upload_status.value if hasattr(ep.upload_status, "value") else str(ep.upload_status),
            "queue_position": ep.queue_position,
            "created_at": ep.created_at.isoformat() if ep.created_at else None,
        }

    @staticmethod
    async def get_queue(db: AsyncSession, room_id: str) -> List[Episode]:
        """Returns all episodes for a room ordered by queue_position ascending."""
        query = (
            select(Episode)
            .where(Episode.room_id == room_id)
            .order_by(Episode.queue_position.asc(), Episode.created_at.asc())
        )
        res = await db.execute(query)
        return list(res.scalars().all())

    @staticmethod
    async def get_episode_by_id(db: AsyncSession, episode_id: str) -> Optional[Episode]:
        """Finds a single episode by ID."""
        res = await db.execute(select(Episode).where(Episode.id == episode_id))
        return res.scalar_one_or_none()

    @staticmethod
    async def reorder_queue(
        db: AsyncSession, room_id: str, ordered_episode_ids: List[str]
    ) -> List[Episode]:
        """
        Reorders the episodes in a room according to the provided list of IDs.
        Any existing episodes not included in the list are appended at the end.
        """
        episodes = await QueueManager.get_queue(db, room_id)
        ep_map = {ep.id: ep for ep in episodes}

        # Validate that all requested IDs belong to this room
        valid_ids = [eid for eid in ordered_episode_ids if eid in ep_map]

        pos = 0
        seen_ids = set()
        for eid in valid_ids:
            ep = ep_map[eid]
            ep.queue_position = pos
            seen_ids.add(eid)
            pos += 1

        # Append any remaining episodes that were not in the reorder list
        for ep in episodes:
            if ep.id not in seen_ids:
                ep.queue_position = pos
                pos += 1

        await db.commit()
        return await QueueManager.get_queue(db, room_id)

    @staticmethod
    async def remove_from_queue(
        db: AsyncSession, room_id: str, episode_id: str
    ) -> Tuple[bool, Optional[str], List[Episode]]:
        """
        Removes an episode from the room.
        - Deletes the database record.
        - Attempts to clean up the video file from storage.
        - Re-compacts the queue_position of remaining episodes.
        - If the removed episode was room.current_episode_id, advances or clears it.
        Returns (success, new_current_episode_id, remaining_episodes).
        """
        res = await db.execute(
            select(Episode).where(Episode.id == episode_id, Episode.room_id == room_id)
        )
        episode = res.scalar_one_or_none()
        if not episode:
            return False, None, []

        # Check if room's current_episode_id is this episode
        room_res = await db.execute(select(Room).where(Room.id == room_id))
        room = room_res.scalar_one_or_none()

        was_current = room and room.current_episode_id == episode_id

        # Delete local file if it exists and resides within storage directory
        if episode.file_path:
            p = Path(episode.file_path).resolve()
            storage_root = Path(settings.STORAGE_DIR).resolve()
            if str(p).startswith(str(storage_root)) and p.exists() and p.is_file():
                try:
                    p.unlink()
                except OSError:
                    pass

        await db.delete(episode)
        await db.flush()

        # Fetch remaining episodes and re-compact indices
        remaining = await QueueManager.get_queue(db, room_id)
        for idx, ep in enumerate(remaining):
            ep.queue_position = idx

        new_current_id = room.current_episode_id if room else None
        if was_current and room:
            # Pick the first episode in remaining, or None if empty
            new_current_id = remaining[0].id if remaining else None
            room.current_episode_id = new_current_id

        await db.commit()
        return True, new_current_id, remaining

    @staticmethod
    async def set_current_episode(
        db: AsyncSession, room_id: str, episode_id: str
    ) -> Tuple[bool, Optional[Episode]]:
        """Sets the active/current episode for a room."""
        res = await db.execute(
            select(Episode).where(Episode.id == episode_id, Episode.room_id == room_id)
        )
        episode = res.scalar_one_or_none()
        if not episode:
            return False, None

        room_res = await db.execute(select(Room).where(Room.id == room_id))
        room = room_res.scalar_one_or_none()
        if room:
            room.current_episode_id = episode_id
            await db.commit()
            return True, episode

        return False, None

    @staticmethod
    async def get_next_episode(
        db: AsyncSession, room_id: str, current_episode_id: Optional[str]
    ) -> Optional[Episode]:
        """
        Finds the next episode in the queue after the current episode.
        If current_episode_id is None, returns the first episode in the queue.
        If current is the last episode, returns None.
        """
        episodes = await QueueManager.get_queue(db, room_id)
        if not episodes:
            return None

        if not current_episode_id:
            return episodes[0]

        current_idx = -1
        for idx, ep in enumerate(episodes):
            if ep.id == current_episode_id:
                current_idx = idx
                break

        if current_idx != -1 and current_idx + 1 < len(episodes):
            return episodes[current_idx + 1]

        return None
