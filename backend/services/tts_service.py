import hashlib
import logging
from pathlib import Path

from backend.config import settings
from backend.dependencies import get_openai_client

logger = logging.getLogger(__name__)


def _cache_path(text: str) -> Path:
    digest = hashlib.sha256(text.encode()).hexdigest()[:16]
    return settings.audio_cache_path / f"{digest}.mp3"


async def synthesize_speech(text: str) -> bytes:
    """Return MP3 audio bytes for text. Uses file cache to avoid redundant API calls."""
    cached = _cache_path(text)
    if cached.exists():
        logger.debug("TTS cache hit: %s", cached.stem)
        return cached.read_bytes()

    client = get_openai_client()
    logger.info("TTS API call (%d chars)", len(text))

    response = await client.audio.speech.create(
        model=settings.openai_tts_model,
        voice=settings.openai_tts_voice,
        input=text,
        response_format="mp3",
    )

    data = response.content
    cached.write_bytes(data)
    logger.debug("TTS cached %d bytes → %s", len(data), cached.name)
    return data
