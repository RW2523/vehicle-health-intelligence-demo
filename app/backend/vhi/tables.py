"""ORM tables.

Historical synthetic data (inspections, bookings, telemetry ...) is bulk-loaded into plain tables by the seeder
(`hist_*`), and read with pandas for analytics. The tables below hold reference data and everything the live
demo creates: live inspections, sensor readings, alerts, decisions, the evidence chain, reports, bookings.
"""
from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _uuid() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


class Branch(Base):
    __tablename__ = "branches"
    branch_id: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    state: Mapped[str] = mapped_column(String(80))
    heavy_capable: Mapped[bool] = mapped_column(Boolean, default=False)
    lanes: Mapped[int] = mapped_column(Integer, default=4)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)


class Examiner(Base):
    __tablename__ = "examiners"
    examiner_id: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    home_branch: Mapped[str] = mapped_column(String(8))
    senior: Mapped[bool] = mapped_column(Boolean, default=False)


class Fleet(Base):
    __tablename__ = "fleets"
    fleet_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    branch_id: Mapped[str] = mapped_column(String(8))
    segment: Mapped[str] = mapped_column(String(40), default="")
    api_key: Mapped[str] = mapped_column(String(40), default="")
    showcase: Mapped[bool] = mapped_column(Boolean, default=False)


class Vehicle(Base):
    __tablename__ = "vehicles"
    vehicle_id: Mapped[str] = mapped_column(String(12), primary_key=True)
    plate: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    chassis_no: Mapped[str] = mapped_column(String(24))
    engine_no: Mapped[str] = mapped_column(String(24))
    make: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(60))
    vtype: Mapped[str] = mapped_column(String(20))  # sedan / MPV / van / pickup / hatchback / lorry / bus ...
    usage: Mapped[str] = mapped_column(String(20))
    fuel: Mapped[str] = mapped_column(String(12))
    heavy: Mapped[bool] = mapped_column(Boolean, default=False)
    year: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(40), default="")
    euro_class: Mapped[str] = mapped_column(String(12), default="")
    dpf_fitted: Mapped[bool] = mapped_column(Boolean, default=False)
    scr_fitted: Mapped[bool] = mapped_column(Boolean, default=False)
    odometer_km: Mapped[int] = mapped_column(Integer, default=0)
    fleet_id: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    owner_type: Mapped[str] = mapped_column(String(20), default="individual")
    owner_name: Mapped[str] = mapped_column(String(80), default="")
    photo: Mapped[str | None] = mapped_column(String(200), nullable=True)
    km_per_month: Mapped[int] = mapped_column(Integer, default=2000)
    mvl_expiry: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # Hidden ground truth from the synthetic generator. Used only for evaluation, never shown in the apps.
    ground_truth: Mapped[dict] = mapped_column(JSON, default=dict)


class LiveInspection(Base):
    __tablename__ = "live_inspections"
    inspection_id: Mapped[str] = mapped_column(String(16), primary_key=True, default=lambda: "LI" + _uuid()[:8])
    session_id: Mapped[str | None] = mapped_column(String(8), nullable=True)
    lane_id: Mapped[str] = mapped_column(String(16))
    branch_id: Mapped[str] = mapped_column(String(8))
    vehicle_id: Mapped[str | None] = mapped_column(String(12), nullable=True)
    plate: Mapped[str] = mapped_column(String(16))
    inspection_type: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(16), default="in_lane")  # in_lane / review / decided / reported
    step: Mapped[str] = mapped_column(String(32), default="")
    started_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    examiner_id: Mapped[str] = mapped_column(String(8), default="VE012")
    route: Mapped[str] = mapped_column(String(16), default="normal")  # normal / senior
    health_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    next_fail_risk: Mapped[float | None] = mapped_column(Float, nullable=True)
    verdict: Mapped[str | None] = mapped_column(String(16), nullable=True)  # PASS / FAIL / CONDITIONAL
    measurements: Mapped[dict] = mapped_column(JSON, default=dict)
    results: Mapped[dict] = mapped_column(JSON, default=dict)
    fusion: Mapped[dict] = mapped_column(JSON, default=dict)


class Reading(Base):
    """Time-series sensor readings (a TimescaleDB hypertable on Postgres)."""
    __tablename__ = "readings"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=_uuid)
    ts: Mapped[dt.datetime] = mapped_column(DateTime, primary_key=True, default=_now)
    inspection_id: Mapped[str] = mapped_column(String(16), index=True)
    sensor: Mapped[str] = mapped_column(String(24))
    t_s: Mapped[float] = mapped_column(Float)
    payload: Mapped[dict] = mapped_column(JSON)


class Alert(Base):
    __tablename__ = "alerts"
    alert_id: Mapped[str] = mapped_column(String(16), primary_key=True, default=lambda: "AL" + _uuid()[:8])
    inspection_id: Mapped[str] = mapped_column(String(16), ForeignKey("live_inspections.inspection_id"), index=True)
    code: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(120))
    detail: Mapped[str] = mapped_column(Text, default="")
    system: Mapped[str] = mapped_column(String(40), default="")
    severity: Mapped[str] = mapped_column(String(8))  # high / medium / low
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    source: Mapped[str] = mapped_column(String(16))  # live_model / live_logic / simulated
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    rank: Mapped[int] = mapped_column(Integer, default=0)
    fail_item: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(12), default="open")  # open / confirmed / dismissed / deferred
    reason: Mapped[str] = mapped_column(Text, default="")
    decided_by: Mapped[str | None] = mapped_column(String(8), nullable=True)
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class EvidenceEntry(Base):
    """Append-only, SHA-256 hash-chained evidence log."""
    __tablename__ = "evidence_log"
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[str] = mapped_column(String(32))
    inspection_id: Mapped[str | None] = mapped_column(String(16), index=True, nullable=True)
    kind: Mapped[str] = mapped_column(String(32))
    actor: Mapped[str] = mapped_column(String(24), default="system")
    payload: Mapped[dict] = mapped_column(JSON)
    payload_hash: Mapped[str] = mapped_column(String(64))
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64), unique=True)


class Report(Base):
    __tablename__ = "reports"
    report_id: Mapped[str] = mapped_column(String(16), primary_key=True, default=lambda: "RP" + _uuid()[:8])
    inspection_id: Mapped[str] = mapped_column(String(16), index=True)
    plate: Mapped[str] = mapped_column(String(16), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    verdict: Mapped[str] = mapped_column(String(24))
    summary: Mapped[str] = mapped_column(Text)
    narrative_source: Mapped[str] = mapped_column(String(24))  # llm:<model> / template
    verify_token: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    chain_hash: Mapped[str] = mapped_column(String(64))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class Booking(Base):
    __tablename__ = "bookings"
    booking_id: Mapped[str] = mapped_column(String(16), primary_key=True, default=lambda: "BK" + _uuid()[:8])
    plate: Mapped[str] = mapped_column(String(16), index=True)
    branch_id: Mapped[str] = mapped_column(String(8))
    date: Mapped[str] = mapped_column(String(10))
    slot: Mapped[str] = mapped_column(String(5))
    inspection_type: Mapped[str] = mapped_column(String(40))
    gear: Mapped[bool] = mapped_column(Boolean, default=False)
    price_rm: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), default="pending_payment")  # pending_payment/confirmed/checked_in/cancelled
    payment_ref: Mapped[str | None] = mapped_column(String(24), nullable=True)
    checkin_token: Mapped[str] = mapped_column(String(24), default=_uuid)
    source: Mapped[str] = mapped_column(String(16), default="owner")  # owner / fleet / api
    fleet_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class SelfCheck(Base):
    __tablename__ = "self_checks"
    check_id: Mapped[str] = mapped_column(String(16), primary_key=True, default=lambda: "SC" + _uuid()[:8])
    plate: Mapped[str] = mapped_column(String(16), index=True)
    results: Mapped[dict] = mapped_column(JSON)
    verdict: Mapped[str] = mapped_column(String(24))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation: Mapped[str] = mapped_column(String(24), index=True)
    role: Mapped[str] = mapped_column(String(12))
    text: Mapped[str] = mapped_column(Text)
    lang: Mapped[str] = mapped_column(String(4), default="en")
    source: Mapped[str] = mapped_column(String(32), default="")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class FleetReading(Base):
    """Monthly condition readings for fleet vehicles (fleet checks, telematics, lane visits)."""
    __tablename__ = "fleet_readings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[str] = mapped_column(String(12), index=True)
    metric: Mapped[str] = mapped_column(String(24))
    month: Mapped[str] = mapped_column(String(7))  # YYYY-MM
    date: Mapped[str] = mapped_column(String(10))
    value: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(20), default="fleet_check")
    photo: Mapped[str | None] = mapped_column(String(200), nullable=True)
    note: Mapped[str] = mapped_column(String(200), default="")

    __table_args__ = (Index("ix_fleet_readings_vm", "vehicle_id", "metric"),)


class PatternReport(Base):
    __tablename__ = "pattern_reports"
    report_id: Mapped[str] = mapped_column(String(16), primary_key=True, default=lambda: "PR" + _uuid()[:8])
    vehicle_id: Mapped[str] = mapped_column(String(12), index=True)
    metric: Mapped[str] = mapped_column(String(24))
    text: Mapped[str] = mapped_column(Text)
    risk: Mapped[str] = mapped_column(String(8))
    recipients: Mapped[dict] = mapped_column(JSON, default=dict)
    trigger: Mapped[str] = mapped_column(String(40), default="manual")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class Setting(Base):
    """Small key/value store (e.g. demo mode, cached web snapshots)."""
    __tablename__ = "settings_kv"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
