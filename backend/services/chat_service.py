import json
import logging
import re
import orjson
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

# Navigation intent patterns
_NEXT_INTENTS = {"next", "next step", "continue", "done", "ready", "ok", "okay", "go", "proceed"}
_PREV_INTENTS = {"previous", "prev", "go back", "last step", "back"}
_REPEAT_INTENTS = {"repeat", "again", "what was that", "say that again", "what", "huh"}
_RESTART_INTENTS = {"start over", "beginning", "restart", "from the top", "reset"}

# Substitution trigger phrases
_SUB_TRIGGERS = ["don't have", "dont have", "allergic", "substitute", "instead of", "alternative to", "out of"]

# Timer trigger phrases
_TIMER_TRIGGERS = re.compile(
    r"(?:set|start|create|add|begin|run)?\s*a?\s*timer\s*(?:for|of)?\s*"
    r"(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?\s*(?:(\d+)\s*s(?:ec(?:onds?)?)?)?",
    re.IGNORECASE,
)


def _detect_timer_intent(text: str) -> Optional[tuple[int, str]]:
    """Detect timer set requests. Returns (seconds, label) or None."""
    lower = text.lower()
    timer_keywords = ("timer", "alarm", "remind me", "set a", "start a", "start timing", "time it", "time this")
    if not any(w in lower for w in timer_keywords):
        return None

    seconds = extract_duration_seconds(text)
    if not seconds:
        return None

    # Extract optional label (e.g. "set a 5 minute timer for the pasta")
    label_match = re.search(r"(?:timer for|alarm for|remind me (?:to|for))\s+(?:the\s+)?(.+)", text, re.IGNORECASE)
    label = label_match.group(1).strip()[:40] if label_match else ""

    return seconds, label


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
    normalized = text.strip().lower().rstrip("!.,?")
    if normalized in _NEXT_INTENTS:
        return "next"
    if normalized in _PREV_INTENTS:
        return "prev"
    if normalized in _REPEAT_INTENTS:
        return "repeat"
    if normalized in _RESTART_INTENTS:
        return "restart"
    return None


def _detect_substitution_request(text: str) -> Optional[str]:
    lower = text.lower()
    for trigger in _SUB_TRIGGERS:
        if trigger in lower:
            return text
    return None


def _build_system_prompt(recipe: Recipe) -> str:
    template = _SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
    recipe_json = json.dumps(recipe.model_dump(mode="json"), indent=2)
    return template.replace("{recipe_json}", recipe_json)


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
    return {
        "type": "step_change",
        "payload": {
            "step_index": step_index,
            "step_number": step_index + 1,
            "total_steps": len(recipe.steps),
            "instruction": step.instruction,
            "tips": step.tips,
            "ingredients_used": step.ingredients_used,
            "duration_seconds": step.duration_seconds,
        },
    }


async def process_message(
    session: ChatSession,
    recipe: Recipe,
    user_text: str,
) -> AsyncIterator[dict]:
    """Process a user message and yield event dicts for the WebSocket."""

    # 1. Check for timer intent (no GPT needed)
    timer_intent = _detect_timer_intent(user_text)
    if timer_intent:
        seconds, label = timer_intent
        yield {
            "type": "timer_start",
            "payload": {"duration_seconds": seconds, "label": label or "Timer"},
        }
        yield {
            "type": "bot_message",
            "payload": {
                "content": f"Starting a {label + ' ' if label else ''}timer for {seconds // 60} minute{'s' if seconds // 60 != 1 else ''}{f' {seconds % 60} seconds' if seconds % 60 else ''}. I'll ring when it's done!",
                "step_index": session.current_step_index,
            },
        }
        return

    # 2. Check for navigation intents (no GPT needed)
    intent = _detect_nav_intent(user_text)
    if intent:
        if intent == "next":
            if session.current_step_index < len(recipe.steps):
                session.current_step_index += 1
        elif intent == "prev":
            session.current_step_index = max(0, session.current_step_index - 1)
        elif intent == "restart":
            session.current_step_index = 0
        # repeat: no change

        event = _step_message(recipe, session.current_step_index)
        save_session(session)

        # Check for timer on new step
        if event["type"] == "step_change":
            duration = event["payload"].get("duration_seconds")
            if not duration:
                duration = extract_duration_seconds(event["payload"]["instruction"])
            if duration:
                yield {
                    "type": "timer_start",
                    "payload": {"duration_seconds": duration, "label": f"Step {session.current_step_index + 1}", "step_index": session.current_step_index},
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
