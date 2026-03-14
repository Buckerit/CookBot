import logging
import time
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from backend.services.tts_service import synthesize_speech

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tts", tags=["tts"])


class TTSRequest(BaseModel):
    text: str


@router.post("")
async def text_to_speech(request: TTSRequest):
    """Convert text to speech and stream MP3 audio."""
    request_start = time.perf_counter()
    print("[timing] request received: POST /tts")
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    if len(request.text) > 4096:
        raise HTTPException(status_code=400, detail="Text too long (max 4096 chars)")

    try:
        stream = await synthesize_speech(request.text)
        print(f"[timing] total response time took {time.perf_counter() - request_start:.2f}s")
        return StreamingResponse(stream, media_type="audio/mpeg")
    except Exception as exc:
        logger.error("TTS failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"TTS error: {exc}")
