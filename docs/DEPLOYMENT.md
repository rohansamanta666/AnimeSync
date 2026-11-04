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
AnimeSync includes a automated start script:
```bash
./scripts/start.sh
```
This script:
1. Activates Python `.venv` and installs dependencies.
2. Builds the React frontend if needed (or launches frontend dev server).
3. Starts the FastAPI + Socket.IO server on `http://localhost:8000`.
4. Keeps your Mac awake during the session using macOS `caffeinate`.
5. Prompts to launch Cloudflare Quick Tunnel and outputs the public HTTPS link for your friend.

### 3.2 Stopping AnimeSync
To cleanly stop the application and background tunnel:
```bash
./scripts/stop.sh
```

---

## 4. Public Tunnel Setup Options

### Option A: Cloudflare Quick Tunnel (Zero Account, Zero Credit Card)
Quick Tunnels allow anyone to expose a local HTTP port over a secure HTTPS public URL without signing up for Cloudflare:
```bash
cloudflared tunnel --url http://localhost:8000
```
- Cloudflare outputs a URL like: `https://brave-falcon-abc.trycloudflare.com`.
- Send this link to your friend!
- **Note**: Thanks to AnimeSync's 5MB chunked upload architecture, files uploaded stay comfortably within Cloudflare's 100MB body limit.

### Option B: Tailscale WireGuard Mesh (Maximum Speed & Security)
If you and your friend both use Tailscale (free personal plan, up to 3 users):
1. Both log into Tailscale on macOS.
2. Share the Host Mac's Tailscale IP (e.g., `http://100.x.y.z:8000`).
3. Your friend opens `http://100.x.y.z:8000` in Chrome or Safari.
4. Video file transfers run directly over local/peer-to-peer WireGuard at your full ISP upload/download speed!

---

## 5. macOS Sleep & Power Management

When hosting a watch party, macOS might sleep if idle.
AnimeSync's start script automatically executes:
```bash
caffeinate -dimsu -w $$ &
```
This ensures:
- Displays can sleep if desired (`-d`), but the system, disk, and network interfaces remain active (`-i -m -s -u`) while AnimeSync is running.
- Once you terminate AnimeSync, sleep behavior returns to normal immediately.

---

## 6. Troubleshooting

- **Friend cannot open the tunnel URL**:
  - Verify `cloudflared` is running in your terminal.
  - Test opening the URL on your own phone or another device.
- **Microphone permission blocked**:
  - In macOS System Settings $\rightarrow$ Privacy & Security $\rightarrow$ Microphone, ensure your browser (Chrome or Safari) has microphone permissions granted.
- **Port 8000 already in use**:
  - Check running processes: `lsof -i :8000`
  - Terminate: `kill -9 <PID>`

