import asyncio
import subprocess
import logging
from pathlib import Path
from typing import Optional

from backend.config import settings

logger = logging.getLogger(__name__)


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
