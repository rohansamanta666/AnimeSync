import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from backend.app.main import app
from backend.app.database import init_db

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()
    yield

@pytest.mark.asyncio
async def test_health_check():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "storage" in data
        assert "free_bytes" in data["storage"]

@pytest.mark.asyncio
async def test_spa_serving():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/")
        assert response.status_code == 200
        assert "AnimeSync" in response.text
        assert '<div id="root">' in response.text

@pytest.mark.asyncio
async def test_room_lifecycle():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create a Room
        create_res = await client.post(
            "/api/rooms",
            json={"name": "Friday Watch Party", "host_username": "Rohan"}
        )
        assert create_res.status_code == 201
        created = create_res.json()
        assert "room" in created
        assert "participant_id" in created
        assert "session_token" in created
        assert created["is_host"] is True

        room_code = created["room"]["code"]
        assert len(room_code) == 6
        assert created["room"]["name"] == "Friday Watch Party"
        assert len(created["room"]["participants"]) == 1
        assert created["room"]["participants"][0]["username"] == "Rohan"

        # 2. Get Room by Code
        get_res = await client.get(f"/api/rooms/{room_code}")
        assert get_res.status_code == 200
        room_data = get_res.json()
        assert room_data["code"] == room_code

        # 3. Friend Joins Room
        join_res = await client.post(
            f"/api/rooms/{room_code}/join",
            json={"username": "BestFriend"}
        )
        assert join_res.status_code == 200
        joined = join_res.json()
        assert joined["is_host"] is False
        assert joined["participant_id"] != created["participant_id"]

        # 4. Verify Both Participants in Room
        final_res = await client.get(f"/api/rooms/{room_code}")
        assert final_res.status_code == 200
        final_data = final_res.json()
        usernames = [p["username"] for p in final_data["participants"]]
        assert "Rohan" in usernames
        assert "BestFriend" in usernames
        assert len(final_data["participants"]) == 2
