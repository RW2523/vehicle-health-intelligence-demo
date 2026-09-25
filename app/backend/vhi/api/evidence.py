"""Evidence log: browse, verify the hash chain, and run the tamper-detection test."""
from __future__ import annotations

from fastapi import APIRouter

from ..services import evidence

router = APIRouter(prefix="/api/evidence", tags=["evidence"])


@router.get("")
def list_entries(inspection_id: str | None = None, limit: int = 200):
    return evidence.entries(inspection_id, limit)


@router.get("/verify")
def verify(inspection_id: str | None = None):
    return evidence.verify(inspection_id)


@router.post("/tamper-test")
def tamper_test():
    return evidence.tamper_test()
