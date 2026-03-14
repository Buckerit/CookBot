import json
import logging
from pathlib import Path

from backend.config import settings
from backend.dependencies import get_openai_client
from backend.models.recipe import Recipe

logger = logging.getLogger(__name__)

_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "entity_extraction.txt"
MAX_INPUT_CHARS = 60_000


def _build_context(
    transcript: str,
    ocr_results: list[tuple[int, str]],
    vision_captions: list[tuple[int, str]],
    source_url: str = "",
) -> str:
    parts = []
    if source_url:
        parts.append(f"Source URL: {source_url}\n")
    if transcript:
        parts.append(f"=== AUDIO TRANSCRIPT ===\n{transcript[:MAX_INPUT_CHARS // 2]}")
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
) -> Recipe:
    system_prompt = _PROMPT_PATH.read_text(encoding="utf-8")
    context = _build_context(transcript, ocr_results, vision_captions, source_url)

    client = get_openai_client()
    logger.info("Extracting recipe from video context (%d chars)", len(context))

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

    raw = response.choices[0].message.content or "{}"
    data = json.loads(raw)
    if source_url:
        data["source_url"] = source_url

    # LLM may return null for title — fall back to the YouTube video title
    if not data.get("title"):
        data["title"] = video_title[:100] if video_title else "Untitled Recipe"

    recipe = Recipe.model_validate(data)
    logger.info("Extracted recipe: %s (%d steps, %d ingredients)", recipe.title, len(recipe.steps), len(recipe.ingredients))
    return recipe
