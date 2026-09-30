"""Used-vehicle sales: the listings and each vehicle's whole record (owner app "Sale" tab, Oversight > Sales)."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter

from ..services import sales as svc
from .deps import clean

router = APIRouter(prefix="/api/sales", tags=["sales"])


@router.get("")
async def listings(kind: str | None = None, q: str = "", state: str | None = None, max_price: float | None = None,
                   flag: str | None = None):
    """Cars and motorcycles for sale with summary badges; filter by kind (car / motorcycle), text, state, price and
    flag (rollback, flood, rebuilt, accident, failed, obd, clean)."""
    return clean(await asyncio.to_thread(svc.listings, kind, q, state, max_price, flag))


@router.get("/{listing_id}")
async def dossier(listing_id: str):
    """The whole record of one listed vehicle: inspections, odometer, OBD, claims, insurance, photos, latest report."""
    return clean(await asyncio.to_thread(svc.dossier, listing_id))
