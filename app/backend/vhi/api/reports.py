"""Reports, QR codes and the public verify endpoint (what a buyer sees after scanning)."""
from __future__ import annotations

import io
from urllib.parse import quote

import qrcode
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from sqlalchemy import select

from .. import auth
from ..db import session_scope
from ..services import reports as svc
from ..tables import LiveInspection, Report

router = APIRouter(tags=["reports"])


@router.get("/api/reports")
def list_reports(plate: str | None = None, limit: int = 30):
    with session_scope() as s:
        q = select(Report).order_by(Report.created_at.desc())
        if plate:
            q = q.where(Report.plate == plate)
        if auth.examiner_branch():  # an examiner sees the reports of their branch
            q = q.join(LiveInspection, LiveInspection.inspection_id == Report.inspection_id).where(
                LiveInspection.branch_id == auth.examiner_branch())
        return [svc.report_dict(r) for r in s.execute(q.limit(limit)).scalars()]


@router.get("/api/reports/{report_id}")
def get_report(report_id: str):
    with session_scope() as s:
        r = s.get(Report, report_id)
        if r is None:
            raise HTTPException(404, "report not found")
        li = s.get(LiveInspection, r.inspection_id)
        auth.check_branch(li.branch_id if li else None)
        out = svc.report_dict(r)
        from ..tables import Vehicle
        v = s.execute(select(Vehicle).where(Vehicle.plate == r.plate)).scalar_one_or_none()
        # where this result shows up downstream: the fleet's vehicle record, or the owner's health passport
        out["history_href"] = (f"/fleet/vehicle/{quote(r.plate)}" if v is not None and v.fleet_id
                               else f"/mobile/vehicle?plate={quote(r.plate)}")
        out["history_label"] = "Fleet vehicle record" if v is not None and v.fleet_id else "Vehicle health passport"
        out["inspection"] = ({"inspection_id": li.inspection_id, "session_id": li.session_id, "lane_id": li.lane_id,
                              "branch_id": li.branch_id, "started_at": li.started_at.isoformat() if li.started_at else None,
                              "health_score": li.health_score, "status": li.status, "route": li.route} if li else None)
        return out


@router.get("/api/reports/{report_id}/qr.svg")
def qr_svg(report_id: str):
    with session_scope() as s:
        r = s.get(Report, report_id)
        if r is None:
            raise HTTPException(404, "report not found")
        url = svc.report_dict(r)["verify_url"]
    import qrcode.image.svg

    img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return Response(buf.getvalue(), media_type="image/svg+xml")


@router.get("/api/verify/{token}", tags=["public"])
def verify(token: str):
    return svc.verify_public(token)
