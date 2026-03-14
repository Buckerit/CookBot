import hashlib
import logging
import time
from pathlib import Path

from backend.config import settings
from backend.dependencies import get_openai_client

logger = logging.getLogger(__name__)


def _cache_path(text: str) -> Path:
    digest = hashlib.sha256(text.encode()).hexdigest()[:16]
    return settings.audio_cache_path / f"{digest}.mp3"


async def synthesize_speech(text: str) -> AsyncIterator[bytes]:
    """Yield audio chunks for text. Uses file cache to avoid redundant API calls."""
    request_start = time.perf_counter()
    print("[timing] request received: synthesize_speech")
    cached = _cache_path(text)
    if cached.exists():
        logger.debug("TTS cache hit for text hash %s", cached.stem)
        async def _from_file() -> AsyncIterator[bytes]:
            stream_start = time.perf_counter()
            data = cached.read_bytes()
            chunk_size = 4096
            for i in range(0, len(data), chunk_size):
                yield data[i:i + chunk_size]
            print(f"[timing] total response time took {time.perf_counter() - stream_start:.2f}s")
        return _from_file()

    client = get_openai_client()
    logger.info("TTS API call (%d chars)", len(text))

    async def _from_api() -> AsyncIterator[bytes]:
        tts_start = time.perf_counter()
        response = await client.audio.speech.create(
            model=settings.openai_tts_model,
            voice=settings.openai_tts_voice,
            input=text,
            response_format="mp3",
        )
        print(f"[timing] tts call took {time.perf_counter() - tts_start:.2f}s")
        buffer = b""
        async for chunk in response.iter_bytes(chunk_size=4096):
            buffer += chunk
            yield chunk
        # Write to cache after full stream
        cached.write_bytes(buffer)
        logger.debug("TTS cached to %s", cached.name)
        print(f"[timing] total response time took {time.perf_counter() - request_start:.2f}s")

    data = response.content
    cached.write_bytes(data)
    logger.debug("TTS cached %d bytes → %s", len(data), cached.name)
    return data
