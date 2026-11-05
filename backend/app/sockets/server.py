import asyncio
import time
from datetime import datetime, timezone
from typing import Optional
import socketio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from backend.app.database import AsyncSessionLocal
from backend.app.models.room import Room
from backend.app.models.participant import Participant, ParticipantStatus
from backend.app.models.episode import Episode
from backend.app.sockets.connection_manager import connection_manager
from backend.app.sockets.playback_manager import playback_manager, RoomPlaybackState

# ---------------------------------------------------------------------------
# Phase 4: Per-room countdown state tracking
# Maps room_code -> asyncio.Task (the pending countdown task)
# If the dict has an entry, a countdown is in progress for that room.
# ---------------------------------------------------------------------------
_countdown_tasks: dict[str, asyncio.Task] = {}

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
        # Phase 4: Cancel room countdown if active when an online participant disconnects
        if session.room_code in _countdown_tasks:
            _cancel_countdown(session.room_code)
            await sio.emit(
                "countdown_cancelled",
                {
                    "room_code": session.room_code,
                    "cancelled_by": session.username,
                    "reason": f"{session.username} disconnected during countdown."
                },
                room=session.room_code
            )

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
            # Phase 4: Cancel room countdown if active when participant leaves
            if session.room_code in _countdown_tasks:
                _cancel_countdown(session.room_code)
                await sio.emit(
                    "countdown_cancelled",
                    {
                        "room_code": session.room_code,
                        "cancelled_by": session.username,
                        "reason": f"{session.username} left the room."
                    },
                    room=session.room_code
                )

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

@sio.event
async def verify_file(sid: str, data: dict):
    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}

    episode_id = data.get("episode_id")
    client_hash = (data.get("sha256_hash") or "").strip().lower()
    client_size = data.get("file_size_bytes")

    if not episode_id or not client_hash:
        return {"status": "ERROR", "message": "Missing episode_id or sha256_hash"}

    async with AsyncSessionLocal() as db:
        # Fetch episode
        ep_query = select(Episode).where(
            Episode.id == episode_id,
            Episode.room_id == session.room_id
        )
        ep_res = await db.execute(ep_query)
        episode = ep_res.scalar_one_or_none()

        if not episode:
            return {"status": "ERROR", "message": "Episode not found in this room"}

        p_query = select(Participant).where(Participant.id == session.participant_id)
        p_res = await db.execute(p_query)
        participant = p_res.scalar_one_or_none()
        if not participant:
            return {"status": "ERROR", "message": "Participant not found"}

        server_hash = (episode.sha256_hash or "").strip().lower()

        # Check hash match and size match (if client provided size)
        hash_matched = (client_hash == server_hash)
        size_matched = True
        if client_size is not None and episode.file_size_bytes is not None:
            size_matched = (int(client_size) == int(episode.file_size_bytes))

        if hash_matched and size_matched:
            participant.status = ParticipantStatus.VERIFIED
            participant.verified_file_hash = server_hash
            await db.commit()

            result_payload = {
                "status": "VERIFIED",
                "message": "File verified successfully! Checksum and size match.",
                "episode_id": episode.id
            }
            await sio.emit("verification_result", result_payload, to=sid)

            # Broadcast presence update
            presence = await connection_manager.get_presence_payload(db, session.room_code)
            await sio.emit(
                "presence_updated",
                {"room_code": session.room_code, "participants": presence},
                room=session.room_code
            )
            return result_payload
        else:
            participant.status = ParticipantStatus.VERIFICATION_FAILED
            participant.verified_file_hash = None
            await db.commit()

            reason = "Checksum mismatch." if not hash_matched else "File size mismatch."
            result_payload = {
                "status": "VERIFICATION_FAILED",
                "message": f"Verification failed: {reason} The selected file is not identical to the host file.",
                "episode_id": episode.id,
                "expected_hash": server_hash,
                "actual_hash": client_hash
            }
            await sio.emit("verification_result", result_payload, to=sid)

            presence = await connection_manager.get_presence_payload(db, session.room_code)
            await sio.emit(
                "presence_updated",
                {"room_code": session.room_code, "participants": presence},
                room=session.room_code
            )
            return result_payload


# ---------------------------------------------------------------------------
# Phase 4: Ready-to-Watch System
# ---------------------------------------------------------------------------

COUNTDOWN_SECONDS = 3.0  # Seconds before playback starts after all ready


def _cancel_countdown(room_code: str) -> None:
    """Cancel any pending countdown task for a room (idempotent)."""
    task = _countdown_tasks.pop(room_code, None)
    if task and not task.done():
        task.cancel()


async def _all_online_participants_ready(db: AsyncSession, room_code: str) -> tuple[bool, list]:
    """
    Returns (all_ready, participants_list).
    'All ready' means every ONLINE participant has status == READY.
    Offline participants (no active socket) are excluded from the check
    so a disconnected viewer does not permanently block the watch party.
    At least one participant must be online.
    """
    query = (
        select(Room)
        .where(Room.code == room_code)
        .options(selectinload(Room.participants))
    )
    res = await db.execute(query)
    room = res.scalar_one_or_none()
    if not room:
        return False, []

    online_participants = [
        p for p in room.participants
        if connection_manager.is_participant_online(room_code, p.id)
    ]

    if not online_participants:
        return False, room.participants

    all_ready = all(p.status == ParticipantStatus.READY for p in online_participants)
    return all_ready, room.participants


async def _run_countdown(room_code: str, episode_id: str) -> None:
    """
    Background coroutine: waits COUNTDOWN_SECONDS then emits 'playback_start'.
    Cancelled cleanly if any participant un-readies or disconnects.
    """
    try:
        await asyncio.sleep(COUNTDOWN_SECONDS)
        # Transition all READY participants -> WATCHING
        async with AsyncSessionLocal() as db:
            query = select(Room).where(Room.code == room_code).options(selectinload(Room.participants))
            res = await db.execute(query)
            room = res.scalar_one_or_none()
            if room:
                for p in room.participants:
                    if p.status == ParticipantStatus.READY:
                        p.status = ParticipantStatus.WATCHING
                await db.commit()

                presence = await connection_manager.get_presence_payload(db, room_code)
                await sio.emit(
                    "presence_updated",
                    {"room_code": room_code, "participants": presence},
                    room=room_code
                )

                # Phase 5: Initialize room playback state to playing
                state = playback_manager.get_or_create_state(room_code)
                state.is_playing = True
                state.current_time = 0.0
                state.playback_speed = 1.0
                state.updated_at = time.time()
                state.sequence_number += 1

                await sio.emit(
                    "playback_start",
                    {
                        "room_code": room_code,
                        "episode_id": episode_id,
                        "timestamp": time.time()
                    },
                    room=room_code
                )
    except asyncio.CancelledError:
        pass  # Countdown was cancelled; presense already updated by caller
    finally:
        _countdown_tasks.pop(room_code, None)


@sio.event
async def set_ready(sid: str, data: dict = None):
    """
    Participant signals they are ready to watch.
    Rules enforced server-side:
      - Participant must be authenticated.
      - Participant.status must currently be VERIFIED.
      - If ALL online participants become READY, start COUNTDOWN_SECONDS countdown.
    """
    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}

    async with AsyncSessionLocal() as db:
        # Fetch participant
        p_query = select(Participant).where(Participant.id == session.participant_id)
        p_res = await db.execute(p_query)
        participant = p_res.scalar_one_or_none()
        if not participant:
            return {"status": "ERROR", "message": "Participant not found"}

        # Enforce: must be VERIFIED to become READY
        if participant.status != ParticipantStatus.VERIFIED:
            await sio.emit(
                "ready_rejected",
                {
                    "reason": "NOT_VERIFIED",
                    "message": (
                        "You must verify your local file before marking yourself as ready. "
                        f"Current status: {participant.status.value}"
                    )
                },
                to=sid
            )
            return {"status": "ERROR", "message": "Participant not VERIFIED"}

        # Cancel any existing countdown (a previous all-ready may have been invalidated)
        _cancel_countdown(session.room_code)

        participant.status = ParticipantStatus.READY
        await db.commit()

        # Broadcast readiness change
        presence = await connection_manager.get_presence_payload(db, session.room_code)
        await sio.emit(
            "presence_updated",
            {"room_code": session.room_code, "participants": presence},
            room=session.room_code
        )

        # Emit personal acknowledgement
        await sio.emit("ready_acknowledged", {"status": "READY"}, to=sid)

        # Check if ALL online participants are now READY
        all_ready, all_participants = await _all_online_participants_ready(db, session.room_code)

        if all_ready:
            # Find the current episode id for the room
            ep_query = (
                select(Room)
                .where(Room.code == session.room_code)
                .options(selectinload(Room.episodes))
            )
            ep_res = await db.execute(ep_query)
            room = ep_res.scalar_one_or_none()
            episode_id: Optional[str] = room.current_episode_id if room else None

            target_start_timestamp = time.time() + COUNTDOWN_SECONDS
            await sio.emit(
                "countdown_started",
                {
                    "room_code": session.room_code,
                    "episode_id": episode_id,
                    "target_start_timestamp": target_start_timestamp,
                    "countdown_seconds": COUNTDOWN_SECONDS
                },
                room=session.room_code
            )

            # Kick off background countdown
            task = asyncio.ensure_future(
                _run_countdown(session.room_code, episode_id or "")
            )
            _countdown_tasks[session.room_code] = task

    return {"status": "OK", "message": "Ready status set"}


@sio.event
async def set_unready(sid: str, data: dict = None):
    """
    Participant withdraws their ready status.
    - Allowed from READY status only (idempotent for other states).
    - Cancels any in-progress countdown for the room.
    - Reverts participant to VERIFIED.
    """
    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}

    async with AsyncSessionLocal() as db:
        p_query = select(Participant).where(Participant.id == session.participant_id)
        p_res = await db.execute(p_query)
        participant = p_res.scalar_one_or_none()
        if not participant:
            return {"status": "ERROR", "message": "Participant not found"}

        if participant.status == ParticipantStatus.READY:
            # Cancel any countdown that may have been started
            _cancel_countdown(session.room_code)

            participant.status = ParticipantStatus.VERIFIED
            await db.commit()

            # Notify room that countdown was cancelled
            await sio.emit(
                "countdown_cancelled",
                {
                    "room_code": session.room_code,
                    "cancelled_by": session.username,
                    "reason": "A participant withdrew their ready status."
                },
                room=session.room_code
            )

            # Broadcast updated presence
            presence = await connection_manager.get_presence_payload(db, session.room_code)
            await sio.emit(
                "presence_updated",
                {"room_code": session.room_code, "participants": presence},
                room=session.room_code
            )

        await sio.emit("unready_acknowledged", {"status": "VERIFIED"}, to=sid)

    return {"status": "OK", "message": "Ready status cleared"}


async def invalidate_room_readiness(room_code: str, reason: str = "Episode changed") -> None:
    """
    Called by the files API when host completes a new upload.
    Resets all non-WATCHING participants back to WAITING_FOR_FILE and cancels countdown.
    Exported so files.py can call it.
    """
    _cancel_countdown(room_code)
    playback_manager.reset_state(room_code)

    async with AsyncSessionLocal() as db:
        query = (
            select(Room)
            .where(Room.code == room_code)
            .options(selectinload(Room.participants))
        )
        res = await db.execute(query)
        room = res.scalar_one_or_none()
        if not room:
            return

        reset_statuses = {
            ParticipantStatus.READY,
            ParticipantStatus.VERIFIED,
            ParticipantStatus.VERIFYING,
            ParticipantStatus.VERIFICATION_FAILED,
            ParticipantStatus.DOWNLOADED,
            ParticipantStatus.DOWNLOADING,
        }
        changed = False
        for p in room.participants:
            if p.status in reset_statuses:
                p.status = ParticipantStatus.WAITING_FOR_FILE
                p.verified_file_hash = None
                changed = True

        if changed:
            await db.commit()

        presence = await connection_manager.get_presence_payload(db, room_code)

        await sio.emit(
            "episode_changed",
            {
                "room_code": room_code,
                "reason": reason,
                "message": "A new episode was uploaded. All participants must re-verify their file."
            },
            room=room_code
        )
        await sio.emit(
            "presence_updated",
            {"room_code": room_code, "participants": presence},
            room=room_code
        )
        if changed:
            await sio.emit(
                "countdown_cancelled",
                {
                    "room_code": room_code,
                    "cancelled_by": "server",
                    "reason": reason
                },
                room=room_code
            )


# ---------------------------------------------------------------------------
# Phase 5 Task 5.2: Server Playback State Machine
# ---------------------------------------------------------------------------

@sio.event
async def playback_action(sid: str, data: dict = None):
    """
    Socket.IO handler for client-initiated playback actions (PLAY, PAUSE, SEEK, RATE_CHANGE).
    Validates:
      1. Session authentication
      2. Room membership & isolation
      3. Participant readiness gate (cannot control playback if file unverified)
      4. Action & parameter validity (PLAY, PAUSE, SEEK, RATE_CHANGE)
    Updates RoomPlaybackState and broadcasts 'playback_sync' to the room with origin SID.
    """
    if data is None or not isinstance(data, dict):
        return {"status": "ERROR", "message": "Payload must be a dictionary"}

    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}

    # Room isolation: If payload specified room_code, ensure it matches session room
    req_room_code = (data.get("room_code") or "").strip().upper()
    if req_room_code and req_room_code != session.room_code:
        return {
            "status": "ERROR",
            "message": f"Room code mismatch: authorized for '{session.room_code}', cannot act on '{req_room_code}'",
        }

    # Verify participant in DB and validate readiness requirements
    async with AsyncSessionLocal() as db:
        p_query = select(Participant).where(Participant.id == session.participant_id)
        p_res = await db.execute(p_query)
        participant = p_res.scalar_one_or_none()
        if not participant:
            return {"status": "ERROR", "message": "Participant not found"}

        if participant.room_id != session.room_id:
            return {"status": "ERROR", "message": "Participant does not belong to this room"}

        unverified_statuses = {
            ParticipantStatus.WAITING_FOR_FILE,
            ParticipantStatus.DOWNLOADING,
            ParticipantStatus.DOWNLOADED,
            ParticipantStatus.VERIFYING,
            ParticipantStatus.VERIFICATION_FAILED,
        }
        if participant.status in unverified_statuses:
            return {
                "status": "ERROR",
                "message": (
                    f"Participant cannot control playback while status is '{participant.status.value}'. "
                    "File must be verified first."
                ),
            }

    action = data.get("action")
    timestamp = data.get("timestamp")
    if timestamp is None:
        timestamp = data.get("current_time")
    playback_rate = data.get("playback_rate")
    if playback_rate is None:
        playback_rate = data.get("playback_speed")

    state, err = playback_manager.process_action(
        room_code=session.room_code,
        action=action,
        timestamp=timestamp,
        playback_rate=playback_rate,
    )

    if err:
        return {"status": "ERROR", "message": err}

    # Authoritative sync payload sent to all participants in room
    sync_payload = {
        "room_code": session.room_code,
        "action": action.strip().upper(),
        "timestamp": state.current_time,
        "current_time": state.current_time,
        "is_playing": state.is_playing,
        "playback_rate": state.playback_speed,
        "playback_speed": state.playback_speed,
        "server_sequence": state.sequence_number,
        "sequence_number": state.sequence_number,
        "server_time": state.updated_at,
        "updated_at": state.updated_at,
        "originating_socket_id": sid,
        "origin_sid": sid,
        "triggered_by": session.username,
    }

    # Broadcast authoritative event to the room
    await sio.emit("playback_sync", sync_payload, room=session.room_code)

    return {
        "status": "OK",
        "action": action.strip().upper(),
        "state": state.to_dict(),
        "sequence_number": state.sequence_number,
    }


@sio.event
async def get_playback_state(sid: str, data: dict = None):
    """Returns current authoritative playback state for the caller's room."""
    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}
    state = playback_manager.get_or_create_state(session.room_code)
    return {"status": "OK", "state": state.to_dict()}

