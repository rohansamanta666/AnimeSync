# AnimeSync — Project Progress

## 1. Project Status Overview
- **Current Phase**: Phase 8 (Watch-Room Polish & UI/UX Experience) — **COMPLETED (100%)**
- **Next Task**: **Phase 9 — Task 9.1: Comprehensive End-to-End Multi-User Testing & Edge Case Scenarios**
- **Git Branch**: `main`
- **Latest Commit**: `912be5c` (`feat(phase-8): implement external subtitles and media management dashboard (tasks 8.5-8.6)`)
- **Overall Health**: Healthy & Clean (0 failing tests, 0 TypeScript errors)
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
| **Phase 5** | Synchronized Video Player | **COMPLETED** | 100% |
| **Phase 6** | Episode Queue & Auto-Next | **COMPLETED** | 100% |
| **Phase 7** | Text Chat & WebRTC Voice | **COMPLETED** | 100% |
| **Phase 8** | Watch-Room Polish & Customization | **COMPLETED** | 100% |
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
- [x] **Task 5.6: Manual Resync & Sync Health UI (`SyncHealthBadge.tsx`, `useVideoSync.ts`, `VideoPlayer.tsx`, `RoomPage.tsx`, `server.py`)**:
  - Dedicated `SyncHealthBadge` component displaying real-time synchronization diagnostics:
    - Four clear status states: **Synced** (emerald glowing dot), **Nudging** (amber micro-drift adjustment), **Buffering** (pulsing violet spinner), and **Paused** (dim zinc dot).
    - Live round-trip network latency measurement (`Ping: XXms`).
    - Live signed playback drift offset (`Drift: ±XXms`).
    - One-click manual Resync button with rotation animation.
  - Video player integration: Resync button placed in bottom controls bar, compact `SyncHealthBadge` in top header overlay, and global badge in RoomPage watch bar. Keyboard shortcut `Shift+R` for rapid alignment.
  - Authoritative resync engine `handleResync`: queries latest state via `get_playback_state`, calculates target alignment via `calculateResyncTarget`, and hard-seeks/resets player without triggering feedback loops (`isApplyingRemoteRef.current = true`).
  - Buffering and paused state preservation: If the room is paused or buffering, manual resync aligns playback position but keeps the player paused, avoiding premature playback.
  - Application-level heartbeat ping `ping_check` socket handler measuring accurate WebSocket round-trip time.
  - 4 automated backend tests in `test_sync.py` covering ping measurement, resync during active playback, resync while paused, and resync during buffering.
  - 10 automated frontend unit tests in `sync_health.test.ts` covering status resolution, ping calculation, and resync target alignment.

### Phase 6: Episode Queue & Auto-Next Workflow
- [x] **Task 6.1: Room Episode Queue Data Model & API/Socket Events (`QueueManager`, `rooms.py`, `server.py`)**:
  - `QueueManager` service providing contiguous queue ordering, addition, deletion with index compaction, reordering, and next episode queries.
  - REST endpoints: `GET /api/rooms/{code}/queue`, `PUT /api/rooms/{code}/queue/reorder`, `DELETE /api/rooms/{code}/queue/{id}`, `POST /api/rooms/{code}/queue/select` with host-only authorization enforcement.
  - Socket.IO handlers: `get_queue`, `reorder_queue`, `remove_from_queue`, `select_episode` with real-time `queue_updated` broadcasts.
- [x] **Task 6.2: Episode Queue UI (`EpisodeQueue.tsx`, `useEpisodeQueue.ts`, `RoomPage.tsx`)**:
  - Japanese dark theme queue list showing upcoming episodes in order with position badges (#1, #2...), file size, and "Playing" status indicator.
  - Host controls: Move Up / Move Down reordering buttons, "Play Now" episode switcher, and deletion buttons.
  - Peer controls: Download button for upcoming episodes so friends can download future episodes ahead of time.
  - Optimistic client-side updates with instant fallback and error resilience.
- [x] **Task 6.3: Video `ended` Coordination with Duplicate Protection (`playback_manager.py`, `server.py`)**:
  - Capture HTML5 `<video>` `ended` event across participants and emit `playback_ended`.
  - Authoritative duplicate protection: `playback_manager.record_episode_ended` uses a 15-second cooldown to deduplicate concurrent emissions from multiple clients so intermission is triggered exactly once.
- [x] **Task 6.4: Intermission Screen (`IntermissionOverlay.tsx`, `server.py`)**:
  - Ambient full-stage intermission overlay when video ends.
  - Displays "Episode Complete!", up next episode metadata preview (title, season, episode, size), and ticking 15s countdown with progress bar.
  - Host controls: "Play Next Now" (skips countdown via `skip_intermission`) and "Stay on Current" (cancels countdown via `cancel_intermission`).
  - Automatic celebration banner when all queued episodes finish (`queue_finished`).
- [x] **Task 6.5: Auto-Next Readiness Reset Enforcement (`server.py`, `RoomPage.tsx`)**:
  - When auto-advancing to the next episode, `invalidate_room_readiness` resets all participants (including `WATCHING`) back to `WAITING_FOR_FILE` and clears verified file hashes.
  - Unloads previous video file locally (`setLocalVideoFile(null)`).
  - Guarantees that neither participant can mark Ready or begin synchronized playback until the new episode's SHA-256 hash is computed and verified.

### Phase 7: Text Chat & WebRTC Voice System
- [x] **Task 7.1: Real-Time Text Chat with Message Persistence & Input Sanitization (`chat_service.py`, `rooms.py`, `server.py`, `useChat.ts`, `ChatPanel.tsx`)**:
  - Server-side `ChatService` with HTML tag stripping, null byte removal, length boundary validation (1–1000 characters), and HTML entity escaping.
  - Database persistence: saves messages to SQLite `messages` table via async SQLAlchemy sessions.
  - REST endpoints: `GET /api/rooms/{code}/messages` (retrieves recent message history) and `POST /api/rooms/{code}/messages` (authenticated message creation).
  - Real-time Socket.IO events: `send_message` and `get_messages`, broadcasting `new_message` to room participants.
  - Frontend `useChat` hook: provides message history, optimistic chat updates, and client-side sanitization.
  - `ChatPanel.tsx` UI: auto-scrolling message list, Japanese dark mode styling, sender badges (Host vs Peer, You vs Peer), timestamps, error notices, and char counter.
- [x] **Task 7.2: WebRTC Voice Signaling through Socket.IO (`voice_manager.py`, `server.py`, `useWebRTCVoice.ts`)**:
  - In-memory `VoiceManager` tracking active voice participants per room and mute states.
  - Mesh signaling events: `voice_join`, `voice_leave`, `voice_offer`, `voice_answer`, `voice_ice_candidate`, and `voice_mute_toggle`.
  - Targeted delivery of offers, answers, and ICE candidates using `target_socket_id`.
  - Disconnect cleanup: removes departed participants from voice room and emits `voice_peer_left`.
- [x] **Task 7.3: Free Google Public STUN NAT Traversal (`webrtc.ts`)**:
  - Standard zero-cost `RTC_CONFIG` using Google public STUN servers (`stun:stun.l.google.com:19302` through `stun4`).
  - Strict zero-cost compliance: operates with no paid TURN servers. Notice: STUN works across standard domestic NATs and home LANs, while restrictive symmetric enterprise firewalls would require TURN in cloud deployments.
- [x] **Task 7.4: Voice Controls, Permissions & Speaking Indicators (`VoiceControlBar.tsx`, `useWebRTCVoice.ts`)**:
  - Join/Leave voice channel controls with visual connection states.
  - Microphone mute/unmute toggle with hardware track muting and room mute event broadcasting.
  - Live speaking detection using Web Audio API `AnalyserNode` calculating root-mean-square (RMS) amplitude over time domain bytes.
  - Glowing speaking indicator rings around avatars in voice list and sidebar tab badges.
  - Microphone device enumeration and dynamic input device selection (`enumerateDevices` & `getUserMedia({ deviceId: { exact } })`).
  - Comprehensive microphone permission error handling and inline retry UI.
- [x] **Task 7.5: Push-to-Talk (PTT) with Key Shortcut `V` (`useWebRTCVoice.ts`)**:
  - Voice mode selector: switchable between "Voice Activity" and "Push-to-Talk".
  - Key shortcut `V`: microphone track is unmuted only while key `V` is pressed down.
  - Triple Keyup Safety Guarantees:
    - Normal `keyup` event releases microphone immediately.
    - Window `blur` event automatically mutes microphone if window loses focus.
    - Document `visibilitychange` event mutes microphone if browser tab is switched or minimized.
  - Input field suppression: `isTypingElement` inspects target element so typing `v` in text inputs or chat never activates the microphone.
  - Manual mute precedence: if the user explicitly clicks Mute, pressing `V` does not transmit audio.
- [x] **Task 7.6: Independent Anime & Peer Audio Pipeline (`webrtc.ts`, `useWebRTCVoice.ts`, `VoiceControlBar.tsx`)**:
  - Completely independent audio architecture:
    - Anime soundtrack volume is controlled directly on native HTML5 `<video>` element.
    - Remote peer voices are routed through Web Audio API: `AudioContext -> MediaStreamAudioSourceNode -> AnalyserNode -> GainNode -> destination`.
  - Independent peer volume slider (0% to 200%) mapping volume percent directly to Web Audio `GainNode.gain.value` (0.0 to 2.0).
  - Local peer mute toggle: allows muting the remote peer locally in headphones without disabling their microphone or affecting the anime soundtrack.

### Phase 8: Watch-Room Polish & UI/UX Experience (100% Completed)
- [x] **Task 8.1: Discord-Inspired Collapsible Watch-Room Sidebar (`RoomPage.tsx`)**:
  - Implemented collapsible communication & playlist sidebar with smooth 300ms CSS transitions.
  - Header toggle button with dynamic icons (`PanelRightClose` / `PanelRightOpen`) and tooltips.
  - Responsive dynamic grid layout: when sidebar is collapsed, the watch stage smoothly expands to 100% full width (`lg:col-span-1` of 1-column layout, replacing `lg:col-span-2` of 3-column layout).
  - Floating action pill button on bottom-right when collapsed, displaying live unread chat count badges and voice speaking ripples for 1-click restore.
  - Global keyboard shortcuts: `[` or `]` toggles sidebar collapse/expand anytime.
- [x] **Task 8.2: Participant Profile Popover with Voice Volume Slider & Local Mute (`ParticipantProfileModal.tsx`, `RoomPage.tsx`)**:
  - Discord-inspired modal popover triggered by clicking any participant avatar or member row.
  - Displays avatar with gradient and online status indicator, username, host/guest role, connection status (`Online (X tabs)` / `Offline`, `Last seen`), and ready-to-watch verification badge.
  - Remote peer controls: individual local voice volume slider ($0\%$ to $200\%$) and local peer mute toggle button (zeros out local gain without affecting peer's physical mic).
  - Quick action: "Send Message" jumps directly to chat tab and opens sidebar.
- [x] **Task 8.3: Fullscreen Player with Hidden Overlays & Slide-Over Communication Drawer (`VideoPlayer.tsx`, `RoomPage.tsx`)**:
  - Fullscreen communication drawer: unobtrusive `💬 Chat & Voice` button in top video overlay opens a frosted slide-over communication drawer inside fullscreen without exiting fullscreen.
  - Fullscreen drawer embeds ChatPanel, VoiceControlBar, and clickable member list.
  - Inactivity cursor & controls autohide: mouse inactivity for 2.5s hides controls and sets `cursor: none`; mouse movement instantly restores controls and cursor.
  - Auto-hide lock: when communication drawer is open, auto-hide is paused so typing and interacting with chat/voice is seamless.
  - Theater Mode: `Tv` button in bottom controls bar and `T` keyboard shortcut expands the player stage to 98vw cinematic width.
- [x] **Task 8.4: Keyboard Shortcuts & Cheat Sheet Modal (`KeyboardShortcutsModal.tsx`, `playerUtils.ts`, `VideoPlayer.tsx`, `RoomPage.tsx`)**:
  - Standardized keyboard shortcut matrix:
    - Playback: `Space` (play/pause), `← / →` (seek ±5s), `↑ / ↓` (volume ±10%), `M` (mute), `F` (fullscreen), `T` (theater mode), `S` (toggle subtitles), `Shift + R` (resync).
    - Communication: `V` (Push-to-Talk), `C` (toggle fullscreen communication drawer).
    - Workspace: `[` / `]` (collapse/expand sidebar), `?` (help modal), `Esc` (dismiss overlays/modals).
  - Global shortcut listener with strict `isTypingElement` protection preventing accidental trigger when typing in chat or input fields.
  - Japanese-aesthetic `KeyboardShortcutsModal` displaying all categorized keybindings with keyboard keycaps (`kbd`).
- [x] **Task 8.5: External Subtitle Support (`subtitles.ts`, `subtitles.test.ts`, `VideoPlayer.tsx`)**:
  - Client-side parser for `.srt` (SubRip) and `.vtt` (WebVTT) subtitle formats with automatic detection.
  - Robust timing parsing supporting 3-part comma (`01:02:03,500`), 3-part dot (`01:02:03.500`), and 2-part short format (`02:03.500`).
  - Cue text sanitizer stripping HTML tags (`<i>`, `<b>`, `<c.color>`) and ASS/SSA positioning tags (`{\an8}`) while preserving dialogue.
  - Microsecond active cue lookups (`findActiveCues`) synchronized to local HTML5 video playback.
  - Subtitle customization popover:
    - Quick enable/disable toggle and keyboard shortcut `S`.
    - Local file loader and cue counter indicator.
    - Font size selection: S (18px), M (22px), L (26px), XL (32px), with automatic 1.3x scaling in Fullscreen mode.
    - Font colors: White (`#FFFFFF`), Yellow (`#FFE600`), Cyan (`#00F5FF`), Green (`#4EFA90`).
    - Background opacity: None (`transparent`), Medium (`rgba(0,0,0,0.65)`), Solid (`rgba(0,0,0,0.95)`).
    - Text shadow toggle for maximum contrast over bright anime scenes.
  - Controls autohide pause: keeps controls visible while customizing subtitle appearance.
- [x] **Task 8.6: Media Management Dashboard (`storage.py`, `rooms.py`, `mediaUtils.ts`, `MediaManagementModal.tsx`, `test_media.py`, `media.test.ts`)**:
  - Real-time host disk storage metrics: total disk space, free disk space, and byte usage breakdown (AnimeSync video files vs temp upload chunks) via `shutil.disk_usage`.
  - Visual storage usage bar with multi-segment proportional progress and free space indicator.
  - Host-only REST API endpoints:
    - `GET /api/rooms/{code}/media`: returns storage capacity and queued episode files with `file_exists_on_disk` and `is_active` flags.
    - `DELETE /api/rooms/{code}/media/{episode_id}`: host-only permanent file deletion from `storage/videos/` and database queue with Socket.IO `queue_updated` broadcast.
    - `POST /api/rooms/{code}/media/purge`: cleans orphaned upload chunks and temporary files from `storage/uploads_temp/`.
  - Frontend `MediaManagementModal` with mandatory confirmation dialog preventing accidental video deletion.
  - Integrated into `RoomPage.tsx` header for hosts.

---

## 4. In-Progress Features
- None (Phase 8 is 100% complete).

---

## 5. Pending Features
- **Phase 9: Testing, Security & Free Deployment**:
  - Task 9.1: Comprehensive end-to-end multi-user testing & edge case verification.
  - Task 9.2: Security review & audit (directory traversal, session authorization, injection prevention).
  - Task 9.3: Free cloud deployment automation (Cloudflare Quick Tunnel / Tailscale setup).
  - Task 9.4: Final documentation and handoff verification.

---

## 6. Known Bugs & Issues
- **Known Bugs**: None.
- **System Limitations & Edge Cases Handled**:
  - **Browser Background Tab Throttling**: Modern browsers throttle `setInterval` timers (e.g. 2s drift check interval) in background/minimized tabs. When refocusing the tab, drift correction catches up on the subsequent tick, or the user can press `Shift+R` to manually trigger an immediate resync.
  - **Client System Clock Skew**: Latency telemetry relies on client timestamps (`Date.now()`); to guard against negative latency from sudden OS clock shifts, calculations are clamped to 0ms.
  - **Browser Codec Compatibility**: Playback uses native HTML5 `<video>`; video files encoded with unsupported codecs trigger the player's custom codec alert prompting the user to load a standard H.264/AAC MP4 or WebM file.
  - **Concurrent Video Ended Events**: Multiple viewers reaching video end concurrently are deduplicated through server monotonic epoch cooldowns.
  - **WebRTC STUN vs Symmetric NAT**: Uses free public Google STUN servers. Works seamlessly over typical home NATs, mobile hotspots, and direct connections; strict enterprise symmetric firewalls would require TURN in cloud deployments.
  - **Microphone Permissions**: Rejection or lack of microphone hardware displays clear non-blocking alerts with device re-selection.

---

## 7. Tests Performed & Passing
- `backend/tests/test_rooms.py` (3 tests) — **PASSED**
- `backend/tests/test_presence.py` (6 tests) — **PASSED**
- `backend/tests/test_upload.py` (3 tests) — **PASSED**
- `backend/tests/test_ready_state.py` (8 tests) — **PASSED**
- `backend/tests/test_sync.py` (26 tests) — **PASSED**
- `backend/tests/test_queue.py` (10 tests) — **PASSED**
- `backend/tests/test_chat_and_voice.py` (8 tests) — **PASSED**
- `backend/tests/test_media.py` (4 tests, Phase 8) — **PASSED**
- `frontend/tests/drift.test.ts` (20 unit tests) — **PASSED**
- `frontend/tests/sync_health.test.ts` (10 unit tests) — **PASSED**
- `frontend/tests/queue.test.ts` (11 unit tests) — **PASSED**
- `frontend/tests/chat_voice.test.ts` (18 unit tests) — **PASSED**
- `frontend/tests/room_polish.test.ts` (9 unit tests, Phase 8) — **PASSED**
- `frontend/tests/subtitles.test.ts` (13 unit tests, Phase 8) — **PASSED**
- `frontend/tests/media.test.ts` (6 unit tests, Phase 8) — **PASSED**
- `npm run build` (TypeScript compilation & Vite bundle) — **PASSED** (2,132 modules transformed, 0 errors)
- Master test runner `./scripts/test.sh` — **PASSED** (All 68 backend tests + 87 frontend unit tests + Vite build)

---

## 8. Exact Next Task
- **Phase 9: Task 9.1 — Comprehensive End-to-End Multi-User Testing & Edge Case Scenarios**.

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
- **One-Click Manual Resync & Diagnostics**: Manual Resync hard-aligns player directly with server state while preserving paused/buffering status; live ping and drift metrics give viewers complete confidence in synchronization health.
- **Contiguous Queue Positions & Zero-Cost Reordering**: Queue re-compacting ensures contiguous indices without gaps. Host-only authorizations protect playlist modifications.
- **Duplicate Ended Protection with Server Monotonic Cooldown**: Multiple concurrent `playback_ended` emissions from room participants are deduplicated via server-side 15s cooldown.
- **Strict Ready Gate Invariance on Auto-Next**: Auto-Next strictly resets participants to `WAITING_FOR_FILE`, preserving the invariant that no participant watches without verified local files.
- **Wall-Clock Intermission Synchronization**: Intermission ticker uses wall-clock target epoch timestamps (`target_advance_time`) ensuring exact synchronization across tabs and client clocks.
- **Free Google STUN NAT Traversal (Zero-Cost Compliance)**: Pure peer-to-peer WebRTC signaling via existing Socket.IO connection and free Google public STUN servers eliminates any need for paid TURN services.
- **Independent Web Audio GainNode Routing**: Direct routing of remote peer streams through Web Audio API GainNode isolates voice amplification (0%–200%) and local mute completely from the native HTML5 `<video>` soundtrack.
- **Triple-Failsafe Push-to-Talk (PTT)**: Mute on keyup, window blur, and document visibilitychange guarantees no microphone hot-mic leaks if the user switches tabs or applications while holding `V`.
- **Typing Element Suppression for Hotkeys**: `isTypingElement` target inspection ensures that typing in chat or text inputs never activates hotkeys or microphone.
- **In-Player Fullscreen Communication Drawer**: Slide-over frosted glass drawer inside fullscreen mode provides complete access to chat, voice, and participants without exiting fullscreen.
- **Inactivity Cursor Autohide**: Automatically hides the mouse cursor and overlays after 2.5s of inactivity during playback, preventing screen distractions.
- **Client-Side Subtitle Synchronization with Dynamic Scaling**: SRT/VTT parsing runs on client thread with zero server upload; cues scale up 1.3x automatically in Fullscreen mode for living room display legibility.
- **Local Host Storage Inspection & Protected Purging**: Host-only disk telemetry inspects exact macOS filesystem disk usage via `shutil.disk_usage`; mandatory confirmation dialogs protect against accidental video deletion.
