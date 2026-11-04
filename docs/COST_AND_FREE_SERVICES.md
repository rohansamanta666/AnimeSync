# AnimeSync — Cost & Free Services Evaluation

## 1. Zero-Cost Principle & Rule Compliance

AnimeSync is designed to operate with **$0.00 total spend** across its entire lifecycle. In accordance with Rule 1.1, no feature or dependency requires a credit card, paid subscription, trial with auto-renewal, or token/credit purchases.

---

## 2. Component-by-Component Cost Breakdown

| Component | Selected Technology | Cost | Hosting / Infrastructure | Limitations / Quotas |
| :--- | :--- | :--- | :--- | :--- |
| **Backend & API** | FastAPI (Python) | $0.00 | Local Host Mac | Tied to host Mac uptime and CPU |
| **Realtime Sync & Chat** | Python-SocketIO (ASGI) | $0.00 | Local Host Mac | Unlimited events on local process |
| **Database** | SQLite + SQLAlchemy (Async) | $0.00 | Local disk (`animesync.db`) | Single file, no external DB server needed |
| **Video Storage** | Local File System | $0.00 | Host Mac internal disk | Limited by Host Mac available disk storage |
| **Frontend SPA** | React + Vite + Tailwind CSS | $0.00 | Served by Host Mac (or static) | Zero hosting fee |
| **File Checksumming** | Web Crypto / Web Worker | $0.00 | Client browser (CPU) | Uses client computing resources |
| **Voice Signaling** | Socket.IO (Server) | $0.00 | Local Host Mac | Uses lightweight JSON messages |
| **Voice Media (P2P)** | WebRTC MediaStream | $0.00 | Browser-to-Browser | Direct P2P bandwidth (no relay cost) |
| **NAT Traversal (STUN)**| Google Public STUN | $0.00 | Free Public STUN servers | STUN only discovers public IP/port; fails on symmetric NAT |
| **Public Tunneling** | Cloudflare Quick Tunnel / Tailscale | $0.00 | Free Tunnels / WireGuard mesh | Evaluated in detail below |

---

## 3. Evaluation of Free Networking & Tunneling Solutions

To allow a friend on a different Wi-Fi / home network to join without paid servers or static public IPs, we evaluated multiple free tunneling and overlay network solutions:

### Option A: Cloudflare Quick Tunnels (`cloudflared`) — *Recommended for Public Sharing*
- **Cost**: $0.00 (No credit card, no account required for `cloudflared tunnel --url http://localhost:8000`).
- **How it works**: Running `cloudflared tunnel --url http://localhost:8000` creates an ephemeral public HTTPS URL (e.g., `https://random-words.trycloudflare.com`).
- **Advantages**: Friend does not need to install any client software; works in standard web browsers. Free SSL/TLS certificate provided automatically.
- **Critical Limitations & Mitigations**:
  - *Cloudflare 100MB Request Body Limit*: Standard Cloudflare free edge nodes reject HTTP POST bodies larger than 100MB with `HTTP 413 Payload Too Large`.
    - **AnimeSync Mitigation**: AnimeSync implements **Chunked File Uploads** with 5MB chunks. Each chunk is an independent 5MB HTTP POST, which easily stays within Cloudflare's limit.
  - *Large File Download Transfer*: While Cloudflare does not strictly cap single GET downloads at 100MB, streaming multi-gigabyte video files continuously over a free tunnel can experience socket timeouts or violate Section 2.8 of Cloudflare TOS if misused.
    - **AnimeSync Mitigation**: AnimeSync uses chunked or range-based video transfers for the pre-watch download phase, rather than continuous live streaming during playback. Playback itself runs locally on each participant's machine!
  - *Ephemeral URL*: Quick Tunnels generate a new URL upon each restart.
    - **AnimeSync Mitigation**: The start script prints the tunnel URL to the terminal for easy sharing with the friend.

### Option B: Tailscale (WireGuard Mesh) — *Recommended for High Performance & No Proxy Limits*
- **Cost**: $0.00 (Free Personal Plan for up to 3 users and 100 devices; no credit card required).
- **How it works**: Both friends install Tailscale (free macOS app / client) and authenticate with their Google/GitHub accounts.
- **Advantages**: Direct encrypted WireGuard peer-to-peer connection. Zero file-size limits, zero proxy bandwidth throttling, transfers run at native ISP speed.
- **Limitations**: Both users must have Tailscale installed and joined to the tailnet or share an invite node.

### Option C: ngrok — *REJECTED*
- **Cost**: Free tier available, BUT has a strict **1 GB/month bandwidth limit** and session timeout limits.
- **Verdict**: **Rejected**. A single 1080p anime episode is 500MB–1.4GB. The monthly quota would be exhausted after a single episode.

### Option D: localtunnel (`npx localtunnel`) — *Fallback Alternative*
- **Cost**: $0.00.
- **Advantages**: No registration required.
- **Limitations**: Frequent downtime, slower transfer speeds, reminder screen shown to first-time visitors.

---

## 4. WebRTC Voice & NAT Traversal Analysis

### STUN vs. TURN
- **STUN (Session Traversal Utilities for NAT)**:
  - Free public STUN servers provided by Google (`stun:stun.l.google.com:19302`) have been operational for over a decade at $0 cost with no authentication.
  - STUN enables WebRTC peers to discover their public IP and port mappings.
  - **Success Rate**: Works for ~80-85% of standard residential home networks.
- **Symmetric NAT & Strict Firewall Limitations**:
  - If both participants are behind restrictive symmetric NATs (e.g., certain mobile hotspots, strict university dorm firewalls), direct P2P connections cannot be established without a TURN relay.
  - **Zero-Cost Policy Compliance**: Paid TURN services (Twilio, Xirsys) are **strictly rejected**.
  - **Fallback / Self-Hosted Option**: If users need TURN, an open-source `coturn` instance can be run on any existing free server or direct home port forwarding. When direct P2P fails, AnimeSync displays a clear, honest UI status: *"Voice connection could not be established via P2P STUN; text chat and synchronized video remain fully functional."*

---

## 5. Host Mac Power & Storage Precautions
1. **Mac Sleep Prevention**: When hosting a watch party, the Mac host must prevent sleep during the session (e.g., using macOS built-in `caffeinate` command in the start script).
2. **Storage Management**: Video files are stored in `storage/videos/`. AnimeSync includes a Media Management dashboard showing disk usage and enabling safe one-click manual deletion of watched files.

