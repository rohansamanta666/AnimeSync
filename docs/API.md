# AnimeSync — API Specification

## 1. REST Endpoints

All REST endpoints are prefixed with `/api`.

### 1.1 Health & Info
- **`GET /api/health`**
  - Response: `{"status": "healthy", "version": "1.0.0", "storage_free_bytes": 104857600}`

### 1.2 Rooms
- **`POST /api/rooms`**
  - Body: `{"name": "Friday Anime Night", "host_username": "Rohan"}`
  - Response:
    ```json
    {
      "id": "uuid-v4",
      "code": "ASYNC1",
      "name": "Friday Anime Night",
      "host_id": "participant-uuid",
      "host_token": "secret-session-token",
      "created_at": "2026-11-04T18:00:00Z"
    }
    ```
- **`GET /api/rooms/{code}`**
  - Response: Room metadata, active episode, queue items, participant list.
- **`POST /api/rooms/{code}/join`**
  - Body: `{"username": "Friend"}`
  - Response:
    ```json
    {
      "room_id": "uuid-v4",
      "room_code": "ASYNC1",
      "participant_id": "participant-uuid",
      "participant_token": "secret-session-token",
      "is_host": false
    }
    ```

### 1.3 File Distribution & Verification
- **`POST /api/files/upload/init`**
  - Headers: `X-Participant-ID: <id>`, `X-Session-Token: <token>`
  - Body:
    ```json
    {
      "room_id": "room-uuid",
      "filename": "frieren_ep01.mp4",
      "file_size_bytes": 734003200,
      "anime_title": "Frieren: Beyond Journey's End",
      "season": 1,
      "episode_number": 1,
      "display_title": "The End of the Journey",
      "mime_type": "video/mp4"
    }
    ```
  - Response:
    ```json
    {
      "upload_id": "upload-uuid",
      "chunk_size_bytes": 5242880,
      "total_chunks": 140,
      "received_chunks": []
    }
    ```
- **`POST /api/files/upload/chunk`**
  - Headers: `X-Participant-ID: <id>`, `X-Session-Token: <token>`
  - Form Data: `upload_id` (str), `chunk_index` (int), `chunk_file` (binary blob)
  - Response:
    ```json
    {
      "upload_id": "upload-uuid",
      "chunk_index": 0,
      "received_chunks": [0],
      "total_chunks": 140,
      "is_complete": false
    }
    ```
- **`GET /api/files/upload/{upload_id}/status`**
  - Headers: `X-Participant-ID: <id>`, `X-Session-Token: <token>`
  - Response: Upload metadata, list of received chunk indices, and progress fraction for resume coordination.
- **`POST /api/files/upload/complete`**
  - Headers: `X-Participant-ID: <id>`, `X-Session-Token: <token>`
  - Body: `{"upload_id": "upload-uuid"}`
  - Response:
    ```json
    {
      "id": "episode-uuid",
      "anime_title": "Frieren: Beyond Journey's End",
      "season": 1,
      "episode_number": 1,
      "display_title": "The End of the Journey",
      "filename": "frieren_ep01.mp4",
      "file_size_bytes": 734003200,
      "sha256_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "duration_seconds": null,
      "upload_status": "COMPLETED",
      "queue_position": 0
    }
    ```
- **`POST /api/files/upload/{upload_id}/cancel`**
  - Headers: `X-Participant-ID: <id>`, `X-Session-Token: <token>`
  - Response: `{"success": true, "message": "Upload cancelled"}`
- **`GET /api/files/download/{episode_id}`**
  - Auth: `Authorization: Bearer <token>` or Query params `?participant_id=<id>&token=<token>`
  - Header: `Range: bytes=start-end` (Optional)
  - Response:
    - 200 OK (Full stream) or 206 Partial Content (Range stream)
    - Headers: `Accept-Ranges: bytes`, `Content-Range: bytes start-end/total`, `Content-Disposition: attachment; filename="..."`, `X-SHA256: <hash>`
- **`DELETE /api/files/{episode_id}`**
  - Host only. Purges video from disk and removes database record.
  - Headers: `X-Participant-ID: <id>`, `X-Session-Token: <token>`
  - Response: `{"success": true, "freed_bytes": 734003200}`

---

## 2. Real-Time Socket.IO Protocol

### 2.1 Connection, Authentication & Presence
- **Client $\rightarrow$ Server: `join_room`**
  - Payload:
    ```json
    {
      "room_code": "ASYNC1",
      "participant_id": "participant-uuid",
      "session_token": "64-char-hex-session-token"
    }
    ```
  - *Server Enforcement*: Validates database record matching `(room_code, participant_id, session_token)`. Rejects unauthorized connections with `error` (`AUTH_FAILED` or `ROOM_NOT_FOUND`).
- **Server $\rightarrow$ Client (Emitter): `room_joined`**
  - Payload:
    ```json
    {
      "success": true,
      "room_code": "ASYNC1",
      "room": { ...full room snapshot... },
      "presence": [
        {
          "id": "participant-uuid",
          "username": "Rohan",
          "is_host": true,
          "is_online": true,
          "status": "WAITING_FOR_FILE",
          "active_connections": 1,
          "last_seen": "2026-11-04T18:00:00Z"
        }
      ]
    }
    ```
- **Server $\rightarrow$ Room: `presence_updated`**
  - Broadcast to room channel when any participant's online/offline status or active connection count changes:
    ```json
    {
      "room_code": "ASYNC1",
      "participants": [
        {
          "id": "uuid",
          "username": "Rohan",
          "is_host": true,
          "is_online": true,
          "status": "WAITING_FOR_FILE",
          "active_connections": 1,
          "last_seen": "..."
        }
      ]
    }
    ```
- **Server $\rightarrow$ Room: `user_joined`**
  - Broadcast when a newly online participant joins the room:
    ```json
    {
      "participant_id": "participant-uuid",
      "username": "Alex",
      "is_host": false,
      "timestamp": 1730740000.0
    }
    ```
- **Server $\rightarrow$ Room: `user_left`**
  - Broadcast when a participant closes their final active connection or explicitly leaves:
    ```json
    {
      "participant_id": "participant-uuid",
      "username": "Alex",
      "timestamp": 1730740010.0
    }
    ```
- **Client $\rightarrow$ Server: `leave_room`**
  - Payload: `{"room_code": "ASYNC1"}`
- **Server $\rightarrow$ Client: `room_left`**
  - Payload: `{"room_code": "ASYNC1"}`
- **Server $\rightarrow$ Client: `error`**
  - Payload: `{"code": "AUTH_FAILED" | "ROOM_NOT_FOUND" | "INVALID_PAYLOAD", "message": "..."}`

### 2.2 Ready-to-Watch & File Verification
- **Client $\rightarrow$ Server: `verify_file`**
  - Payload:
    ```json
    {
      "episode_id": "episode-uuid",
      "sha256_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "file_size_bytes": 734003200
    }
    ```
- **Server $\rightarrow$ Client (Emitter): `verification_result`**
  - On Success:
    ```json
    {
      "status": "VERIFIED",
      "message": "File verified successfully! Checksum and size match.",
      "episode_id": "episode-uuid"
    }
    ```
  - On Failure:
    ```json
    {
      "status": "VERIFICATION_FAILED",
      "message": "Verification failed: Checksum mismatch. The selected file is not identical to the host file.",
      "episode_id": "episode-uuid",
      "expected_hash": "...",
      "actual_hash": "..."
    }
    ```
- **Server $\rightarrow$ Room: `presence_updated`**
  - Broadcasts updated participant list showing newly updated status (`VERIFIED` or `VERIFICATION_FAILED`).
- **Client $\rightarrow$ Server: `set_ready`**
  - Payload: `{"is_ready": true}`
  - *Enforcement*: Server rejects if participant is not `VERIFIED`.
- **Server $\rightarrow$ Room: `readiness_updated`**
  - Payload: `{"participant_id": "uuid", "status": "READY"}`
- **Server $\rightarrow$ Room: `countdown_started`**
  - Payload: `{"seconds": 3, "target_start_timestamp": 1730740003.5}`

### 2.3 Synchronized Video Playback
- **Client $\rightarrow$ Server: `playback_action`**
  - Payload:
    ```json
    {
      "action": "PLAY" | "PAUSE" | "SEEK" | "RATE_CHANGE",
      "timestamp": 124.5,
      "playback_rate": 1.0,
      "client_sequence": 42
    }
    ```
- **Server $\rightarrow$ Room: `playback_sync`**
  - Broadcast to all participants in room:
    ```json
    {
      "action": "PLAY",
      "timestamp": 124.5,
      "playback_rate": 1.0,
      "server_sequence": 43,
      "server_time": 1730740010.2,
      "originating_socket_id": "socket-abc"
    }
    ```
- **Client $\rightarrow$ Server: `request_resync`**
  - Client requests authoritative playback state when experiencing drift.
- **Client $\rightarrow$ Server: `buffering_state`**
  - Payload: `{"is_buffering": true}`

### 2.4 Chat System
- **Client $\rightarrow$ Server: `send_message`**
  - Payload: `{"content": "That intro animation was incredible!"}`
- **Server $\rightarrow$ Room: `new_message`**
  - Payload: `{"id": "msg-uuid", "username": "Rohan", "content": "...", "timestamp": "..."}`

### 2.5 WebRTC Voice Signaling
- **Client $\rightarrow$ Server: `voice_signal`**
  - Payload: `{"target_socket_id": "socket-xyz", "type": "offer" | "answer" | "ice_candidate", "data": {...}}`
- **Server $\rightarrow$ Target Client: `voice_signal`**
  - Direct relay of WebRTC session description / ICE candidate.
- **Client $\rightarrow$ Server: `voice_speaking`**
  - Payload: `{"is_speaking": true}`
- **Server $\rightarrow$ Room: `peer_speaking`**
  - Broadcasts voice activity indicator to update the avatar ring.

