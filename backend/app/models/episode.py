import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Float, DateTime, Enum as SQLEnum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.app.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

class UploadStatus(str, enum.Enum):
    PENDING = "PENDING"
    UPLOADING = "UPLOADING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class Episode(Base):
    __tablename__ = "episodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True)
    anime_title: Mapped[str] = mapped_column(String(200), nullable=False)
    season: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    episode_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    display_title: Mapped[str] = mapped_column(String(200), nullable=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256_hash: Mapped[str] = mapped_column(String(64), nullable=True)
    mime_type: Mapped[str] = mapped_column(String(100), default="video/mp4", nullable=False)
    duration_seconds: Mapped[float] = mapped_column(Float, nullable=True)
    upload_status: Mapped[UploadStatus] = mapped_column(
        SQLEnum(UploadStatus), default=UploadStatus.PENDING, nullable=False
    )
    queue_position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    room = relationship("Room", back_populates="episodes")
