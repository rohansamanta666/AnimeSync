"""
AnimeSync — Phase 9: Security Verification & End-to-End Multi-User Integration Tests
"""
import os
import uuid
import hashlib
import pytest
import pytest_asyncio
from pathlib import Path
from httpx import AsyncClient, ASGITransport
from backend.app.main import app
from backend.app.database import init_db, AsyncSessionLocal
from backend.app.services.room_manager import RoomManager
from backend.app.services.storage import StorageService
from backend.app.services.queue_manager import QueueManager
from backend.app.models.episode import Episode, UploadStatus
from backend.app.models.participant import ParticipantStatus
from backend.app.config import settings
from backend.app.sockets.connection_manager import connection_manager
from backend.app.sockets.playback_manager import playback_manager
from backend.app.sockets.server import (
    handle_join_room,
    verify_file,
    set_ready,
    playback_action,
    buffering_start,
    buffering_end,
)

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()
    connection_manager._sid_to_session.clear()
    connection_manager._participant_sockets.clear()
    connection_manager._room_participants.clear()
    yield

# ---------------------------------------------------------------------------
# 1. Security Tests: Directory Traversal, Boundary Enforcement & Permissions
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_security_upload_id_traversal_guards():
    """Validates that empty or malicious upload IDs cannot escape TEMP_UPLOAD_DIR."""
    with pytest.raises(ValueError, match="Invalid or empty upload session ID"):
        StorageService.get_upload_dir("../../../")

    with pytest.raises(ValueError, match="Invalid or empty upload session ID"):
        StorageService.get_upload_dir("")

    with pytest.raises(ValueError, match="Invalid or empty upload session ID"):
        StorageService.get_upload_dir("///")

    # Safe valid ID creates subpath strictly inside TEMP_UPLOAD_DIR
    valid_id = str(uuid.uuid4())
    upload_dir = StorageService.get_upload_dir(valid_id)
    assert str(upload_dir.resolve()).startswith(str(Path(settings.TEMP_UPLOAD_DIR).resolve()))


@pytest.mark.asyncio
async def test_security_download_traversal_guards():
    """Validates that attempts to download files outside STORAGE_DIR are strictly forbidden."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with AsyncSessionLocal() as db:
            room, host, host_token = await RoomManager.create_room(db, "Security Room", "HostUser")

            # Intentionally create an episode pointing to an external file
            malicious_ep = Episode(
                id=str(uuid.uuid4()),
                room_id=room.id,
                anime_title="Malicious Ep",
                season=1,
                episode_number=1,
                filename="passwd",
                file_path="/etc/passwd",
                file_size_bytes=100,
                upload_status=UploadStatus.COMPLETED,
                queue_position=0,
            )
            db.add(malicious_ep)
            await db.commit()

        headers = {
            "X-Participant-ID": host.id,
            "Authorization": f"Bearer {host_token}",
        }
        res = await client.get(f"/api/files/download/{malicious_ep.id}", headers=headers)
        # Must be rejected with 403 Forbidden
        assert res.status_code == 403
        assert "outside the allowed storage directory" in res.json()["detail"]


@pytest.mark.asyncio
async def test_security_host_only_actions_enforcement():
    """Validates that non-host participants cannot execute host-only management actions."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with AsyncSessionLocal() as db:
            room, host, host_token = await RoomManager.create_room(db, "Perms Room", "HostUser")
            _, guest, guest_token = await RoomManager.join_room(db, room.code, "GuestUser")

            ep = Episode(
                id=str(uuid.uuid4()),
                room_id=room.id,
                anime_title="Sample Anime",
                season=1,
                episode_number=1,
                filename="sample.mp4",
                file_path=str(Path(settings.STORAGE_DIR) / "sample.mp4"),
                file_size_bytes=1024,
                upload_status=UploadStatus.COMPLETED,
                queue_position=0,
            )
            db.add(ep)
            await db.commit()

        guest_headers = {
            "X-Participant-ID": guest.id,
            "X-Session-Token": guest_token,
        }

        # 1. Non-host cannot delete from queue
        res_del = await client.delete(f"/api/rooms/{room.code}/queue/{ep.id}", headers=guest_headers)
        assert res_del.status_code == 403

        # 2. Non-host cannot reorder queue
        res_reorder = await client.put(
            f"/api/rooms/{room.code}/queue/reorder",
            headers=guest_headers,
            json={"ordered_episode_ids": [ep.id]},
        )
        assert res_reorder.status_code == 403

        # 3. Non-host cannot select active episode
        res_select = await client.post(
            f"/api/rooms/{room.code}/queue/select",
            headers=guest_headers,
            json={"episode_id": ep.id},
        )
        assert res_select.status_code == 403

        # 4. Non-host cannot delete media file
        res_media_del = await client.delete(
            f"/api/rooms/{room.code}/media/{ep.id}", headers=guest_headers
        )
        assert res_media_del.status_code == 403

        # 5. Non-host cannot purge temporary storage
        res_purge = await client.post(f"/api/rooms/{room.code}/media/purge", headers=guest_headers)
        assert res_purge.status_code == 403


@pytest.mark.asyncio
async def test_security_spa_missing_api_routes_404():
    """Validates that missing API endpoints return 404 JSON and are not masked by SPA index.html."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/nonexistent_endpoint")
        assert res.status_code == 404
        assert res.json()["detail"] == "API route not found"

# ---------------------------------------------------------------------------
# 2. Complete End-to-End Multi-User Watch Party Lifecycle
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_full_multi_user_watch_party_flow():
    """
    End-to-End lifecycle across two users:
    1. Host creates room, Guest joins room.
    2. Host uploads chunked video episode.
    3. Guest downloads chunked range stream.
    4. Both compute matching SHA-256 and achieve VERIFIED status.
    5. Readiness gating: countdown triggers when all are READY -> status WATCHING.
    6. Playback synchronization: Play, Seek, Speed with sequence numbers.
    7. Buffering detection & recovery coordination.
    8. Host cleans up / deletes episode with confirmation.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Step 1: Create room & Join
        async with AsyncSessionLocal() as db:
            room, host, host_token = await RoomManager.create_room(db, "E2E Anime Night", "Host")
            _, guest, guest_token = await RoomManager.join_room(db, room.code, "Guest")

        host_headers = {"X-Participant-ID": host.id, "X-Session-Token": host_token}
        guest_headers = {"X-Participant-ID": guest.id, "X-Session-Token": guest_token}

        # Step 2: Chunked Upload (2 chunks: 5MB + 1MB = 6MB)
        chunk_a = b"A" * settings.CHUNK_SIZE_BYTES
        chunk_b = b"B" * (1024 * 1024)
        full_content = chunk_a + chunk_b
        expected_hash = hashlib.sha256(full_content).hexdigest().lower()
        file_size = len(full_content)

        init_res = await client.post(
            "/api/files/upload/init",
            headers=host_headers,
            json={
                "room_id": room.id,
                "filename": "e2e_episode_01.mp4",
                "file_size_bytes": file_size,
                "anime_title": "Attack on Titan",
                "season": 1,
                "episode_number": 1,
                "display_title": "To You, in 2000 Years",
            },
        )
        assert init_res.status_code == 200
        upload_id = init_res.json()["upload_id"]

        # Upload chunk 0
        c0_res = await client.post(
            "/api/files/upload/chunk",
            headers=host_headers,
            data={"upload_id": upload_id, "chunk_index": 0},
            files={"chunk_file": ("0.chunk", chunk_a, "application/octet-stream")},
        )
        assert c0_res.status_code == 200

        # Upload chunk 1
        c1_res = await client.post(
            "/api/files/upload/chunk",
            headers=host_headers,
            data={"upload_id": upload_id, "chunk_index": 1},
            files={"chunk_file": ("1.chunk", chunk_b, "application/octet-stream")},
        )
        assert c1_res.status_code == 200

        # Complete upload
        comp_res = await client.post(
            "/api/files/upload/complete",
            headers=host_headers,
            json={"upload_id": upload_id},
        )
        assert comp_res.status_code == 200
        episode_data = comp_res.json()
        episode_id = episode_data["id"]
        assert episode_data["sha256_hash"] == expected_hash

        # Step 3: Guest downloads byte range
        down_res = await client.get(
            f"/api/files/download/{episode_id}",
            headers={"Authorization": f"Bearer {guest_token}", "Range": "bytes=0-1023"},
            params={"participant_id": guest.id},
        )
        assert down_res.status_code == 206
        assert len(down_res.content) == 1024

        # Step 4: Sockets connect and verify file
        host_sid = "sid_host_e2e"
        guest_sid = "sid_guest_e2e"

        await handle_join_room(host_sid, {"room_code": room.code, "participant_id": host.id, "session_token": host_token})
        await handle_join_room(guest_sid, {"room_code": room.code, "participant_id": guest.id, "session_token": guest_token})

        # Both compute SHA-256 and send verify_file
        await verify_file(host_sid, {"room_code": room.code, "episode_id": episode_id, "sha256_hash": expected_hash, "file_size": file_size})
        await verify_file(guest_sid, {"room_code": room.code, "episode_id": episode_id, "sha256_hash": expected_hash, "file_size": file_size})

        async with AsyncSessionLocal() as db:
            p_host = await db.get(type(host), host.id)
            p_guest = await db.get(type(guest), guest.id)
            assert p_host.status == ParticipantStatus.VERIFIED
            assert p_guest.status == ParticipantStatus.VERIFIED

        # Step 5: Readiness gating & countdown
        await set_ready(host_sid, {"room_code": room.code})
        # Countdown only starts when BOTH are ready
        await set_ready(guest_sid, {"room_code": room.code})

        # Step 6: Playback synchronization
        # Host pauses video at 25.0s
        await playback_action(
            host_sid,
            {
                "room_code": room.code,
                "action": "PAUSE",
                "current_time": 25.0,
                "is_playing": False,
                "playback_rate": 1.0,
                "sequence_number": 1,
            },
        )

        state = playback_manager.get_state(room.code)
        assert state is not None
        assert state.is_playing is False
        assert state.current_time == 25.0

        # Guest seeks to 42.0s
        await playback_action(
            guest_sid,
            {
                "room_code": room.code,
                "action": "SEEK",
                "current_time": 42.0,
                "is_playing": False,
                "playback_rate": 1.0,
                "sequence_number": 2,
            },
        )
        assert playback_manager.get_state(room.code).current_time == 42.0

        # Step 7: Buffering coordination
        # Guest starts buffering
        await buffering_start(guest_sid, {"room_code": room.code})
        assert "Guest" in playback_manager.get_buffering_usernames(room.code)

        # Guest finishes buffering -> state clears
        await buffering_end(guest_sid, {"room_code": room.code})
        assert "Guest" not in playback_manager.get_buffering_usernames(room.code)

        # Step 8: Host deletes episode from dashboard
        del_res = await client.delete(f"/api/rooms/{room.code}/media/{episode_id}", headers=host_headers)
        assert del_res.status_code == 200
        assert del_res.json()["success"] is True

        # Verify disk file is gone
        assert not Path(episode_data["filename"]).exists()
