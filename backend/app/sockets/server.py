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
from backend.app.services.queue_manager import QueueManager
from backend.app.sockets.connection_manager import connection_manager
from backend.app.sockets.playback_manager import playback_manager, RoomPlaybackState

# ---------------------------------------------------------------------------
# Phase 4 & Phase 6: Per-room countdown and intermission task tracking
# ---------------------------------------------------------------------------
_countdown_tasks: dict[str, asyncio.Task] = {}
_intermission_tasks: dict[str, asyncio.Task] = {}
INTERMISSION_SECONDS = 15.0


def _cancel_intermission(room_code: str) -> bool:
    """Cancels active intermission task for a room (idempotent)."""
    code = room_code.upper()
    playback_manager.clear_intermission(code)
    task = _intermission_tasks.pop(code, None)
    if task and not task.done():
        task.cancel()
        return True
    return False

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

            # Phase 5 Task 5.5: Clean up buffering state on departure
            was_buf_removed, should_resume, state = playback_manager.clear_buffering_for_participant(
                session.room_code, session.participant_id
            )
            if was_buf_removed:
                active_ids = connection_manager.get_room_active_participant_ids(session.room_code)
                remaining_active = [pid for pid in active_ids if pid != session.participant_id]
                if should_resume and len(remaining_active) > 0:
                    resume_payload = {
                        "room_code": session.room_code,
                        "action": "PLAY",
                        "timestamp": state.current_time,
                        "current_time": state.current_time,
                        "is_playing": True,
                        "playback_rate": state.playback_speed,
                        "playback_speed": state.playback_speed,
                        "server_sequence": state.sequence_number,
                        "sequence_number": state.sequence_number,
                        "server_time": state.updated_at,
                        "updated_at": state.updated_at,
                        "originating_socket_id": "server",
                        "reason": "buffering_disconnect_recovery",
                        "triggered_by": "server",
                    }
                    await sio.emit("playback_sync", resume_payload, room=session.room_code)
                elif should_resume and len(remaining_active) == 0:
                    state.paused_for_buffering = False
                    state.is_playing = False

                buffering_payload = {
                    "room_code": session.room_code,
                    "is_buffering": playback_manager.is_room_buffering(session.room_code),
                    "buffering_participants": playback_manager.get_buffering_usernames(session.room_code),
                    "buffering_participant_ids": playback_manager.get_buffering_participant_ids(session.room_code),
                    "paused_for_buffering": state.paused_for_buffering,
                    "current_time": state.current_time,
                    "triggered_by": session.username,
                }
                await sio.emit("buffering_update", buffering_payload, room=session.room_code)

        # Phase 5 Task 5.5: Clean up buffering state on disconnect
        was_buf_removed, should_resume, state = playback_manager.clear_buffering_for_participant(
            session.room_code, session.participant_id
        )
        if was_buf_removed:
            active_ids = connection_manager.get_room_active_participant_ids(session.room_code)
            remaining_active = [pid for pid in active_ids if pid != session.participant_id]
            if should_resume and len(remaining_active) > 0:
                resume_payload = {
                    "room_code": session.room_code,
                    "action": "PLAY",
                    "timestamp": state.current_time,
                    "current_time": state.current_time,
                    "is_playing": True,
                    "playback_rate": state.playback_speed,
                    "playback_speed": state.playback_speed,
                    "server_sequence": state.sequence_number,
                    "sequence_number": state.sequence_number,
                    "server_time": state.updated_at,
                    "updated_at": state.updated_at,
                    "originating_socket_id": "server",
                    "reason": "buffering_disconnect_recovery",
                    "triggered_by": "server",
                }
                await sio.emit("playback_sync", resume_payload, room=session.room_code)
            elif should_resume and len(remaining_active) == 0:
                state.paused_for_buffering = False
                state.is_playing = False

            buffering_payload = {
                "room_code": session.room_code,
                "is_buffering": playback_manager.is_room_buffering(session.room_code),
                "buffering_participants": playback_manager.get_buffering_usernames(session.room_code),
                "buffering_participant_ids": playback_manager.get_buffering_participant_ids(session.room_code),
                "paused_for_buffering": state.paused_for_buffering,
                "current_time": state.current_time,
                "triggered_by": session.username,
            }
            await sio.emit("buffering_update", buffering_payload, room=session.room_code)

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

            # Phase 5 Task 5.5: Clean up buffering state on departure
            was_buf_removed, should_resume, state = playback_manager.clear_buffering_for_participant(
                session.room_code, session.participant_id
            )
            if was_buf_removed:
                active_ids = connection_manager.get_room_active_participant_ids(session.room_code)
                remaining_active = [pid for pid in active_ids if pid != session.participant_id]
                if should_resume and len(remaining_active) > 0:
                    resume_payload = {
                        "room_code": session.room_code,
                        "action": "PLAY",
                        "timestamp": state.current_time,
                        "current_time": state.current_time,
                        "is_playing": True,
                        "playback_rate": state.playback_speed,
                        "playback_speed": state.playback_speed,
                        "server_sequence": state.sequence_number,
                        "sequence_number": state.sequence_number,
                        "server_time": state.updated_at,
                        "updated_at": state.updated_at,
                        "originating_socket_id": "server",
                        "reason": "buffering_disconnect_recovery",
                        "triggered_by": "server",
                    }
                    await sio.emit("playback_sync", resume_payload, room=session.room_code)
                elif should_resume and len(remaining_active) == 0:
                    state.paused_for_buffering = False
                    state.is_playing = False

                buffering_payload = {
                    "room_code": session.room_code,
                    "is_buffering": playback_manager.is_room_buffering(session.room_code),
                    "buffering_participants": playback_manager.get_buffering_usernames(session.room_code),
                    "buffering_participant_ids": playback_manager.get_buffering_participant_ids(session.room_code),
                    "paused_for_buffering": state.paused_for_buffering,
                    "current_time": state.current_time,
                    "triggered_by": session.username,
                }
                await sio.emit("buffering_update", buffering_payload, room=session.room_code)

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


async def invalidate_room_readiness(
    room_code: str, reason: str = "Episode changed", reset_watching: bool = False
) -> None:
    """
    Called by the files API or queue management when episode changes or advances.
    Resets participants back to WAITING_FOR_FILE and cancels any countdown or intermission.
    By default, preserves active WATCHING participants unless reset_watching=True.
    """
    _cancel_countdown(room_code)
    _cancel_intermission(room_code)
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
            ParticipantStatus.BUFFERING,
        }
        if reset_watching:
            reset_statuses.add(ParticipantStatus.WATCHING)

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


# ---------------------------------------------------------------------------
# Phase 5 Task 5.5: Buffering Detection & Recovery
# ---------------------------------------------------------------------------

@sio.event
async def buffering_start(sid: str, data: dict = None):
    """
    Socket handler when a participant's local video enters buffering (waiting/stalled).
    If the room is actively playing, pauses playback across all participants to prevent desync.
    Broadcasts buffering_update and (if state changed to paused) playback_sync(PAUSE).
    """
    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}

    req_room_code = (data.get("room_code") if isinstance(data, dict) else "") or ""
    if req_room_code and req_room_code.strip().upper() != session.room_code:
        return {
            "status": "ERROR",
            "message": f"Room code mismatch: authorized for '{session.room_code}', cannot act on '{req_room_code}'",
        }

    # Verify participant has verified file / is watching
    async with AsyncSessionLocal() as db:
        p_query = select(Participant).where(Participant.id == session.participant_id)
        p_res = await db.execute(p_query)
        participant = p_res.scalar_one_or_none()
        if not participant:
            return {"status": "ERROR", "message": "Participant not found"}

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
                "message": f"Participant status '{participant.status.value}' cannot participate in buffering sync",
            }

    was_paused, state = playback_manager.add_buffering_participant(
        session.room_code, session.participant_id, session.username
    )

    if was_paused:
        # Broadcast authoritative PAUSE to all participants with reason="buffering"
        pause_payload = {
            "room_code": session.room_code,
            "action": "PAUSE",
            "timestamp": state.current_time,
            "current_time": state.current_time,
            "is_playing": False,
            "playback_rate": state.playback_speed,
            "playback_speed": state.playback_speed,
            "server_sequence": state.sequence_number,
            "sequence_number": state.sequence_number,
            "server_time": state.updated_at,
            "updated_at": state.updated_at,
            "originating_socket_id": sid,
            "reason": "buffering",
            "triggered_by": session.username,
        }
        await sio.emit("playback_sync", pause_payload, room=session.room_code)

    buffering_payload = {
        "room_code": session.room_code,
        "is_buffering": True,
        "buffering_participants": playback_manager.get_buffering_usernames(session.room_code),
        "buffering_participant_ids": playback_manager.get_buffering_participant_ids(session.room_code),
        "paused_for_buffering": state.paused_for_buffering,
        "current_time": state.current_time,
        "triggered_by": session.username,
    }
    await sio.emit("buffering_update", buffering_payload, room=session.room_code)

    return {
        "status": "OK",
        "is_buffering": True,
        "paused": was_paused,
        "buffering_participants": buffering_payload["buffering_participants"],
    }


@sio.event
async def buffering_end(sid: str, data: dict = None):
    """
    Socket handler when a participant finishes buffering (canplay/playing).
    Removes participant from buffering list.
    If all participants in the room are ready and playback was paused for buffering,
    authoritatively resumes playback with playback_sync(PLAY) and updates buffering state.
    """
    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}

    req_room_code = (data.get("room_code") if isinstance(data, dict) else "") or ""
    if req_room_code and req_room_code.strip().upper() != session.room_code:
        return {
            "status": "ERROR",
            "message": f"Room code mismatch: authorized for '{session.room_code}', cannot act on '{req_room_code}'",
        }

    was_removed, should_resume, state = playback_manager.remove_buffering_participant(
        session.room_code, session.participant_id
    )

    if not was_removed:
        return {"status": "OK", "message": "Participant was not recorded as buffering"}

    if should_resume:
        # Broadcast authoritative PLAY to all participants (originating from "server")
        resume_payload = {
            "room_code": session.room_code,
            "action": "PLAY",
            "timestamp": state.current_time,
            "current_time": state.current_time,
            "is_playing": True,
            "playback_rate": state.playback_speed,
            "playback_speed": state.playback_speed,
            "server_sequence": state.sequence_number,
            "sequence_number": state.sequence_number,
            "server_time": state.updated_at,
            "updated_at": state.updated_at,
            "originating_socket_id": "server",
            "reason": "buffering_resolved",
            "triggered_by": "server",
        }
        await sio.emit("playback_sync", resume_payload, room=session.room_code)

    is_buffering = playback_manager.is_room_buffering(session.room_code)
    buffering_payload = {
        "room_code": session.room_code,
        "is_buffering": is_buffering,
        "buffering_participants": playback_manager.get_buffering_usernames(session.room_code),
        "buffering_participant_ids": playback_manager.get_buffering_participant_ids(session.room_code),
        "paused_for_buffering": state.paused_for_buffering,
        "current_time": state.current_time,
        "triggered_by": session.username,
    }
    await sio.emit("buffering_update", buffering_payload, room=session.room_code)

    return {
        "status": "OK",
        "resumed": should_resume,
        "is_buffering": is_buffering,
        "buffering_participants": buffering_payload["buffering_participants"],
    }


# ---------------------------------------------------------------------------
# Phase 5 Task 5.6: Ping Check & Latency Measurement
# ---------------------------------------------------------------------------

@sio.event
async def ping_check(sid: str, data: dict = None):
    """
    Heartbeat ping handler. Returns client_time and server_time
    so the client can calculate exact round-trip latency in milliseconds.
    """
    client_time = (data or {}).get("client_time")
    return {
        "status": "OK",
        "client_time": client_time,
        "server_time": time.time(),
    }


# ---------------------------------------------------------------------------
# Phase 6: Episode Queue & Auto-Next Workflow (Tasks 6.1 – 6.5)
# ---------------------------------------------------------------------------

async def _advance_to_next_episode(room_code: str, next_episode_id: str) -> Optional[dict]:
    """
    Advances room to the next episode:
    - Cancels any intermission task
    - Updates room.current_episode_id in DB
    - Invalidates readiness (participants must verify the new file)
    - Resets playback state
    - Emits queue_advanced and queue_updated events
    """
    _cancel_intermission(room_code)
    async with AsyncSessionLocal() as db:
        room_res = await db.execute(select(Room).where(Room.code == room_code))
        room = room_res.scalar_one_or_none()
        if not room:
            return None

        success, next_ep = await QueueManager.set_current_episode(db, room.id, next_episode_id)
        if not success or not next_ep:
            return None

        # Reset readiness for all participants (they must verify the new local file)
        await invalidate_room_readiness(
            room_code, reason="Queue auto-advanced to next episode", reset_watching=True
        )
        playback_manager.reset_state(room_code)

        ep_dict = QueueManager.serialize_episode(next_ep)
        all_eps = await QueueManager.get_queue(db, room.id)
        queue_dicts = [QueueManager.serialize_episode(ep) for ep in all_eps]

        await sio.emit(
            "queue_advanced",
            {
                "room_code": room_code,
                "current_episode_id": next_ep.id,
                "episode": ep_dict,
            },
            room=room_code,
        )

        await sio.emit(
            "queue_updated",
            {
                "room_code": room_code,
                "episodes": queue_dicts,
                "current_episode_id": next_ep.id,
            },
            room=room_code,
        )

        return ep_dict


async def _run_intermission(room_code: str, next_episode_id: str) -> None:
    """
    Background task: waits INTERMISSION_SECONDS, then advances the room to the next episode.
    Can be cancelled by host via cancel_intermission or skipped via skip_intermission.
    """
    try:
        await asyncio.sleep(INTERMISSION_SECONDS)
        await _advance_to_next_episode(room_code, next_episode_id)
    except asyncio.CancelledError:
        pass
    finally:
        _intermission_tasks.pop(room_code, None)


@sio.event
async def playback_ended(sid: str, data: dict = None):
    """
    Triggered when a participant's video element fires the 'ended' event.
    Features:
    - Authoritative duplicate protection: multiple clients reaching end within 15s cooldown
      are deduplicated so intermission is started exactly once.
    - Automatic transition to intermission if a next episode is queued.
    - Emits queue_finished if no subsequent episodes exist.
    """
    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}

    payload = data or {}
    episode_id = payload.get("episode_id")

    async with AsyncSessionLocal() as db:
        room_res = await db.execute(select(Room).where(Room.code == session.room_code))
        room = room_res.scalar_one_or_none()
        if not room:
            return {"status": "ERROR", "message": "Room not found"}

        target_ep_id = episode_id or room.current_episode_id
        if not target_ep_id:
            return {"status": "ERROR", "message": "No active episode found"}

        is_first, state = playback_manager.record_episode_ended(
            session.room_code, target_ep_id, cooldown_seconds=15.0
        )
        if not is_first:
            return {"status": "ALREADY_HANDLED", "message": "Episode end already coordinated"}

        # Authoritatively broadcast pause to all viewers
        pause_sync = {
            "room_code": session.room_code,
            "action": "PAUSE",
            "timestamp": state.current_time,
            "current_time": state.current_time,
            "is_playing": False,
            "playback_rate": state.playback_speed,
            "playback_speed": state.playback_speed,
            "server_sequence": state.sequence_number,
            "sequence_number": state.sequence_number,
            "server_time": state.updated_at,
            "updated_at": state.updated_at,
            "originating_socket_id": "server",
            "reason": "video_ended",
            "triggered_by": session.username,
        }
        await sio.emit("playback_sync", pause_sync, room=session.room_code)

        # Look up next episode in queue
        next_ep = await QueueManager.get_next_episode(db, room.id, target_ep_id)
        if next_ep:
            intermission_data = {
                "room_code": session.room_code,
                "current_episode_id": target_ep_id,
                "next_episode": QueueManager.serialize_episode(next_ep),
                "seconds_remaining": int(INTERMISSION_SECONDS),
                "target_advance_time": time.time() + INTERMISSION_SECONDS,
            }
            playback_manager.set_intermission(session.room_code, intermission_data)
            _intermission_tasks[session.room_code] = asyncio.create_task(
                _run_intermission(session.room_code, next_ep.id)
            )

            await sio.emit("intermission_started", intermission_data, room=session.room_code)
            return {
                "status": "OK",
                "has_next": True,
                "next_episode": QueueManager.serialize_episode(next_ep),
            }
        else:
            await sio.emit(
                "queue_finished",
                {
                    "room_code": session.room_code,
                    "message": "All queued episodes completed.",
                },
                room=session.room_code,
            )
            return {"status": "OK", "has_next": False, "message": "Queue finished"}


@sio.event
async def video_ended(sid: str, data: dict = None):
    """Alias for playback_ended."""
    return await playback_ended(sid, data)


@sio.event
async def skip_intermission(sid: str, data: dict = None):
    """Skips the intermission countdown and advances immediately to the next episode."""
    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}

    code = session.room_code
    intermission = playback_manager.get_intermission(code)

    next_ep_id = None
    if intermission and "next_episode" in intermission:
        next_ep_id = intermission["next_episode"]["id"]
    else:
        async with AsyncSessionLocal() as db:
            room_res = await db.execute(select(Room).where(Room.code == code))
            room = room_res.scalar_one_or_none()
            if room:
                next_ep = await QueueManager.get_next_episode(db, room.id, room.current_episode_id)
                if next_ep:
                    next_ep_id = next_ep.id

    if not next_ep_id:
        return {"status": "ERROR", "message": "No next episode available in queue"}

    advanced = await _advance_to_next_episode(code, next_ep_id)
    return {"status": "OK", "episode": advanced}


@sio.event
async def cancel_intermission(sid: str, data: dict = None):
    """Cancels the active intermission countdown so the room stays on the current episode."""
    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}

    code = session.room_code
    was_cancelled = _cancel_intermission(code)
    await sio.emit(
        "intermission_cancelled",
        {
            "room_code": code,
            "cancelled_by": session.username,
        },
        room=code,
    )
    return {"status": "OK", "was_cancelled": was_cancelled}


@sio.event
async def get_queue(sid: str, data: dict = None):
    """Retrieves the current ordered queue for the participant's room."""
    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}

    async with AsyncSessionLocal() as db:
        room_res = await db.execute(select(Room).where(Room.code == session.room_code))
        room = room_res.scalar_one_or_none()
        if not room:
            return {"status": "ERROR", "message": "Room not found"}

        episodes = await QueueManager.get_queue(db, room.id)
        queue_dicts = [QueueManager.serialize_episode(ep) for ep in episodes]

        return {
            "status": "OK",
            "room_code": room.code,
            "current_episode_id": room.current_episode_id,
            "episodes": queue_dicts,
        }


@sio.event
async def reorder_queue(sid: str, data: dict = None):
    """Reorders the room's queue using a list of episode IDs."""
    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}

    ordered_ids = (data or {}).get("ordered_episode_ids", [])
    if not isinstance(ordered_ids, list):
        return {"status": "ERROR", "message": "ordered_episode_ids must be a list"}

    async with AsyncSessionLocal() as db:
        room_res = await db.execute(select(Room).where(Room.code == session.room_code))
        room = room_res.scalar_one_or_none()
        if not room:
            return {"status": "ERROR", "message": "Room not found"}

        reordered = await QueueManager.reorder_queue(db, room.id, ordered_ids)
        queue_dicts = [QueueManager.serialize_episode(ep) for ep in reordered]

        await sio.emit(
            "queue_updated",
            {
                "room_code": room.code,
                "episodes": queue_dicts,
                "current_episode_id": room.current_episode_id,
            },
            room=room.code,
        )

        return {"status": "OK", "episodes": queue_dicts}


@sio.event
async def remove_from_queue(sid: str, data: dict = None):
    """Removes an episode from the room's queue."""
    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}

    episode_id = (data or {}).get("episode_id")
    if not episode_id:
        return {"status": "ERROR", "message": "episode_id is required"}

    async with AsyncSessionLocal() as db:
        room_res = await db.execute(select(Room).where(Room.code == session.room_code))
        room = room_res.scalar_one_or_none()
        if not room:
            return {"status": "ERROR", "message": "Room not found"}

        prev_current = room.current_episode_id
        success, new_current, remaining = await QueueManager.remove_from_queue(
            db, room.id, episode_id
        )
        if not success:
            return {"status": "ERROR", "message": "Episode not found in queue"}

        queue_dicts = [QueueManager.serialize_episode(ep) for ep in remaining]
        await sio.emit(
            "queue_updated",
            {
                "room_code": room.code,
                "episodes": queue_dicts,
                "current_episode_id": new_current,
            },
            room=room.code,
        )

        if prev_current == episode_id:
            await invalidate_room_readiness(
                room.code, reason="Active episode was removed from queue", reset_watching=True
            )

        return {
            "status": "OK",
            "episodes": queue_dicts,
            "current_episode_id": new_current,
        }


@sio.event
async def select_episode(sid: str, data: dict = None):
    """Switches the room's active episode to a chosen episode in the queue."""
    session = connection_manager.get_session(sid)
    if not session:
        return {"status": "ERROR", "message": "Socket session unauthenticated"}

    episode_id = (data or {}).get("episode_id")
    if not episode_id:
        return {"status": "ERROR", "message": "episode_id is required"}

    async with AsyncSessionLocal() as db:
        room_res = await db.execute(select(Room).where(Room.code == session.room_code))
        room = room_res.scalar_one_or_none()
        if not room:
            return {"status": "ERROR", "message": "Room not found"}

        success, episode = await QueueManager.set_current_episode(db, room.id, episode_id)
        if not success or not episode:
            return {"status": "ERROR", "message": "Episode not found in queue"}

        await invalidate_room_readiness(
            room.code, reason="Selected a different episode from queue", reset_watching=True
        )

        episodes = await QueueManager.get_queue(db, room.id)
        queue_dicts = [QueueManager.serialize_episode(ep) for ep in episodes]

        await sio.emit(
            "queue_updated",
            {
                "room_code": room.code,
                "episodes": queue_dicts,
                "current_episode_id": episode.id,
            },
            room=room.code,
        )

        return {"status": "OK", "current_episode_id": episode.id}



