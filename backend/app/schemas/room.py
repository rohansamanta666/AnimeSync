from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime

class RoomCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, description="Watch room name")
    host_username: str = Field(..., min_length=1, max_length=50, description="Host display name")

class RoomJoinRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50, description="Participant display name")

class ParticipantResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    is_host: bool
    status: str
    last_seen: datetime

class EpisodeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    anime_title: str
    season: int
    episode_number: int
    display_title: Optional[str] = None
    filename: str
    file_size_bytes: int
    sha256_hash: Optional[str] = None
    duration_seconds: Optional[float] = None
    upload_status: str
    queue_position: int

class RoomResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    code: str
    name: str
    host_id: Optional[str]
    is_active: bool
    current_episode_id: Optional[str]
    created_at: datetime
    participants: List[ParticipantResponse] = []
    episodes: List[EpisodeResponse] = []

class RoomCreateResponse(BaseModel):
    room: RoomResponse
    participant_id: str
    session_token: str
    is_host: bool

class RoomJoinResponse(BaseModel):
    room: RoomResponse
    participant_id: str
    session_token: str
    is_host: bool

class QueueResponse(BaseModel):
    room_code: str
    current_episode_id: Optional[str] = None
    episodes: List[EpisodeResponse] = []

class QueueReorderRequest(BaseModel):
    ordered_episode_ids: List[str]

class QueueSelectRequest(BaseModel):
    episode_id: str
