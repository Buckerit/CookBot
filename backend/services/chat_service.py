import json
import logging
import orjson
import re
from pathlib import Path
from typing import Optional, AsyncIterator

from backend.config import settings
from backend.dependencies import get_openai_client
from backend.models.chat import ChatMessage, ChatSession
from backend.models.recipe import Recipe
from backend.services import substitution_service
from backend.services.timer_service import extract_duration_seconds

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "system_chat.txt"
_CONVERSION_REFERENCE = """
Useful approximate kitchen conversions:
- 1 tablespoon butter ≈ 14 grams
- 1 tablespoon oil ≈ 14 grams
- 1 tablespoon water ≈ 15 milliliters
- 1 tablespoon sugar ≈ 12 to 13 grams
- 1 tablespoon flour ≈ 8 grams
- 1 teaspoon salt ≈ 5 to 6 grams

Consistency rule:
- If you suggested an amount already, and the user asks for it in another unit, convert that same amount instead of changing the recommendation.
""".strip()

# Navigation intent patterns
_NEXT_INTENTS = {"next", "next step", "continue", "done", "ready", "ok", "okay", "go", "proceed"}
_PREV_INTENTS = {"previous", "prev", "go back", "last step", "back"}
_REPEAT_INTENTS = {"repeat", "again", "what was that", "say that again", "what", "huh"}
_RESTART_INTENTS = {"start over", "beginning", "restart", "from the top", "reset"}
_STEP_JUMP_PATTERN = re.compile(
    r"\b(?:go to|goto|jump to|skip to|take me to|move to)\s+step\s+(\d+)\b",
    re.IGNORECASE,
)

# Substitution trigger phrases
_SUB_TRIGGERS = ["don't have", "dont have", "allergic", "substitute", "instead of", "alternative to", "out of"]

_AMBIGUOUS_AMOUNT_HINTS = [
    (("salt",), "start with about 1/4 teaspoon, then adjust to taste"),
    (("pepper",), "start with about 1/8 to 1/4 teaspoon"),
    (("olive oil", "vegetable oil", "oil"), "start with about 1 tablespoon"),
    (("butter",), "start with about 1 tablespoon"),
    (("garlic",), "start with 1 clove"),
    (("sugar", "brown sugar", "honey", "maple syrup"), "start with about 1 tablespoon, then taste"),
    (("soy sauce",), "start with 1 to 2 teaspoons"),
    (("lemon juice", "lime juice", "vinegar"), "start with about 1 teaspoon"),
    (("milk", "cream", "water", "broth", "stock"), "start with 2 to 3 tablespoons and add more if needed"),
    (("flour", "cornstarch"), "start with about 1 tablespoon"),
    (("parmesan", "cheese"), "start with about 2 tablespoons"),
    (("parsley", "cilantro", "basil", "herbs"), "start with about 1 tablespoon"),
    (("onion", "scallion", "green onion"), "start with about 2 tablespoons chopped"),
    (("paprika", "cumin", "chili", "red pepper flakes"), "start with about 1/4 teaspoon"),
    (("egg", "eggs"), "start with 1 egg"),
]

_NAV_TRANSITIONS = {
    "next": "Great, let's move to the next step.",
    "prev": "Sure, let's go back one step.",
    "repeat": "Of course. Here's that step again.",
    "restart": "Let's start again from the beginning.",
    "jump": "Sure, let's jump to that step.",
}
_AMBIGUITY_NOTE_CACHE: dict[tuple[str, int], list[str]] = {}
_INGREDIENT_ESTIMATE_CACHE: dict[tuple[str, str], str] = {}
_SERVING_STEP_PATTERN = re.compile(
    r"\b(?:serve|serving|plate|plating|garnish|enjoy|ready to eat|ready to serve)\b",
    re.IGNORECASE,
)


def _session_path(session_id: str) -> Path:
    return settings.sessions_path / f"{session_id}.json"


def load_session(session_id: str) -> Optional[ChatSession]:
    path = _session_path(session_id)
    if not path.exists():
        return None
    return ChatSession.model_validate(orjson.loads(path.read_bytes()))


def save_session(session: ChatSession) -> None:
    path = _session_path(session.session_id)
    path.write_bytes(orjson.dumps(session.model_dump(mode="json"), option=orjson.OPT_INDENT_2))


def create_session(recipe: Recipe) -> ChatSession:
    session = ChatSession(recipe_id=recipe.id)
    save_session(session)
    return session


def _detect_nav_intent(text: str) -> Optional[str]:
    normalized = re.sub(r"[!.,?]", "", text.strip().lower())
    normalized = re.sub(r"\b(?:please|pls|plz)\b", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if normalized in _NEXT_INTENTS:
        return "next"
    if normalized in _PREV_INTENTS:
        return "prev"
    if normalized in _REPEAT_INTENTS:
        return "repeat"
    if normalized in _RESTART_INTENTS:
        return "restart"
    if any(phrase in normalized for phrase in ("next step", "go next", "move on", "keep going", "continue on")):
        return "next"
    if any(phrase in normalized for phrase in ("previous step", "step before", "go back", "back one")):
        return "prev"
    if any(phrase in normalized for phrase in ("repeat that", "say that again", "repeat step")):
        return "repeat"
    return None


def _detect_substitution_request(text: str) -> Optional[str]:
    lower = text.lower()
    for trigger in _SUB_TRIGGERS:
        if trigger in lower:
            return text
    return None


def _detect_step_jump_intent(text: str, total_steps: int) -> Optional[int]:
    match = _STEP_JUMP_PATTERN.search(text)
    if not match:
        return None
    step_number = int(match.group(1))
    if step_number < 1 or step_number > total_steps:
        return None
    return step_number - 1


def _build_system_prompt(recipe: Recipe) -> str:
    template = _SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
    recipe_json = json.dumps(recipe.model_dump(mode="json"), indent=2)
    return template.replace("{recipe_json}", recipe_json) + f"\n\n## Conversion Reference\n{_CONVERSION_REFERENCE}"


def _completion_message(recipe: Recipe) -> str:
    return f"Congratulations!! You're all set. Plate up your {recipe.title} and enjoy!!"


def _fallback_missing_amount(ingredient_name: str) -> str:
    lowered = ingredient_name.lower()
    for keywords, hint in _AMBIGUOUS_AMOUNT_HINTS:
        if any(keyword in lowered for keyword in keywords):
            return hint
    return "start with a small amount and adjust as you go"


async def _ambiguity_notes(recipe: Recipe, step_index: int) -> list[str]:
    cache_key = (recipe.id, step_index)
    if cache_key in _AMBIGUITY_NOTE_CACHE:
        return _AMBIGUITY_NOTE_CACHE[cache_key]

    if step_index < 0 or step_index >= len(recipe.steps):
        return []

    step = recipe.steps[step_index]
    if not step.ingredients_used:
        return []

    missing_ingredients = []
    for ingredient_name in step.ingredients_used:
        match = next(
            (
                ingredient
                for ingredient in recipe.ingredients
                if ingredient.name.strip().lower() == ingredient_name.strip().lower()
            ),
            None,
        )
        if not match or match.quantity:
            continue
        missing_ingredients.append(match.name)

    if not missing_ingredients:
        _AMBIGUITY_NOTE_CACHE[cache_key] = []
        return []

    unseen_ingredients = [
        name for name in missing_ingredients
        if (recipe.id, name.strip().lower()) not in _INGREDIENT_ESTIMATE_CACHE
    ]
    if not unseen_ingredients:
        _AMBIGUITY_NOTE_CACHE[cache_key] = []
        return []

    fallback_estimates = {name: _fallback_missing_amount(name) for name in unseen_ingredients}
    prior_estimates = {
        name: _INGREDIENT_ESTIMATE_CACHE[(recipe.id, name.strip().lower())]
        for name in missing_ingredients
        if (recipe.id, name.strip().lower()) in _INGREDIENT_ESTIMATE_CACHE
    }

    prompt = (
        "You are helping with a cooking recipe. The recipe source omitted exact amounts for some ingredients in the current step.\n"
        "Using the recipe title, current step, and ingredient list, suggest practical starting amounts that make culinary sense.\n"
        "Be conservative, internally consistent, and specific to each ingredient. Do not invent certainty; say it is approximate.\n"
        "Choose units that make culinary sense for the ingredient, not generic tablespoon defaults.\n"
        "Prefer grams for solid ingredients like butter, crackers, chocolate, cheese, flour, breadcrumbs, and chopped vegetables.\n"
        "Prefer counts for discrete items like eggs, garlic cloves, cookies, biscuits, and fruit.\n"
        "Prefer teaspoons or tablespoons only for spices, extracts, sauces, or small seasoning amounts.\n"
        "Prefer milliliters only for liquids.\n"
        "Avoid using cups or tablespoons for ingredients like graham crackers or butter when a weight estimate in grams would be more sensible.\n"
        "Return the amount as a short phrase that already includes the unit, for example: 'start with about 60 grams', 'start with 1 egg', or 'start with about 1/4 teaspoon'.\n"
        "Return strict JSON with this shape: "
        '{"notes":[{"ingredient":"butter","estimate":"start with about 60 grams"}]}'
    )
    context = {
        "title": recipe.title,
        "current_step": step.instruction,
        "ingredients_used_in_step": step.ingredients_used,
        "full_ingredient_list": [
            {
                "name": ingredient.name,
                "quantity": ingredient.quantity,
                "unit": ingredient.unit,
                "notes": ingredient.notes,
            }
            for ingredient in recipe.ingredients
        ],
        "missing_amount_ingredients": unseen_ingredients,
        "prior_estimates_from_earlier_steps": prior_estimates,
    }

    client = get_openai_client()
    try:
        response = await client.chat.completions.create(
            model=settings.openai_model_chat,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps(context)},
            ],
            response_format={"type": "json_object"},
            max_tokens=300,
            temperature=0.2,
        )
        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)
        note_map = {
            str(item.get("ingredient", "")).strip().lower(): str(item.get("estimate", "")).strip()
            for item in data.get("notes", [])
            if item.get("ingredient") and item.get("estimate")
        }
        estimates = {
            name: note_map.get(name.lower(), fallback_estimates[name])
            for name in unseen_ingredients
        }
    except Exception as exc:
        logger.warning("Ambiguous amount estimation failed for recipe %s step %s: %s", recipe.id, step_index, exc)
        estimates = fallback_estimates

    for name, estimate in estimates.items():
        _INGREDIENT_ESTIMATE_CACHE[(recipe.id, name.strip().lower())] = estimate

    if len(unseen_ingredients) == 1:
        name = unseen_ingredients[0]
        notes = [f"The source does not give an exact amount for {name}, so I would {estimates[name]}."]
    else:
        joined_names = ", ".join(unseen_ingredients[:-1]) + f", and {unseen_ingredients[-1]}"
        estimate_parts = [f"{name}: {estimates[name]}" for name in unseen_ingredients]
        notes = [
            f"The source does not give exact amounts for {joined_names}, so I would use approximately "
            + "; ".join(estimate_parts)
            + "."
        ]

    _AMBIGUITY_NOTE_CACHE[cache_key] = notes
    return notes


async def _step_message(recipe: Recipe, step_index: int) -> dict:
    if step_index >= len(recipe.steps):
        instruction = _completion_message(recipe)
        return {
            "type": "step_change",
            "payload": {
                "step_index": step_index,
                "step_number": len(recipe.steps) + 1,
                "total_steps": len(recipe.steps) + 1,
                "instruction": instruction,
                "tips": [],
                "ingredients_used": [],
                "duration_seconds": None,
                "spoken_follow_up": "",
                "image_url": recipe.completion_image_url,
                "is_completion": True,
            },
        }
    step = recipe.steps[step_index]
    is_serving_finish = step_index == len(recipe.steps) - 1 and _SERVING_STEP_PATTERN.search(step.instruction or "")
    ambiguity_notes = await _ambiguity_notes(recipe, step_index)
    instruction = step.instruction
    spoken_follow_up = " ".join(ambiguity_notes)
    tips = step.tips + ambiguity_notes
    if is_serving_finish:
        instruction = _completion_message(recipe)
        spoken_follow_up = ""
        tips = step.tips
    return {
        "type": "step_change",
        "payload": {
            "step_index": step_index,
            "step_number": step_index + 1,
            "total_steps": len(recipe.steps),
            "instruction": instruction,
            "tips": tips,
            "ingredients_used": step.ingredients_used,
            "duration_seconds": step.duration_seconds,
            "spoken_follow_up": spoken_follow_up,
            "image_url": step.image_url,
        },
    }


async def process_message(
    session: ChatSession,
    recipe: Recipe,
    user_text: str,
) -> AsyncIterator[dict]:
    """Process a user message and yield event dicts for the WebSocket."""

    jump_to = _detect_step_jump_intent(user_text, len(recipe.steps))
    if jump_to is not None:
        yield {
            "type": "bot_message",
            "payload": {
                "content": _NAV_TRANSITIONS["jump"],
                "step_index": session.current_step_index,
                "transition": True,
            },
        }
        session.current_step_index = jump_to
        event = await _step_message(recipe, session.current_step_index)
        save_session(session)

        if event["type"] == "step_change":
            duration = event["payload"].get("duration_seconds")
            if not duration:
                duration = extract_duration_seconds(event["payload"]["instruction"])
            if duration:
                yield {
                    "type": "timer_start",
                    "payload": {"duration_seconds": duration, "step_index": session.current_step_index},
                }
        yield event
        return

    # 1. Check for navigation intents first (no GPT needed)
    intent = _detect_nav_intent(user_text)
    if intent:
        transition = _NAV_TRANSITIONS.get(intent)
        if transition:
            yield {
                "type": "bot_message",
                "payload": {
                    "content": transition,
                    "step_index": session.current_step_index,
                    "transition": True,
                },
            }
        if intent == "next":
            if session.current_step_index < len(recipe.steps):
                session.current_step_index += 1
        elif intent == "prev":
            session.current_step_index = max(0, session.current_step_index - 1)
        elif intent == "restart":
            session.current_step_index = 0
        # repeat: no change

        event = await _step_message(recipe, session.current_step_index)
        save_session(session)

        # Check for timer on new step
        if event["type"] == "step_change":
            duration = event["payload"].get("duration_seconds")
            if not duration:
                duration = extract_duration_seconds(event["payload"]["instruction"])
            if duration:
                yield {
                    "type": "timer_start",
                    "payload": {"duration_seconds": duration, "step_index": session.current_step_index},
                }
        yield event
        return

    # 2. Check for substitution request
    sub_request = _detect_substitution_request(user_text)
    if sub_request:
        try:
            answer = await substitution_service.get_substitution(recipe, user_text)
            yield {
                "type": "bot_message",
                "payload": {"content": answer, "step_index": session.current_step_index},
            }
            session.message_history.append(ChatMessage(role="user", content=user_text))
            session.message_history.append(ChatMessage(role="assistant", content=answer))
            save_session(session)
            return
        except Exception as exc:
            logger.warning("Substitution service error: %s", exc)
            # Fall through to regular GPT

    # 3. Regular GPT conversation
    session.message_history.append(ChatMessage(role="user", content=user_text))

    current_step = recipe.steps[min(session.current_step_index, len(recipe.steps) - 1)] if recipe.steps else None
    step_context = ""
    if current_step:
        step_context = (
            f"\n\n[Current context: User is on Step {session.current_step_index + 1}/{len(recipe.steps)}: "
            f"{current_step.instruction}]"
        )

    system_prompt = _build_system_prompt(recipe) + step_context

    messages = [{"role": "system", "content": system_prompt}]
    # Keep last 20 messages for context
    for msg in session.message_history[-20:]:
        messages.append({"role": msg.role, "content": msg.content})

    client = get_openai_client()
    try:
        response = await client.chat.completions.create(
            model=settings.openai_model_chat,
            messages=messages,
            max_tokens=400,
            temperature=0.6,
        )
        answer = response.choices[0].message.content or ""
        session.message_history.append(ChatMessage(role="assistant", content=answer))
        save_session(session)
        yield {
            "type": "bot_message",
            "payload": {"content": answer, "step_index": session.current_step_index},
        }
    except Exception as exc:
        logger.error("GPT call failed: %s", exc)
        yield {
            "type": "error",
            "payload": {"message": "I had trouble thinking of a response. Please try again."},
        }
