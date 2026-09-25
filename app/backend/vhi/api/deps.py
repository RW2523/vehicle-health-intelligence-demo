"""Shared API helpers."""
from __future__ import annotations

import math
from typing import Any

import numpy as np
from fastapi import HTTPException
from sqlalchemy import select

from ..db import session_scope
from ..tables import Vehicle


def clean(obj: Any) -> Any:
    """Make numpy / pandas values JSON-safe (NaN -> None)."""
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return clean(obj.tolist())
    return obj


def norm_plate(plate: str) -> str:
    p = "".join(ch for ch in plate.upper() if ch.isalnum())
    # "DMO9001" -> "DMO 9001": letters then digits, one space between
    i = 0
    while i < len(p) and p[i].isalpha():
        i += 1
    return (p[:i] + " " + p[i:]).strip() if 0 < i < len(p) else p


def vehicle_or_404(plate: str) -> Vehicle:
    with session_scope() as s:
        v = s.execute(select(Vehicle).where(Vehicle.plate == norm_plate(plate))).scalar_one_or_none()
        if v is None:
            raise HTTPException(404, f"vehicle {plate} not found")
        return v


def vehicle_public(v: Vehicle) -> dict[str, Any]:
    """Vehicle fields safe to show in the apps (no hidden ground truth)."""
    return {
        "vehicle_id": v.vehicle_id, "plate": v.plate, "make": v.make, "model": v.model, "vtype": v.vtype,
        "usage": v.usage, "fuel": v.fuel, "heavy": v.heavy, "year": v.year, "state": v.state,
        "euro_class": v.euro_class, "odometer_km": v.odometer_km, "fleet_id": v.fleet_id,
        "owner_type": v.owner_type, "owner_name": v.owner_name, "photo": v.photo, "km_per_month": v.km_per_month,
        "mvl_expiry": v.mvl_expiry, "chassis_no": v.chassis_no, "engine_no": v.engine_no,
    }
