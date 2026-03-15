import json
import logging
import re
from typing import Optional, AsyncIterator
from pathlib import Path

from backend.config import settings
from backend.db import async_session_factory, SessionRow
from backend.dependencies import get_openai_client
from backend.models.chat import ChatMessage, ChatSession
from backend.models.recipe import Recipe
from backend.services import substitution_service
from backend.services.timer_service import extract_duration_seconds

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "system_chat.txt"

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


async def load_session(session_id: str) -> Optional[ChatSession]:
    async with async_session_factory() as db:
        row = await db.get(SessionRow, session_id)
        if not row:
            return None
        return ChatSession.model_validate(row.data)


async def save_session(session: ChatSession) -> None:
    data = session.model_dump(mode="json")
    async with async_session_factory() as db:
        async with db.begin():
            row = await db.get(SessionRow, session.session_id)
            if row:
                row.data = data
            else:
                db.add(SessionRow(id=session.session_id, recipe_id=session.recipe_id, data=data))


async def create_session(recipe: Recipe) -> ChatSession:
    session = ChatSession(recipe_id=recipe.id)
    await save_session(session)
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
    return template.replace("{recipe_json}", recipe_json)


def _estimate_missing_amount(ingredient_name: str) -> str:
    lowered = ingredient_name.lower()
    for keywords, hint in _AMBIGUOUS_AMOUNT_HINTS:
        if any(keyword in lowered for keyword in keywords):
            return hint
    return "start with a small amount, around 1 to 2 tablespoons, and adjust as you go"


def _ambiguity_notes(recipe: Recipe, step_index: int) -> list[str]:
    if step_index < 0 or step_index >= len(recipe.steps):
        return []

    step = recipe.steps[step_index]
    if not step.ingredients_used:
        return []

    notes: list[str] = []
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

        estimate = _estimate_missing_amount(match.name)
        notes.append(
            f"The source does not give an exact amount for {match.name}, so I would {estimate}."
        )
    return notes


def _step_message(recipe: Recipe, step_index: int) -> dict:
    if step_index >= len(recipe.steps):
        return {
            "type": "bot_message",
            "payload": {
                "content": f"You've completed all {len(recipe.steps)} steps! Enjoy your {recipe.title}!",
                "step_index": step_index,
            },
        }
    step = recipe.steps[step_index]
    ambiguity_notes = _ambiguity_notes(recipe, step_index)
    return {
        "type": "step_change",
        "payload": {
            "step_index": step_index,
            "step_number": step_index + 1,
            "total_steps": len(recipe.steps),
            "instruction": step.instruction,
            "tips": step.tips + ambiguity_notes,
            "ingredients_used": step.ingredients_used,
            "duration_seconds": step.duration_seconds,
            "spoken_follow_up": " ".join(ambiguity_notes),
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
        event = _step_message(recipe, session.current_step_index)
        await save_session(session)

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

        event = _step_message(recipe, session.current_step_index)
        await save_session(session)

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
            await save_session(session)
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
        await save_session(session)
        yield {
            "type": "bot_message",
            "payload": {"content": answer, "step_index": session.current_step_index},
        }
    except Exception as exc:
        logger.error("GPT call failed: %s", exc, exc_info=True)
        yield {
            "type": "error",
            "payload": {"message": f"GPT error: {exc}"},
        }
