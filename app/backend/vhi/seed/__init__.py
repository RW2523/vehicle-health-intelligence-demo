"""Seed the database from data/curated. Run with ``python -m vhi.seed`` (idempotent; ``--force`` rebuilds)."""
from __future__ import annotations

import logging
import time

from sqlalchemy import select

from ..db import init_db, session_scope
from ..tables import Setting

SEED_VERSION = 5
log = logging.getLogger("vhi.seed")


def seeded() -> bool:
    with session_scope() as s:
        row = s.execute(select(Setting).where(Setting.key == "seed_version")).scalar_one_or_none()
        return bool(row and row.value.get("v") == SEED_VERSION)


def reset_runtime() -> dict:
    """Delete everything the demo creates at run time (lane inspections, alerts, readings, evidence, reports, bookings,
    self-checks, chats, pattern reports) and keep the seeded world. Stop the API first."""
    import shutil

    from sqlalchemy import delete

    from ..config import get_settings
    from ..tables import (Alert, Booking, ChatMessage, EvidenceEntry, LiveInspection, PatternReport, Reading, Report,
                          SelfCheck)

    init_db()
    counts = {}
    with session_scope() as s:
        for t in (ChatMessage, SelfCheck, PatternReport, Report, EvidenceEntry, Alert, Reading, Booking, LiveInspection):
            counts[t.__tablename__] = s.execute(delete(t)).rowcount
    shutil.rmtree(get_settings().evidence_dir, ignore_errors=True)
    log.info("runtime state cleared: %s", counts)
    return counts


def run(force: bool = False) -> bool:
    """Returns True if seeding ran."""
    from .core import seed_data_fleets, seed_history, seed_reference, seed_vehicles
    from .demo import seed_session_vehicles
    from .fleet import seed_showcase_fleets

    init_db()
    if seeded() and not force:
        return False
    t = time.time()
    seed_reference()
    seed_vehicles()
    seed_history()
    seed_data_fleets()
    seed_session_vehicles()
    seed_showcase_fleets()
    with session_scope() as s:
        s.merge(Setting(key="seed_version", value={"v": SEED_VERSION, "at": time.time()}))
    log.info("seeded in %.1fs", time.time() - t)
    return True
