"""Owner app (the mobile app): booking, Express next-day slots, mock payment, reschedule and cancel, self-check,
assistant and the Vehicle Health Passport."""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import json
import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from .. import auth
from ..db import session_scope
from ..runtime import rt
from ..services import assistant, booking, insights
from ..tables import Booking
from .deps import norm_plate, vehicle_or_404

router = APIRouter(prefix="/api/owner", tags=["owner app"])


class BookReq(BaseModel):
    plate: str
    branch_id: str
    date: str
    slot: str
    inspection_type: str
    gear: bool = False


class PayReq(BaseModel):
    method: str = "FPX"


class RescheduleReq(BaseModel):
    date: str
    slot: str
    branch_id: str | None = None


class ChatReq(BaseModel):
    conversation: str
    text: str
    lang: str | None = None
    branch_id: str | None = None


class SelfCheckReq(BaseModel):
    plate: str
    # the rear number-plate photo (GET /self-check/plate-photo): "clean", or "dirty" for the demo's muddy, faded plate
    plate_photo: Literal["clean", "dirty"] | None = None
    tint_vlt_pct: float | None = None
    headlamp_left: str | None = None
    headlamp_right: str | None = None
    tyre_images: list[str] = []
    # the guided brake test, the owner's yes/no answers: safe_place, warning_light, pedal, straight, quiet, handbrake
    brakes: dict[str, bool] | None = None
    engine_audio: str | None = None


@router.get("/inspection-types")
def inspection_types(selling: bool = False, buyer_loan: bool = False, fuel: str = "", commercial: bool = False):
    return {"types": [{"code": k, **v} for k, v in booking.TYPES.items()],
            "recommended": booking.recommend_types(selling, buyer_loan, fuel, commercial), "gear_surcharge_rm": booking.GEAR_SURCHARGE}


@router.get("/slots")
def slots(branch_id: str, date: str):
    return {"branch_id": branch_id, "date": date, "slots": booking.slots(branch_id, date)}


@router.get("/nearby-slots")
def nearby_slots(date: str, lat: float, lon: float, time: str | None = None, exclude: str | None = None):
    return {"date": date, "time": time, "branches": booking.nearby(date, lat, lon, time, exclude)}


@router.get("/gear")
def gear(branch_id: str = "BR00"):
    return booking.gear_slots(branch_id)


@router.post("/bookings")
def create_booking(req: BookReq):
    vehicle_or_404(auth.own_plate(req.plate))
    return booking.create(norm_plate(req.plate), req.branch_id, req.date, req.slot, req.inspection_type, req.gear)


@router.post("/bookings/{booking_id}/pay")
def pay(booking_id: str, req: PayReq):
    _own_booking(booking_id)
    return booking.pay(booking_id, req.method)


def _own_booking(booking_id: str) -> None:
    with session_scope() as s:
        b = s.get(Booking, booking_id)
        if b is None:
            raise HTTPException(404, "booking not found")
        auth.own_plate(b.plate)


@router.get("/bookings")
def list_bookings(plate: str):
    auth.own_plate(plate)
    with session_scope() as s:
        rows = s.execute(select(Booking).where(Booking.plate == norm_plate(plate)).order_by(Booking.created_at.desc())).scalars()
        return [booking.booking_dict(b) for b in rows]


@router.get("/checkin/{token}")
def checkin(token: str):
    with session_scope() as s:
        b = s.execute(select(Booking).where(Booking.checkin_token == token)).scalar_one_or_none()
        if b is None:
            raise HTTPException(404, "unknown check-in code")
        return booking.booking_dict(b)


@router.post("/bookings/{booking_id}/reschedule")
def reschedule(booking_id: str, req: RescheduleReq):
    """Move a booking that is not checked in yet to another free slot (same inspection, same price). An Express
    booking moves only to another Express slot, a normal one only to a normal slot."""
    _own_booking(booking_id)
    try:
        day = dt.date.fromisoformat(req.date)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD") from None
    if day < booking.today():
        raise HTTPException(400, "Pick a day from today on.")
    with session_scope() as s:
        b = s.get(Booking, booking_id)
        if b.status not in ("pending_payment", "confirmed"):
            raise HTTPException(409, "This booking can no longer be changed.")
        branch, gear = req.branch_id or b.branch_id, b.gear
        if (branch, req.date, req.slot) == (b.branch_id, b.date, b.slot):
            raise HTTPException(400, "That is already the booking's time.")
    free = {x["time"]: x for x in booking.slots(branch, req.date)}
    if req.slot not in free or not free[req.slot]["available"]:
        raise HTTPException(409, "slot no longer available")
    if free[req.slot]["gear"] != gear:
        raise HTTPException(409, "An Express booking moves to another Express slot, a normal booking to a normal slot.")
    with session_scope() as s:
        b = s.get(Booking, booking_id)
        old = {"branch_id": b.branch_id, "branch_name": booking.branch_name(b.branch_id), "date": b.date, "slot": b.slot}
        b.branch_id, b.date, b.slot = branch, req.date, req.slot
        s.flush()
        return {**booking.booking_dict(b), "moved_from": old}


@router.post("/bookings/{booking_id}/cancel")
def cancel(booking_id: str):
    """Cancel a booking that is not checked in yet; a paid one is refunded through the mock gateway."""
    _own_booking(booking_id)
    with session_scope() as s:
        b = s.get(Booking, booking_id)
        if b.status == "checked_in":
            raise HTTPException(409, "The vehicle has already checked in at the lane.")
        refund = None
        if b.status == "confirmed" and b.payment_ref:
            refund = {"amount_rm": b.price_rm, "ref": "RF-" + hashlib.sha1(f"refund{booking_id}".encode()).hexdigest()[:10].upper(),
                      "gateway": "mock payment gateway (demo)"}
        b.status = "cancelled"
        return {**booking.booking_dict(b), "refund": refund}


def _qr_svg(text_: str):
    import io

    import qrcode
    import qrcode.image.svg
    from fastapi.responses import Response

    buf = io.BytesIO()
    qrcode.make(text_, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2).save(buf)
    return Response(buf.getvalue(), media_type="image/svg+xml")


@router.get("/bookings/{booking_id}/qr.svg")
def booking_qr(booking_id: str):
    with session_scope() as s:
        b = s.get(Booking, booking_id)
        if b is None:
            raise HTTPException(404, "booking not found")
        auth.own_plate(b.plate)
        url = booking.booking_dict(b)["checkin_url"]
    return _qr_svg(url)


@router.get("/link-qr.svg")
def link_qr(url: str = Query(..., max_length=600)):
    """A QR code of a web address (the mobile app's "open on your phone")."""
    if not re.fullmatch(r"https?://[^\s<>\"]+", url):
        raise HTTPException(400, "not a web address")
    return _qr_svg(url)


@router.post("/assistant")
async def chat(req: ChatReq):
    return await asyncio.to_thread(assistant.reply, rt().llm, req.conversation, req.text, req.lang, req.branch_id)


@router.get("/assistant/{conversation}")
def chat_history(conversation: str):
    return assistant.history(conversation)


@router.get("/self-check/script")
def self_check_script():
    """The S6 scripted attempts (tyre photos and engine clip are real curated media). The first has the number plate
    muddy and faded, the tint too dark and the left headlamp out; the second has them put right. The brake test is
    answered "all fine" in both."""
    meta = json.loads((rt().settings.sessions_dir / "S6.json").read_text())
    sc, media = meta["self_check"], meta["media"]
    brakes = {k: True for k in ("safe_place", *(c[0] for c in insights.BRAKE_CHECKS))}

    def attempt(a, plate_photo):
        return {"plate_photo": plate_photo, "tint_vlt_pct": a["tint_vlt_pct"],
                "headlamp_left": "ok" if a["headlamp_left"] == "ok" else "not working", "headlamp_right": "ok",
                "tyre_images": media["tyre_images"], "brakes": brakes, "engine_audio": media["audio"][0]}
    return {"plate": meta["vehicle"]["plate"], "first_attempt": attempt(sc["first_attempt"], "dirty"),
            "second_attempt": attempt(sc["second_attempt"], "clean"), "assistant_script": meta["assistant_script"]}


@router.get("/self-check/plate-photo")
async def self_check_plate_photo(plate: str):
    """The vehicle's rear number-plate photo for the self-check, clean and with the plate muddy and faded (the demo
    control): the photo uploaded for its image slot "<slug>.plate" (source "uploaded") or a rendered sample."""
    vehicle_or_404(auth.own_plate(plate))
    p = norm_plate(plate)
    clean, dirty = await asyncio.to_thread(lambda: (insights.plate_photo(p), insights.plate_photo(p, dirty=True)))
    return {"plate": p, "source": clean["source"], "clean": clean["url"], "dirty": dirty["url"]}


@router.post("/self-check")
async def self_check(req: SelfCheckReq):
    vehicle_or_404(auth.own_plate(req.plate))
    return await asyncio.to_thread(insights.self_check, norm_plate(req.plate), req.model_dump(), rt().models)


@router.get("/passport/{plate}")
def passport(plate: str):
    p = insights.passport(auth.own_plate(plate))
    if not p:
        raise HTTPException(404, "vehicle not found")
    v = p["vehicle"]
    mvl = v.get("mvl_expiry")
    today = booking.today()  # the booking calendar's today, so reminders, due dates and slots agree
    p["reminders"] = []
    if mvl:
        days = (dt.date.fromisoformat(mvl) - today).days
        p["reminders"].append({"kind": "road_tax", "date": mvl, "days": days})
    p["next_due"] = _next_due(p, today)
    return p


COMMERCIAL = {"bus", "lorry", "taxi", "ehailing", "van", "rental"}


def _next_due(p: dict, today: dt.date) -> dict:
    """When the vehicle's next inspection is due, from its latest result and its use: a re-inspection 30 days after a
    FAIL, a follow-up 90 days after a CONDITIONAL result, every 6 months for commercial vehicles, and a yearly health
    check (recommended) for private ones."""
    v, latest = p["vehicle"], p.get("latest")
    booked = next((e for e in sorted(p["events"], key=lambda e: e["date"]) if e["kind"] == "booking"
                   and e.get("status") in ("pending_payment", "confirmed") and e["date"] >= today.isoformat()), None)
    if not latest:
        due, basis = today, "No inspection on record yet"
    else:
        last = dt.date.fromisoformat(latest["date"][:10])
        if latest["result"] == "FAIL":
            due, basis = last + dt.timedelta(days=30), "Re-inspection within 30 days of a failed inspection"
        elif latest["result"] == "CONDITIONAL":
            due, basis = last + dt.timedelta(days=90), "Follow-up check on the conditional items"
        elif v.get("usage") in COMMERCIAL or v.get("heavy"):
            due, basis = last + dt.timedelta(days=182), "Periodic inspection every 6 months (commercial vehicle)"
        else:
            due, basis = last + dt.timedelta(days=365), "Yearly health check (recommended for private vehicles)"
    return {"date": due.isoformat(), "days": (due - today).days, "basis": basis,
            "booked": {"date": booked["date"], "booking_id": booked.get("booking_id")} if booked else None}
