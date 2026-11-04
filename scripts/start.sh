#!/usr/bin/env bash
set -e

# Change directory to project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=========================================================="
echo "🌸 AnimeSync — Private Synchronized Watch Party"
echo "   Your Anime Night. Together. (同期)"
echo "=========================================================="

# 1. Check Python virtual environment
if [ ! -d ".venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r backend/requirements.txt
else
    source .venv/bin/activate
fi

# 2. Check and build frontend if dist is missing
if [ ! -d "frontend/dist" ]; then
    echo "Building frontend production assets..."
    cd frontend
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    npm run build
    cd "$PROJECT_ROOT"
fi

# 3. Prevent Mac sleep during watch party session (caffeinate)
if command -v caffeinate >/dev/null 2>&1; then
    echo "☕ macOS sleep prevention activated (caffeinate)."
    caffeinate -dimsu -w $$ &
fi

# 4. Storage directory verification
mkdir -p storage/videos storage/uploads_temp

echo ""
echo "🚀 Starting AnimeSync Server at http://localhost:8000"
echo "   Local Network: http://$(ipconfig getifaddr en0 2>/dev/null || echo 'localhost'):8000"
echo ""
echo "🌐 To invite your friend over the internet (100% Free):"
echo "   Run in a separate terminal: cloudflared tunnel --url http://localhost:8000"
echo "   Or use Tailscale mesh for direct zero-limit P2P speed."
echo "=========================================================="
echo ""

# Start FastAPI Uvicorn server
exec uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
