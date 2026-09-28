"""Health, pipeline status ("under the hood") and the WebSocket endpoint."""
from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Query, WebSocket
from pydantic import BaseModel
from sqlalchemy import func, select

from .. import presenter
from ..config import public_base_url
from ..db import session_scope
from ..runtime import rt
from ..tables import EvidenceEntry, LiveInspection, Reading

router = APIRouter(tags=["system"])


@router.get("/api/health")
def health():
    return {"ok": True}


@router.get("/api/system/status")
def status():
    r = rt()
    with session_scope() as s:
        n_read = s.scalar(select(func.count()).select_from(Reading))
        n_live = s.scalar(select(func.count()).select_from(LiveInspection))
        n_ev = s.scalar(select(func.count()).select_from(EvidenceEntry))
    models = r.models.status() if r.models else {}
    return {
        "uptime_s": round(time.time() - r.started_at),
        "database": "postgresql" if r.settings.db_url.startswith("postgresql") else "sqlite",
        "bus": {"kind": r.bus.kind, "published": r.bus.published},
        "websocket": {"clients": len(r.hub.clients), "sent": r.hub.sent},
        "llm": r.llm.status() if r.llm else {"backend": "none"},
        "vlm": r.vlm.status() if r.vlm else {"backend": None},
        "public_base_url": public_base_url(),
        "presenter": {"required": presenter.required()},
        "models": models,
        "player": r.player.state_all() if r.player else [],
        "processor": r.processor.stats() if r.processor else {},
        "counts": {"readings": n_read, "live_inspections": n_live, "evidence_entries": n_ev},
    }


class PinReq(BaseModel):
    pin: str


@router.post("/api/system/presenter")
def presenter_unlock(req: PinReq):
    """Check the presenter PIN before the web apps store it (wrong PINs count towards the same rate limit)."""
    result = presenter.gate.check(req.pin)
    if result != "ok":
        code, detail = presenter.MESSAGES[result]
        raise HTTPException(code, detail)
    return {"ok": True, "required": presenter.required()}


@router.websocket("/ws")
async def ws(websocket: WebSocket, channels: str = Query("*")):
    await rt().hub.serve(websocket, {c for c in channels.split(",") if c})
