"""Flood watch: JPS river levels and rainfall (real) x registered vehicles (synthetic) -> which vehicles need a
flood-damage inspection or an underbody corrosion check."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter
from pydantic import BaseModel

from ..services import floodwatch as svc
from .deps import clean

router = APIRouter(prefix="/api/floodwatch", tags=["flood watch"])


class InviteReq(BaseModel):
    plates: list[str]
    scope: str = svc.LIVE


@router.get("")
async def overview():
    """Where the JPS data came from and when, station counts by status and state, past flood events, the trend."""
    return clean(await asyncio.to_thread(svc.overview))


@router.get("/stations")
async def stations(status: str | None = None, state: str | None = None):
    """JPS water-level stations with their status; ``status`` takes a comma-separated list (e.g. alert,warning,danger)."""
    return clean(await asyncio.to_thread(svc.stations, status, state))


@router.get("/stations/{station_id}/history")
async def station_history(station_id: str):
    return clean(await asyncio.to_thread(svc.station_history, station_id))


@router.get("/areas")
async def areas(scope: str = svc.LIVE):
    """Districts exposed now (``live``) or in a past flood (``event:<date>``), with the vehicles to inspect there."""
    return clean(await asyncio.to_thread(svc.areas, scope))


@router.get("/vehicles")
async def vehicles(scope: str = svc.LIVE, min_risk: int = svc.CHECK_RISK, page: int = 1, page_size: int = 25,
                   state: str | None = None, district: str | None = None, recommendation: str | None = None):
    """Vehicles ranked by flood / corrosion-damage risk, with the reasons."""
    return clean(await asyncio.to_thread(svc.vehicles, scope, min_risk, page, page_size, state, district, recommendation))


@router.get("/vehicles/{key}")
async def vehicle(key: str, scope: str = svc.LIVE):
    """One vehicle (plate or id): every reason, the flood model's factors, its corrosion history and flood claims."""
    return clean(await asyncio.to_thread(svc.vehicle_detail, key, scope))


@router.post("/refresh")
async def refresh():
    """Fetch every state from JPS Public InfoBanjir now (at most every two minutes)."""
    return clean(await asyncio.to_thread(svc.refresh))


@router.post("/invitations")
async def invite(req: InviteReq):
    """Mock: record that the owners were invited for a flood inspection. No message is sent."""
    return clean(await asyncio.to_thread(svc.invite, req.plates, req.scope))


@router.get("/invitations")
async def invitations():
    return await asyncio.to_thread(svc.invitations)
