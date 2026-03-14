import hashlib
import logging
from pathlib import Path
from typing import AsyncIterator

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)


def _cache_path(text: str) -> Path:
    digest_input = f"{settings.elevenlabs_voice_id}:{settings.elevenlabs_model_id}:{text}"
    digest = hashlib.sha256(digest_input.encode()).hexdigest()[:16]
    return settings.audio_cache_path / f"{digest}.mp3"


async def synthesize_speech(text: str) -> AsyncIterator[bytes]:
    """Yield audio chunks for text. Uses file cache to avoid redundant API calls."""
    if not settings.elevenlabs_api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured")

    cached = _cache_path(text)
    if cached.exists():
        logger.debug("TTS cache hit for text hash %s", cached.stem)

        async def _from_file() -> AsyncIterator[bytes]:
            data = cached.read_bytes()
            chunk_size = 4096
            for i in range(0, len(data), chunk_size):
                yield data[i:i + chunk_size]

        return _from_file()

    logger.info("TTS API call for %d chars", len(text))

    async def _from_elevenlabs() -> AsyncIterator[bytes]:
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{settings.elevenlabs_voice_id}/stream"
        payload = {
            "text": text,
            "model_id": settings.elevenlabs_model_id,
        }
        headers = {
            "xi-api-key": settings.elevenlabs_api_key,
            "Accept": "audio/mpeg",
        }
        buffer = b""

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes(chunk_size=4096):
                    if not chunk:
                        continue
                    buffer += chunk
                    yield chunk

        cached.write_bytes(buffer)
        logger.debug("TTS cached to %s", cached.name)

    async def _from_api() -> AsyncIterator[bytes]:
        async for chunk in _from_elevenlabs():
            yield chunk

    return _from_api()
