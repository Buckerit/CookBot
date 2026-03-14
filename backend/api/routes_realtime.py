import json

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse

from backend.config import settings

router = APIRouter(prefix="/realtime", tags=["realtime"])

@router.post("/session")
async def create_realtime_session(request: Request):
    if not settings.openai_api_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY is not configured")

    offer_sdp = (await request.body()).decode("utf-8").strip()
    if not offer_sdp:
        raise HTTPException(status_code=400, detail="SDP offer is required")

    session = {
        "type": "realtime",
        "model": settings.openai_realtime_model,
        "instructions": "You are a helpful cooking assistant.",
        "audio": {
            "output": {
                "voice": settings.openai_realtime_voice,
            }
        },
    }

    files = {
        "sdp": ("offer.sdp", offer_sdp, "application/sdp"),
        "session": (None, json.dumps(session), "application/json"),
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/realtime/calls",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            files=files,
        )

    if response.status_code >= 400:
        detail = response.text
        try:
            detail = response.json()
        except Exception:
            pass
        raise HTTPException(status_code=response.status_code, detail=detail)

    return PlainTextResponse(response.text, media_type="application/sdp")
