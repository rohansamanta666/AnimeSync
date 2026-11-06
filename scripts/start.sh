#!/usr/bin/env bash
set -e

# Change directory to project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=========================================================="
echo "🌸 AnimeSync — Private Synchronized Watch Party"
echo "   Your Anime Night. Together. (同期)"
echo "=========================================================="

# 0. Environment configuration check
if [ ! -f ".env" ]; then
    echo "📄 Creating initial .env configuration from .env.example..."
    cp .env.example .env
fi

# 1. Port conflict check
if lsof -i :8000 >/dev/null 2>&1; then
    echo "⚠️  Port 8000 is already in use by another process."
    echo "   To stop the existing process, run: ./scripts/stop.sh"
    exit 1
fi

# 2. Check Python virtual environment
if [ ! -d ".venv" ]; then
    echo "🐍 Creating Python virtual environment..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r backend/requirements.txt
else
    source .venv/bin/activate
fi

# 3. Check and build frontend assets
REBUILD_FRONTEND=false
if [ "$1" == "--build" ] || [ ! -d "frontend/dist" ]; then
    REBUILD_FRONTEND=true
fi

if [ "$REBUILD_FRONTEND" = true ]; then
    echo "⚛️  Building frontend production assets..."
    cd frontend
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    npm run build
    cd "$PROJECT_ROOT"
fi

# 4. Storage directory verification
mkdir -p storage/videos storage/uploads_temp

# 5. Prevent Mac sleep during watch party session (caffeinate)
CAFFEINATE_PID=""
if command -v caffeinate >/dev/null 2>&1; then
    echo "☕ macOS sleep prevention activated (caffeinate)."
    caffeinate -dimsu -w $$ &
    CAFFEINATE_PID=$!
fi

cleanup() {
    echo ""
    echo "🌸 Shutting down AnimeSync..."
    if [ -n "$CAFFEINATE_PID" ]; then
        kill "$CAFFEINATE_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

echo ""
echo "🚀 AnimeSync Server starting at http://localhost:8000"
echo "   Local LAN Address: http://$(ipconfig getifaddr en0 2>/dev/null || echo 'localhost'):8000"
echo ""
echo "🌐 Free Public Sharing Options:"
echo "   1. Cloudflare Quick Tunnel (Zero setup, zero credit card):"
echo "      Run in a second terminal: cloudflared tunnel --url http://localhost:8000"
echo "   2. Tailscale WireGuard Mesh (Highest direct peer-to-peer speed):"
echo "      Share your Tailscale IP: http://100.x.y.z:8000"
echo "=========================================================="
echo ""

# Start FastAPI Uvicorn server
exec uvicorn backend.app.main:app --host 0.0.0.0 --port 8000

