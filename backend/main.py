import asyncio
import sys

# Windows requires ProactorEventLoop for asyncio.create_subprocess_exec
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from backend.config import settings
from backend.utils.logging_config import setup_logging
from backend.utils.file_utils import create_storage_dirs
from backend.db import init_db
from backend.api import routes_ingest, routes_recipe, routes_chat, routes_tts, routes_realtime


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    create_storage_dirs()
    await init_db()
    yield


app = FastAPI(
    title="CookPilot API",
    description="Hands-free cooking assistant",
    version="0.1.0",
    lifespan=lifespan,
)

# API routes
app.include_router(routes_ingest.router)
app.include_router(routes_recipe.router)
app.include_router(routes_chat.router)
app.include_router(routes_tts.router)
app.include_router(routes_realtime.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve recipe step images
_recipes_dir = Path(settings.storage_base) / "recipes"
_recipes_dir.mkdir(parents=True, exist_ok=True)
app.mount("/recipe-images", StaticFiles(directory=str(_recipes_dir)), name="recipe-images")

# Serve frontend static files
_frontend = Path(__file__).parent.parent / "frontend"
if _frontend.exists():
    app.mount("/static", StaticFiles(directory=str(_frontend)), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(str(_frontend / "index.html"))
