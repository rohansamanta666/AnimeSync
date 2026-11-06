"""
AnimeSync — Chat Service (Phase 7 Task 7.1)

Handles:
- Input sanitization (HTML tag stripping, entity encoding, length limits)
- Message persistence in SQLite via SQLAlchemy
- Recent message history queries with room isolation
"""
import re
import html
from typing import List, Optional
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.app.models.message import Message

MAX_MESSAGE_LENGTH = 1000
MIN_MESSAGE_LENGTH = 1

# Regex to strip HTML tags
HTML_TAG_REGEX = re.compile(r"<[^>]*?>")


def sanitize_message_content(raw_content: str) -> str:
    """
    Sanitizes chat message input:
    - Strips leading/trailing whitespace
    - Strips HTML/script tags
    - Escapes remaining special HTML characters
    - Validates length constraints [1, 1000]
    Raises ValueError if invalid or empty.
    """
    if not isinstance(raw_content, str):
        raise ValueError("Message content must be a string")

    # Strip HTML tags
    cleaned = HTML_TAG_REGEX.sub("", raw_content)
    # Strip null characters and leading/trailing whitespace
    cleaned = cleaned.replace("\0", "").strip()

    if len(cleaned) < MIN_MESSAGE_LENGTH:
        raise ValueError("Message cannot be empty")
    if len(cleaned) > MAX_MESSAGE_LENGTH:
        raise ValueError(f"Message cannot exceed {MAX_MESSAGE_LENGTH} characters")

    # HTML escape for defense in depth
    return html.escape(cleaned)


class ChatService:
    @staticmethod
    def serialize_message(msg: Message) -> dict:
        """Serializes a Message model to a JSON-serializable dictionary."""
        return {
            "id": msg.id,
            "room_id": msg.room_id,
            "participant_id": msg.participant_id,
            "username": msg.username,
            "content": msg.content,
            "created_at": msg.created_at.isoformat() if msg.created_at else datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    async def create_message(
        db: AsyncSession,
        room_id: str,
        participant_id: str,
        username: str,
        content: str,
    ) -> Message:
        """Sanitizes and saves a new chat message to the database."""
        sanitized = sanitize_message_content(content)

        msg = Message(
            room_id=room_id,
            participant_id=participant_id,
            username=username.strip(),
            content=sanitized,
            created_at=datetime.now(timezone.utc),
        )
        db.add(msg)
        await db.commit()
        await db.refresh(msg)
        return msg

    @staticmethod
    async def get_recent_messages(
        db: AsyncSession, room_id: str, limit: int = 100
    ) -> List[Message]:
        """Fetches the most recent messages for a room ordered chronologically."""
        safe_limit = max(1, min(limit, 200))
        # Fetch the last N messages in ascending order
        query = (
            select(Message)
            .where(Message.room_id == room_id)
            .order_by(Message.created_at.desc())
            .limit(safe_limit)
        )
        res = await db.execute(query)
        messages = list(res.scalars().all())
        # Reverse so they are in chronological order (oldest -> newest)
        messages.reverse()
        return messages
