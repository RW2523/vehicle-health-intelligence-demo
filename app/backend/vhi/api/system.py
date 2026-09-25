"""Health, pipeline status ("under the hood") and the WebSocket endpoint."""
from __future__ import annotations

import time

from fastapi import APIRouter, Query, WebSocket
from sqlalchemy import func, select

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
        "models": models,
        "player": r.player.state_all() if r.player else [],
        "processor": r.processor.stats() if r.processor else {},
        "counts": {"readings": n_read, "live_inspections": n_live, "evidence_entries": n_ev},
    }


@router.websocket("/ws")
async def ws(websocket: WebSocket, channels: str = Query("*")):
    await rt().hub.serve(websocket, {c for c in channels.split(",") if c})
