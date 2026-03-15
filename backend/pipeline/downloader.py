import asyncio
import subprocess
import logging
import re
import tempfile
from pathlib import Path
from typing import Optional

from backend.config import settings

logger = logging.getLogger(__name__)


def _extract_video_id(url: str) -> Optional[str]:
    match = re.search(r"(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})", url)
    return match.group(1) if match else None


async def fetch_transcript_youtube_api(url: str) -> Optional[tuple[str, list[dict]]]:
    """Fetch transcript via youtube-transcript-api (no download, works from servers)."""
    video_id = _extract_video_id(url)
    if not video_id:
        return None
    try:
        from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled
        snippets = await asyncio.to_thread(
            YouTubeTranscriptApi.get_transcript, video_id, languages=["en", "en-US", "en-GB"]
        )
        segments = [{"start": s["start"], "end": s["start"] + s["duration"], "text": s["text"]} for s in snippets]
        transcript = " ".join(s["text"] for s in snippets)
        logger.info("Fetched transcript via youtube-transcript-api for %s (%d segments)", video_id, len(segments))
        return transcript, segments
    except Exception as exc:
        logger.info("youtube-transcript-api failed for %s: %s", video_id, exc)
        return None


def _cookies_args() -> list[str]:
    """Return --cookies flag args if YOUTUBE_COOKIES env var is set."""
    content = settings.youtube_cookies.strip()
    if not content:
        return []
    # Write cookies to a temp file yt-dlp can read
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
    tmp.write(content)
    tmp.close()
    return ["--cookies", tmp.name]


async def fetch_transcript(url: str, task_id: str) -> Optional[Path]:
    """Try to download auto-captions via yt-dlp. Returns path to VTT file or None."""
    output_dir = settings.downloads_path / task_id
    output_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "yt-dlp",
        "--write-auto-sub", "--write-sub",
        "--sub-lang", "en",
        "--skip-download",
        "--sub-format", "vtt",
        "--output", str(output_dir / "%(title)s.%(ext)s"),
        "--no-playlist",
        "--js-runtimes", "node",
        *_cookies_args(),
        url,
    ]
    logger.info("Fetching transcript for: %s", url)
    result = await asyncio.to_thread(lambda: subprocess.run(cmd, capture_output=True))
    vtt_files = list(output_dir.glob("*.vtt"))
    if vtt_files:
        logger.info("Found transcript: %s", vtt_files[0].name)
        return vtt_files[0]
    logger.info("No transcript available for: %s", url)
    return None


async def download_video(url: str, task_id: str) -> Path:
    """Download a video from URL using yt-dlp. Returns path to downloaded file."""
    output_dir = settings.downloads_path / task_id
    output_dir.mkdir(parents=True, exist_ok=True)
    output_template = str(output_dir / "%(title)s.%(ext)s")

    cmd = [
        "yt-dlp",
        "--format", "bestvideo[height<=720]+bestaudio/best[height<=720]",
        "--merge-output-format", "mp4",
        "--output", output_template,
        "--no-playlist",
        "--max-filesize", "2G",
        "--js-runtimes", "node",
        *_cookies_args(),
        url,
    ]

    logger.info("Downloading video: %s", url)

    def _run():
        return subprocess.run(cmd, capture_output=True)

    result = await asyncio.to_thread(_run)

    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {result.stderr.decode(errors='replace')[-2000:]}")

    # Find the downloaded file
    mp4_files = list(output_dir.glob("*.mp4"))
    if not mp4_files:
        raise RuntimeError("yt-dlp completed but no MP4 file found")

    path = mp4_files[0]
    logger.info("Downloaded: %s (%.1f MB)", path.name, path.stat().st_size / 1e6)
    return path
