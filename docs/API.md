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

### 1.3 File Distribution
- **`POST /api/files/upload/init`**
  - Header: `Authorization: Bearer <host_token>`
  - Body:
    ```json
    {
      "room_id": "uuid",
      "filename": "frieren_ep01.mp4",
      "file_size_bytes": 734003200,
      "anime_title": "Frieren: Beyond Journey's End",
      "season": 1,
      "episode_number": 1,
      "display_title": "The End of the Journey"
    }
    ```
  - Response: `{"upload_id": "upload-uuid", "chunk_size_bytes": 5242880, "total_chunks": 140}`
- **`POST /api/files/upload/chunk`**
  - Form Data: `upload_id`, `chunk_index`, `chunk_file` (binary blob)
  - Response: `{"upload_id": "upload-uuid", "chunk_index": 0, "received_bytes": 5242880}`
- **`POST /api/files/upload/complete`**
  - Body: `{"upload_id": "upload-uuid"}`
  - Response:
    ```json
    {
      "episode_id": "episode-uuid",
      "filename": "frieren_ep01.mp4",
      "sha256_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "file_size_bytes": 734003200,
      "status": "COMPLETED"
    }
    ```
- **`GET /api/files/download/{episode_id}`**
  - Supports HTTP `Range: bytes=start-end` header.
  - Streaming binary response with `Accept-Ranges: bytes` and `Content-Disposition: attachment; filename="..."`.
- **`GET /api/files/storage`**
  - Header: `Authorization: Bearer <host_token>`
  - Response: Lists stored files, total disk usage, free disk space.
- **`DELETE /api/files/{episode_id}`**
  - Header: `Authorization: Bearer <host_token>`
  - Response: `{"success": true, "freed_bytes": 734003200}`

---

## 2. Real-Time Socket.IO Protocol

### 2.1 Connection & Presence
- **Client $\rightarrow$ Server: `join_room`**
  - Payload: `{"room_code": "ASYNC1", "participant_id": "uuid", "token": "session-token"}`
- **Server $\rightarrow$ Client: `room_state`**
  - Full room snapshot (participants, queue, playback state, chat history).
- **Server $\rightarrow$ Room: `presence_updated`**
  - List of connected participants and their online/offline state.

### 2.2 Ready-to-Watch & File Verification
- **Client $\rightarrow$ Server: `verify_file`**
  - Payload: `{"episode_id": "uuid", "sha256_hash": "client-computed-hash"}`
- **Server $\rightarrow$ Client: `verification_result`**
  - Payload: `{"status": "VERIFIED" | "VERIFICATION_FAILED", "message": "Hash matched perfectly"}`
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
