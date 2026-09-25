"""HQ operations dashboard."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter

from ..runtime import rt
from ..services import insights
from .deps import clean

router = APIRouter(prefix="/api/hq", tags=["hq"])


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
