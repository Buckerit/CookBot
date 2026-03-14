import logging
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
    """Convert text to speech and return MP3 audio."""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    if len(request.text) > 4096:
        raise HTTPException(status_code=400, detail="Text too long (max 4096 chars)")

    try:
        audio = await synthesize_speech(request.text)
        return Response(content=audio, media_type="audio/mpeg")
    except Exception as exc:
        logger.error("TTS failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"TTS error: {exc}")
