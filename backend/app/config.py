from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import List
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

class Settings(BaseSettings):
    # Server network settings
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    ENVIRONMENT: str = "development"
    FRONTEND_PORT: int = 5173

    # Database
    DATABASE_URL: str = f"sqlite+aiosqlite:///{BASE_DIR}/animesync.db"

    # Storage Paths
    STORAGE_DIR: str = str(BASE_DIR / "storage" / "videos")
    TEMP_UPLOAD_DIR: str = str(BASE_DIR / "storage" / "uploads_temp")

    # Upload Constraints (Default: 4GB max, 5MB chunks)
    MAX_UPLOAD_SIZE_MB: int = 4096
    CHUNK_SIZE_BYTES: int = 5 * 1024 * 1024  # 5MB

    # CORS Origins
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:8000,http://127.0.0.1:5173,http://127.0.0.1:8000"

    # WebRTC STUN/TURN
    STUN_SERVERS: str = "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
    TURN_SERVER_URL: str = ""
    TURN_USERNAME: str = ""
    TURN_CREDENTIAL: str = ""

    # Playback Drift Thresholds (Seconds)
    DRIFT_IGNORE_THRESHOLD: float = 0.25
    DRIFT_RATE_ADJUST_THRESHOLD: float = 1.5
    DRIFT_HARD_SEEK_THRESHOLD: float = 3.0

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def stun_servers_list(self) -> List[str]:
        return [server.strip() for server in self.STUN_SERVERS.split(",") if server.strip()]

settings = Settings()

# Ensure storage directories exist
Path(settings.STORAGE_DIR).mkdir(parents=True, exist_ok=True)
Path(settings.TEMP_UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
