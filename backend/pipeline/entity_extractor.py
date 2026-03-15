import logging
import time
from pathlib import Path

from backend.config import settings
from backend.dependencies import get_openai_client
from backend.models.recipe import Recipe
from backend.utils.llm_json import parse_llm_recipe_json

logger = logging.getLogger(__name__)

_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "entity_extraction.txt"
MAX_INPUT_CHARS = 60_000


def _build_timed_context(segments: list[dict]) -> str:
    return "\n".join(
        f"[{s['start']:.1f}s-{s['end']:.1f}s]: {s['text'].strip()}"
        for s in segments
    )


def _build_context(
    transcript: str,
    ocr_results: list[tuple[int, str]],
    vision_captions: list[tuple[int, str]],
    source_url: str = "",
    segments: list[dict] | None = None,
) -> str:
    parts = []
    if source_url:
        parts.append(f"Source URL: {source_url}\n")
    if transcript:
        parts.append(f"=== AUDIO TRANSCRIPT ===\n{transcript[:MAX_INPUT_CHARS // 2]}")
    if segments:
        timed = _build_timed_context(segments)
        parts.append(f"=== TIMED TRANSCRIPT SEGMENTS ===\n{timed[:MAX_INPUT_CHARS // 2]}")
    if ocr_results:
        ocr_text = "\n".join(f"[Frame {i}]: {t}" for i, t in ocr_results)
        parts.append(f"=== ON-SCREEN TEXT (OCR) ===\n{ocr_text}")
    if vision_captions:
        cap_text = "\n".join(f"[Frame {i}]: {t}" for i, t in vision_captions)
        parts.append(f"=== VISUAL DESCRIPTIONS ===\n{cap_text}")
    return "\n\n".join(parts)[:MAX_INPUT_CHARS]


async def extract_recipe_from_video(
    transcript: str,
    ocr_results: list[tuple[int, str]],
    vision_captions: list[tuple[int, str]],
    source_url: str = "",
    video_title: str = "",
    segments: list[dict] | None = None,
) -> Recipe:
    request_start = time.perf_counter()
    print("[timing] request received: extract_recipe_from_video")

    prompt_start = time.perf_counter()
    system_prompt = _PROMPT_PATH.read_text(encoding="utf-8")
    print(f"[timing] prompt load took {time.perf_counter() - prompt_start:.2f}s")
    context = _build_context(transcript, ocr_results, vision_captions, source_url, segments)

    client = get_openai_client()
    logger.info("Extracting recipe from video context (%d chars)", len(context))

    extractor_start = time.perf_counter()
    response = await client.chat.completions.create(
        model=settings.openai_model_vision,  # Use GPT-4o for better video understanding
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": context},
        ],
        response_format={"type": "json_object"},
        max_tokens=4096,
        temperature=0.2,
    )
    print(f"[timing] extractor call took {time.perf_counter() - extractor_start:.2f}s")

    raw = response.choices[0].message.content or "{}"
    data = parse_llm_recipe_json(raw, "video extractor")
    if source_url:
        data["source_url"] = source_url

    # LLM may return null for title — fall back to the YouTube video title
    if not data.get("title"):
        data["title"] = video_title[:100] if video_title else "Untitled Recipe"

    recipe = Recipe.model_validate(data)
    logger.info("Extracted recipe: %s (%d steps, %d ingredients)", recipe.title, len(recipe.steps), len(recipe.ingredients))
    print(f"[timing] total response time took {time.perf_counter() - request_start:.2f}s")
    return recipe
