"""Booking (feature 1), GEAR next-day premium slots (feature 2) and the mock payment gateway."""
from __future__ import annotations

import datetime as dt
import hashlib
import random

from fastapi import HTTPException
from sqlalchemy import select

from ..config import get_settings, public_base_url
from ..db import session_scope
from ..tables import Booking, Branch

TYPES = {
    "B5": {"label": "B5 ownership transfer (MV15)", "price": 40.0, "minutes": 30},
    "B7": {"label": "B7 hire-purchase", "price": 40.0, "minutes": 30},
    "B5+B7": {"label": "B5 + B7 (sale with bank loan)", "price": 70.0, "minutes": 45},
    "VOLUNTARY": {"label": "Voluntary inspection", "price": 60.0, "minutes": 40},
    "EV": {"label": "EV Health Certificate", "price": 120.0, "minutes": 45},
    "BERKALA": {"label": "Berkala (commercial periodic)", "price": 90.0, "minutes": 45},
}
GEAR_SURCHARGE = 30.0
SLOT_TIMES = [f"{h:02d}:{m:02d}" for h in range(8, 17) for m in (0, 20, 40)]
GEAR_TIMES = {"08:00", "10:40", "13:20", "15:40"}  # premium slots held back each day for next-day GEAR bookings


def today() -> dt.date:
    return dt.date.fromisoformat(get_settings().demo_today)


def _synthetic_taken(branch_id: str, day: str, slot: str, lanes: int) -> int:
    """Occupancy from other customers (deterministic per branch/day/slot), shaped like the historical demand."""
    h = int(hashlib.md5(f"{branch_id}{day}{slot}".encode()).hexdigest()[:8], 16)
    r = random.Random(h)
    days_ahead = (dt.date.fromisoformat(day) - today()).days
    base = 0.92 if days_ahead <= 1 else (0.75 if days_ahead <= 3 else 0.5)
    peak = 0.12 if slot[:2] in ("09", "10", "14") else 0.0
    return min(lanes, int(round(lanes * min(1.0, base + peak + r.uniform(-0.2, 0.1)))))


def slots(branch_id: str, day: str) -> list[dict]:
    with session_scope() as s:
        br = s.get(Branch, branch_id)
        if br is None:
            raise HTTPException(404, "branch not found")
        lanes = br.lanes
        booked = s.execute(select(Booking.slot).where(Booking.branch_id == branch_id, Booking.date == day,
                                                      Booking.status != "cancelled")).scalars().all()
    d = dt.date.fromisoformat(day)
    is_next_day = (d - today()).days == 1
    out = []
    for t in SLOT_TIMES:
        gear = t in GEAR_TIMES
        taken = _synthetic_taken(branch_id, day, t, lanes) + booked.count(t)
        if gear:
            # GEAR slots are only sold the day before; otherwise they are released to normal booking
            taken = booked.count(t) + (0 if is_next_day else _synthetic_taken(branch_id, day, t, lanes))
        free = max(0, lanes - taken) if not gear else max(0, 1 - booked.count(t))
        out.append({"time": t, "free": free, "gear": gear and is_next_day, "available": free > 0 and d.weekday() != 6})
    return out


def gear_slots(branch_id: str) -> dict:
    d = today() + dt.timedelta(days=1)
    if d.weekday() == 6:
        d += dt.timedelta(days=1)
    free = [s for s in slots(branch_id, d.isoformat()) if s["gear"] and s["available"]]
    return {"branch_id": branch_id, "date": d.isoformat(), "slots": [s["time"] for s in free], "surcharge_rm": GEAR_SURCHARGE}


def create(plate: str, branch_id: str, day: str, slot: str, itype: str, gear: bool = False, source: str = "owner",
           fleet_id: str | None = None) -> dict:
    if itype not in TYPES:
        raise HTTPException(400, f"unknown inspection type {itype}")
    av = {s["time"]: s for s in slots(branch_id, day)}
    if slot not in av or not av[slot]["available"]:
        raise HTTPException(409, "slot no longer available")
    if gear and not av[slot]["gear"]:
        raise HTTPException(409, "GEAR premium slots are only sold for the next day")
    price = TYPES[itype]["price"] + (GEAR_SURCHARGE if gear else 0)
    with session_scope() as s:
        b = Booking(plate=plate, branch_id=branch_id, date=day, slot=slot, inspection_type=itype, gear=gear,
                    price_rm=price, source=source, fleet_id=fleet_id,
                    status="confirmed" if source in ("fleet", "api") else "pending_payment")
        s.add(b)
        s.flush()
        return booking_dict(b)


def pay(booking_id: str, method: str = "FPX") -> dict:
    """Mock payment gateway: always approves and returns a reference."""
    with session_scope() as s:
        b = s.get(Booking, booking_id)
        if b is None:
            raise HTTPException(404, "booking not found")
        if b.status == "pending_payment":
            b.status = "confirmed"
            b.payment_ref = f"{method}-{hashlib.sha1(booking_id.encode()).hexdigest()[:10].upper()}"
        return {**booking_dict(b), "gateway": "mock payment gateway (demo)", "method": method}


def booking_dict(b: Booking) -> dict:
    return {"booking_id": b.booking_id, "plate": b.plate, "branch_id": b.branch_id, "date": b.date, "slot": b.slot,
            "inspection_type": b.inspection_type, "type_label": TYPES.get(b.inspection_type, {}).get("label", b.inspection_type),
            "gear": b.gear, "price_rm": b.price_rm, "status": b.status, "payment_ref": b.payment_ref,
            "checkin_token": b.checkin_token, "checkin_url": f"{public_base_url()}/checkin/{b.checkin_token}",
            "source": b.source, "fleet_id": b.fleet_id}


def recommend_types(selling: bool = False, buyer_loan: bool = False, fuel: str = "", commercial: bool = False) -> list[str]:
    if commercial:
        return ["BERKALA"]
    out = []
    if selling:
        out.append("B5+B7" if buyer_loan else "B5")
    if fuel == "ev":
        out.append("EV")
    return out or ["VOLUNTARY"]
