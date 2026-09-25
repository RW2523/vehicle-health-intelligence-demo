"""Owner app: booking, GEAR, mock payment, self-check, assistant and the Vehicle Health Passport."""
from __future__ import annotations

import asyncio
import datetime as dt
import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

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


class ChatReq(BaseModel):
    conversation: str
    text: str
    lang: str | None = None
    branch_id: str | None = None


class SelfCheckReq(BaseModel):
    plate: str
    tint_vlt_pct: float | None = None
    headlamp_left: str | None = None
    headlamp_right: str | None = None
    tyre_images: list[str] = []
    engine_audio: str | None = None


@router.get("/inspection-types")
def inspection_types(selling: bool = False, buyer_loan: bool = False, fuel: str = "", commercial: bool = False):
    return {"types": [{"code": k, **v} for k, v in booking.TYPES.items()],
            "recommended": booking.recommend_types(selling, buyer_loan, fuel, commercial), "gear_surcharge_rm": booking.GEAR_SURCHARGE}


@router.get("/slots")
def slots(branch_id: str, date: str):
    return {"branch_id": branch_id, "date": date, "slots": booking.slots(branch_id, date)}


@router.get("/gear")
def gear(branch_id: str = "BR01"):
    return booking.gear_slots(branch_id)


@router.post("/bookings")
def create_booking(req: BookReq):
    vehicle_or_404(req.plate)
    return booking.create(norm_plate(req.plate), req.branch_id, req.date, req.slot, req.inspection_type, req.gear)


@router.post("/bookings/{booking_id}/pay")
def pay(booking_id: str, req: PayReq):
    return booking.pay(booking_id, req.method)


@router.get("/bookings")
def list_bookings(plate: str):
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


@router.get("/bookings/{booking_id}/qr.svg")
def booking_qr(booking_id: str):
    import io

    import qrcode
    import qrcode.image.svg
    from fastapi.responses import Response

    from ..tables import Booking as B

    with session_scope() as s:
        b = s.get(B, booking_id)
        if b is None:
            raise HTTPException(404, "booking not found")
        url = booking.booking_dict(b)["checkin_url"]
    buf = io.BytesIO()
    qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2).save(buf)
    return Response(buf.getvalue(), media_type="image/svg+xml")


@router.post("/assistant")
async def chat(req: ChatReq):
    return await asyncio.to_thread(assistant.reply, rt().llm, req.conversation, req.text, req.lang, req.branch_id)


@router.get("/assistant/{conversation}")
def chat_history(conversation: str):
    return assistant.history(conversation)


@router.get("/self-check/script")
def self_check_script():
    """The S6 scripted attempts (tyre photos and engine clip are real curated media)."""
    meta = json.loads((rt().settings.sessions_dir / "S6.json").read_text())
    sc, media = meta["self_check"], meta["media"]
    def attempt(a):
        return {"tint_vlt_pct": a["tint_vlt_pct"], "headlamp_left": "ok" if a["headlamp_left"] == "ok" else "not working",
                "headlamp_right": "ok", "tyre_images": media["tyre_images"], "engine_audio": media["audio"][0]}
    return {"plate": meta["vehicle"]["plate"], "first_attempt": attempt(sc["first_attempt"]),
            "second_attempt": attempt(sc["second_attempt"]), "assistant_script": meta["assistant_script"]}


@router.post("/self-check")
async def self_check(req: SelfCheckReq):
    vehicle_or_404(req.plate)
    return await asyncio.to_thread(insights.self_check, norm_plate(req.plate), req.model_dump(), rt().models)


@router.get("/passport/{plate}")
def passport(plate: str):
    p = insights.passport(plate)
    if not p:
        raise HTTPException(404, "vehicle not found")
    v = p["vehicle"]
    mvl = v.get("mvl_expiry")
    p["reminders"] = []
    if mvl:
        days = (dt.date.fromisoformat(mvl) - dt.date.fromisoformat(rt().settings.demo_today)).days
        p["reminders"].append({"kind": "road_tax", "date": mvl, "days": days})
    return p
