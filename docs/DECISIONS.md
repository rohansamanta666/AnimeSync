# AnimeSync — Architectural Decision Records (ADRs)

## ADR-001: Local Video File Playback vs. Server Live Video Streaming
- **Context**: Anime episodes are large (300MB–1.5GB). Streaming video through a free public tunnel (such as Cloudflare Quick Tunnel) or domestic home Wi-Fi uplink will result in buffering, bandwidth throttling, and proxy connection resets.
- **Decision**: Pre-distribute video files via HTTP chunked download. During watch sessions, both participants select and play the identical verified file stored directly on their local Mac disk.
- **Consequences**: Zero server bandwidth used during video playback. 1080p/4K 60fps local playback quality. Requires client-side SHA-256 verification before playback can begin.

---

## ADR-002: SQLite + SQLAlchemy Async for Database Layer
- **Context**: The application must run at $0 cost on the user's Mac without requiring paid cloud databases (e.g. AWS RDS, Supabase paid tiers).
- **Decision**: Use SQLite with `aiosqlite` and SQLAlchemy 2.0 async engine.
- **Consequences**: Entire database resides in a single file (`animesync.db`) on the host Mac. Zero setup, zero monthly cost, zero cloud credentials required. The architecture isolates the database access via repository/service layer so migration to PostgreSQL is effortless if needed later.

---

## ADR-003: 5MB Chunked Resumable Uploads
- **Context**: Free Cloudflare Tunnels enforce an unchangeable 100MB HTTP request body limit (`HTTP 413 Payload Too Large`). Single-POST uploads of typical video files (300MB–1.5GB) immediately fail.
- **Decision**: Implement a chunked upload API where the client slices files into 5MB chunks (`File.slice()`), transfers them sequentially with chunk indices, and the server appends them into a temporary file on disk before finalizing.
- **Consequences**: Uploads stay well beneath the 100MB limit. Interrupted uploads can resume from the last received chunk without re-uploading from 0%. Server RAM consumption remains minimal (~5MB buffer per upload).

---

## ADR-004: Client-Side Web Worker SHA-256 Incremental Hashing
- **Context**: Computing the SHA-256 hash of a 1GB file in JavaScript's main UI thread freezes the browser for 10–30 seconds, causing "Page Unresponsive" warnings.
- **Decision**: Offload checksum computation to a dedicated Web Worker that reads file slices incrementally (using `FileReaderSync` or `ReadableStream`) and feeds them into the streaming crypto hasher.
- **Consequences**: The UI remains completely responsive (60fps animation, active chat) while hashing. Progress is reported smoothly to the UI thread via `worker.postMessage()`.

---

## ADR-005: WebRTC P2P Voice with Free Public STUN
- **Context**: Voice chat must be free, real-time, low latency, and not consume host server CPU.
- **Decision**: Establish direct peer-to-peer WebRTC audio streams using Socket.IO for signaling (`offer`, `answer`, `ice_candidate`) and Google's free public STUN servers (`stun:stun.l.google.com:19302`).
- **Consequences**: Works across standard residential NAT configurations without paid infrastructure. If both users are behind strict symmetric NATs, a clear notification is displayed.

---

## ADR-006: Independent Audio Pipeline Architecture
- **Context**: Users frequently need to hear their friend's voice clearly over loud anime battle scenes or music, or mute a coughing participant without muting the episode.
- **Decision**: Completely decouple the anime audio pipeline (HTML5 `<video>` element volume/mute) from the voice chat pipeline (Web Audio API `GainNode` on the WebRTC `MediaStream`).
- **Consequences**: Allows independent anime volume (0–100%) and peer voice volume (0–200% with gain boost). Muting a peer is local-only and does not affect the remote user's transmission.

---

## ADR-007: Server-Authoritative Sync Engine with Sequence Numbers
- **Context**: In peer-to-peer sync, Client A pausing can cause Client B to auto-correct, creating an infinite feedback loop of play/pause events.
- **Decision**: The backend server is the sole authority for playback state. Every command carries a monotonic `sequence_number` and the client's socket ID. The server validates the command, updates the authoritative state, and broadcasts the event with the originating ID so the sender ignores self-echoes.
- **Consequences**: Eliminates ping-pong loops and ensures clean drift resolution.

---

## ADR-008: Multi-Tab Socket Tracking & Room Membership Reconciliation
- **Context**: In browser watch parties, participants frequently open a second tab or refresh their browser before the TCP socket from the previous page has timed out. Naive socket-to-user 1:1 mappings cause the user to be reported as "offline" when the old tab closes, or cause duplicate participant cards in the UI.
- **Decision**: Implement a decoupled `ConnectionManager` that maps `(room_code, participant_id) -> Set[socket_id]`.
- **Consequences**: Opening multiple tabs maintains a single logical participant card displaying `Online (2 tabs)`. Closing one tab keeps the participant online without triggering spurious leave/join events. Only when all socket connections for that participant terminate is an offline status broadcast.


