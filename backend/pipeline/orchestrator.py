import asyncio
import logging
from datetime import datetime
from typing import Optional

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


async def run_url_pipeline(task_id: str, url: str) -> None:
    """Full video ingestion pipeline — runs as a background task."""
    from backend.pipeline import downloader, extractor, transcriber, ocr, vision, entity_extractor

    _tasks[task_id] = IngestStatus(task_id=task_id, status="processing", progress_message="Starting download...")

    try:
        # Step 1: Download
        _update(task_id, progress_message="Downloading video...")
        video_path = await downloader.download_video(url, task_id)

        # Step 2: Extract audio + keyframes
        _update(task_id, progress_message="Extracting audio and frames...")
        audio_path, keyframe_paths, duration = await extractor.extract_media(video_path, task_id)

        # Step 3: Transcribe
        _update(task_id, progress_message="Transcribing audio...")
        transcript = await transcriber.transcribe_audio(audio_path)

        # If the transcript is sparse (<30 words/min), double the frame rate for better visual coverage
        word_count = len(transcript.split())
        words_per_minute = (word_count / duration * 60) if duration > 0 else 0
        if words_per_minute < 30:
            logger.info("Sparse transcript (%.0f wpm) — extracting denser frames", words_per_minute)
            _update(task_id, progress_message="Sparse audio detected, extracting more frames...")
            keyframe_paths = await extractor.extract_more_keyframes(video_path, task_id, fps=1.0)

        # Step 4: OCR frames (run concurrently with vision)
        _update(task_id, progress_message="Analyzing frames...")
        ocr_task = asyncio.create_task(ocr.ocr_frames(keyframe_paths))
        vision_task = asyncio.create_task(vision.caption_frames(keyframe_paths))
        ocr_results, vision_captions = await asyncio.gather(ocr_task, vision_task)

        # Step 5: Entity extraction
        _update(task_id, progress_message="Extracting recipe...")
        video_title = video_path.stem  # yt-dlp names the file after the video title
        recipe = await entity_extractor.extract_recipe_from_video(
            transcript, ocr_results, vision_captions, source_url=url, video_title=video_title
        )

        # Step 6: Save
        save_recipe(recipe)
        _update(task_id, status="done", progress_message="Done!", recipe_id=recipe.id)
        logger.info("Pipeline complete for task %s → recipe %s", task_id, recipe.id)

    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        logger.exception("Pipeline failed for task %s", task_id)
        error_msg = str(exc) or type(exc).__name__
        _update(task_id, status="error", progress_message="Failed", error=f"{error_msg}\n{tb}")
