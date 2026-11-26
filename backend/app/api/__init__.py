from fastapi import APIRouter
from backend.app.api.rooms import router as rooms_router
from backend.app.api.files import router as files_router

api_router = APIRouter(prefix="/api")
api_router.include_router(rooms_router)
api_router.include_router(files_router)
