import time
from datetime import datetime, timezone
import socketio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from backend.app.database import AsyncSessionLocal
from backend.app.models.room import Room
from backend.app.models.participant import Participant, ParticipantStatus
from backend.app.sockets.connection_manager import connection_manager

# Create Async Socket.IO Server
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    ping_timeout=20,
    ping_interval=10
)

@sio.event
async def connect(sid: str, environ: dict, auth: dict = None):
    # Connected at transport layer; awaiting authenticated join_room or using auth payload
    if auth and isinstance(auth, dict) and "room_code" in auth and "participant_id" in auth and "session_token" in auth:
        await handle_join_room(sid, auth)

@sio.event
async def disconnect(sid: str):
    result = await connection_manager.unregister_connection(sid)
    if not result:
        return

    session, is_now_offline = result
    if is_now_offline:
        async with AsyncSessionLocal() as db:
            # Update last_seen in database
            query = select(Participant).where(Participant.id == session.participant_id)
            res = await db.execute(query)
            participant = res.scalar_one_or_none()
            if participant:
                participant.last_seen = datetime.now(timezone.utc)
                await db.commit()

            # Broadcast departure to remaining room participants
            presence = await connection_manager.get_presence_payload(db, session.room_code)
            await sio.emit(
                "user_left",
                {
                    "participant_id": session.participant_id,
                    "username": session.username,
                    "timestamp": time.time()
                },
                room=session.room_code
            )
            await sio.emit(
                "presence_updated",
                {
                    "room_code": session.room_code,
                    "participants": presence
                },
                room=session.room_code
            )

@sio.event
async def join_room(sid: str, data: dict):
    return await handle_join_room(sid, data)

async def handle_join_room(sid: str, data: dict):
    room_code = (data.get("room_code") or "").strip().upper()
    participant_id = (data.get("participant_id") or "").strip()
    session_token = (data.get("session_token") or "").strip()

    if not room_code or not participant_id or not session_token:
        error_payload = {
            "code": "INVALID_PAYLOAD",
            "message": "Missing room_code, participant_id, or session_token"
        }
        await sio.emit("error", error_payload, to=sid)
        return {"success": False, "error": error_payload}

    async with AsyncSessionLocal() as db:
        # Authenticate participant against room in database
        query = (
            select(Room)
            .where(Room.code == room_code)
            .options(
                selectinload(Room.participants),
                selectinload(Room.episodes)
            )
        )
        res = await db.execute(query)
        room = res.scalar_one_or_none()

        if not room or not room.is_active:
            error_payload = {
                "code": "ROOM_NOT_FOUND",
                "message": "Room not found or no longer active"
            }
            await sio.emit("error", error_payload, to=sid)
            return {"success": False, "error": error_payload}

        # Find participant
        participant = next((p for p in room.participants if p.id == participant_id), None)
        if not participant or participant.session_token != session_token:
            error_payload = {
                "code": "AUTH_FAILED",
                "message": "Unauthorized: Invalid participant credentials for this room"
            }
            await sio.emit("error", error_payload, to=sid)
            return {"success": False, "error": error_payload}

        # Update last_seen
        participant.last_seen = datetime.now(timezone.utc)
        await db.commit()

        # Register socket connection
        was_offline = await connection_manager.register_connection(
            sid=sid,
            room_code=room_code,
            room_id=room.id,
            participant_id=participant.id,
            username=participant.username,
            is_host=participant.is_host
        )

        # Enter Socket.IO room channel
        try:
            await sio.enter_room(sid, room_code)
        except Exception:
            pass

        # Get authoritative presence payload
        presence = await connection_manager.get_presence_payload(db, room_code)

        # Build full room state snapshot for joining client
        room_snapshot = {
            "id": room.id,
            "code": room.code,
            "name": room.name,
            "host_id": room.host_id,
            "is_active": room.is_active,
            "current_episode_id": room.current_episode_id,
            "created_at": room.created_at.isoformat() if room.created_at else None,
            "participants": presence,
            "episodes": [
                {
                    "id": ep.id,
                    "anime_title": ep.anime_title,
                    "season": ep.season,
                    "episode_number": ep.episode_number,
                    "display_title": ep.display_title,
                    "filename": ep.filename,
                    "file_size_bytes": ep.file_size_bytes,
                    "sha256_hash": ep.sha256_hash,
                    "duration_seconds": ep.duration_seconds,
                    "upload_status": ep.upload_status.value if hasattr(ep.upload_status, "value") else str(ep.upload_status),
                    "queue_position": ep.queue_position
                }
                for ep in room.episodes
            ]
        }

        # Send state snapshot directly to this connected socket
        await sio.emit(
            "room_joined",
            {
                "success": True,
                "room_code": room_code,
                "room": room_snapshot,
                "presence": presence
            },
            to=sid
        )

        # Broadcast presence update to everyone in the room
        await sio.emit(
            "presence_updated",
            {
                "room_code": room_code,
                "participants": presence
            },
            room=room_code
        )

        # If this was their first connection, notify others that user joined
        if was_offline:
            await sio.emit(
                "user_joined",
                {
                    "participant_id": participant.id,
                    "username": participant.username,
                    "is_host": participant.is_host,
                    "timestamp": time.time()
                },
                room=room_code,
                skip_sid=sid
            )

        return {"success": True, "room_code": room_code}

@sio.event
async def leave_room(sid: str, data: dict = None):
    result = await connection_manager.unregister_connection(sid)
    if not result:
        return {"success": True}

    session, is_now_offline = result
    try:
        await sio.leave_room(sid, session.room_code)
    except Exception:
        pass

    async with AsyncSessionLocal() as db:
        if is_now_offline:
            presence = await connection_manager.get_presence_payload(db, session.room_code)
            await sio.emit(
                "user_left",
                {
                    "participant_id": session.participant_id,
                    "username": session.username,
                    "timestamp": time.time()
                },
                room=session.room_code
            )
            await sio.emit(
                "presence_updated",
                {
                    "room_code": session.room_code,
                    "participants": presence
                },
                room=session.room_code
            )

    await sio.emit("room_left", {"room_code": session.room_code}, to=sid)
    return {"success": True}
