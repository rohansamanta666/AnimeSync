from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime
from typing import List

class MessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=1000)

class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    room_id: str
    participant_id: str
    username: str
    content: str
    created_at: datetime

class MessageListResponse(BaseModel):
    room_code: str
    messages: List[MessageResponse]
