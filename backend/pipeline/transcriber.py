import logging
import re
from pathlib import Path
from typing import Optional

from backend.config import settings
from backend.dependencies import get_openai_client

logger = logging.getLogger(__name__)

MAX_FILE_BYTES = 24 * 1024 * 1024  # 24 MB (Whisper limit is 25 MB)


async def transcribe_audio(audio_path: Path) -> tuple[str, list[dict]]:
    """Transcribe audio file using OpenAI Whisper. Returns (transcript_text, segments)."""
    client = get_openai_client()
    file_size = audio_path.stat().st_size
    logger.info("Transcribing %s (%.1f MB)", audio_path.name, file_size / 1e6)

    if file_size <= MAX_FILE_BYTES:
        with open(audio_path, "rb") as f:
            response = await client.audio.transcriptions.create(
                model=settings.whisper_model,
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )
        segments = [
            {"start": s.start, "end": s.end, "text": s.text}
            for s in (response.segments or [])
        ]
        return response.text, segments

    # File too large — split into chunks using ffmpeg segment
    logger.warning("Audio file too large (%.1f MB), chunking...", file_size / 1e6)
    text = await _transcribe_chunked(audio_path, client)
    return text, []


async def _transcribe_chunked(audio_path: Path, client) -> str:
    """Split audio into 20-minute chunks with 30s overlap and transcribe each."""
    from backend.utils.ffmpeg_utils import run_ffmpeg

    chunk_dir = audio_path.parent / "chunks"
    chunk_dir.mkdir(exist_ok=True)
    chunk_pattern = str(chunk_dir / "chunk_%03d.mp3")

    # 20 min chunks
    await run_ffmpeg(
        "-i", str(audio_path),
        "-f", "segment",
        "-segment_time", "1200",
        "-c", "copy",
        chunk_pattern,
    )

    chunks = sorted(chunk_dir.glob("chunk_*.mp3"))
    transcripts = []
    for chunk in chunks:
        with open(chunk, "rb") as f:
            response = await client.audio.transcriptions.create(
                model=settings.whisper_model,
                file=f,
                response_format="text",
            )
        transcripts.append(response if isinstance(response, str) else response.text)

    return " ".join(transcripts)


def parse_vtt_transcript(vtt_path: Path) -> tuple[str, list[dict]]:
    """Extract plain text and timed segments from a VTT subtitle file."""
    text = vtt_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    segments: list[dict] = []
    result_words: list[str] = []

    i = 0
    while i < len(lines):
        line = lines[i]
        # Match timestamp lines like "00:00:01.000 --> 00:00:04.000"
        ts_match = re.match(
            r"(\d+:\d{2}:\d{2}\.\d+|\d{2}:\d{2}\.\d+)\s*-->\s*(\d+:\d{2}:\d{2}\.\d+|\d{2}:\d{2}\.\d+)",
            line,
        )
        if ts_match:
            start = _vtt_ts_to_seconds(ts_match.group(1))
            end = _vtt_ts_to_seconds(ts_match.group(2))
            i += 1
            seg_lines = []
            while i < len(lines) and lines[i].strip():
                clean = re.sub(r"<[^>]+>", "", lines[i]).strip()
                if clean:
                    seg_lines.append(clean)
                i += 1
            seg_text = " ".join(seg_lines)
            if seg_text:
                segments.append({"start": start, "end": end, "text": seg_text})
                result_words.append(seg_text)
        else:
            i += 1

    # Deduplicate consecutive identical segments (common in auto-captions)
    deduped: list[dict] = []
    for seg in segments:
        if not deduped or seg["text"] != deduped[-1]["text"]:
            deduped.append(seg)

    plain_text = " ".join(s["text"] for s in deduped)
    return plain_text, deduped


def _vtt_ts_to_seconds(ts: str) -> float:
    """Convert VTT timestamp (HH:MM:SS.mmm or MM:SS.mmm) to seconds."""
    parts = ts.split(":")
    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    elif len(parts) == 2:
        m, s = parts
        return int(m) * 60 + float(s)
    return float(ts)
