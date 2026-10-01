"""The inspector dashboard (today at a hub), the hub's full day schedule, global search and the notification feed."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter

from .. import auth
from ..services import hubday, registry
from .deps import clean

router = APIRouter(prefix="/api", tags=["dashboard"])


def _hub(branch_id: str | None) -> str:
    return auth.examiner_branch() or branch_id or "BR00"  # an examiner sees their own hub


@router.get("/hub/today")
async def hub_today(branch_id: str | None = None, at: str | None = None):
    return clean(await asyncio.to_thread(hubday.today, _hub(branch_id), at))


@router.post("/hub/restart")
def hub_restart():
    """Start the demo hub's day again from now (the presenter and HQ): four inspections done, every lane busy, one
    vehicle waiting and one still to come."""
    return hubday.restart()


@router.get("/hub/schedule")
async def hub_schedule(branch_id: str | None = None, status: str = "", q: str = "", page: int = 1, page_size: int = 30):
    """Every vehicle at the hub today, with its state now (completed, on a lane, waiting, still to come)."""
    def run():
        c = hubday.clock()
        rows = [hubday._state(x, c["minute"]) for x in hubday.schedule(_hub(branch_id), c["date"])]
        for r in rows:
            r["photo"] = registry._photo(r["plate"])
        counts = {k: sum(1 for r in rows if r["status"] == k) for k in ("completed", "in_progress", "in_queue", "scheduled")}
        if status:
            rows = [r for r in rows if r["status"] == status]
        if q:
            rows = [r for r in rows if q.upper() in r["plate"] or q.upper() in r["no"] or q.lower() in r["owner"].lower()]
        pages = max(1, -(-len(rows) // page_size))
        p = max(1, min(page, pages))
        return {"clock": {**c, "time": hubday.hhmm(c["minute"])}, "counts": counts, "total": len(rows), "page": p, "pages": pages,
                "items": rows[(p - 1) * page_size: p * page_size]}
    return clean(await asyncio.to_thread(run))


@router.get("/search")
async def search(q: str = ""):
    return await asyncio.to_thread(registry.search, q)


@router.get("/notifications")
async def notifications():
    a = auth.user()
    return await asyncio.to_thread(registry.notifications, a.role if a else "")
