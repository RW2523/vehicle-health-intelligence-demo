"""Appointments (the inspection app): the hub staff's calendar of the ten main vehicles' bookings - list and filter,
the staff slot view, book, reschedule, cancel with a reason, mock payment, counter check-in and the check-in QR."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query
from pydantic import BaseModel

from ..services import appointments as svc
from .deps import clean

router = APIRouter(prefix="/api/appointments", tags=["appointments"])


class CreateReq(BaseModel):
    plate: str
    branch_id: str
    date: str
    slot: str
    inspection_type: str
    note: str | None = None
    paid: bool = False
    method: str | None = None  # with paid: CASH / CARD / FPX / EWALLET (default CARD)


class MoveReq(BaseModel):
    date: str
    slot: str


class CancelReq(BaseModel):
    reason: str = ""


class PayReq(BaseModel):
    method: str = "CASH"


@router.get("")
async def list_appointments(from_: str | None = Query(None, alias="from"), to: str | None = None, status: str = "",
                            plate: str = "", branch_id: str = ""):
    """The appointments from..to (default: this week's Monday to two weeks ahead), with counts by status and the
    number per day (for the calendar's dots), plus the page's headline numbers."""
    return clean(await asyncio.to_thread(svc.listing, from_, to, status, plate, branch_id))


@router.get("/options")
def options():
    return svc.options()


@router.get("/slots")
async def slots(branch_id: str, date: str, plate: str | None = None, exclude: str | None = None):
    """A hub's day for the staff: every slot with the room left, the gear slots and, for a vehicle, whether it can
    take the slot and why not (exclude: the appointment being moved)."""
    return await asyncio.to_thread(svc.slot_view, branch_id, date, plate, exclude)


@router.post("")
async def create(req: CreateReq):
    return await asyncio.to_thread(svc.create, req.plate, req.branch_id, req.date, req.slot, req.inspection_type, req.note,
                                   req.paid, req.method)


@router.get("/{booking_id}")
async def get(booking_id: str):
    return await asyncio.to_thread(svc.get, booking_id)


@router.post("/{booking_id}/reschedule")
async def reschedule(booking_id: str, req: MoveReq):
    return await asyncio.to_thread(svc.reschedule, booking_id, req.date, req.slot)


@router.post("/{booking_id}/cancel")
async def cancel(booking_id: str, req: CancelReq):
    return await asyncio.to_thread(svc.cancel, booking_id, req.reason)


@router.post("/{booking_id}/checkin")
async def checkin(booking_id: str):
    return await asyncio.to_thread(svc.checkin, booking_id)


@router.post("/{booking_id}/payment")
async def payment(booking_id: str, req: PayReq):
    return await asyncio.to_thread(svc.pay, booking_id, req.method)


@router.get("/{booking_id}/qr.svg")
def qr(booking_id: str):
    """The check-in QR (the same code as the owner app's): it opens the check-in page of the booking."""
    from .owner import booking_qr

    svc.get(booking_id)  # 404 / another hub
    return booking_qr(booking_id)
