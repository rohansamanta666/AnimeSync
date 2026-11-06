# AnimeSync 🌸

> **Your Anime Night. Together.**
> Sync your screens, grab your snacks, and enjoy every episode together — wherever you are.

AnimeSync is a private, desktop-first, online anime watch-party application allowing two people in different homes to watch locally stored video files in synchronized playback, accompanied by real-time text chat and WebRTC voice communication.

---

## Key Features

- **Local Playback with Zero Server Bandwidth**: Video files are played directly from each participant's local disk. The server coordinates synchronization via lightweight Socket.IO packets, ensuring 1080p/4K 60fps quality with zero buffering or video proxy limits.
- **Real-Time Presence & Multi-Tab Resilience**: Authenticated Socket.IO rooms with multi-tab connection reconciliation. Disconnecting one tab keeps the user online; departures and arrivals update in real time with strict channel isolation.
- **5MB Chunked Resumable Upload & Download**: Large anime episodes are transferred efficiently in 5MB chunks, bypassing free tunnel limits (such as Cloudflare's 100MB body limit) with range-request download resumption.
- **SHA-256 Web Worker Verification**: Guarantees both participants are watching the exact same file. Incremental background streaming hashing keeps the browser UI smooth and responsive.
- **Server-Authoritative Ready-to-Watch System**: Playback is gated until both participants have verified matching files and clicked "Ready". A synchronized 3-second countdown launches playback together.
- **Adaptive Drift Correction**: Subtly corrects playback rate ($\pm 5\%$) for minor drift, falling back to instant hard seeking only for significant network desynchronization.
- **Real-Time Text Chat & WebRTC Voice**: Low-latency voice chat via Google STUN with Push-to-Talk (`V`), voice activity indicators, and device selection.
- **Independent Audio Controls**: Separate controls for local anime volume (0–100%) and peer voice volume (0–200% with gain boost). Muting a peer is local-only and does not affect the remote user's transmission.
- **Discord-Inspired Watch Room**: Collapsible communication sidebar, fullscreen autohide controls, theater mode, and external subtitle (`.srt`/`.vtt`) support.
- **Hardened Security & Boundary Containment**: Strict path containment checks blocking directory traversal in chunked uploads and file downloads, host-only permission barriers, and isolated Single Page Application routing (preventing API route masking).
- **100% Free & Open Source**: Zero paid hosting, zero paid cloud databases, zero credit card requirements. Runs self-hosted on your Mac with free Cloudflare Quick Tunnel or Tailscale mesh.

---

## Tech Stack

- **Backend**: Python 3.10+, FastAPI, Python-SocketIO (ASGI), SQLAlchemy 2.0 (Async), SQLite (`aiosqlite`), Uvicorn.
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide React, Socket.IO Client, Web Audio API, Web Workers.
- **Networking**: Cloudflare Quick Tunnel / Tailscale WireGuard Mesh, Google Public STUN (`stun:stun.l.google.com:19302`).

---

## Documentation

- [System Architecture](docs/ARCHITECTURE.md)
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md)
- [Project Progress & Status](docs/PROGRESS.md)
- [Architectural Decision Records (ADR)](docs/DECISIONS.md)
- [API & Socket Protocol](docs/API.md)
- [Testing Strategy & Acceptance Protocol](docs/TESTING.md)
- [Deployment & Free Hosting Guide](docs/DEPLOYMENT.md)
- [Cost & Free Services Audit](docs/COST_AND_FREE_SERVICES.md)

---

## Quick Start

### 1. Prerequisites
- macOS (Apple Silicon or Intel)
- Python 3.10+
- Node.js 18+ and npm
- (Optional for public sharing) `brew install cloudflared` or `brew install tailscale`

### 2. Launch AnimeSync
```bash
# Clone and enter directory
git clone https://github.com/rohansamanta666/AnimeSync.git
cd AnimeSync

# Start the application (auto-creates .env, installs dependencies, builds frontend, launches server)
./scripts/start.sh

# Or start with automatic Cloudflare Quick Tunnel (prints public link for your friend):
./scripts/start.sh --tunnel

# Or force rebuild of frontend production assets:
./scripts/start.sh --build --tunnel
```

Open `http://localhost:8000` in your browser.

### 3. Share with Your Friend (100% Free)
- **Option A — Cloudflare Quick Tunnel** (Instant HTTPS URL, zero account needed):
  - When started with `./scripts/start.sh --tunnel`, the public link is printed directly in your terminal.
  - Or run manually in a separate terminal: `cloudflared tunnel --url http://localhost:8000`
  - Share the generated `https://*.trycloudflare.com` URL with your friend!
- **Option B — Tailscale WireGuard Mesh** (Fastest direct P2P speed; bypasses symmetric NAT):
  Share your Mac's Tailscale IP: `http://100.x.y.z:8000`.

### 4. Stop Services
```bash
./scripts/stop.sh
```

---

## Testing & Quality Verification

AnimeSync includes a comprehensive automated test suite and two-computer validation protocol:
- **Backend Test Suite**: 73 Pytest tests passing 100% (`backend/tests/`) covering presence, chunked upload/download, SHA-256 verification, ready state gates, drift correction, buffering coordination, queue management, chat/voice signaling, media management, security traversal guards, and end-to-end watch party workflows.
- **Frontend Test Suite**: 87 unit tests passing 100% (`frontend/tests/`) covering drift calculations, audio gain, speaking RMS detection, PTT keyup safety, subtitle parsing, queue reordering, and sync health badges.
- **Production Build**: Clean TypeScript compilation and Vite build (`tsc && vite build`).
- **Master Test Runner**: Run all tests in one step:
  ```bash
  ./scripts/test.sh
  ```
- **Acceptance Protocol**: Step-by-step two-computer testing checklist detailed in [docs/TESTING.md](docs/TESTING.md).

