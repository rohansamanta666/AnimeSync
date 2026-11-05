# AnimeSync — Implementation Plan

This document outlines the execution roadmap across all 9 phases, specifying deliverables, acceptance criteria, and technical milestones.

---

## Phase 1 — Foundation & UI Design System
- [x] Task 1.1: Initialize project repository structure, `.gitignore`, `.env.example`, and directory hierarchy.
- [x] Task 1.2: Configure Python virtual environment, dependencies (`requirements.txt`), and FastAPI ASGI scaffolding.
- [x] Task 1.3: Set up Vite + React + TypeScript + Tailwind CSS with Japanese-inspired dark mode theme (near-black, dark navy, electric violet, neon pink, soft cyan).
- [x] Task 1.4: Implement SQLite database schema with SQLAlchemy async engine and automated schema initialization.
- [x] Task 1.5: Build core UI components (Navbar, Button, Card, Modal, Input, Badge, Toast notifications).
- [x] Task 1.6: Build user entry pages: Landing Page ("Your Anime Night. Together."), Guest Entry / Room Creation, Room Joining, and Room Dashboard.
- [x] Task 1.7: Write automated tests for Phase 1 endpoints and UI build verification.

---

## Phase 2 — Private Rooms & Realtime Presence
- [x] Task 2.1: Implement Room CRUD API and secure 6-character room code generation.
- [x] Task 2.2: Implement guest session management with secure participant tokens (UUID cookies/headers).
- [x] Task 2.3: Integrate Python-SocketIO server with FastAPI ASGI mount.
- [x] Task 2.4: Build real-time presence system (`join_room`, `leave_room`, `disconnect`, `user_joined`, `user_left`).
- [x] Task 2.5: Build Room Waiting Lobby view showing active participants, roles (Host/Guest), and connection health.
- [x] Task 2.6: Test multi-client room connection, disconnect handling, and automatic reconnect recovery.

---

## Phase 3 — Video Distribution & File Verification
- [x] Task 3.1: Implement chunked file upload API (`/api/files/upload/init`, `/api/files/upload/chunk`, `/api/files/upload/complete`).
- [x] Task 3.2: Implement server-side incremental SHA-256 calculation and safe filesystem storage (`storage/videos/`).
- [x] Task 3.3: Implement resumable chunked downloads with HTTP `Range` request support (`Accept-Ranges: bytes`).
- [x] Task 3.4: Build Client-side Upload UI with chunk progress bar, cancel, and retry capabilities.
- [x] Task 3.5: Build Client-side Download UI with byte progress and completion confirmation.
- [x] Task 3.6: Implement HTML5 local file picker and Web Worker for streaming client-side SHA-256 calculation without main-thread blocking.
- [x] Task 3.7: Implement socket event `verify_file` where server validates client checksum against authoritative database hash.
- [x] Task 3.8: Unit and integration tests for upload chunk assembly, hash verification, and mismatch handling.

---

## Phase 4 — Ready-to-Watch System
- [x] Task 4.1: Model participant states: `WAITING_FOR_FILE`, `DOWNLOADING`, `VERIFYING`, `VERIFICATION_FAILED`, `VERIFIED`, `READY`, `WATCHING`.
- [x] Task 4.2: Enforce server-authoritative readiness rules (participant cannot declare `READY` without server `VERIFIED` state).
- [x] Task 4.3: Implement Ready/Unready toggle UI with clear state badges for both participants.
- [x] Task 4.4: Implement server-coordinated synchronized countdown (3.. 2.. 1.. Watch!) with authoritative start timestamp.
- [x] Task 4.5: Handle state invalidation: if host uploads new episode or guest changes file, reset readiness back to verification.
- [x] Task 4.6: Automated tests verifying state machine transitions and readiness gates.

---

## Phase 5 — Synchronized Video Player
- [x] Task 5.1: Build custom HTML5 video player component loading local `File` via `URL.createObjectURL()`.
- [x] Task 5.2: Implement server playback state machine (`is_playing`, `current_time`, `speed`, `updated_at`, `sequence`).
- [x] Task 5.3: Implement client-to-server controls: Play, Pause, Seek, Speed with sequence numbers to eliminate feedback loops.
- [x] Task 5.4: Implement adaptive drift correction engine:
  - Drift < 0.25s: Ignore (or restore intended speed if previously nudged).
  - 0.25s – 1.5s: Gentle `playbackRate` nudge (±5%).
  - Drift >= 1.5s: Immediate hard seek.
- [x] Task 5.5: Implement buffering detection and recovery:
  - Detect HTML5 `waiting`, `stalled`, and `canplay` video events.
  - Server-coordinated shared pause when any active participant buffers.
  - Resume only when all active participants are ready.
  - Automatic disconnect recovery and feedback loop prevention.
- [x] Task 5.6: Implement manual "Resync" button and Sync Health status indicator:
  - Add Resync button to video player overlay and room header.
  - One-click authoritative alignment via `calculateResyncTarget`.
  - Live round-trip network latency measurement via `ping_check` Socket.IO event.
  - Live Sync Health badge showing Synced, Nudging, Buffering, Paused.
- [ ] Task 5.7: Test playback sync under simulated latency and packet drops.

---

## Phase 6 — Episode Queue & Auto-Next Workflow
- [x] Task 6.1: Implement Room Episode Queue data model and API/Socket events (`add_to_queue`, `remove_from_queue`, `reorder_queue`).
- [x] Task 6.2: Build episode queue UI showing upcoming episodes, download status, and verification badges.
- [x] Task 6.3: Implement video `ended` event coordination with duplicate protection.
- [x] Task 6.4: Build Intermission Screen showing next episode details, per-participant verification requirements, and countdown.
- [x] Task 6.5: Verify that Auto-Next enforces Ready-to-Watch requirements before advancing playback.

---

## Phase 7 — Chat & WebRTC Voice System
- [ ] Task 7.1: Implement real-time text chat with Socket.IO, message persistence, timestamps, and input sanitization.
- [ ] Task 7.2: Implement WebRTC voice signaling over Socket.IO (`voice_offer`, `voice_answer`, `ice_candidate`).
- [ ] Task 7.3: Integrate free Google public STUN servers for NAT traversal.
- [ ] Task 7.4: Build Voice UI: Join/Leave voice, Mute/Unmute microphone, Audio device selection, Speaking indicator.
- [ ] Task 7.5: Implement Push-to-Talk (PTT) with key shortcut `V`, keyup safety guarantees, and manual mute precedence.
- [ ] Task 7.6: Implement Independent Audio Architecture:
  - Anime volume slider (HTML5 video gain).
  - Remote voice volume slider (Web Audio API `GainNode` 0–200%).
  - Local mute of remote peer without remote microphone muting.

---

## Phase 8 — Watch-Room Polish & UI/UX Experience
- [ ] Task 8.1: Implement Discord-inspired collapsible watch-room sidebar (participant list + chat).
- [ ] Task 8.2: Participant profile popover with individual voice volume slider and mute controls.
- [ ] Task 8.3: Fullscreen mode: automatically hide sidebar, chat, and queue, with cursor inactivity autohide.
- [ ] Task 8.4: Keyboard shortcuts: Space (play/pause), Left/Right (seek $\pm 5$s), F (fullscreen), M (mute anime), V (PTT).
- [ ] Task 8.5: External subtitle support: `.srt` and `.vtt` file parser with customizable font size, color, and background.
- [ ] Task 8.6: Media Management Dashboard: view disk usage, inspect stored videos, and manually delete files with confirmation.

---

## Phase 9 — Testing, Security, & Zero-Cost Deployment
- [ ] Task 9.1: Comprehensive test suite execution (FastAPI backend tests, Vitest frontend tests).
- [ ] Task 9.2: Security verification: directory traversal guards, safe filename sanitization, rate limiting, room isolation.
- [ ] Task 9.3: Create production startup script (`scripts/start.sh`) with auto-build and Cloudflare Quick Tunnel / Tailscale instructions.
- [ ] Task 9.4: Two-computer validation protocol across separate networks.
- [ ] Task 9.5: Complete project documentation and handover.

