"""Booking (feature 1), Express next-day slots (feature 2) and the mock payment gateway."""
from __future__ import annotations

import datetime as dt
import hashlib
import math
import random

from fastapi import HTTPException
from sqlalchemy import select

from ..config import get_settings, public_base_url
from ..db import session_scope
from ..tables import Booking, Branch

TYPES = {
    "TRANSFER": {"label": "Ownership Transfer Inspection", "price": 40.0, "minutes": 30},
    "FINANCING": {"label": "Financing Inspection", "price": 40.0, "minutes": 30},
    "TRANSFER+FINANCING": {"label": "Ownership Transfer + Financing (sale with a bank loan)", "price": 70.0, "minutes": 45},
    "VOLUNTARY": {"label": "Voluntary Inspection", "price": 60.0, "minutes": 40},
    "EV": {"label": "EV Health Check", "price": 120.0, "minutes": 45},
    "PERIODIC": {"label": "Commercial Periodic Inspection", "price": 90.0, "minutes": 45},
}
# the internal name of the Express next-day slots is "gear" (the booking column and field)
GEAR_SURCHARGE = 30.0
SLOT_TIMES = [f"{h:02d}:{m:02d}" for h in range(8, 17) for m in (0, 20, 40)]
GEAR_TIMES = {"08:00", "10:40", "13:20", "15:40"}  # slots held back each day for Express next-day bookings


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
            # Express slots are only sold the day before; otherwise they are released to normal booking
            taken = booked.count(t) + (0 if is_next_day else _synthetic_taken(branch_id, day, t, lanes))
        free = max(0, lanes - taken) if not gear else max(0, 1 - booked.count(t))
        out.append({"time": t, "free": free, "gear": gear and is_next_day, "available": free > 0 and d.weekday() != 6})
    return out


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


def _minutes(t: str) -> int:
    return int(t[:2]) * 60 + int(t[3:])


def nearby(day: str, lat: float, lon: float, time: str | None = None, exclude: str | None = None, limit: int = 4) -> list[dict]:
    """When the owner's branch is full: the branches nearest to them with the chosen time free that day, or failing
    that the free times closest to it (any free times when no time was chosen)."""
    with session_scope() as s:
        branches = [(b.branch_id, b.name, b.lat, b.lon) for b in s.execute(select(Branch)).scalars()
                    if b.lat is not None and b.branch_id != exclude]
    out = []
    for bid, name, blat, blon in sorted(branches, key=lambda b: _km(lat, lon, b[2], b[3])):
        free = [x for x in slots(bid, day) if x["available"]]
        at = next((x for x in free if x["time"] == time), None)
        others = sorted(free, key=lambda x: abs(_minutes(x["time"]) - _minutes(time))) if time else free
        others = [x["time"] for x in others if x is not at and (not time or abs(_minutes(x["time"]) - _minutes(time)) <= 60)][:3]
        if at or others:
            out.append({"branch_id": bid, "name": name, "km": round(_km(lat, lon, blat, blon), 1),
                        "time_free": at is not None, "free": at["free"] if at else 0, "other_times": others})
        if len(out) >= limit:
            break
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
        raise HTTPException(409, "Express slots are only sold for the next day")
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


def branch_name(branch_id: str) -> str:
    with session_scope() as s:
        br = s.get(Branch, branch_id)
        return br.name if br else branch_id


def booking_dict(b: Booking) -> dict:
    return {"booking_id": b.booking_id, "plate": b.plate, "branch_id": b.branch_id, "branch_name": branch_name(b.branch_id),
            "date": b.date, "slot": b.slot,
            "inspection_type": b.inspection_type, "type_label": TYPES.get(b.inspection_type, {}).get("label", b.inspection_type),
            "gear": b.gear, "price_rm": b.price_rm, "status": b.status, "payment_ref": b.payment_ref,
            "checkin_token": b.checkin_token, "checkin_url": f"{public_base_url()}/checkin/{b.checkin_token}",
            "source": b.source, "fleet_id": b.fleet_id}


def recommend_types(selling: bool = False, buyer_loan: bool = False, fuel: str = "", commercial: bool = False) -> list[str]:
    if commercial:
        return ["PERIODIC"]
    out = []
    if selling:
        out.append("TRANSFER+FINANCING" if buyer_loan else "TRANSFER")
    if fuel == "ev":
        out.append("EV")
    return out or ["VOLUNTARY"]
