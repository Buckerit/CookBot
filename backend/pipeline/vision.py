import base64
import logging
from pathlib import Path

from backend.config import settings
from backend.dependencies import get_openai_client

logger = logging.getLogger(__name__)

_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "vision_caption.txt"
MAX_FRAMES_PER_BATCH = 20  # kept for reference but no longer used to cap


def _encode_image(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("utf-8")


async def caption_frame(image_path: Path) -> str:
    """Caption a single keyframe using GPT-4o vision."""
    prompt = _PROMPT_PATH.read_text(encoding="utf-8")
    b64 = _encode_image(image_path)
    client = get_openai_client()

    response = await client.chat.completions.create(
        model=settings.openai_model_vision,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"}},
                ],
            }
        ],
        max_tokens=200,
    )
    return response.choices[0].message.content or ""


async def select_best_frame(instruction: str, candidates: list[Path]) -> Path:
    """
    Given several candidate frames for a step, ask GPT-4o to pick the most
    visually representative one. Returns the chosen Path.
    Falls back to the first candidate on any error.
    """
    if len(candidates) == 1:
        return candidates[0]

    client = get_openai_client()
    content: list[dict] = [
        {
            "type": "text",
            "text": (
                f"You are selecting the best photo to illustrate a cooking step.\n"
                f"Step: \"{instruction}\"\n\n"
                f"Below are {len(candidates)} frames from the video numbered 1 to {len(candidates)}. "
                f"Choose the frame that most clearly shows the key action or ingredient for this step. "
                f"Reply with ONLY the number of the best frame, nothing else."
            ),
        }
    ]
    for i, path in enumerate(candidates, start=1):
        b64 = _encode_image(path)
        content.append({"type": "text", "text": f"Frame {i}:"})
        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"}})

    try:
        response = await client.chat.completions.create(
            model=settings.openai_model_vision,
            messages=[{"role": "user", "content": content}],
            max_tokens=5,
            temperature=0,
        )
        raw = (response.choices[0].message.content or "").strip()
        idx = int(raw) - 1
        if 0 <= idx < len(candidates):
            logger.debug("Best frame selected: %d of %d for step '%s'", idx + 1, len(candidates), instruction[:40])
            return candidates[idx]
    except Exception as exc:
        logger.warning("select_best_frame failed (%s), using first candidate", exc)

    return candidates[0]


async def caption_frames(frame_paths: list[Path], sample_rate: int = 2) -> list[tuple[int, str]]:
    """
    Caption a sampled subset of frames.
    sample_rate=4 means every 4th frame (since we extract at 0.5fps = one per 2s, this is every 8s).
    Returns list of (frame_index, caption).
    """
    import asyncio

    sampled = [(i, p) for i, p in enumerate(frame_paths) if i % sample_rate == 0]

    logger.info("Captioning %d frames with GPT-4o vision", len(sampled))

    async def _cap(idx: int, path: Path) -> tuple[int, str]:
        try:
            caption = await caption_frame(path)
            return idx, caption
        except Exception as exc:
            logger.warning("Vision caption failed for frame %d: %s", idx, exc)
            return idx, ""

    results = await asyncio.gather(*[_cap(i, p) for i, p in sampled])
    return [(i, c) for i, c in results if c]
