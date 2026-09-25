"""Session player: replays the scripted lane sessions (S1-S3) as real-time sensor streams on the message bus.

Every downstream step (models, alerts, fusion, reports) computes live from what is published here. A presenter
can pause, resume, change speed, jump to a lane step, or override any value (``sensor.field`` = value, or
``sensor.field*`` = multiplier) and the results change accordingly.

Topics: ``lane/<lane_id>/<sensor>`` with sensors: control, step, enose, obd, pn, brake, instrument, thermal,
ev_bms, camera, audio, odometer.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from ..config import get_settings

log = logging.getLogger("vhi.player")

LANE_SESSIONS = {
    "S1": dict(lane_id="BR00-L3", inspection_type="Berkala (commercial, B2)", report_kind="Berkala inspection report"),
    "S2": dict(lane_id="BR01-L2", inspection_type="B5 ownership + B7 hire-purchase, EV",
               report_kind="EV Health Certificate + B5/B7 report"),
    "S3": dict(lane_id="BR02-L1", inspection_type="B5 ownership transfer (MV15)", report_kind="B5 inspection report"),
}
# Extra scripted frames used by the sessions (sample captures shipped in app assets)
EXTRA_MEDIA = {
    "S2": {"cabin_images": ["assets:captures/c05o.jpg"]},
}
# When each non-stream measurement is published (seconds into the session)
INSTRUMENT_AT = {
    "smoke_opacity_pct": 125, "co_pct": 125, "hc_ppm": 125, "hv_isolation_mohm": 120,
    "suspension_eff_pct": 226, "side_slip_m_per_km": 242, "headlamp_dev_pct": 270, "tint_vlt_pct": 276,
    "adas_self_test": 372,
}

PRESETS = {
    "S1": [
        {"id": "dpf_refitted", "label": "DPF refitted (PN x0.05)", "overrides": {"pn.pn_per_cm3*": 0.05}},
        {"id": "brake_fixed", "label": "Dragging brake fixed (A2R hub 60 °C)", "overrides": {"thermal.A2R": 60.0}},
        {"id": "scr_fixed", "label": "SCR repaired (no DTCs, no NH3)", "overrides": {"obd.dtcs": "", "enose.suppress": True}},
    ],
    "S2": [
        {"id": "hv_ok", "label": "HV isolation healthy (6 MOhm)", "overrides": {"instrument.hv_isolation_mohm": 6.0}},
        {"id": "no_offgas", "label": "No electrolyte off-gas", "overrides": {"enose.suppress": True}},
    ],
    "S3": [
        {"id": "odo_ok", "label": "Odometer consistent (190,500 km)", "overrides": {"odometer.km": 190500}},
        {"id": "tint_dark", "label": "Dark tint (VLT 30%)", "overrides": {"instrument.tint_vlt_pct": 30}},
    ],
}


def _media_path(ref: str) -> str:
    """Return a path usable by the processor and a URL-able reference."""
    s = get_settings()
    if ref.startswith("assets:"):
        return str(s.assets_dir / ref.split(":", 1)[1])
    return str(s.data_dir / ref)


@dataclass
class Event:
    t: float
    sensor: str
    payload: dict[str, Any]


@dataclass
class PlayerState:
    session_id: str
    lane_id: str
    status: str = "idle"          # idle / playing / paused / finished
    t: float = 0.0
    speed: float = 1.0
    step: str = ""
    duration: float = 480.0
    overrides: dict[str, Any] = field(default_factory=dict)
    inspection_id: str | None = None
    started_wall: float = 0.0


def build_events(sid: str) -> tuple[dict, list[Event]]:
    """Turn a session file + its stream files into a time-ordered list of bus events."""
    s = get_settings()
    meta = json.loads((s.sessions_dir / f"{sid}.json").read_text())
    sdir = s.sessions_dir / "streams" / sid
    ev: list[Event] = []
    timeline = meta["lane_timeline"]
    for st in timeline:
        ev.append(Event(st["start_s"], "step", {"step": st["step"], "start_s": st["start_s"], "end_s": st["end_s"]}))
    ev.append(Event(timeline[-1]["end_s"], "step", {"step": "done", "start_s": timeline[-1]["end_s"], "end_s": timeline[-1]["end_s"]}))
    step_at = {st["step"]: st for st in timeline}

    def load(name):
        p = sdir / name
        if not p.exists():
            return None
        return pd.read_parquet(p) if name.endswith(".parquet") else json.loads(p.read_text())

    en = load("enose.parquet")
    if en is not None:
        chans = [c for c in en.columns if c.startswith("ch")]
        for r in en.itertuples(index=False):
            ev.append(Event(float(r.t_s), "enose", {"t_s": float(r.t_s), "ch": [float(getattr(r, c)) for c in chans]}))
    obd = load("obd.parquet")
    if obd is not None:
        for r in obd.itertuples(index=False):
            ev.append(Event(float(r.t_s), "obd", {"t_s": float(r.t_s), "engine_rpm": _f(r.engine_rpm), "coolant_temp_c": _f(r.coolant_temp_c),
                                                  "intake_air_temp_c": _f(r.intake_air_temp_c), "maf_g_s": _f(r.maf_g_s),
                                                  "dtcs": r.dtcs or "", "mil_on": bool(r.mil_on)}))
    pn = load("pn.parquet")
    if pn is not None:
        t0 = step_at["emission_idle_rev"]["start_s"] + 5
        for r in pn.itertuples(index=False):
            ev.append(Event(t0 + float(r.t_s), "pn", {"t_s": float(r.t_s), "pn_per_cm3": float(r.pn_per_cm3)}))
    br = load("brake_roller.parquet")
    if br is not None:
        t0 = step_at["brake_roller"]["start_s"] + 3
        for r in br.itertuples(index=False):
            ev.append(Event(t0 + (int(r.axle) - 1) * 16 + float(r.t_s), "brake",
                            {"axle": int(r.axle), "side": r.side, "t_s": float(r.t_s), "force_kn": float(r.brake_force_kn)}))
    inst = load("instruments.json") or {}
    for k, v in inst.items():
        at = INSTRUMENT_AT.get(k)
        if at is not None:
            ev.append(Event(at, "instrument", {"field": k, "value": v}))
    th = load("thermal.json")
    if th:
        ev.append(Event(step_at["undercarriage_ai"]["start_s"] + 8, "thermal", th))
    bms = load("ev_bms.parquet")
    if bms is not None:
        ev.append(Event(step_at["emission_idle_rev"]["start_s"] + 20, "ev_bms", {"modules": bms.to_dict("records")}))
    v = meta.get("vehicle", {})
    ev.append(Event(4, "camera", {"kind": "plate", "plate_text": v.get("plate"), "camera": "ANPR entry camera"}))
    ev.append(Event(24, "camera", {"kind": "chassis", "camera": "Handheld OCR camera"}))
    ev.append(Event(30, "odometer", {"km": v.get("odometer_km"), "source": "OBD / cluster read"}))
    media = {**meta.get("media", {}), **EXTRA_MEDIA.get(sid, {})}
    t_under = step_at["undercarriage_ai"]["start_s"]
    for i, p in enumerate(media.get("undercarriage_images", [])):
        ev.append(Event(t_under + 14 + i * 12, "camera", {"kind": "undercarriage", "path": _media_path(p), "ref": p,
                                                          "camera": f"Pit camera {i + 1}"}))
    for i, p in enumerate(media.get("tyre_images", [])):
        ev.append(Event(t_under + 44 + i * 6, "camera", {"kind": "tyre", "path": _media_path(p), "ref": p, "camera": "Tyre scanner"}))
    t_above = step_at["above_carriage_ai"]["start_s"]
    for i, p in enumerate(media.get("body_images", [])):
        ev.append(Event(t_above + 8 + i * 10, "camera", {"kind": "body", "path": _media_path(p), "ref": p,
                                                         "camera": ["Rear-left camera", "Rear camera"][i % 2]}))
    for i, p in enumerate(media.get("cabin_images", [])):
        ev.append(Event(t_above + 18 + i * 8, "camera", {"kind": "cabin", "path": _media_path(p), "ref": p, "camera": "Cabin camera"}))
    audio = media.get("audio", [])
    t_em = step_at["emission_idle_rev"]["start_s"]
    if sid == "S1" and len(audio) >= 2:
        ev.append(Event(t_em + 30, "audio", {"path": _media_path(audio[1]), "ref": audio[1], "purpose": "engine", "mic": "Idle microphone"}))
        ev.append(Event(step_at["brake_roller"]["start_s"] + 24, "audio", {"path": _media_path(audio[0]), "ref": audio[0],
                                                                            "purpose": "roller", "mic": "Roller-bed microphone"}))
    elif sid == "S3" and len(audio) >= 2:
        ev.append(Event(t_em + 30, "audio", {"path": _media_path(audio[1]), "ref": audio[1], "purpose": "engine", "mic": "Idle microphone"}))
    elif audio:
        ev.append(Event(t_em + 30, "audio", {"path": _media_path(audio[0]), "ref": audio[0], "purpose": "engine", "mic": "Idle microphone"}))
    ev.sort(key=lambda e: (e.t, e.sensor != "step"))
    return meta, ev


def _f(x):
    try:
        f = float(x)
        return None if f != f else f
    except (TypeError, ValueError):
        return None


def apply_overrides(sensor: str, payload: dict, ov: dict) -> dict | None:
    if not ov:
        return payload
    if ov.get(f"{sensor}.suppress"):
        return None
    p = dict(payload)
    if sensor == "instrument":
        key = f"instrument.{p['field']}"
        if key in ov:
            p["value"] = ov[key]
            p["overridden"] = True
        return p
    if sensor == "thermal":
        hubs = dict(p.get("wheel_hub_max_c", {}))
        for k in hubs:
            if f"thermal.{k}" in ov:
                hubs[k] = ov[f"thermal.{k}"]
                p["overridden"] = True
        p["wheel_hub_max_c"] = hubs
        return p
    for k, v in ov.items():
        if not k.startswith(sensor + "."):
            continue
        f = k.split(".", 1)[1]
        if f.endswith("*") and f[:-1] in p and isinstance(p[f[:-1]], (int, float)):
            p[f[:-1]] = p[f[:-1]] * float(v)
            p["overridden"] = True
        elif f in p:
            p[f] = v
            p["overridden"] = True
    return p


class SessionPlayer:
    def __init__(self, rt, sid: str):
        self.rt, self.sid = rt, sid
        cfg = LANE_SESSIONS[sid]
        self.meta, self.events = build_events(sid)
        self.state = PlayerState(session_id=sid, lane_id=cfg["lane_id"], speed=rt.settings.player_speed,
                                 duration=float(self.meta["lane_timeline"][-1]["end_s"]))
        self.cfg = cfg
        self._i = 0
        self._task: asyncio.Task | None = None
        self._resume = asyncio.Event()

    @property
    def topic(self) -> str:
        return f"lane/{self.state.lane_id}"

    async def _pub(self, sensor: str, payload: dict) -> None:
        payload = apply_overrides(sensor, payload, self.state.overrides)
        if payload is None:
            return
        await self.rt.bus.publish(f"{self.topic}/{sensor}", {**payload, "session": self.sid,
                                                              "inspection_id": self.state.inspection_id,
                                                              "sim_t": round(self.state.t, 2)})

    async def start(self, speed: float | None = None, overrides: dict | None = None) -> PlayerState:
        await self.stop()
        from ..tables import _uuid
        st = self.state
        st.inspection_id = "LI" + _uuid()[:8]
        st.t, st.status, st.step = 0.0, "playing", ""
        st.speed = speed or st.speed
        st.overrides = dict(overrides or {})
        st.started_wall = time.time()
        self._i = 0
        self._resume.set()
        await self.rt.bus.publish(f"{self.topic}/control", {
            "action": "start", "session": self.sid, "inspection_id": st.inspection_id, "lane_id": st.lane_id,
            "branch_id": self.meta.get("branch_id"), "vehicle": self.meta.get("vehicle"),
            "inspection_type": self.cfg["inspection_type"], "report_kind": self.cfg["report_kind"],
            "title": self.meta.get("title"), "timeline": self.meta["lane_timeline"], "overrides": st.overrides,
            "sim_t": 0.0})
        self._task = asyncio.create_task(self._run())
        return st

    async def _run(self) -> None:
        st = self.state
        tick = self.rt.settings.player_tick_s
        last = time.monotonic()
        try:
            while self._i < len(self.events):
                await self._resume.wait()
                now = time.monotonic()
                st.t += (now - last) * st.speed
                last = now
                await self._flush_until(st.t)
                await self._broadcast_state()
                await asyncio.sleep(tick)
                if not self._resume.is_set():
                    last = time.monotonic()
            st.status = "finished"
            await self._broadcast_state()
        except asyncio.CancelledError:
            pass
        except Exception:  # keep the demo alive; the processor logs its own errors
            log.exception("player %s crashed", self.sid)
            st.status = "error"

    async def _flush_until(self, t: float) -> None:
        while self._i < len(self.events) and self.events[self._i].t <= t:
            e = self.events[self._i]
            self._i += 1
            if e.sensor == "step":
                self.state.step = e.payload["step"]
            await self._pub(e.sensor, dict(e.payload))

    async def _broadcast_state(self) -> None:
        await self.rt.hub.broadcast(f"lane:{self.state.lane_id}", "player", self.snapshot())
        await self.rt.hub.broadcast("player", "state", self.snapshot())

    def snapshot(self) -> dict:
        st = self.state
        return {"session_id": st.session_id, "lane_id": st.lane_id, "status": st.status, "t": round(st.t, 1),
                "duration": st.duration, "speed": st.speed, "step": st.step, "inspection_id": st.inspection_id,
                "overrides": st.overrides, "timeline": self.meta["lane_timeline"], "title": self.meta.get("title"),
                "presets": PRESETS.get(self.sid, [])}

    async def pause(self) -> None:
        if self.state.status == "playing":
            self.state.status = "paused"
            self._resume.clear()
            await self._broadcast_state()

    async def resume(self) -> None:
        if self.state.status == "paused":
            self.state.status = "playing"
            self._resume.set()
            await self._broadcast_state()

    async def set_speed(self, speed: float) -> None:
        self.state.speed = max(0.25, min(32.0, speed))
        await self._broadcast_state()

    async def set_overrides(self, ov: dict, replace: bool = False) -> None:
        self.state.overrides = dict(ov) if replace else {**self.state.overrides, **ov}
        await self.rt.bus.publish(f"{self.topic}/control", {"action": "overrides", "overrides": self.state.overrides,
                                                            "inspection_id": self.state.inspection_id, "sim_t": self.state.t})
        await self._broadcast_state()

    async def seek(self, t: float) -> None:
        """Jump forward (events in between are delivered instantly). Jumping back restarts the inspection."""
        if self.state.inspection_id is None or t < self.state.t:
            was_paused = self.state.status == "paused"
            await self.start(self.state.speed, self.state.overrides)
            if was_paused:
                await self.pause()
        self.state.t = t
        await self._flush_until(t)
        await self._broadcast_state()

    async def seek_step(self, step: str) -> None:
        for st in self.meta["lane_timeline"]:
            if st["step"] == step:
                await self.seek(float(st["start_s"]) + 0.01)
                return
        raise KeyError(step)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._task = None


class SessionManager:
    def __init__(self, rt):
        self.rt = rt
        self.players: dict[str, SessionPlayer] = {}

    def get(self, sid: str) -> SessionPlayer:
        sid = sid.upper()
        if sid not in LANE_SESSIONS:
            raise KeyError(sid)
        if sid not in self.players:
            self.players[sid] = SessionPlayer(self.rt, sid)
        return self.players[sid]

    def state_all(self) -> list[dict]:
        return [p.snapshot() for p in self.players.values()]

    async def stop_all(self) -> None:
        for p in self.players.values():
            await p.stop()

    async def run_to_end(self, sid: str, overrides: dict | None = None) -> str:
        """Play a whole session instantly (used by tests and the 'fast-forward' button)."""
        p = self.get(sid)
        st = await p.start(speed=1.0, overrides=overrides)
        await p.pause()
        await p.seek(p.state.duration + 1)
        return st.inspection_id


def session_catalogue() -> list[dict]:
    s = get_settings()
    out = []
    for sid in ["S1", "S2", "S3", "S4", "S5", "S6"]:
        meta = json.loads((s.sessions_dir / f"{sid}.json").read_text())
        out.append({"session_id": sid, "title": meta.get("title"), "kind": "lane" if sid in LANE_SESSIONS else "app",
                    "vehicle": meta.get("vehicle"), "expected": meta.get("expected"),
                    "lane_id": LANE_SESSIONS.get(sid, {}).get("lane_id"), "presets": PRESETS.get(sid, [])})
    return out


_ = Path  # (kept for type readers)
