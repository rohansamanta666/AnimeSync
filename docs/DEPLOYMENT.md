# AnimeSync — Deployment & Zero-Cost Hosting Guide

## 1. Hosting Architecture

AnimeSync is self-hosted directly on your Mac:
- **Host Mac**: Executes the FastAPI + Socket.IO server, serves the built React frontend, and hosts stored anime video files on local disk.
- **External Network Access**: Provided through **Cloudflare Quick Tunnel** (or Tailscale mesh) with zero configuration, zero paid servers, and zero credit cards.

```
[ Friend's Mac ]
       │
       ▼ (HTTPS)
[ Cloudflare Quick Tunnel / trycloudflare.com ]
       │
       ▼ (Port 8000)
[ Your Mac (FastAPI + SQLite + Local Storage) ]
```

---

## 2. Prerequisites on Host Mac

All tools are free and open-source:
1. **Python 3.10+** (Already installed on your Mac).
2. **Node.js 18+ and npm** (Already installed on your Mac).
3. **Cloudflare CLI (`cloudflared`)** (Free; no account or credit card needed):
   ```bash
   brew install cloudflared
   ```
4. *Optional Alternative*: **Tailscale** (`brew install tailscale` or Mac App Store).

---

## 3. Quick Start (Development & Watch Party)

### 3.1 One-Click Start Script
AnimeSync includes an automated startup script:
```bash
# Standard local start:
./scripts/start.sh

# Start with automatic Cloudflare Quick Tunnel (generates live public HTTPS link):
./scripts/start.sh --tunnel

# Force rebuild of frontend production assets and launch tunnel:
./scripts/start.sh --build --tunnel
```

**What `scripts/start.sh` does automatically:**
1. **Environment Configuration**: Checks for `.env`; automatically initializes `.env` from `.env.example` if not found.
2. **Port Conflict Check**: Detects if port 8000 is occupied; warns and exits cleanly with guidance to run `./scripts/stop.sh`.
3. **Python Virtual Environment**: Checks for `.venv`; creates virtual environment and installs dependencies if needed, then activates it.
4. **Frontend Asset Verification**: Automatically installs npm packages and builds production assets (`frontend/dist`) if missing or when invoked with `--build`.
5. **Storage Directory Verification**: Verifies `storage/videos` and `storage/uploads_temp` directories exist.
6. **macOS Sleep Prevention**: Launches `caffeinate -dimsu` to keep disk, system, and network interfaces active during the anime night.
7. **Cloudflare Quick Tunnel Integration**: When invoked with `--tunnel`, launches `cloudflared` in the background, captures the generated `https://*.trycloudflare.com` URL, and displays it in the terminal.
8. **Signal Handling**: Sets traps for `EXIT`, `INT`, and `TERM` to terminate background caffeinate and cloudflared processes cleanly on server exit.
9. **Network Guidance**: Prints local LAN IP and instructions for free Cloudflare Quick Tunnel and Tailscale sharing.
10. **Server Launch**: Starts FastAPI + Socket.IO production server on `0.0.0.0:8000`.

### 3.2 Stopping AnimeSync
To cleanly terminate AnimeSync services:
```bash
./scripts/stop.sh
```
This script cleanly stops:
1. Running Uvicorn server processes on port 8000.
2. Background `cloudflared tunnel` instances.
3. Background macOS `caffeinate` sleep-prevention processes.

---

## 4. Public Tunnel & Network Setup Options

### Option A: Cloudflare Quick Tunnel (Zero Account, Zero Credit Card)
Quick Tunnels allow anyone to expose a local HTTP port over a secure HTTPS public URL without signing up for Cloudflare:
- **One-click command**:
  ```bash
  ./scripts/start.sh --tunnel
  ```
  The script automatically starts the tunnel and prints:
  `🎉 Cloudflare Quick Tunnel Live! Share this link with your friend: https://*.trycloudflare.com`
- **Manual alternative (run in a separate terminal)**:
  ```bash
  cloudflared tunnel --url http://localhost:8000
  ```
- Send the printed link to your friend!
- **Note**: Thanks to AnimeSync's 5MB chunked upload architecture, files uploaded stay comfortably within Cloudflare's 100MB body limit.

### Option B: Tailscale WireGuard Mesh (Maximum Speed & Security)
If you and your friend both use Tailscale (free personal plan, up to 3 users):
1. Both log into Tailscale on macOS.
2. Share the Host Mac's Tailscale IP (e.g., `http://100.x.y.z:8000`).
3. Your friend opens `http://100.x.y.z:8000` in Chrome or Safari.
4. Video file transfers run directly over local/peer-to-peer WireGuard at your full ISP upload/download speed!
5. **Bypasses Symmetric NAT**: Because Tailscale creates an encrypted point-to-point WireGuard tunnel, WebRTC and HTTP traffic navigate enterprise NATs without requiring paid TURN servers.

---

## 5. WebRTC Network Architecture & NAT Traversal

AnimeSync voice chat operates peer-to-peer using WebRTC:
- **STUN Signaling**: Free public Google STUN servers (`stun:stun.l.google.com:19302`) resolve external public IP and port mappings.
- **Supported Topologies**: Full Cone NAT, Address-Restricted Cone NAT, Port-Restricted Cone NAT, and local LANs. Covers virtually all standard home Wi-Fi and residential ISP connections.
- **Symmetric NAT Boundary**: Strict enterprise networks and institutional firewalls (e.g. universities, corporate VPNs) allocate random port mappings per destination, which prevents STUN from establishing direct UDP hole punching.
- **Recommended Free Alternative**: When connecting across restrictive firewalls, use **Tailscale** (Option B above). It provides a direct virtual network connection between both computers, bypassing symmetric firewall restrictions with zero cloud cost.

---

## 6. Environment Variable Reference

The application loads configuration from `.env` (derived from `.env.example`):

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `HOST` | `0.0.0.0` | Server bind IP address. |
| `PORT` | `8000` | Server HTTP/WebSocket port. |
| `ENVIRONMENT` | `development` | Deployment environment mode (`development` / `production`). |
| `FRONTEND_PORT` | `5173` | Vite development server port (dev mode only). |
| `DATABASE_URL` | `sqlite+aiosqlite:///...` | Async SQLite database path. |
| `STORAGE_DIR` | `./storage/videos` | Target directory for completed episode videos. |
| `TEMP_UPLOAD_DIR` | `./storage/uploads_temp` | Temporary directory for chunked upload sessions. |
| `MAX_UPLOAD_SIZE_MB`| `4096` (4 GB) | Maximum allowed file upload size. |
| `CHUNK_SIZE_BYTES` | `5242880` (5 MB) | Chunk size for chunked upload API (Cloudflare safe). |
| `CORS_ORIGINS` | Comma-separated | Allowed HTTP origins for CORS policy. |
| `STUN_SERVERS` | Google STUN servers | Free STUN servers for WebRTC NAT traversal. |
| `TURN_SERVER_URL` | `""` | Optional TURN server URL (empty by default). |
| `DRIFT_IGNORE_THRESHOLD` | `0.25` | Playback drift tolerance in seconds. |
| `DRIFT_RATE_ADJUST_THRESHOLD` | `1.5` | Threshold for micro-drift speed adjustment (±5%). |
| `DRIFT_HARD_SEEK_THRESHOLD` | `3.0` | Threshold for hard seek alignment. |

---

## 7. macOS Sleep & Power Management

When hosting a watch party, macOS might sleep if idle.
AnimeSync's start script automatically executes:
```bash
caffeinate -dimsu -w $$ &
```
This ensures:
- Displays can sleep if desired (`-d`), but the system, disk, and network interfaces remain active (`-i -m -s -u`) while AnimeSync is running.
- Once you terminate AnimeSync or run `./scripts/stop.sh`, sleep behavior returns to normal immediately.

---

## 8. Troubleshooting

- **Friend cannot open the tunnel URL**:
  - Verify `cloudflared` is running in your terminal.
  - Test opening the URL on your own phone or another device.
- **Microphone permission blocked**:
  - In macOS System Settings $\rightarrow$ Privacy & Security $\rightarrow$ Microphone, ensure your browser (Chrome or Safari) has microphone permissions granted.
- **Port 8000 already in use**:
  - Run `./scripts/stop.sh` or inspect: `lsof -i :8000`.
- **SPA 404 vs Backend API**:
  - Missing `/api/*` and `socket.io` endpoints return structured JSON 404 error responses, while browser page refreshes (`/rooms/ABC123`) serve the SPA `index.html`.

