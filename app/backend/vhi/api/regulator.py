"""JPJ / DOE regulator view."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter

from ..services import insights
from .deps import clean

router = APIRouter(prefix="/api/regulator", tags=["regulator"])


@router.get("")
async def overview():
    return clean(await asyncio.to_thread(insights.regulator))


@router.post("/refresh-web")
async def refresh():
    return await asyncio.to_thread(insights.refresh_web)
