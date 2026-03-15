import asyncio
import logging
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional

from backend.models.ingest import IngestStatus
from backend.models.recipe import Recipe
from backend.pipeline.text_parser import parse_recipe_text
from backend.pipeline.orchestrator import get_status, run_url_pipeline, _tasks
from backend.services.recipe_store import save_recipe
from backend.services.web_scraper import scrape_recipe_page
from backend.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ingest", tags=["ingest"])


class TextIngestRequest(BaseModel):
    text: str
    source_url: Optional[str] = None


class UrlIngestRequest(BaseModel):
    url: str


class RecipeUrlRequest(BaseModel):
    url: str


@router.post("/text", response_model=Recipe)
async def ingest_text(request: TextIngestRequest):
    """Parse plain recipe text and return structured Recipe JSON."""
    request_start = time.perf_counter()
    print("[timing] request received: POST /ingest/text")
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    try:
        recipe = await parse_recipe_text(request.text, source_url=request.source_url or "")
        save_recipe(recipe)
        print(f"[timing] total response time took {time.perf_counter() - request_start:.2f}s")
        return recipe
    except Exception as exc:
        logger.error("Text ingest failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Parsing failed: {exc}")


@router.post("/url", response_model=IngestStatus)
async def ingest_url(request: UrlIngestRequest):
    """Start async video pipeline for a URL (YouTube, etc.)."""
    import uuid
    task_id = str(uuid.uuid4())
    _tasks[task_id] = IngestStatus(task_id=task_id, status="pending", progress_message="Queued")
    # Use asyncio.create_task so the pipeline runs in the same event loop
    asyncio.create_task(run_url_pipeline(task_id, request.url))
    return _tasks[task_id]


@router.get("/status/{task_id}", response_model=IngestStatus)
async def get_ingest_status(task_id: str):
    status = get_status(task_id)
    if not status:
        raise HTTPException(status_code=404, detail="Task not found")
    return status


@router.post("/recipe-url", response_model=Recipe)
async def ingest_recipe_url(request: RecipeUrlRequest):
    """Scrape a recipe website URL and parse it as a recipe."""
    if not request.url.strip():
        raise HTTPException(status_code=400, detail="URL cannot be empty")
    try:
        text = await scrape_recipe_page(request.url)
        recipe = await parse_recipe_text(text, source_url=request.url)
        save_recipe(recipe)
        return recipe
    except Exception as exc:
        logger.error("Recipe URL ingest failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to import recipe: {exc}")


@router.post("/file", response_model=Recipe)
async def ingest_file(file: UploadFile = File(...)):
    """Upload a .txt or .pdf recipe file."""
    request_start = time.perf_counter()
    print("[timing] request received: POST /ingest/file")
    content_type = file.content_type or ""
    filename = file.filename or ""

    if filename.endswith(".pdf") or "pdf" in content_type:
        try:
            import fitz  # PyMuPDF
            data = await file.read()
            doc = fitz.open(stream=data, filetype="pdf")
            text = "\n".join(page.get_text() for page in doc)
        except ImportError:
            raise HTTPException(status_code=500, detail="PyMuPDF not installed")
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"PDF parse error: {exc}")
    else:
        # Treat as plain text
        data = await file.read()
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = data.decode("latin-1")

    if not text.strip():
        raise HTTPException(status_code=400, detail="File appears to be empty")

    try:
        recipe = await parse_recipe_text(text, source_url=filename)
        save_recipe(recipe)
        print(f"[timing] total response time took {time.perf_counter() - request_start:.2f}s")
        return recipe
    except Exception as exc:
        logger.error("File ingest failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Parsing failed: {exc}")
