#!/usr/bin/env bash

echo "Stopping AnimeSync services..."

# Kill running Uvicorn instances on port 8000
PID=$(lsof -ti :8000 || true)
if [ -n "$PID" ]; then
    echo "Stopping AnimeSync server (PID $PID)..."
    kill -9 $PID 2>/dev/null || true
    echo "AnimeSync server stopped."
else
    echo "No AnimeSync server running on port 8000."
fi

# Kill any lingering cloudflared tunnel processes if desired
CF_PID=$(pgrep -f "cloudflared tunnel" || true)
if [ -n "$CF_PID" ]; then
    echo "Stopping background cloudflared tunnel (PID $CF_PID)..."
    kill -9 $CF_PID 2>/dev/null || true
fi

echo "All AnimeSync services stopped cleanly."
