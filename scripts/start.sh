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
START_TUNNEL=false

for arg in "$@"; do
    case "$arg" in
        --build)
            REBUILD_FRONTEND=true
            ;;
        --tunnel)
            START_TUNNEL=true
            ;;
        *)
            ;;
    esac
done

if [ ! -d "frontend/dist" ]; then
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

# 6. Optional Cloudflare Quick Tunnel
CLOUDFLARED_PID=""
if [ "$START_TUNNEL" = true ]; then
    if command -v cloudflared >/dev/null 2>&1; then
        echo "🌐 Starting Cloudflare Quick Tunnel..."
        mkdir -p storage
        cloudflared tunnel --url http://localhost:8000 > storage/tunnel.log 2>&1 &
        CLOUDFLARED_PID=$!

        # Wait up to 10 seconds for the tunnel URL to appear in the log
        TUNNEL_URL=""
        for i in {1..20}; do
            TUNNEL_URL=$(grep -oE "https://[a-zA-Z0-9-]+\.trycloudflare\.com" storage/tunnel.log | head -n 1 || true)
            if [ -n "$TUNNEL_URL" ]; then
                break
            fi
            sleep 0.5
        done

        if [ -n "$TUNNEL_URL" ]; then
            echo ""
            echo "=========================================================="
            echo "🎉 Cloudflare Quick Tunnel Live! Share this link with your friend:"
            echo "👉 $TUNNEL_URL"
            echo "=========================================================="
            echo ""
        else
            echo "⚠️  Tunnel initiated in background. Check 'cat storage/tunnel.log' for public link."
        fi
    else
        echo "⚠️  cloudflared is not installed. Run 'brew install cloudflared' to enable --tunnel."
    fi
fi

cleanup() {
    echo ""
    echo "🌸 Shutting down AnimeSync..."
    if [ -n "$CLOUDFLARED_PID" ]; then
        kill "$CLOUDFLARED_PID" 2>/dev/null || true
    fi
    if [ -n "$CAFFEINATE_PID" ]; then
        kill "$CAFFEINATE_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

echo ""
echo "🚀 AnimeSync Server starting at http://localhost:8000"
echo "   Local LAN Address: http://$(ipconfig getifaddr en0 2>/dev/null || echo 'localhost'):8000"
if [ "$START_TUNNEL" = false ]; then
    echo ""
    echo "🌐 Free Public Sharing Options:"
    echo "   1. Auto-Tunnel:  Restart with ./scripts/start.sh --tunnel"
    echo "   2. Manual:       In a separate terminal, run: cloudflared tunnel --url http://localhost:8000"
    echo "   3. Tailscale:    Share your Tailscale IP: http://100.x.y.z:8000"
fi
echo "=========================================================="
echo ""

# Start FastAPI Uvicorn server
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000

