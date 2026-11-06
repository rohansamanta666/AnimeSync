import os
import shutil
import uuid
from pathlib import Path
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from backend.app.main import app
from backend.app.database import init_db, AsyncSessionLocal
from backend.app.services.room_manager import RoomManager
from backend.app.services.storage import StorageService
from backend.app.services.queue_manager import QueueManager
from backend.app.models.episode import Episode, UploadStatus
from backend.app.config import settings
from backend.app.sockets.connection_manager import connection_manager

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()
    connection_manager._sid_to_session.clear()
    connection_manager._participant_sockets.clear()
    connection_manager._room_participants.clear()
    yield

@pytest.mark.asyncio
async def test_storage_service_usage():
    usage = StorageService.get_storage_usage()
    assert "total_disk_bytes" in usage
    assert "free_disk_bytes" in usage
    assert "animesync_used_bytes" in usage
    assert "video_storage_bytes" in usage
    assert "temp_storage_bytes" in usage
    assert usage["total_disk_bytes"] > 0
    assert usage["free_disk_bytes"] >= 0
    assert usage["animesync_used_bytes"] >= 0

@pytest.mark.asyncio
async def test_get_media_dashboard_api():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ep_id = str(uuid.uuid4())
        test_file_path = Path(settings.STORAGE_DIR) / f"test_ep_{ep_id}.mp4"
        test_file_path.write_bytes(b"ANIME_VIDEO_BYTES_TEST")

        async with AsyncSessionLocal() as db:
            room, host, host_token = await RoomManager.create_room(db, "Media Room", "HostUser")

            ep = Episode(
                id=ep_id,
                room_id=room.id,
                anime_title="Steins;Gate",
                season=1,
                episode_number=1,
                filename="steins_gate_ep01.mp4",
                file_path=str(test_file_path),
                file_size_bytes=len(b"ANIME_VIDEO_BYTES_TEST"),
                upload_status=UploadStatus.COMPLETED,
                queue_position=0,
            )
            db.add(ep)
            room.current_episode_id = ep.id
            await db.commit()

        try:
            # 1. Unauthenticated request should be rejected
            unauth_res = await client.get(f"/api/rooms/{room.code}/media")
            assert unauth_res.status_code == 422 or unauth_res.status_code == 401

            # 2. Host request should succeed
            headers = {
                "X-Participant-ID": host.id,
                "X-Session-Token": host_token,
            }
            res = await client.get(f"/api/rooms/{room.code}/media", headers=headers)
            assert res.status_code == 200
            data = res.json()
            assert data["room_code"] == room.code
            assert "storage" in data
            assert data["storage"]["total_disk_bytes"] > 0
            assert data["storage"]["video_storage_bytes"] >= len(b"ANIME_VIDEO_BYTES_TEST")
            assert len(data["episodes"]) == 1
            ep_data = data["episodes"][0]
            assert ep_data["id"] == ep_id
            assert ep_data["anime_title"] == "Steins;Gate"
            assert ep_data["is_active"] is True
            assert ep_data["file_exists_on_disk"] is True
        finally:
            # Clean up created file
            if test_file_path.exists():
                test_file_path.unlink()

@pytest.mark.asyncio
async def test_delete_media_file_host_and_permission():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ep_id = str(uuid.uuid4())
        test_file_path = Path(settings.STORAGE_DIR) / f"test_ep_{ep_id}.mp4"
        test_file_path.write_bytes(b"EPISODE_DELETE_TEST_DATA")

        async with AsyncSessionLocal() as db:
            room, host, host_token = await RoomManager.create_room(db, "Delete Room", "HostUser")
            _, viewer, viewer_token = await RoomManager.join_room(db, room.code, "ViewerUser")

            ep = Episode(
                id=ep_id,
                room_id=room.id,
                anime_title="Attack on Titan",
                season=1,
                episode_number=1,
                filename="aot_ep01.mp4",
                file_path=str(test_file_path),
                file_size_bytes=len(b"EPISODE_DELETE_TEST_DATA"),
                upload_status=UploadStatus.COMPLETED,
                queue_position=0,
            )
            db.add(ep)
            room.current_episode_id = ep.id
            await db.commit()

        viewer_headers = {
            "X-Participant-ID": viewer.id,
            "X-Session-Token": viewer_token,
        }
        host_headers = {
            "X-Participant-ID": host.id,
            "X-Session-Token": host_token,
        }

        try:
            # 1. Non-host viewer cannot delete episode
            del_viewer = await client.delete(
                f"/api/rooms/{room.code}/media/{ep.id}", headers=viewer_headers
            )
            assert del_viewer.status_code == 403
            assert test_file_path.exists()

            # 2. Host can delete episode
            del_host = await client.delete(
                f"/api/rooms/{room.code}/media/{ep.id}", headers=host_headers
            )
            assert del_host.status_code == 200
            del_data = del_host.json()
            assert del_data["success"] is True
            assert del_data["freed_bytes"] == len(b"EPISODE_DELETE_TEST_DATA")
            assert del_data["remaining_episodes_count"] == 0
            assert not test_file_path.exists()

            # 3. Deleting nonexistent episode returns 404
            del_404 = await client.delete(
                f"/api/rooms/{room.code}/media/nonexistent_id", headers=host_headers
            )
            assert del_404.status_code == 404
        finally:
            if test_file_path.exists():
                test_file_path.unlink()

@pytest.mark.asyncio
async def test_purge_temp_storage():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with AsyncSessionLocal() as db:
            room, host, host_token = await RoomManager.create_room(db, "Purge Room", "HostUser")
            _, viewer, viewer_token = await RoomManager.join_room(db, room.code, "ViewerUser")

        # Create dummy temp session directory in TEMP_UPLOAD_DIR
        dummy_session_id = f"dummy_{uuid.uuid4().hex[:8]}"
        dummy_temp = Path(settings.TEMP_UPLOAD_DIR) / dummy_session_id
        dummy_temp.mkdir(parents=True, exist_ok=True)
        (dummy_temp / "0.chunk").write_bytes(b"CHUNK_TEMP_BYTES")

        viewer_headers = {
            "X-Participant-ID": viewer.id,
            "X-Session-Token": viewer_token,
        }
        host_headers = {
            "X-Participant-ID": host.id,
            "X-Session-Token": host_token,
        }

        try:
            # Viewer cannot purge
            res_viewer = await client.post(f"/api/rooms/{room.code}/media/purge", headers=viewer_headers)
            assert res_viewer.status_code == 403

            # Host can purge
            res_host = await client.post(f"/api/rooms/{room.code}/media/purge", headers=host_headers)
            assert res_host.status_code == 200
            purge_data = res_host.json()
            assert purge_data["success"] is True
            assert purge_data["purged_count"] >= 1
            assert not dummy_temp.exists()
        finally:
            if dummy_temp.exists():
                shutil.rmtree(dummy_temp, ignore_errors=True)
