"""Neutral product terminology: the inspection types every app shows, and the older codes still found in the curated
data files (mapped when the database is seeded, so the apps only ever see the neutral codes)."""
from __future__ import annotations

INSPECTION_TYPES = {
    "periodic_commercial": "Commercial Periodic Inspection",
    "periodic_ride_hailing": "Commercial Periodic Inspection (ride-hailing)",
    "ownership_transfer": "Ownership Transfer Inspection",
    "financing": "Financing Inspection",
    "voluntary": "Voluntary Inspection",
    "special_total_loss": "Special Inspection (after a total-loss claim)",
    "ev_health": "EV Health Check",
}

# codes used by the curated synthetic data (data/curated/synthetic/inspections.parquet)
LEGACY = {
    "berkala_B2": "periodic_commercial",
    "berkala_ehailing": "periodic_ride_hailing",
    "B5_MV15": "ownership_transfer",
    "B7_hire_purchase": "financing",
    "khas_B2_85_ber": "special_total_loss",
}


def code(x: str | None) -> str:
    return LEGACY.get(x or "", x or "")


def label(x: str | None) -> str:
    c = code(x)
    return INSPECTION_TYPES.get(c, c.replace("_", " "))
