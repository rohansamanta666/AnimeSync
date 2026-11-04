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
- **100% Free & Open Source**: Zero paid hosting, zero paid cloud databases, zero credit card requirements. Runs self-hosted on your Mac with free Cloudflare Quick Tunnel or Tailscale mesh.

---

## Tech Stack

- **Backend**: Python 3.10+, FastAPI, Python-SocketIO (ASGI), SQLAlchemy 2.0 (Async), SQLite (`aiosqlite`), Uvicorn.
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide React, Socket.IO Client, Web Audio API, Web Workers.
- **Networking**: Cloudflare Quick Tunnel / Tailscale WireGuard Mesh, Google Public STUN.

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
- (Optional for public sharing) `brew install cloudflared`

### 2. Launch AnimeSync
```bash
# Clone and enter directory
cd /Users/rohansamanta/Documents/AnimeSync

# Start the application
./scripts/start.sh
```

Open `http://localhost:8000` in your browser. If you launched Cloudflare Tunnel, share the printed `https://*.trycloudflare.com` URL with your friend!

---

## Acceptance Testing Checklist

AnimeSync is thoroughly verified against a 32-step acceptance criteria matrix covering chunked transfer, Web Worker hash verification, ready gates, drift correction, WebRTC voice, PTT, independent audio, and keyboard shortcuts. See [docs/TESTING.md](docs/TESTING.md) for details.

