import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel

from backend.models.chat import ChatSession
from backend.services import chat_service
from backend.services.recipe_store import get_recipe

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])


class StartSessionRequest(BaseModel):
    recipe_id: str


@router.post("/sessions", response_model=ChatSession)
async def start_session(request: StartSessionRequest):
    recipe = get_recipe(request.recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    session = chat_service.create_session(recipe)
    return session


@router.get("/sessions/{session_id}", response_model=ChatSession)
async def get_session(session_id: str):
    session = chat_service.load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.websocket("/ws/chat/{session_id}")
async def chat_websocket(websocket: WebSocket, session_id: str):
    await websocket.accept()
    logger.info("WebSocket connected: session %s", session_id)

    session = chat_service.load_session(session_id)
    if not session:
        await websocket.send_json({"type": "error", "payload": {"message": "Session not found"}})
        await websocket.close(code=4004)
        return

    recipe = get_recipe(session.recipe_id)
    if not recipe:
        await websocket.send_json({"type": "error", "payload": {"message": "Recipe not found"}})
        await websocket.close(code=4004)
        return

    # Send initial step
    initial = chat_service._step_message(recipe, session.current_step_index)
    await websocket.send_json(initial)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                user_text = msg.get("text", "").strip()
            except json.JSONDecodeError:
                user_text = raw.strip()

            if not user_text:
                continue

            async for event in chat_service.process_message(session, recipe, user_text):
                await websocket.send_json(event)

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: session %s", session_id)
    except Exception as exc:
        logger.error("WebSocket error (session %s): %s", session_id, exc)
        try:
            await websocket.send_json({"type": "error", "payload": {"message": str(exc)}})
        except Exception:
            pass
