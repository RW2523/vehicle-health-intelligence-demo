"""Fleet Intelligence portal + the fleet API (API-key protected) for operators' own systems."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..db import session_scope
from ..services import fleet as svc
from ..tables import Fleet
from .deps import clean

router = APIRouter(prefix="/api/fleet", tags=["fleet"])


class BookReq(BaseModel):
    plates: list[str]


@router.get("")
def fleets():
    return svc.fleets()


@router.get("/overview")
async def overview(fleet_id: str | None = None, vtype: str | None = None, branch_id: str | None = None, months: int = 12):
    return clean(await asyncio.to_thread(svc.overview, fleet_id, vtype, branch_id, months))


@router.get("/vehicles/{plate}")
async def vehicle(plate: str):
    return clean(await asyncio.to_thread(svc.vehicle_detail, plate))


@router.post("/vehicles/{plate}/report")
async def send_report(plate: str):
    return clean(await asyncio.to_thread(svc.send_report, plate))


@router.post("/bookings")
async def bulk_book(req: BookReq):
    return await asyncio.to_thread(svc.book, req.plates)


@router.get("/keys")
def api_keys():
    """Demo only: shows each showcase fleet's API key so the portal can display the API card."""
    with session_scope() as s:
        return [{"fleet_id": f.fleet_id, "name": f.name, "api_key": f.api_key}
                for f in s.execute(select(Fleet).where(Fleet.showcase.is_(True))).scalars()]


def _fleet_for_key(key: str | None) -> str:
    if not key:
        raise HTTPException(401, "X-API-Key header required")
    with session_scope() as s:
        f = s.execute(select(Fleet).where(Fleet.api_key == key)).scalar_one_or_none()
        if f is None:
            raise HTTPException(403, "invalid API key")
        return f.fleet_id


@router.get("/v1/vehicles", tags=["fleet API"])
async def api_vehicles(x_api_key: str | None = Header(None)):
    fid = _fleet_for_key(x_api_key)
    return clean({"fleet_id": fid, "vehicles": await asyncio.to_thread(svc.api_vehicles, fid)})


@router.post("/v1/bookings", tags=["fleet API"])
async def api_book(req: BookReq, x_api_key: str | None = Header(None)):
    fid = _fleet_for_key(x_api_key)
    with session_scope() as s:
        from ..tables import Vehicle
        own = {v.plate for v in s.execute(select(Vehicle).where(Vehicle.fleet_id == fid)).scalars()}
    bad = [p for p in req.plates if p not in own]
    if bad:
        raise HTTPException(403, f"not in your fleet: {bad}")
    return await asyncio.to_thread(svc.book, req.plates)
