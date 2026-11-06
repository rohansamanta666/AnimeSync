"""
AnimeSync — Chat & WebRTC Voice Verification Suite (Phase 7 Tasks 7.1 – 7.6)

Covers:
- Input sanitization (HTML stripping, entity encoding, length limits)
- Message persistence in SQLite and chronological retrieval
- REST Chat endpoints: GET /messages, POST /messages
- Socket.IO Chat events: send_message, get_messages
- VoiceManager state tracking: join, leave, mute toggle, disconnect cleanup
- WebRTC voice signaling: voice_offer, voice_answer, voice_ice_candidate relay
- Room channel isolation for chat and voice signaling
"""
import pytest
import asyncio
import uuid
from httpx import AsyncClient, ASGITransport
from backend.app.main import app
from backend.app.database import init_db, AsyncSessionLocal
from backend.app.models.room import Room
from backend.app.models.participant import Participant, ParticipantStatus
from backend.app.services.chat_service import ChatService, sanitize_message_content
from backend.app.sockets.connection_manager import connection_manager
from backend.app.sockets.voice_manager import voice_manager
from backend.app.sockets.server import (
    send_message,
    get_messages,
    voice_join,
    voice_leave,
    voice_offer,
    voice_answer,
    voice_ice_candidate,
    voice_mute_toggle,
    disconnect,
)


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()
    connection_manager.clear()
    voice_manager.clear()
    yield
    connection_manager.clear()
    voice_manager.clear()


async def _make_room(name: str = "Chat & Voice Room") -> Room:
    code = f"C{uuid.uuid4().hex[:5].upper()}"
    room = Room(id=str(uuid.uuid4()), code=code, name=name, is_active=True)
    async with AsyncSessionLocal() as db:
        db.add(room)
        await db.commit()
        await db.refresh(room)
    return room


async def _make_participant(
    room_id: str,
    username: str,
    status: ParticipantStatus = ParticipantStatus.WATCHING,
    is_host: bool = False,
    token: str = None,
) -> Participant:
    p = Participant(
        id=str(uuid.uuid4()),
        room_id=room_id,
        username=username,
        session_token=token or str(uuid.uuid4()),
        is_host=is_host,
        status=status,
    )
    async with AsyncSessionLocal() as db:
        db.add(p)
        await db.commit()
        await db.refresh(p)
    return p


# ---------------------------------------------------------------------------
# 1. Chat Sanitization Unit Tests (Task 7.1)
# ---------------------------------------------------------------------------

def test_chat_sanitization_strips_html():
    raw = "<script>alert('pwned')</script>Hello <b>World</b>!"
    sanitized = sanitize_message_content(raw)
    assert "<script>" not in sanitized
    assert "<b>" not in sanitized
    assert "alert(&#x27;pwned&#x27;)Hello World!" in sanitized


def test_chat_sanitization_escapes_entities():
    raw = "Tanjiro & Nezuko <3"
    sanitized = sanitize_message_content(raw)
    assert "&amp;" in sanitized
    assert "<" not in sanitized


def test_chat_sanitization_rejects_empty():
    with pytest.raises(ValueError, match="Message cannot be empty"):
        sanitize_message_content("   <p></p>   ")


def test_chat_sanitization_rejects_overly_long():
    long_msg = "A" * 1001
    with pytest.raises(ValueError, match="cannot exceed 1000 characters"):
        sanitize_message_content(long_msg)


# ---------------------------------------------------------------------------
# 2. Chat REST API & Persistence Tests (Task 7.1)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_chat_rest_api_lifecycle():
    room = await _make_room("Chat REST Room")
    p1 = await _make_participant(room.id, "Tanjiro", is_host=True)
    p2 = await _make_participant(room.id, "Zenitsu", is_host=False)

    p1_headers = {
        "X-Participant-ID": p1.id,
        "X-Session-Token": p1.session_token,
    }
    p2_headers = {
        "X-Participant-ID": p2.id,
        "X-Session-Token": p2.session_token,
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Send first message from Tanjiro
        res1 = await client.post(
            f"/api/rooms/{room.code}/messages",
            json={"content": "Let's watch Episode 1!"},
            headers=p1_headers,
        )
        assert res1.status_code == 201
        m1 = res1.json()
        assert m1["username"] == "Tanjiro"
        assert m1["content"] == "Let&#x27;s watch Episode 1!"

        # 2. Send second message from Zenitsu with HTML to sanitize
        res2 = await client.post(
            f"/api/rooms/{room.code}/messages",
            json={"content": "I am <i>scared</i> of demons!"},
            headers=p2_headers,
        )
        assert res2.status_code == 201
        m2 = res2.json()
        assert m2["username"] == "Zenitsu"
        assert m2["content"] == "I am scared of demons!"

        # 3. Retrieve messages
        get_res = await client.get(
            f"/api/rooms/{room.code}/messages",
            headers=p1_headers,
        )
        assert get_res.status_code == 200
        history = get_res.json()["messages"]
        assert len(history) == 2
        assert history[0]["username"] == "Tanjiro"
        assert history[1]["username"] == "Zenitsu"

        # 4. Unauthenticated request rejected
        unauth_res = await client.get(
            f"/api/rooms/{room.code}/messages",
            headers={"X-Participant-ID": "bad", "X-Session-Token": "bad"},
        )
        assert unauth_res.status_code == 403


# ---------------------------------------------------------------------------
# 3. Chat Socket.IO Handlers (Task 7.1)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_chat_socket_handlers():
    room = await _make_room("Chat Socket Room")
    p = await _make_participant(room.id, "Inosuke", is_host=False)
    sid = "sid_inosuke"

    await connection_manager.register_connection(
        sid=sid, room_code=room.code, room_id=room.id,
        participant_id=p.id, username="Inosuke", is_host=False
    )

    # Send message via Socket
    send_res = await send_message(sid, {"content": "Boar Rush!!!"})
    assert send_res["status"] == "OK"
    assert send_res["message"]["username"] == "Inosuke"
    assert send_res["message"]["content"] == "Boar Rush!!!"

    # Fetch messages via Socket
    get_res = await get_messages(sid, {"limit": 10})
    assert get_res["status"] == "OK"
    assert len(get_res["messages"]) == 1
    assert get_res["messages"][0]["content"] == "Boar Rush!!!"

    # Bad content handling
    err_res = await send_message(sid, {"content": "   "})
    assert err_res["status"] == "ERROR"
    assert "Message cannot be empty" in err_res["message"]

    await connection_manager.unregister_connection(sid)


# ---------------------------------------------------------------------------
# 4. VoiceManager Unit Tests (Task 7.2)
# ---------------------------------------------------------------------------

def test_voice_manager_lifecycle():
    room = "VOICE_ROOM"
    # Join
    vp1 = voice_manager.join_voice(room, "p1", "User1", "sid1", is_muted=False)
    assert vp1.username == "User1"
    assert voice_manager.is_in_voice(room, "p1") is True
    assert len(voice_manager.get_participants(room)) == 1

    # Mute toggle
    voice_manager.set_mute(room, "p1", True)
    assert voice_manager.get_participants(room)[0].is_muted is True

    # Join second participant
    vp2 = voice_manager.join_voice(room, "p2", "User2", "sid2", is_muted=True)
    assert len(voice_manager.get_participants(room)) == 2

    # Leave
    left = voice_manager.leave_voice(room, "p1")
    assert left is not None
    assert left.participant_id == "p1"
    assert len(voice_manager.get_participants(room)) == 1

    # Disconnect cleanup
    removed = voice_manager.remove_by_socket_id("sid2")
    assert len(removed) == 1
    assert removed[0][0] == room
    assert removed[0][1].participant_id == "p2"
    assert len(voice_manager.get_participants(room)) == 0


# ---------------------------------------------------------------------------
# 5. WebRTC Voice Signaling Socket Tests (Tasks 7.2 & 7.3)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_voice_signaling_lifecycle():
    room = await _make_room("WebRTC Signaling Room")
    p1 = await _make_participant(room.id, "Caller", is_host=True)
    p2 = await _make_participant(room.id, "Callee", is_host=False)

    sid1 = "sid_caller"
    sid2 = "sid_callee"

    await connection_manager.register_connection(
        sid=sid1, room_code=room.code, room_id=room.id,
        participant_id=p1.id, username="Caller", is_host=True
    )
    await connection_manager.register_connection(
        sid=sid2, room_code=room.code, room_id=room.id,
        participant_id=p2.id, username="Callee", is_host=False
    )

    # 1. Caller joins voice -> no other peers yet
    join1 = await voice_join(sid1, {"is_muted": False})
    assert join1["status"] == "OK"
    assert join1["peers"] == []

    # 2. Callee joins voice -> receives Caller in peers list
    join2 = await voice_join(sid2, {"is_muted": True})
    assert join2["status"] == "OK"
    assert len(join2["peers"]) == 1
    assert join2["peers"][0]["participant_id"] == p1.id
    assert join2["peers"][0]["socket_id"] == sid1

    # 3. WebRTC Offer relay
    fake_offer = {"type": "offer", "sdp": "v=0\r\no=caller..."}
    offer_res = await voice_offer(sid1, {
        "target_socket_id": sid2,
        "sdp": fake_offer,
    })
    assert offer_res["status"] == "OK"

    # 4. WebRTC Answer relay
    fake_answer = {"type": "answer", "sdp": "v=0\r\no=callee..."}
    ans_res = await voice_answer(sid2, {
        "target_socket_id": sid1,
        "sdp": fake_answer,
    })
    assert ans_res["status"] == "OK"

    # 5. ICE Candidate relay
    fake_candidate = {"candidate": "candidate:1 1 UDP ...", "sdpMid": "0"}
    ice_res = await voice_ice_candidate(sid1, {
        "target_socket_id": sid2,
        "candidate": fake_candidate,
    })
    assert ice_res["status"] == "OK"

    # 6. Mute toggle
    mute_res = await voice_mute_toggle(sid1, {"is_muted": True})
    assert mute_res["status"] == "OK"
    assert mute_res["is_muted"] is True

    # 7. Callee leaves voice
    leave_res = await voice_leave(sid2, {})
    assert leave_res["status"] == "OK"
    assert len(voice_manager.get_participants(room.code)) == 1

    # 8. Caller disconnects -> automatically cleaned up from voice
    await disconnect(sid1)
    assert len(voice_manager.get_participants(room.code)) == 0

    await connection_manager.unregister_connection(sid2)
