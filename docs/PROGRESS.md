# AnimeSync — Project Progress

## 1. Project Status Overview
- **Current Phase**: Phase 3 (Video Distribution & File Verification) — **COMPLETED**
- **Next Phase**: Phase 4 (Ready-to-Watch System)
- **Overall Health**: Healthy
- **Target OS**: macOS (Apple Silicon & Intel)
- **Zero-Cost Compliance**: 100% verified (Local storage, SQLite, WebRTC P2P + Google STUN, Cloudflare Quick Tunnel / Tailscale)

---

## 2. Feature Tracking Matrix

| Phase | Description | Status | Completion % |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Foundation & UI Design System | **COMPLETED** | 100% |
| **Phase 2** | Private Rooms & Realtime Presence | **COMPLETED** | 100% |
| **Phase 3** | Video Distribution & File Verification | **COMPLETED** | 100% |
| **Phase 4** | Ready-to-Watch System | Up Next | 0% |
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
- [x] `python-socketio` AsyncServer mounted via `socketio.ASGIApp` wrapping FastAPI.
- [x] Authenticated guest socket sessions validated against database.
- [x] Strict room channel isolation.
- [x] Multi-tab connection tracking with `ConnectionManager` (`Online (2 tabs)`).
- [x] Real-time presence handlers: `join_room`, `leave_room`, `disconnect`, `user_joined`, `user_left`, `presence_updated`.
- [x] Frontend `useSocket` hook with auto-reconnection and event cleanup.
- [x] Live Room Lobby UI with connection status and online participant presence.

### Phase 3: Video Distribution & File Verification
- [x] **5MB Chunked Resumable Upload API**:
  - `POST /api/files/upload/init`: Prepares upload session, validates file size limits (default 4GB), and calculates chunk count.
  - `POST /api/files/upload/chunk`: Saves individual 5MB chunks to `storage/uploads_temp/{id}/chunks/`. Bypasses Cloudflare 100MB body cap.
  - `GET /api/files/upload/{upload_id}/status`: Provides received chunks list for upload resumption.
  - `POST /api/files/upload/complete`: Validates that all chunks are present, streams chunk assembly sequentially, and creates `Episode` record.
  - `POST /api/files/upload/{upload_id}/cancel`: Cleans up temp files and frees disk space.
- [x] **Incremental Server-Side Checksumming**:
  - Python `hashlib.sha256()` updated incrementally in 64KB blocks during chunk assembly.
  - Multi-gigabyte videos are never loaded into server RAM.
- [x] **Resumable Range-Based Download API**:
  - `GET /api/files/download/{episode_id}` with full HTTP Range request support (`Range: bytes=start-end`).
  - Streams bytes in 64KB buffers (`206 Partial Content` and `Accept-Ranges: bytes`).
  - Strict room authorization validation preventing unauthorized cross-room file downloads.
- [x] **Path Traversal & Unsafe Filename Guards**:
  - Sanitizes filenames, strips directory components, and restricts files to `storage/videos/`.
- [x] **Browser-Side Streaming SHA-256 Web Worker**:
  - Pure TypeScript `StreamingSHA256` implementation running in dedicated `sha256.worker.ts`.
  - Reads local `File` in 4MB slice buffers; maintains $O(1)$ memory without UI freeze or page crashes.
  - Verified against Node.js crypto test vectors.
- [x] **Authoritative Server Verification (`verify_file`)**:
  - Validates client's computed hash and file size against the server's database record.
  - Updates participant status to `VERIFIED` on match or `VERIFICATION_FAILED` on mismatch.
  - Broadcasts updated presence to the room in real time.
- [x] **Phase 3 Frontend Components**:
  - `EpisodeUploadModal`: Chunked upload progress bar, chunk counter, and cancellation.
  - `EpisodeVerificationCard`: Episode metadata, range-request download button, file picker, live Web Worker verification progress bar, and instant verified/mismatch status banners.

---

## 4. In-Progress Features
- Transitioning to **Phase 4: Ready-to-Watch System**.

---

## 5. Pending Features
- Phase 4: Ready-to-Watch state machine, verification validation, ready/unready toggle, synchronized countdown.
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
- `backend/tests/test_rooms.py` (3 tests) — **PASSED**
- `backend/tests/test_presence.py` (6 tests) — **PASSED**
- `backend/tests/test_upload.py` (3 tests) — **PASSED**
  - `test_chunked_upload_assembly_and_sha256`: 3 chunks uploaded, assembled, incremental SHA-256 validated, range download 206 verified, and socket file verification tested.
  - `test_missing_chunk_finalize_rejection`: Finalize rejected if chunks are missing.
  - `test_unauthorized_download_prevention`: Cross-room file downloads rejected with 403 Forbidden.
- `npm run build` (TypeScript compilation & Vite bundle) — **PASSED** (2111 modules transformed, 0 errors)
- Master test runner `./scripts/test.sh` — **PASSED** (All 12 backend tests + Vite build)

---

## 8. Exact Next Task
- **Phase 4 Implementation**:
  1. Formalize authoritative Ready-to-Watch state machine transitions on server.
  2. Implement `set_ready` / `set_unready` Socket.IO events with strict server-side validation (`status == VERIFIED`).
  3. Invalidate readiness if episode is replaced or participant selects a different file.
  4. Implement server-coordinated 3-second synchronized countdown timer (`countdown_started`, `target_start_timestamp`).
  5. Build Ready-to-Watch UI controls and countdown overlay in frontend.

---

## 9. Important Decisions Logged
- **Chunked Upload 5MB limit**: Guarantees zero failures over Cloudflare free tunnel proxy.
- **Incremental SHA-256 in 64KB blocks**: Keeps host RAM consumption at $O(1)$ during video assembly.
- **Client Web Worker Hashing in 4MB slices**: Guarantees browser main thread remains at 60fps without lag.
