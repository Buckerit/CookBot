import asyncio
import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.config import settings
from backend.models.ingest import IngestStatus
from backend.services.recipe_store import save_recipe

logger = logging.getLogger(__name__)

# In-memory status store (good enough for MVP single-process)
_tasks: dict[str, IngestStatus] = {}


def get_status(task_id: str) -> Optional[IngestStatus]:
    return _tasks.get(task_id)


def _update(task_id: str, **kwargs) -> None:
    status = _tasks[task_id]
    for k, v in kwargs.items():
        setattr(status, k, v)
    status.updated_at = datetime.utcnow()


def _cleanup_task_media(task_id: str) -> None:
    # Remove per-task video/audio/frame artifacts after the pipeline finishes.
    for path in (
        settings.downloads_path / task_id,
        settings.media_path / task_id,
    ):
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)


def _frame_ts(path: Path, fps: float) -> float:
    """Return timestamp (seconds) for a keyframe file named like 'frame_0001.jpg'."""
    try:
        num = int(path.stem.split("_")[1])
        return (num - 1) / fps
    except (IndexError, ValueError):
        return 0.0


def _assign_step_images(recipe, keyframe_paths: list[Path], fps: float, task_id: str) -> None:
    """Copy best-matching keyframe for each step into persistent recipe storage."""
    if not keyframe_paths:
        return
    recipe_dir = settings.recipes_path / recipe.id
    recipe_dir.mkdir(parents=True, exist_ok=True)
    for step in recipe.steps:
        if step.timestamp_start_seconds is None or step.timestamp_end_seconds is None:
            continue
        # Prefer the LLM-specified ingredient moment; fall back to step midpoint
        if step.image_timestamp_seconds is not None:
            target_ts = step.image_timestamp_seconds
        else:
            target_ts = (step.timestamp_start_seconds + step.timestamp_end_seconds) / 2
        candidates = [
            p for p in keyframe_paths
            if step.timestamp_start_seconds <= _frame_ts(p, fps) <= step.timestamp_end_seconds
        ]
        if not candidates:
            candidates = keyframe_paths
        best = min(candidates, key=lambda p: abs(_frame_ts(p, fps) - target_ts))
        dest = recipe_dir / f"step_{step.index}.jpg"
        shutil.copy(best, dest)
        step.image_url = f"/recipe-images/{recipe.id}/step_{step.index}.jpg"


async def run_url_pipeline(task_id: str, url: str) -> None:
    """Full video ingestion pipeline — runs as a background task."""
    from backend.pipeline import downloader, extractor, transcriber, ocr, vision, entity_extractor

    _tasks[task_id] = IngestStatus(task_id=task_id, status="processing", progress_message="Starting...")

    try:
        # Step 1: Try youtube-transcript-api first (works from any server, no download needed)
        _update(task_id, progress_message="Fetching transcript...")
        transcript_data = await downloader.fetch_transcript_youtube_api(url)

        if transcript_data:
            # Transcript-only fast path — no video download required
            transcript, segments = transcript_data
            video_id = downloader._extract_video_id(url) or url
            logger.info("Transcript-only path for task %s", task_id)

            _update(task_id, progress_message="Extracting recipe from transcript...")
            recipe = await entity_extractor.extract_recipe_from_video(
                transcript, [], [],
                source_url=url, video_title=video_id, segments=segments,
            )
            await save_recipe(recipe)
            _update(task_id, status="done", progress_message="Done!", recipe_id=recipe.id)
            logger.info("Pipeline complete (transcript-only) for task %s → recipe %s", task_id, recipe.id)
            return

        # No transcript available — fall back to full video pipeline (requires cookies)
        if not settings.youtube_cookies.strip():
            raise RuntimeError(
                "No transcript is available for this video, and video download requires "
                "YouTube authentication on cloud servers. Please add a YOUTUBE_COOKIES "
                "environment variable, or try a video that has captions enabled."
            )

        # Step 2: Download video (needs cookies on cloud)
        _update(task_id, progress_message="Downloading video...")
        transcript_path = await downloader.fetch_transcript(url, task_id)
        video_path = await downloader.download_video(url, task_id)

        # Step 3: Extract audio + keyframes
        _update(task_id, progress_message="Extracting audio and frames...")
        audio_path, keyframe_paths, duration = await extractor.extract_media(video_path, task_id)

        # Step 4: Transcript from VTT subtitles or Whisper
        if transcript_path:
            logger.info("Using yt-dlp VTT transcript, skipping Whisper")
            _update(task_id, progress_message="Using available transcript...")
            transcript, segments = transcriber.parse_vtt_transcript(transcript_path)
        else:
            _update(task_id, progress_message="Transcribing audio...")
            transcript, segments = await transcriber.transcribe_audio(audio_path)

        # Step 5: If transcript is sparse, extract denser frames
        word_count = len(transcript.split())
        words_per_minute = (word_count / duration * 60) if duration > 0 else 0
        fps_used = 0.5
        if words_per_minute < 30:
            logger.info("Sparse transcript (%.0f wpm) — extracting denser frames", words_per_minute)
            _update(task_id, progress_message="Sparse audio detected, extracting more frames...")
            keyframe_paths = await extractor.extract_more_keyframes(video_path, task_id, fps=1.0)
            fps_used = 1.0

        # Step 6: OCR + vision (concurrent)
        _update(task_id, progress_message="Analyzing frames...")
        ocr_results, vision_captions = await asyncio.gather(
            asyncio.create_task(ocr.ocr_frames(keyframe_paths)),
            asyncio.create_task(vision.caption_frames(keyframe_paths)),
        )

        # Step 7: Entity extraction
        _update(task_id, progress_message="Extracting recipe...")
        recipe = await entity_extractor.extract_recipe_from_video(
            transcript, ocr_results, vision_captions,
            source_url=url, video_title=video_path.stem, segments=segments,
        )

        # Step 8: Assign step images
        _assign_step_images(recipe, keyframe_paths, fps_used, task_id)

        # Step 9: Save
        await save_recipe(recipe)
        _update(task_id, status="done", progress_message="Done!", recipe_id=recipe.id)
        logger.info("Pipeline complete for task %s → recipe %s", task_id, recipe.id)

    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        logger.exception("Pipeline failed for task %s", task_id)
        error_msg = str(exc) or type(exc).__name__
        _update(task_id, status="error", progress_message="Failed", error=f"{error_msg}\n{tb}")
    finally:
        _cleanup_task_media(task_id)
