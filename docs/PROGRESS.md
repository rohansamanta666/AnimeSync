# AnimeSync — Project Progress

## 1. Project Status Overview
- **Current Phase**: Phase 1 (Foundation & UI Design System) — **COMPLETED**
- **Next Phase**: Phase 2 (Private Rooms & Realtime Presence)
- **Overall Health**: Healthy
- **Target OS**: macOS (Apple Silicon & Intel)
- **Zero-Cost Compliance**: 100% verified (Local storage, SQLite, WebRTC P2P + Google STUN, Cloudflare Quick Tunnel / Tailscale)

---

## 2. Feature Tracking Matrix

| Phase | Description | Status | Completion % |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Foundation & UI Design System | **COMPLETED** | 100% |
| **Phase 2** | Private Rooms & Realtime Presence | Up Next | 0% |
| **Phase 3** | Video Distribution & File Verification | Pending | 0% |
| **Phase 4** | Ready-to-Watch System | Pending | 0% |
| **Phase 5** | Synchronized Video Player | Pending | 0% |
| **Phase 6** | Episode Queue & Auto-Next | Pending | 0% |
| **Phase 7** | Text Chat & WebRTC Voice | Pending | 0% |
| **Phase 8** | Watch-Room Polish & Customization | Pending | 0% |
| **Phase 9** | Testing, Security & Free Deployment | Pending | 0% |

---

## 3. Completed Features (Phase 1)
- [x] **Project Scaffolding**: Modular monolith structure (`backend`, `frontend`, `storage/videos`, `storage/uploads_temp`, `docs`, `scripts`).
- [x] **Zero-Cost Audit & Evaluation**: Documented 100% free operation using Mac local hosting, SQLite, WebRTC Google STUN, and Cloudflare Quick Tunnel / Tailscale in `docs/COST_AND_FREE_SERVICES.md`.
- [x] **Complete Architecture & ADRs**: Documented in `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.
- [x] **Backend Infrastructure**:
  - FastAPI with lifespan initialization.
  - SQLAlchemy 2.0 async engine (`sqlite+aiosqlite`) with automatic table creation (`Room`, `Participant`, `Episode`, `Message`).
  - Cryptographically secure 6-character room codes (`ROOM_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"`).
  - 64-hex-char guest session tokens.
  - REST API endpoints for `/api/health`, `POST /api/rooms`, `GET /api/rooms/{code}`, and `POST /api/rooms/{code}/join`.
  - Built-in static file serving for compiled React SPA in production mode.
- [x] **Frontend Design System**:
  - React 18, TypeScript, Vite, Tailwind CSS with custom Japanese dark theme palette (`void-950`, `void-900`, `void-800`, `violet-accent`, `pink-accent`, `cyan-accent`, `ink-text`, `ink-muted`).
  - Reusable UI component library: `Button`, `Input`, `Card`, `Badge`, `Modal`, `Navbar`.
- [x] **Core Pages**:
  - Landing Page with hero copy ("Your Anime Night. Together."), visual preview, and feature pillars.
  - Create Room Modal with immediate code generation and session caching.
  - Join Room Modal with 6-char formatted code input.
  - Room Lobby / Dashboard with 1-click invitation link copier and participant presence list.
  - 404 Not Found Page.
- [x] **Automated Verification**:
  - `backend/tests/test_rooms.py` testing health, room creation, joining, and SPA serving.
  - `./scripts/test.sh` automating backend pytest and frontend TypeScript / Vite production build.
  - `./scripts/start.sh` and `./scripts/stop.sh` for one-command execution with macOS `caffeinate` sleep prevention.

---

## 4. In-Progress Features
- Transitioning to **Phase 2: Private Rooms & Realtime Presence**.

---

## 5. Pending Features
- Phase 2: Python-SocketIO ASGI server integration, presence events (`join_room`, `leave_room`, `disconnect`), reconnect reconciliation.
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
- `npm run build` (TypeScript compilation & Vite bundle) — **PASSED** (2077 modules transformed, 0 errors)
- Execution of `./scripts/test.sh` — **PASSED**

---

## 8. Exact Next Task
- **Phase 2 Implementation**:
  1. Integrate `python-socketio` AsyncServer with the FastAPI ASGI application.
  2. Implement real-time room presence handlers (`connect`, `join_room`, `leave_room`, `disconnect`).
  3. Create frontend `useSocket` hook and Socket.IO client service to subscribe to presence updates and show live participant indicators in the Room Lobby.

---

## 9. Important Decisions Logged
- Video files are stored in `storage/videos/` on host Mac; never in SQLite.
- 5MB chunked uploads selected to guarantee zero failures on Cloudflare free tunnels (which have a 100MB body cap).
- Dual audio pipeline: HTML5 `<video>` for anime audio and Web Audio API `GainNode` for voice, guaranteeing independent volume and mute controls.
- Single unified ASGI application serving both REST API, Socket.IO, and compiled React SPA.
