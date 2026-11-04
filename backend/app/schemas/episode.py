from pydantic import BaseModel, Field
from typing import Optional

class UploadInitRequest(BaseModel):
    room_id: str
    filename: str = Field(..., min_length=1, max_length=255)
    file_size_bytes: int = Field(..., gt=0)
    anime_title: str = Field(..., min_length=1, max_length=200)
    season: int = Field(default=1, ge=1)
    episode_number: int = Field(default=1, ge=1)
    display_title: Optional[str] = None
    mime_type: Optional[str] = "video/mp4"

class UploadInitResponse(BaseModel):
    upload_id: str
    chunk_size_bytes: int
    total_chunks: int

class UploadCompleteRequest(BaseModel):
    upload_id: str

class VerifyFileRequest(BaseModel):
    episode_id: str
    sha256_hash: str
