import uuid
import enum
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Integer, Boolean, DateTime, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column
from backend.app.database import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class DownloadStatus(str, enum.Enum):
    PENDING = "PENDING"
    DOWNLOADING = "DOWNLOADING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class DownloadTask(Base):
    __tablename__ = "download_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    anime_title: Mapped[str] = mapped_column(String(200), nullable=False)
    episode_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    source_url: Mapped[str] = mapped_column(String(2000), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    total_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    downloaded_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sha256_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    supports_range: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[DownloadStatus] = mapped_column(
        SQLEnum(DownloadStatus), default=DownloadStatus.PENDING, nullable=False
    )
    error_message: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
