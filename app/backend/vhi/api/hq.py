"""HQ operations dashboard."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter
from pydantic import BaseModel

from .. import auth
from ..runtime import rt
from ..services import exceptions, insights
from .deps import clean

router = APIRouter(prefix="/api/hq", tags=["hq"])


class ActionReq(BaseModel):
    key: str
    action: str
    note: str = ""


@router.get("/integrity")
async def integrity():
    return clean(await asyncio.to_thread(insights.integrity))


@router.get("/demand")
async def demand(branch_id: str = "BR00"):
    return clean(await asyncio.to_thread(insights.demand, branch_id, rt().models))


@router.get("/equipment")
async def equipment():
    return clean(await asyncio.to_thread(insights.equipment))


@router.get("/ops")
def ops():
    return insights.live_ops()


@router.get("/audit")
def audit():
    return insights.audit()


@router.get("/exceptions")
async def list_exceptions():
    return clean(await asyncio.to_thread(exceptions.overview, rt().models))


@router.post("/exceptions/action")
async def exception_action(req: ActionReq):
    a = auth.user()
    actor = a.username if a else "hq"
    out = await asyncio.to_thread(exceptions.act, req.key, req.action, req.note, actor, rt().models)
    await rt().hub.broadcast("usecases", "progress", {"kind": "exception_action"}, remember=False)
    return clean(out)
