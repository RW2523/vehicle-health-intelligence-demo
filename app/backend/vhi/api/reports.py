"""Reports, QR codes and the public verify endpoint (what a buyer sees after scanning)."""
from __future__ import annotations

import io

import qrcode
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from sqlalchemy import select

from ..db import session_scope
from ..services import reports as svc
from ..tables import Report

router = APIRouter(tags=["reports"])


@router.get("/api/reports")
def list_reports(plate: str | None = None, limit: int = 30):
    with session_scope() as s:
        q = select(Report).order_by(Report.created_at.desc())
        if plate:
            q = q.where(Report.plate == plate)
        return [svc.report_dict(r) for r in s.execute(q.limit(limit)).scalars()]


@router.get("/api/reports/{report_id}")
def get_report(report_id: str):
    with session_scope() as s:
        r = s.get(Report, report_id)
        if r is None:
            raise HTTPException(404, "report not found")
        return svc.report_dict(r)


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
