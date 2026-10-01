"""The inspection app's Chat Bot: ask the operations copilot, and keep, list and delete the conversations of the
logged-in account (vhi/services/copilot.py)."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import auth
from ..runtime import rt
from ..services import copilot

router = APIRouter(prefix="/api/copilot", tags=["chat bot"])


class ChatReq(BaseModel):
    conversation_id: str | None = None
    message: str = Field(..., max_length=2000)
    plate: str | None = None


def _who() -> str:
    a = auth.user()
    if a is None:  # RequireLogin lets no anonymous request through; this guards direct use
        raise HTTPException(401, "Log in first.")
    return a.username


def _branch() -> str:
    return auth.examiner_branch() or "BR00"  # an examiner asks about their own hub


@router.post("/chat")
async def chat(req: ChatReq):
    """Answer a question from the platform's data: numbered facts with links, the answer citing them, which engine
    answered (the local LLM or the template engine), three follow-ups and the vehicle in focus."""
    return await asyncio.to_thread(copilot.chat, _who(), req.conversation_id, req.message, req.plate, rt().llm, _branch(),
                                   auth.examiner_branch())


@router.get("/conversations")
async def conversations():
    return await asyncio.to_thread(copilot.conversations, _who())


@router.get("/conversations/{cid}")
async def conversation(cid: str):
    return await asyncio.to_thread(copilot.conversation, _who(), cid)


@router.delete("/conversations/{cid}")
async def delete_conversation(cid: str):
    return await asyncio.to_thread(copilot.delete_conversation, _who(), cid)


@router.get("/vehicles")
async def vehicles():
    """The ten main vehicles, for the vehicle chips that scope a question."""
    return await asyncio.to_thread(copilot.main_vehicles)


@router.get("/starters")
def starters(lang: str = "en"):
    return {"prompts": copilot.starters(lang)}
