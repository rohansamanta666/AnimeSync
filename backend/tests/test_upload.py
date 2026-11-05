import hashlib
import os
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from backend.app.main import app
from backend.app.database import init_db, AsyncSessionLocal
from backend.app.services.room_manager import RoomManager
from backend.app.models.participant import ParticipantStatus
from backend.app.sockets.server import handle_join_room, verify_file
from backend.app.sockets.connection_manager import connection_manager

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()
    connection_manager._sid_to_session.clear()
    connection_manager._participant_sockets.clear()
    connection_manager._room_participants.clear()
    yield

@pytest.mark.asyncio
async def test_chunked_upload_assembly_and_sha256():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create a room
        async with AsyncSessionLocal() as db:
            room, host, host_token = await RoomManager.create_room(db, "Anime Night", "HostUser")

        # Create a test payload: 3 chunks (5MB, 5MB, 1MB = 11MB)
        chunk_0 = b"A" * (5 * 1024 * 1024)
        chunk_1 = b"B" * (5 * 1024 * 1024)
        chunk_2 = b"C" * (1 * 1024 * 1024)
        full_content = chunk_0 + chunk_1 + chunk_2
        expected_sha256 = hashlib.sha256(full_content).hexdigest().lower()
        file_size = len(full_content)

        headers = {
            "X-Participant-ID": host.id,
            "X-Session-Token": host_token
        }

        # 2. Init upload
        init_res = await client.post(
            "/api/files/upload/init",
            headers=headers,
            json={
                "room_id": room.id,
                "filename": "../../test_anime_ep01.mp4",  # includes path traversal test
                "file_size_bytes": file_size,
                "anime_title": "Frieren",
                "season": 1,
                "episode_number": 1,
                "display_title": "Journey's End"
            }
        )
        assert init_res.status_code == 200
        init_data = init_res.json()
        upload_id = init_data["upload_id"]
        assert init_data["total_chunks"] == 3

        # 3. Upload chunks
        # Chunk 0
        res_c0 = await client.post(
            "/api/files/upload/chunk",
            headers=headers,
            data={"upload_id": upload_id, "chunk_index": 0},
            files={"chunk_file": ("0.chunk", chunk_0, "application/octet-stream")}
        )
        assert res_c0.status_code == 200

        # Chunk 1
        res_c1 = await client.post(
            "/api/files/upload/chunk",
            headers=headers,
            data={"upload_id": upload_id, "chunk_index": 1},
            files={"chunk_file": ("1.chunk", chunk_1, "application/octet-stream")}
        )
        assert res_c1.status_code == 200

        # Verify status endpoint shows received chunks [0, 1]
        status_res = await client.get(f"/api/files/upload/{upload_id}/status", headers=headers)
        assert status_res.status_code == 200
        assert status_res.json()["received_chunks"] == [0, 1]

        # Chunk 2
        res_c2 = await client.post(
            "/api/files/upload/chunk",
            headers=headers,
            data={"upload_id": upload_id, "chunk_index": 2},
            files={"chunk_file": ("2.chunk", chunk_2, "application/octet-stream")}
        )
        assert res_c2.status_code == 200
        assert res_c2.json()["is_complete"] is True

        # 4. Finalize upload
        complete_res = await client.post(
            "/api/files/upload/complete",
            headers=headers,
            json={"upload_id": upload_id}
        )
        assert complete_res.status_code == 200
        ep_data = complete_res.json()
        assert ep_data["sha256_hash"] == expected_sha256
        assert ep_data["file_size_bytes"] == file_size
        assert ".." not in ep_data["filename"]
        assert ep_data["filename"] == "test_anime_ep01.mp4"
        episode_id = ep_data["id"]

        # 5. Range-based download test
        # Partial Range 0-99 (100 bytes)
        range_res = await client.get(
            f"/api/files/download/{episode_id}",
            headers={"Range": "bytes=0-99", "Authorization": f"Bearer {host_token}"},
            params={"participant_id": host.id}
        )
        assert range_res.status_code == 206
        assert range_res.headers["Content-Range"] == f"bytes 0-99/{file_size}"
        assert range_res.headers["Accept-Ranges"] == "bytes"
        assert len(range_res.content) == 100
        assert range_res.content == chunk_0[:100]

        # 6. Socket verification test: Matching hash
        # Connect host to socket room
        await handle_join_room("sid_host", {
            "room_code": room.code,
            "participant_id": host.id,
            "session_token": host_token
        })

        verify_success = await verify_file("sid_host", {
            "episode_id": episode_id,
            "sha256_hash": expected_sha256,
            "file_size_bytes": file_size
        })
        assert verify_success["status"] == "VERIFIED"

        # 7. Socket verification test: Mismatching hash
        verify_fail = await verify_file("sid_host", {
            "episode_id": episode_id,
            "sha256_hash": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            "file_size_bytes": file_size
        })
        assert verify_fail["status"] == "VERIFICATION_FAILED"

@pytest.mark.asyncio
async def test_missing_chunk_finalize_rejection():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with AsyncSessionLocal() as db:
            room, host, host_token = await RoomManager.create_room(db, "Incomplete Upload", "Host")

        headers = {"X-Participant-ID": host.id, "X-Session-Token": host_token}
        init_res = await client.post(
            "/api/files/upload/init",
            headers=headers,
            json={
                "room_id": room.id,
                "filename": "ep02.mp4",
                "file_size_bytes": 10 * 1024 * 1024,
                "anime_title": "Attack on Titan",
                "season": 1,
                "episode_number": 2
            }
        )
        upload_id = init_res.json()["upload_id"]

        # Only upload chunk 0 (total chunks = 2)
        await client.post(
            "/api/files/upload/chunk",
            headers=headers,
            data={"upload_id": upload_id, "chunk_index": 0},
            files={"chunk_file": ("0.chunk", b"A" * (5 * 1024 * 1024), "application/octet-stream")}
        )

        # Attempt to finalize prematurely
        fail_res = await client.post(
            "/api/files/upload/complete",
            headers=headers,
            json={"upload_id": upload_id}
        )
        assert fail_res.status_code == 400
        assert "Missing 1 chunks" in fail_res.json()["detail"]

@pytest.mark.asyncio
async def test_unauthorized_download_prevention():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with AsyncSessionLocal() as db:
            room1, host1, token1 = await RoomManager.create_room(db, "Room 1", "Host1")
            room2, host2, token2 = await RoomManager.create_room(db, "Room 2", "Host2")

        # Upload episode to Room 1
        headers1 = {"X-Participant-ID": host1.id, "X-Session-Token": token1}
        init_res = await client.post(
            "/api/files/upload/init",
            headers=headers1,
            json={
                "room_id": room1.id,
                "filename": "secret.mp4",
                "file_size_bytes": 100,
                "anime_title": "Secret",
                "season": 1,
                "episode_number": 1
            }
        )
        uid = init_res.json()["upload_id"]
        await client.post(
            "/api/files/upload/chunk",
            headers=headers1,
            data={"upload_id": uid, "chunk_index": 0},
            files={"chunk_file": ("0.chunk", b"0" * 100, "application/octet-stream")}
        )
        comp = await client.post(
            "/api/files/upload/complete",
            headers=headers1,
            json={"upload_id": uid}
        )
        ep_id = comp.json()["id"]

        # User from Room 2 attempts to download Room 1's episode
        bad_download = await client.get(
            f"/api/files/download/{ep_id}",
            params={"participant_id": host2.id, "token": token2}
        )
        assert bad_download.status_code == 403

