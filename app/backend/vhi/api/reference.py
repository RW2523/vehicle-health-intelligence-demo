"""Reference data: inspection hubs, examiners, vehicles and the mock vehicle registry."""
from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, Query
from sqlalchemy import or_, select, text

from ..db import engine, session_scope
from ..tables import Branch, Examiner, Vehicle
from .deps import clean, norm_plate, vehicle_or_404, vehicle_public

router = APIRouter(prefix="/api", tags=["reference"])


@router.get("/branches")
def branches():
    with session_scope() as s:
        return [dict(branch_id=b.branch_id, name=b.name, state=b.state, heavy_capable=b.heavy_capable, lanes=b.lanes,
                     lat=b.lat, lon=b.lon) for b in s.scalars(select(Branch).order_by(Branch.branch_id))]


@router.get("/examiners")
def examiners():
    with session_scope() as s:
        return [dict(examiner_id=e.examiner_id, name=e.name, home_branch=e.home_branch, senior=e.senior)
                for e in s.scalars(select(Examiner).order_by(Examiner.examiner_id))]


@router.get("/vehicles")
def vehicle_register(q: str = Query("", min_length=0), vtype: str = "", fuel: str = "", state: str = "", result: str = "",
                     page: int = 1, page_size: int = 25, scope: str = "main"):
    """The vehicle register with each vehicle's latest inspection, filtered and paged: the ten main vehicles the
    inspection app is built around, or the whole synthetic register with scope=all."""
    from .. import auth
    from ..services import registry
    a = auth.user()
    if a and a.role == "owner":  # an owner sees only their own vehicle
        q = a.plate or ""
    return registry.listing(q, vtype, fuel, state, result, page, page_size, scope)


@router.get("/vehicles/facets")
def vehicle_facets():
    from ..services import registry
    return registry.facets()


@router.get("/vehicles/{plate}/profile")
def vehicle_profile(plate: str):
    from .. import auth
    from ..services import registry
    return registry.profile(auth.own_plate(plate))


@router.get("/vehicles/{plate}")
def get_vehicle(plate: str):
    return vehicle_public(vehicle_or_404(plate))


@router.get("/vehicles/{plate}/history")
def vehicle_history(plate: str):
    v = vehicle_or_404(plate)
    df = pd.read_sql(text("select * from hist_inspections where vehicle_id = :v order by date"),
                     engine(), params={"v": v.vehicle_id})
    claims = pd.read_sql(text("select * from hist_claims where vehicle_id = :v order by claim_date"),
                         engine(), params={"v": v.vehicle_id})
    return clean({"vehicle": vehicle_public(v), "inspections": df.to_dict("records"),
                  "claims": claims.to_dict("records")})


@router.get("/registry/{plate}", tags=["mock integrations"])
def registry_lookup(plate: str):
    """Mock of the national vehicle-registry lookup used at check-in (fictional records only)."""
    v = vehicle_or_404(norm_plate(plate))
    return {"source": "mock vehicle registry (fictional records)", "plate": v.plate, "chassis_no": v.chassis_no,
            "engine_no": v.engine_no, "make": v.make, "model": v.model, "year": v.year,
            "registered_owner": v.owner_name or "company", "status": "active"}
