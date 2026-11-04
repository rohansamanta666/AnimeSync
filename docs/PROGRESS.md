# AnimeSync — Project Progress

## 1. Project Status Overview
- **Current Phase**: Phase 2 (Private Rooms & Realtime Presence) — **COMPLETED**
- **Next Phase**: Phase 3 (Video Distribution & File Verification)
- **Overall Health**: Healthy
- **Target OS**: macOS (Apple Silicon & Intel)
- **Zero-Cost Compliance**: 100% verified (Local storage, SQLite, WebRTC P2P + Google STUN, Cloudflare Quick Tunnel / Tailscale)

---

## 2. Feature Tracking Matrix

| Phase | Description | Status | Completion % |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Foundation & UI Design System | **COMPLETED** | 100% |
| **Phase 2** | Private Rooms & Realtime Presence | **COMPLETED** | 100% |
| **Phase 3** | Video Distribution & File Verification | Up Next | 0% |
| **Phase 4** | Ready-to-Watch System | Pending | 0% |
| **Phase 5** | Synchronized Video Player | Pending | 0% |
| **Phase 6** | Episode Queue & Auto-Next | Pending | 0% |
| **Phase 7** | Text Chat & WebRTC Voice | Pending | 0% |
| **Phase 8** | Watch-Room Polish & Customization | Pending | 0% |
| **Phase 9** | Testing, Security & Free Deployment | Pending | 0% |

---

## 3. Completed Features

### Phase 1: Foundation & UI Design System
- [x] Modular monolith project scaffolding (`backend`, `frontend`, `storage/videos`, `storage/uploads_temp`, `docs`, `scripts`).
- [x] Zero-cost infrastructure verification and documentation.
- [x] Database models: `Room`, `Participant`, `Episode`, `Message` with SQLAlchemy 2.0 Async + SQLite (`aiosqlite`).
- [x] 6-character room codes and 64-hex-char guest session authentication.
- [x] Japanese-inspired dark mode UI design system with Tailwind CSS tokens and component library.
- [x] Landing page, Create Room modal, Join Room modal, and Watch Room dashboard.
- [x] `./scripts/start.sh`, `./scripts/stop.sh`, and `./scripts/test.sh` automation scripts.

### Phase 2: Private Rooms & Realtime Presence
- [x] **python-socketio ASGI Integration**: AsyncServer mounted via `socketio.ASGIApp` wrapping FastAPI, supporting both WebSocket transport and HTTP endpoints.
- [x] **Authoritative Guest Session Authentication**: Sockets connecting to `join_room` must present valid `(room_code, participant_id, session_token)` verified against SQLite. Unauthorized sockets receive `AUTH_FAILED` and are rejected.
- [x] **Strict Channel Isolation**: Room events broadcast only to authorized participants entered in `sio.enter_room(sid, room_code)`.
- [x] **Multi-Tab & Duplicate Connection Handling**: Implemented `ConnectionManager` tracking `(room_code, participant_id) -> Set[sid]`. Multiple open tabs represent a single logical user (`Online (2 tabs)`). Disconnecting one tab preserves online state; disconnecting all tabs marks the user offline.
- [x] **Real-Time Presence Handlers**: `join_room`, `leave_room`, `disconnect`, `user_joined`, `user_left`, `presence_updated`.
- [x] **Frontend `useSocket` Hook**: Connection state tracking (`connecting`, `connected`, `disconnected`, `reconnecting`, `error`), automatic re-auth on reconnect, and event cleanup.
- [x] **Live Room Lobby UI**:
  - Live socket connection status indicator (Realtime Active / Connecting / Offline).
  - Real-time participant cards with initials avatar, host badge, online pulse indicator, and active tab counts.
  - Graceful join modal prompt for users opening shared room links.
  - Real-time error banner with one-click reconnect trigger.

---

## 4. In-Progress Features
- Transitioning to **Phase 3: Video Distribution & File Verification**.

---

## 5. Pending Features
- Phase 3: 5MB chunked video upload, disk storage, range-based download, Web Worker SHA-256 calculation.
- Phase 4: Ready-to-Watch state machine, verification validation, synchronized countdown.
- Phase 5: HTML5 local video player, server-authoritative sync, adaptive drift correction, buffering recovery.
- Phase 6: Room queue, intermission screen, auto-next flow.
- Phase 7: Text chat, WebRTC P2P voice with Google STUN, Push-to-Talk (`V`), independent audio gains.
- Phase 8: Discord-inspired collapsible watch-room sidebar, fullscreen autohide, external subtitles, storage cleanup.
- Phase 9: End-to-end testing, security audits, Cloudflare Quick Tunnel integration.

---

## 6. Known Bugs & Issues
- None.

---

## 7. Tests Performed & Passing
- `backend/tests/test_rooms.py::test_health_check` — **PASSED**
- `backend/tests/test_rooms.py::test_spa_serving` — **PASSED**
- `backend/tests/test_rooms.py::test_room_lifecycle` — **PASSED**
- `backend/tests/test_presence.py::test_two_participants_join_same_room` — **PASSED**
- `backend/tests/test_presence.py::test_room_isolation_different_rooms` — **PASSED**
- `backend/tests/test_presence.py::test_unauthorized_room_access` — **PASSED**
- `backend/tests/test_presence.py::test_multiple_tabs_and_duplicate_connections` — **PASSED**
- `backend/tests/test_presence.py::test_unexpected_disconnect_and_reconnection` — **PASSED**
- `backend/tests/test_presence.py::test_explicit_leave_room` — **PASSED**
- `npm run build` (TypeScript compilation & Vite bundle) — **PASSED** (2108 modules transformed, 0 errors)
- Execution of master `./scripts/test.sh` — **PASSED** (All 9 tests + Vite build)

---

## 8. Exact Next Task
- **Phase 3 Implementation**:
  1. Build Chunked Upload API (`/api/files/upload/init`, `/api/files/upload/chunk`, `/api/files/upload/complete`) using 5MB chunks and safe storage in `storage/videos/`.
  2. Implement server-side incremental SHA-256 hash generation during upload finalization.
  3. Implement range-based file download endpoint (`/api/files/download/{id}`).
  4. Build Client-side Upload UI with chunk progress and cancel/resume capability.
  5. Build Client-side Download UI with byte progress.
  6. Implement Web Worker streaming SHA-256 calculator for locally selected files.
  7. Implement `verify_file` socket event for server-authoritative hash validation against database.

---

## 9. Important Decisions Logged
- **ADR-008**: Multi-Tab Socket Tracking & Room Membership Reconciliation (`ConnectionManager` tracks `(room_code, participant_id) -> Set[sid]`).
- Python-SocketIO mounted via `socketio.ASGIApp` wrapping FastAPI, maintaining transparent ASGI 3 pass-through for HTTP endpoints and static SPA delivery.
- Sockets must authenticate with database-backed session tokens before entering rooms.
