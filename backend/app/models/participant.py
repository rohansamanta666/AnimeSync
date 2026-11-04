import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, DateTime, Enum as SQLEnum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.app.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

class ParticipantStatus(str, enum.Enum):
    WAITING_FOR_FILE = "WAITING_FOR_FILE"
    DOWNLOADING = "DOWNLOADING"
    DOWNLOADED = "DOWNLOADED"
    VERIFYING = "VERIFYING"
    VERIFICATION_FAILED = "VERIFICATION_FAILED"
    VERIFIED = "VERIFIED"
    READY = "READY"
    WATCHING = "WATCHING"
    BUFFERING = "BUFFERING"
    DISCONNECTED = "DISCONNECTED"

class Participant(Base):
    __tablename__ = "participants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    room_id: Mapped[str] = mapped_column(String(36), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(50), nullable=False)
    session_token: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    is_host: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[ParticipantStatus] = mapped_column(
        SQLEnum(ParticipantStatus), default=ParticipantStatus.WAITING_FOR_FILE, nullable=False
    )
    socket_id: Mapped[str] = mapped_column(String(100), nullable=True)
    verified_file_hash: Mapped[str] = mapped_column(String(64), nullable=True)
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    room = relationship("Room", back_populates="participants")
