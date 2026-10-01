"""The ten main vehicles the inspection and mobile apps are built around.

The synthetic world has thousands of registered vehicles (the regulator, flood watch and sales views aggregate over
them), but the hub's daily work is shown on ten: the four lane-replay vehicles (DMO 9001-9006, whose sensors are
replayed and analysed live) and six fleet vehicles whose sample inspection images are in the image library
(data/curated/images/vehiclesense_demo). Every list in the inspection app shows these ten, each with its photos.
"""
from __future__ import annotations

from sqlalchemy import select

from ..db import session_scope
from ..tables import Vehicle

MAIN: list[dict] = [
    {"plate": "DMO 9001", "slug": "dmo-9001", "session": "S1", "lane": "BR00-L3", "story": "Commercial periodic inspection: brakes, particle number, tyres, undercarriage"},
    {"plate": "DMO 9002", "slug": "dmo-9002", "session": "S2", "lane": "BR00-L2", "story": "EV health check with an ownership transfer: battery health, flood evidence"},
    {"plate": "DMO 9003", "slug": "dmo-9003", "session": "S3", "lane": "BR00-L1", "story": "Ownership transfer: plate, chassis, odometer and engine sound against its history"},
    {"plate": "DMO 9006", "slug": "dmo-9006", "session": "S7", "lane": "BR00-L4", "story": "Voluntary inspection booked from the owner's phone"},
    {"plate": "VJM 7412", "slug": "vjm-7412", "session": None, "lane": None, "story": "Fleet sedan: rear scratch, roof dent, 12 V battery corrosion"},
    {"plate": "WXD 2291", "slug": "wxd-2291", "session": None, "lane": None, "story": "Fleet pickup: uneven tyre wear and a sidewall bulge, tread trend"},
    {"plate": "BHY 7783", "slug": "bhy-7783", "session": None, "lane": None, "story": "Fleet van: dent, scratch and wheel-arch rust, exhaust smoke"},
    {"plate": "VKR 3128", "slug": "vkr-3128", "session": None, "lane": None, "story": "Fleet sedan: dent, scratch, rust and brake disc scoring"},
    {"plate": "PKE 4410", "slug": "pke-4410", "session": None, "lane": None, "story": "Fleet MPV: scratch and a tilted ADAS camera mount"},
    {"plate": "JTR 5510", "slug": "jtr-5510", "session": None, "lane": None, "story": "Fleet van: tail lamp crack, door misalignment, oil-wet shock absorber"},
]
MAIN_PLATES: list[str] = [m["plate"] for m in MAIN]
BY_PLATE: dict[str, dict] = {m["plate"]: m for m in MAIN}


def is_main(plate: str | None) -> bool:
    return plate in BY_PLATE


def slug(plate: str) -> str:
    return BY_PLATE[plate]["slug"] if plate in BY_PLATE else plate.lower().replace(" ", "-")


def vehicles() -> list[dict]:
    """The ten vehicles' register rows, in the order above."""
    with session_scope() as s:
        rows = {v.plate: v for v in s.execute(select(Vehicle).where(Vehicle.plate.in_(MAIN_PLATES))).scalars()}
        out = []
        for m in MAIN:
            v = rows.get(m["plate"])
            if v is None:
                continue
            out.append({"plate": v.plate, "vehicle_id": v.vehicle_id, "make": v.make, "model": v.model, "year": v.year,
                        "vtype": v.vtype, "fuel": v.fuel, "usage": v.usage, "owner_name": v.owner_name, "owner_type": v.owner_type,
                        "fleet_id": v.fleet_id, "state": v.state, "odometer_km": v.odometer_km, "mvl_expiry": v.mvl_expiry,
                        "heavy": v.heavy, **{k: m[k] for k in ("slug", "session", "lane", "story")}})
        return out
