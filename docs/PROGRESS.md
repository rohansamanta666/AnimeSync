# AnimeSync — Project Progress

## 1. Project Status Overview
- **Current Phase**: Phase 5 (Synchronized Video Player) — **IN PROGRESS (Tasks 5.1, 5.2, 5.3 Completed)**
- **Next Task**: Phase 5 Task 5.4 (Adaptive Drift Correction Engine)
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
| **Phase 4** | Ready-to-Watch System | **COMPLETED** | 100% |
| **Phase 5** | Synchronized Video Player | **IN PROGRESS** | 90% |
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

### Phase 4: Ready-to-Watch System
- [x] **Server-Authoritative Ready Gate**:
  - `set_ready` Socket.IO handler strictly validates that `participant.status == VERIFIED` in the database.
  - Rejects premature ready declarations with `ready_rejected` event (`reason: NOT_VERIFIED`).
  - Transitions participant to `READY` and updates presence room-wide in real time.
- [x] **Ready Cancellation & Reversion**:
  - `set_unready` Socket.IO handler allows participants to withdraw readiness, cleanly reverting their state back to `VERIFIED`.
  - Instantly aborts any active room countdown and alerts the room with `countdown_cancelled`.
- [x] **Server-Coordinated Synchronized Countdown**:
  - Authoritative check `_all_online_participants_ready`: verifies every connected online participant is `READY` (safely ignoring disconnected viewers).
  - Emits `countdown_started` with exact target UNIX start timestamp (`target_start_timestamp = time.time() + 3.0`).
  - Background async task `_run_countdown` waits 3.0s, atomically transitions all `READY` participants to `WATCHING`, and emits `playback_start`.
- [x] **Disconnection & Departure Safety**:
  - If any participant disconnects or leaves during countdown, the countdown is automatically cancelled (`countdown_cancelled`).
- [x] **Readiness Invalidation on New Video**:
  - Server function `invalidate_room_readiness` resets all non-watching participants back to `WAITING_FOR_FILE`, clears `verified_file_hash`, cancels countdowns, and broadcasts `episode_changed`.
  - Automatically triggered when the host uploads a new episode via `POST /api/files/upload/complete`.
- [x] **Frontend Ready-to-Watch UI**:
  - `useReadyState` custom hook managing socket events, local state, and smooth `requestAnimationFrame` countdown ticker.
  - `CountdownOverlay` full-screen ambient animation with glowing rings, second-by-second pop animations, and cancellation shortcut.
  - Dynamic "I'm Ready" / "Cancel Ready" toggle button in `RoomPage` with status validation tooltip and error banner.
  - `PlaybackStartedBanner` confirming synchronized start before Phase 5 player launch.

### Phase 5: Synchronized Video Player (In Progress)
- [x] **Task 5.1: Custom HTML5 Video Player Component (`VideoPlayer.tsx`)**:
  - Direct local file playback using `URL.createObjectURL(file)` without streaming from server.
  - Safe memory cleanup: automatic `URL.revokeObjectURL(url)` on file change or unmount.
  - Japanese dark theme custom controls overlay: Play/Pause, 10s forward/backward seek, scrubber timeline, time display (`mm:ss`/`hh:mm:ss`), volume slider, mute toggle, playback rate selector (`0.5x` to `2.0x`), and native fullscreen toggle.
  - Central action flash indicator on play/pause and auto-hiding controls (2.5s mouse inactivity).
  - Keyboard shortcuts: Space (play/pause), ArrowLeft/Right ($\pm 5$s seek), ArrowUp/Down ($\pm 10\%$ volume), `M` (mute), `F` (fullscreen).
  - Codec error detection with graceful fallback notification and local re-selection button.
  - Imperative handle `VideoPlayerHandle` (`play`, `pause`, `seek`, `setPlaybackRate`, `getCurrentTime`, `getDuration`, `isPaused`, `getVideoElement`) for sync engine integration.
  - Integrated into `RoomPage.tsx` with automatic file binding from `EpisodeVerificationCard.onFileVerified`.
- [x] **Task 5.2: Server Playback State Machine (`playback_manager.py` & `server.py`)**:
  - In-memory `RoomPlaybackState` tracking `room_code`, `is_playing`, `current_time`, `playback_speed`, `updated_at`, and `sequence_number`.
  - Authoritative time advancement calculation (`compute_current_time`) advancing position only while `is_playing == True`.
  - Socket.IO `playback_action` handler supporting and strictly validating `PLAY`, `PAUSE`, `SEEK`, and `RATE_CHANGE`.
  - Validation rules: rejects non-string actions, negative seek timestamps, missing parameters, and out-of-bounds rates ($[0.25, 4.0]$).
  - Room isolation and authentication validation: checks active session, verifies room code match, and rejects cross-room control attempts.
  - Readiness gate: rejects playback commands from participants who have not verified their local file (`WAITING_FOR_FILE`, `VERIFYING`, `VERIFICATION_FAILED`).
  - Authoritative broadcast: emits `playback_sync` with updated state, monotonic `server_sequence`, and `originating_socket_id` so senders can ignore self-echoes.
- [x] **Task 5.3: Client-to-Server Controls & Sequence Number Loop Prevention (`useVideoSync.ts`)**:
  - Binds `VideoPlayer` controls (Play, Pause, Seek, Speed) directly to backend `playback_action` emissions.
  - Self-echo suppression: checks incoming `playback_sync.originating_socket_id === socket.id` and ignores own actions to eliminate feedback loops.
  - Sequence number ordering: ignores stale or duplicate updates (`incomingSeq <= lastAppliedSeq`).
  - Programmatic event suppression (`isApplyingRemoteRef` & `isRemoteActionRef`): prevents remote handle calls (`play()`, `pause()`, `seek()`) from re-triggering outgoing socket events.
  - Real-time sync feedback badge (`Sync #Seq (ACTION)`) displayed in the room lobby bar.
  - Fully verified across multi-client simulated watch parties.
- [x] **Task 5.4: Adaptive Playback Drift Correction Engine (`drift.ts` & `useVideoSync.ts`)**:
  - Dedicated drift service `frontend/src/services/drift.ts` implementing authoritative timeline formulas, signed drift measurement, and tiered threshold evaluation.
  - Authoritative time computation: advances timeline based on server `updated_at` (or local receive timestamp) and authoritative `playback_speed`.
  - Tiered correction engine:
    - **Drift < 0.25s**: Within tolerance. Do nothing; if previously nudging, smoothly restores user's intended playback speed.
    - **0.25s to < 1.5s (Micro-Drift)**: Applies temporary ±5% playback speed adjustment (`intendedRate * 1.05` when local is behind; `intendedRate * 0.95` when local is ahead).
    - **Drift >= 1.5s (Macro-Drift)**: Immediately hard-seeks directly to authoritative timestamp and restores intended rate.
  - 2-second periodic evaluation timer (`DRIFT_CHECK_INTERVAL_MS = 2000`) active only during active playback.
  - Paused playback handling: strictly avoids rate adjustments while paused, and restores intended speed if paused while nudging.
  - Inactivity cooldown (`DRIFT_ACTION_COOLDOWN_MS = 1200ms`): suppresses drift checks immediately following manual or remote playback actions to allow transitions to settle.
  - Programmatic execution lock (`isApplyingRemoteRef.current = true`): ensures drift adjustments (rate change or seek) NEVER emit outgoing `playback_action` socket events, preventing cascade feedback loops.
  - Drift observability telemetry: hook returns `driftSeconds` and `isNudging`; `RoomPage.tsx` displays live amber drift correction badge (`Syncing drift (XXXms)`).
  - 20 unit tests in `frontend/tests/drift.test.ts` verifying all thresholds, edge cases, pause behaviours, and custom playback rates.
- [x] **Task 5.5: Buffering Detection & Recovery (`VideoPlayer.tsx`, `playback_manager.py`, `server.py`, `useVideoSync.ts`)**:
  - Buffering event detection: `VideoPlayer.tsx` captures HTML5 `<video>` events `waiting`, `stalled`, `canplay`, and `playing`, debounced locally via `isLocalBufferingRef`.
  - Server-authoritative buffering manager: `PlaybackManager` tracks `buffering_participants` per room and coordinates `paused_for_buffering` state.
  - Server-coordinated shared pause: when any active participant buffers during playback, server transitions state to paused, increments sequence, and broadcasts `playback_sync(action="PAUSE", reason="buffering")` and `buffering_update`.
  - Multi-participant buffering coordination: if multiple viewers buffer concurrently, room remains paused until the LAST buffering viewer finishes.
  - Authoritative resume broadcast: when all participants finish buffering, server emits `playback_sync(action="PLAY", originating_socket_id="server", reason="buffering_resolved")` so all clients start together in lockstep.
  - Automatic disconnect recovery: if a buffering participant disconnects or leaves, server clears their buffering hold and resumes playback for remaining viewers.
  - Manual override safety: explicit user PAUSE or PLAY clears `paused_for_buffering`, respecting intentional user commands.
  - Feedback loop prevention: `useVideoSync` suppresses drift evaluation during room buffering (`isRoomBuffering`).
  - Buffering UI: Japanese dark theme spinner overlay on video stage displaying `Buffering: [usernames]`, plus pulsing status pill in room header.
  - 7 automated tests added in `backend/tests/test_sync.py` covering buffering start/end, multi-client coordination, paused buffering, manual pause overrides, disconnect recovery, and unverified rejection.

---

## 4. In-Progress Features
- **Phase 5: Synchronized Video Player**:
  - Task 5.1: Completed.
  - Task 5.2: Completed.
  - Task 5.3: Completed.
  - Task 5.4: Completed.
  - Task 5.5: Completed.
  - Task 5.6: Up next (Manual Resync Button & Sync Health UI).

---

## 5. Pending Features
- Task 5.6: Resync button and Sync Health UI (latency, drift ms, sync badge).
- Task 5.7: Playback sync verification under simulated latency and packet drops.
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
- `backend/tests/test_ready_state.py` (8 tests) — **PASSED**
- `backend/tests/test_sync.py` (22 tests) — **PASSED**
  - `test_playback_manager_initial_state`: Initial state defaults.
  - `test_playback_manager_play_action`: PLAY action updates is_playing and sequence.
  - `test_playback_manager_pause_action`: PAUSE action updates is_playing and records position.
  - `test_playback_manager_seek_action`: SEEK action updates current_time to non-negative target.
  - `test_playback_manager_rate_change`: RATE_CHANGE action updates speed within [0.25, 4.0].
  - `test_playback_manager_invalid_actions_and_values`: Rejection of invalid action strings, negative timestamps, out-of-bounds rates.
  - `test_playback_manager_time_progression`: Authoritative time progression calculation while playing vs static position while paused.
  - `test_socket_playback_action_unauthenticated`: Rejection of unauthenticated socket connections.
  - `test_socket_playback_action_room_isolation_mismatch`: Rejection of commands with mismatched room_code (room isolation).
  - `test_socket_playback_action_readiness_gate_rejection`: Readiness gate enforcement (rejecting unverified participants).
  - `test_socket_playback_action_play_pause_seek_rate_lifecycle`: Full socket event lifecycle verifying `playback_sync` broadcast with `originating_socket_id` and monotonic sequence numbers.
  - `test_two_participants_playback_sync_and_echo_suppression`: Two-client watch party simulation verifying echo suppression via `originating_socket_id` and non-originating client application.
  - `test_cross_room_playback_isolation`: Strict channel isolation ensuring Room 1 playback broadcasts are never delivered to Room 2.
  - `test_get_playback_state_socket_handler`: Direct authoritative playback state querying via Socket.IO.
  - `test_authoritative_drift_formula_consistency`: Validates server authoritative time matches client drift thresholds.
  - `test_playback_manager_buffering_coordination_and_recovery`: Unit test for shared pause on buffer and resume when all ready.
  - `test_playback_manager_buffering_while_paused_no_autoresume`: Buffering while paused does not trigger auto-resume.
  - `test_playback_manager_manual_pause_overrides_buffering_resume`: User manual pause cancels auto-resume.
  - `test_socket_buffering_start_and_end_lifecycle`: Full Socket.IO buffering start and end lifecycle.
  - `test_socket_buffering_multiple_participants_coordination`: Multi-participant buffering coordination (resumes only when last viewer ready).
  - `test_socket_buffering_disconnect_recovery`: Disconnect during buffering automatically resumes remaining viewers.
  - `test_socket_buffering_unverified_rejected`: Unverified participant cannot trigger buffering coordination.
- `frontend/tests/drift.test.ts` (20 unit tests) — **PASSED**
- `npm run build` (TypeScript compilation & Vite bundle) — **PASSED** (2117 modules transformed, 0 errors)
- Master test runner `./scripts/test.sh` — **PASSED** (All 42 backend tests + 20 frontend unit tests + Vite build)

---

## 8. Exact Next Task
- **Phase 5 Task 5.6: Implement Manual Resync Button & Sync Health UI**:
  1. Add "Resync" button to player controls to manually fetch authoritative server state and hard-seek if needed.
  2. Implement Sync Health badge displaying live latency (ping/pong round-trip) and measured drift.
  3. Provide quick visual confirmation of sync status ("Synced", "Nudging", "Buffering").

---

## 9. Important Decisions Logged
- **Chunked Upload 5MB limit**: Guarantees zero failures over Cloudflare free tunnel proxy.
- **Incremental SHA-256 in 64KB blocks**: Keeps host RAM consumption at $O(1)$ during video assembly.
- **Client Web Worker Hashing in 4MB slices**: Guarantees browser main thread remains at 60fps without lag.
- **Server-Authoritative Ready Gate**: Prevents unverified viewers from desynchronizing playback.
- **Online-Only Readiness Calculation**: Offline or departed participants do not permanently block active viewers.
- **Direct Local Playback with URL.createObjectURL**: Video streams 100% locally from disk without passing video bytes through the server or tunnel proxy.
- **Server-Authoritative Playback State Machine with Originating Socket ID**: `RoomPlaybackState` manages the single source of truth for time, speed, and play/pause state; broadcasting `originating_socket_id` eliminates feedback loops.
- **Quadruple-Layered Loop Prevention**: `originating_socket_id` matching + monotonic sequence numbering + `isApplyingRemoteRef` hook guard + `isRemoteActionRef` player handle lock prevents any feedback loops during remote sync.
- **Tiered Adaptive Playback Drift Correction**: Micro-drift ($0.25$s to $1.5$s) uses imperceptible $\pm 5\%$ speed nudges, completely avoiding jarring audio stutters or seeks; macro-drift ($\ge 1.5$s) immediately seeks. Intended speed is faithfully restored upon re-alignment.
- **Server-Coordinated Buffering with Disconnect Recovery**: Shared pause triggered when any viewer buffers; playback resumes authoritatively with `originating_socket_id="server"` when all buffering viewers finish. Disconnecting viewers are automatically cleared so remaining viewers are never stalled indefinitely.
