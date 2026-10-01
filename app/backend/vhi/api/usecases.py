"""Guided demo: the nine use cases, their live progress, and the presenter's start / restart / stop."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter
from pydantic import BaseModel

from .. import auth
from ..runtime import rt
from ..services import usecases as svc

router = APIRouter(prefix="/api/usecases", tags=["demo control"])


class VisitReq(BaseModel):
    path: str


@router.get("")
def catalogue():
    return svc.catalogue()


@router.get("/active")
def active():
    return {"active": svc.active()}


@router.post("/stop")
def stop():
    svc.stop()
    return {"active": None}


@router.post("/visit")
def visit(req: VisitReq):
    return {"active": svc.visit(req.path[:300])}


@router.post("/{uc_id}/start")
async def start(uc_id: str):
    a = auth.user()
    out = await asyncio.to_thread(svc.start, uc_id.upper(), a.username if a else "presenter")
    uc = svc.BY_ID[uc_id.upper()]
    if uc.get("autostart") and uc.get("session"):
        # the lane replay starts at 4x (about two minutes), so the presenter lands on a lane that is already running
        await rt().player.get(uc["session"]).start(speed=4)
    await rt().hub.broadcast("usecases", "started", {"id": out["id"]}, remember=False)
    return out
