import shutil
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import socketio
from backend.app.config import settings
from backend.app.database import init_db
from backend.app.api import api_router
from backend.app.sockets import sio

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database schema
    await init_db()
    yield

fastapi_app = FastAPI(
    title="AnimeSync API",
    description="Private desktop-first synchronized anime watch-party backend",
    version="1.0.0",
    lifespan=lifespan
)

# CORS setup: allow local dev, configured origins, and dynamic Cloudflare Quick Tunnel / LAN / Tailscale domains
configured_origins = ["*"] if (settings.ENVIRONMENT == "development" or "*" in settings.cors_origins_list) else settings.cors_origins_list
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins,
    allow_origin_regex=r"^https?://([a-zA-Z0-9-]+\.)*trycloudflare\.com(:[0-9]+)?$|^https?://(localhost|127\.0\.0\.1|100\..*|192\.168\..*|10\..*)(:[0-9]+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API routes
fastapi_app.include_router(api_router)

@fastapi_app.get("/api/health")
async def health_check():
    # Check free disk space on storage volume
    total, used, free = shutil.disk_usage(settings.STORAGE_DIR)
    return {
        "status": "healthy",
        "version": "1.0.0",
        "environment": settings.ENVIRONMENT,
        "storage": {
            "total_bytes": total,
            "used_bytes": used,
            "free_bytes": free,
            "free_gb": round(free / (1024 ** 3), 2)
        }
    }

# Serve compiled frontend in production if built
frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    fastapi_app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

    @fastapi_app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Do not mask non-existent API or Socket.IO routes with SPA HTML
        if full_path.startswith("api/") or full_path == "api" or full_path.startswith("socket.io"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="API route not found")

        resolved_dist = frontend_dist.resolve()
        requested_path = (frontend_dist / full_path).resolve()

        # Secure check: ensure requested file stays within frontend/dist directory
        if requested_path.is_file() and str(requested_path).startswith(str(resolved_dist)):
            return FileResponse(str(requested_path))
        return FileResponse(str(frontend_dist / "index.html"))

# Wrap with python-socketio ASGI application
app = socketio.ASGIApp(
    socketio_server=sio,
    other_asgi_app=fastapi_app,
    socketio_path="/socket.io"
)
