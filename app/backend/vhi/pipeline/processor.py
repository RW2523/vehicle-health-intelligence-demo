"""Stream processor: consumes lane sensor streams from the bus, runs the models, stores readings, raises alerts,
computes the fused health score at examiner review and pushes every update to the apps over WebSocket.

One worker per lane keeps events in order; heavy model calls run in a thread so lanes do not block each other.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy import select, text

from ..db import engine, session_scope
from ..ml import ocr
from ..ml.acoustic import LABELS as AC_LABELS
from ..ml.vision import annotate
from ..services import dtc as dtc_svc
from ..services import evidence
from ..tables import Alert, Booking, LiveInspection, Reading, Setting, Vehicle, _uuid

log = logging.getLogger("vhi.processor")

SEV_W = {"high": 3, "medium": 2, "low": 1}
ENOSE_INFO = {
    "nh3_slip_scr": ("Ammonia slip from the SCR system", "Engine & emissions", "high",
                     "AdBlue dosing fault or bypass. Matches SCR fault codes when present."),
    "ev_electrolyte_offgas": ("Battery electrolyte off-gassing", "EV battery & electrics", "high",
                              "Vented cell or damaged module. Treat as a high-voltage safety concern."),
    "burning_oil_or_hot_brake": ("Burning oil or overheated brake", "Brakes", "medium",
                                 "Hot brake friction material or oil on the exhaust."),
    "fuel_vapour_leak": ("Fuel vapour leak", "Engine & emissions", "high", "Fuel-system leak - fire risk."),
    "coolant_glycol_leak": ("Coolant (glycol) leak", "Engine & emissions", "medium", "Head gasket or radiator leak."),
    "cabin_solvent_or_mould": ("Solvent / mould odour in cabin", "Lights & body", "medium",
                               "Can follow water ingress (flood) or recent refinishing."),
}
AC_SYSTEM = {"engine_knock": "Engine & emissions", "valve_tick": "Engine & emissions", "powertrain_other": "Engine & emissions",
             "wheel_bearing_or_suspension": "Suspension", "belt_or_accessory": "Engine & emissions",
             "exhaust_or_fuel": "Engine & emissions", "brake_noise": "Brakes"}


@dataclass
class LaneCtx:
    inspection_id: str
    session: str
    lane_id: str
    branch_id: str
    vehicle: dict
    vehicle_id: str | None
    inspection_type: str
    report_kind: str
    timeline: list
    step: str = ""
    enose_t: list = field(default_factory=list)
    enose_x: list = field(default_factory=list)
    enose_seen: dict = field(default_factory=dict)
    dtcs: set = field(default_factory=set)
    pn: list = field(default_factory=list)
    brake: dict = field(default_factory=dict)
    results: dict = field(default_factory=dict)
    measurements: dict = field(default_factory=dict)
    alert_codes: set = field(default_factory=set)
    readings: list = field(default_factory=list)
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    worker: asyncio.Task | None = None
    overrides: dict = field(default_factory=dict)
    started: float = field(default_factory=time.time)

    @property
    def evdir(self) -> str:
        return self.inspection_id


class StreamProcessor:
    def __init__(self, rt):
        self.rt = rt
        self.ctx: dict[str, LaneCtx] = {}
        self._tasks: list[asyncio.Task] = []
        self.n_msgs = 0
        self.n_model_calls = 0
        self.last_latency_ms: dict[str, float] = {}

    # ------------------------------------------------------------------ plumbing
    async def start(self) -> None:
        self._tasks = [asyncio.create_task(self._consume()), asyncio.create_task(self._flusher())]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for c in self.ctx.values():
            if c.worker:
                c.worker.cancel()

    def stats(self) -> dict:
        return {"messages": self.n_msgs, "model_calls": self.n_model_calls, "active_lanes": len(self.ctx),
                "latency_ms": self.last_latency_ms}

    async def _consume(self) -> None:
        async for topic, payload in self.rt.bus.subscribe("lane/#"):
            self.n_msgs += 1
            try:
                parts = topic.split("/")
                sensor = parts[-1]
                iid = payload.get("inspection_id")
                if sensor == "control" and payload.get("action") == "start":
                    await self._on_start(payload)
                    continue
                c = self.ctx.get(iid)
                if c is not None:
                    c.queue.put_nowait((sensor, payload))
            except Exception:  # noqa: BLE001
                log.exception("bad message on %s", topic)

    async def _lane_worker(self, c: LaneCtx) -> None:
        while True:
            sensor, payload = await c.queue.get()
            try:
                await self._handle(c, sensor, payload)
            except Exception:  # noqa: BLE001
                log.exception("processing %s for %s failed", sensor, c.inspection_id)
            finally:
                c.queue.task_done()

    async def idle(self, inspection_id: str, timeout: float = 180) -> None:
        """Wait until every queued event of an inspection has been processed (tests, fast-forward)."""
        t0 = time.time()
        quiet = 0
        while time.time() - t0 < timeout:
            c = self.ctx.get(inspection_id)
            backlog = getattr(self.rt.bus, "backlog", lambda: 0)()
            busy = c is None or backlog > 0 or c.queue.qsize() > 0 or c.queue._unfinished_tasks > 0  # noqa: SLF001
            quiet = 0 if busy else quiet + 1
            if quiet >= 3:
                return
            await asyncio.sleep(0.1)
        raise TimeoutError(f"processing {inspection_id} did not finish in {timeout}s")

    async def _flusher(self) -> None:
        while True:
            await asyncio.sleep(1.0)
            rows = []
            for c in list(self.ctx.values()):
                if c.readings:
                    rows += c.readings
                    c.readings = []
            if rows:
                try:
                    await asyncio.to_thread(self._insert_readings, rows)
                except Exception:  # noqa: BLE001
                    log.exception("reading flush failed")

    @staticmethod
    def _insert_readings(rows: list[dict]) -> None:
        with session_scope() as s:
            s.bulk_insert_mappings(Reading, rows)

    def _reading(self, c: LaneCtx, sensor: str, t_s: float, payload: dict) -> None:
        c.readings.append({"id": _uuid(), "ts": dt.datetime.utcnow(), "inspection_id": c.inspection_id,
                           "sensor": sensor, "t_s": float(t_s), "payload": payload})

    async def _push(self, c: LaneCtx, type_: str, data: Any, lane: bool = False) -> None:
        await self.rt.hub.broadcast(f"inspection:{c.inspection_id}", type_, data)
        if lane:
            await self.rt.hub.broadcast(f"lane:{c.lane_id}", type_, data)

    async def _model(self, c: LaneCtx, name: str, fn, *args):
        t0 = time.perf_counter()
        out = await asyncio.to_thread(fn, *args)
        self.n_model_calls += 1
        self.last_latency_ms[name] = round((time.perf_counter() - t0) * 1000, 1)
        return out

    def _media_url(self, path: str) -> str:
        s = self.rt.settings
        p = Path(path)
        for base, prefix in ((s.evidence_dir, "/media/evidence/"), (s.data_dir, "/media/data/"), (s.assets_dir, "/media/assets/")):
            try:
                return prefix + str(p.resolve().relative_to(base.resolve()))
            except ValueError:
                continue
        return path

    def _evfile(self, c: LaneCtx, name: str) -> Path:
        p = self.rt.settings.evidence_dir / c.evdir / name
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    # ------------------------------------------------------------------ lifecycle
    async def _on_start(self, p: dict) -> None:
        v = p.get("vehicle") or {}
        with session_scope() as s:
            veh = s.execute(select(Vehicle).where(Vehicle.plate == v.get("plate"))).scalar_one_or_none()
            vid = veh.vehicle_id if veh else None
            vdict = {"plate": v.get("plate"), "make": v.get("make"), "model": v.get("model"), "year": v.get("year"),
                     "fuel": v.get("fuel"), "usage": v.get("usage"), "heavy": bool(veh.heavy) if veh else v.get("usage") in ("lorry", "bus"),
                     "euro_class": v.get("euro_class"), "dpf_fitted": v.get("dpf_fitted"), "odometer_km": v.get("odometer_km"),
                     "chassis_no": veh.chassis_no if veh else None, "state": veh.state if veh else "",
                     "owner_name": veh.owner_name if veh else "", "vehicle_id": vid, "axles": v.get("axles", 2)}
            s.add(LiveInspection(inspection_id=p["inspection_id"], session_id=p["session"], lane_id=p["lane_id"],
                                 branch_id=p.get("branch_id") or "BR00", vehicle_id=vid, plate=v.get("plate", "?"),
                                 inspection_type=p["inspection_type"], status="in_lane", results={}, measurements={},
                                 fusion={"report_kind": p["report_kind"], "title": p.get("title")}))
        # retire older contexts of the same lane
        for k in [k for k, c in self.ctx.items() if c.lane_id == p["lane_id"]]:
            old = self.ctx.pop(k)
            if old.worker:
                old.worker.cancel()
        c = LaneCtx(inspection_id=p["inspection_id"], session=p["session"], lane_id=p["lane_id"],
                    branch_id=p.get("branch_id") or "BR00", vehicle=vdict, vehicle_id=vid,
                    inspection_type=p["inspection_type"], report_kind=p["report_kind"], timeline=p["timeline"],
                    overrides=p.get("overrides") or {})
        c.worker = asyncio.create_task(self._lane_worker(c))
        self.ctx[c.inspection_id] = c
        evidence.append("inspection_started", {"lane": c.lane_id, "session": c.session, "plate": vdict["plate"],
                                               "type": c.inspection_type, "overrides": c.overrides}, c.inspection_id)
        self.rt.hub.forget(f"lane:{c.lane_id}")
        await self._push(c, "inspection", self.summary(c), lane=True)
        await self.rt.hub.broadcast("inspections", "started", {"inspection_id": c.inspection_id, "lane_id": c.lane_id,
                                                               "plate": vdict["plate"], "session": c.session})

    def summary(self, c: LaneCtx) -> dict:
        return {"inspection_id": c.inspection_id, "session": c.session, "lane_id": c.lane_id, "branch_id": c.branch_id,
                "vehicle": c.vehicle, "inspection_type": c.inspection_type, "report_kind": c.report_kind,
                "timeline": c.timeline, "step": c.step}

    def _save(self, c: LaneCtx, **extra) -> None:
        with session_scope() as s:
            li = s.get(LiveInspection, c.inspection_id)
            if li is None:
                return
            li.results = dict(c.results)
            li.measurements = dict(c.measurements)
            li.step = c.step
            for k, v in extra.items():
                setattr(li, k, v)

    # ------------------------------------------------------------------ dispatch
    async def _handle(self, c: LaneCtx, sensor: str, p: dict) -> None:
        h = getattr(self, f"_on_{sensor}", None)
        if h:
            await h(c, p)

    async def _on_control(self, c: LaneCtx, p: dict) -> None:
        if p.get("action") == "overrides":
            c.overrides = p.get("overrides", {})
            evidence.append("presenter_override", {"overrides": c.overrides, "sim_t": p.get("sim_t")}, c.inspection_id, actor="presenter")
            await self._push(c, "overrides", c.overrides, lane=True)

    async def _on_step(self, c: LaneCtx, p: dict) -> None:
        prev = c.step
        c.step = p["step"]
        if prev == "emission_idle_rev":
            await self._finish_emission(c)
        if prev == "brake_roller":
            await self._finish_brakes(c)
        if c.step == "examiner_review":
            await self._run_enose(c, final=True)
            await self._finalise(c)
        if c.step == "done":
            with session_scope() as s:
                li = s.get(LiveInspection, c.inspection_id)
                if li and li.status == "in_lane":
                    li.status = "review"
        await asyncio.to_thread(self._save, c)
        await self._push(c, "step", {"step": c.step, "start_s": p.get("start_s"), "end_s": p.get("end_s"),
                                     "sim_t": p.get("sim_t")}, lane=True)

    async def _on_enose(self, c: LaneCtx, p: dict) -> None:
        c.enose_t.append(p["t_s"])
        c.enose_x.append(p["ch"])
        self._reading(c, "enose", p["t_s"], {"ch": p["ch"]})
        await self._push(c, "enose", {"t_s": p["t_s"], "ch": p["ch"]}, lane=True)
        if len(c.enose_t) % 20 == 0:
            await self._run_enose(c)

    async def _run_enose(self, c: LaneCtx, final: bool = False) -> None:
        if len(c.enose_t) < 12:
            return
        res = await self._model(c, "enose", self.rt.models.enose.analyse, np.array(c.enose_t), np.array(c.enose_x))
        self._context_fuse(c, res)
        c.results["enose"] = res
        if final:
            await self._retract_enose(c, {e["condition"] for e in res["events"]})
        for e in res["events"]:
            prev = c.enose_seen.get(e["condition"])
            if prev is None or (SEV_W.get(e["level"], 0) > SEV_W.get(prev, 0) and e["level"] != "trace"):
                c.enose_seen[e["condition"]] = e["level"]
                title, system, sev, detail = ENOSE_INFO.get(e["condition"], (e["condition"], "Engine & emissions", "medium", ""))
                if e["level"] == "trace" and sev == "high":
                    sev = "medium"
                await self._alert(c, f"enose:{e['condition']}", f"{title} ({e['level']})",
                                  f"{detail} Peak at {e['peak_s']:.0f} s, confidence {e['p']:.0%} "
                                  f"(signature proxy: {e['proxy_gas']})." + (f" Resolved with other evidence: {e['fused_with']}." if e.get("fused_with") else ""), system, sev, e["p"], "live_model",
                                  {"event": e, "stream": "e-nose 16 ch @ 2 Hz (simulated sensor, UCI signature proxy)"},
                                  replace=True)
        await self._push(c, "result", {"key": "enose", "value": res})

    def _context_fuse(self, c: LaneCtx, res: dict) -> None:
        """Odour classes with similar sensor shapes (e.g. glycol vs hot friction material) are resolved with the
        other lane evidence: a hot wheel hub favours a hot brake, an EV favours electrolyte over fuel vapour."""
        hot_hub = any(t > 100 for t in ((c.results.get("thermal") or {}).get("hubs") or {}).values())
        is_ev = c.vehicle.get("fuel") == "ev"
        prefer = []
        if hot_hub:
            prefer.append(("burning_oil_or_hot_brake", "thermal camera shows a hot wheel hub"))
        if is_ev:
            prefer.append(("ev_electrolyte_offgas", "vehicle is an EV"))
        if not prefer:
            return
        for e in res["events"]:
            # Bayesian context prior: conditions supported by other lane evidence get 10x prior odds
            post = {r["condition"]: r["p"] * (10.0 if any(r["condition"] == c_ for c_, _ in prefer) else 1.0) for r in e["ranked"]}
            z = sum(post.values()) or 1.0
            post = {k: v / z for k, v in post.items()}
            best = max(post, key=post.get)
            if best != e["condition"]:
                e["model_top"] = {"condition": e["condition"], "p": e["p"]}
                e["fused_with"] = next(why for c_, why in prefer if c_ == best)
            e["condition"], e["p"] = best, round(post[best], 3)
            e["posterior"] = {k: round(v, 3) for k, v in post.items()}

    async def _retract_enose(self, c: LaneCtx, keep: set) -> None:
        with session_scope() as s:
            stale = s.execute(select(Alert).where(Alert.inspection_id == c.inspection_id, Alert.code.like("enose:%"),
                                                  Alert.status == "open")).scalars().all()
            gone = [a for a in stale if a.code.split(":", 1)[1] not in keep]
            ids = [(a.alert_id, a.code) for a in gone]
            for a in gone:
                s.delete(a)
        for aid, code in ids:
            c.alert_codes.discard(code)
            c.enose_seen.pop(code.split(":", 1)[1], None)
            evidence.append("alert_retracted", {"alert_id": aid, "code": code, "why": "superseded by the fused e-nose result"},
                            c.inspection_id)
            await self._push(c, "alert_retracted", {"alert_id": aid, "code": code}, lane=True)

    async def _on_obd(self, c: LaneCtx, p: dict) -> None:
        self._reading(c, "obd", p["t_s"], {k: p.get(k) for k in ("engine_rpm", "coolant_temp_c", "maf_g_s", "dtcs", "mil_on")})
        await self._push(c, "obd", {k: p.get(k) for k in ("t_s", "engine_rpm", "coolant_temp_c", "maf_g_s", "mil_on")}, lane=True)
        codes = {d for d in (p.get("dtcs") or "").split(",") if d}
        c.measurements["obd_mil_on"] = bool(p.get("mil_on")) and bool(codes)
        c.measurements["obd_dtcs"] = ",".join(sorted(codes))
        new = codes - c.dtcs
        if new:
            c.dtcs |= new
            decoded = [dtc_svc.describe(x) for x in sorted(codes)]
            c.results["obd"] = {"dtcs": decoded, "mil_on": bool(p.get("mil_on"))}
            for d in [dtc_svc.describe(x) for x in sorted(new)]:
                await self._alert(c, f"dtc:{d['code']}", f"OBD fault code {d['code']}", d["description"], d["system"],
                                  d["severity"], 0.99, "simulated", {"dtc": d, "source": "OBD-II readout (simulated stream)"})
            await self._push(c, "result", {"key": "obd", "value": c.results["obd"]})

    async def _on_pn(self, c: LaneCtx, p: dict) -> None:
        c.pn.append(p["pn_per_cm3"])
        self._reading(c, "pn", p["t_s"], {"pn_per_cm3": p["pn_per_cm3"]})
        await self._push(c, "pn", {"t_s": p["t_s"], "pn_per_cm3": p["pn_per_cm3"]}, lane=True)

    async def _finish_emission(self, c: LaneCtx) -> None:
        if not c.pn:
            return
        pn = float(np.median(c.pn))
        c.measurements["pn_per_cm3"] = pn
        dpf = bool(c.vehicle.get("dpf_fitted"))
        verdict = "fail" if pn > 1e6 and dpf else ("advisory" if pn > 250_000 else "pass")
        c.results["pn"] = {"median_per_cm3": round(pn), "samples": len(c.pn), "limit_advisory": 250_000,
                           "limit_tamper": 1_000_000, "verdict": verdict, "dpf_fitted": dpf}
        smoke = (c.results.get("instruments") or {}).get("smoke_opacity_pct")
        if smoke:
            c.results["pn"]["opacity_misleading"] = verdict != "pass" and smoke["verdict"] == "pass"
        if verdict != "pass":
            await self._alert(c, "pn:high", f"Particle number {pn / 1e6:.2f} M/cm³ ({'DPF removed or failed' if verdict == 'fail' else 'above advisory level'})",
                              f"Median of {len(c.pn)} one-second PN readings at idle. A working DPF keeps PN below 250k/cm³; "
                              f"{'this vehicle has a DPF fitted, so the level indicates removal or failure.' if dpf else ''}"
                              f" Smoke opacity alone does not catch this.",
                              "Engine & emissions", "high", 0.97, "simulated", {"pn": c.results["pn"]}, fail_item=verdict == "fail")
        await self._push(c, "result", {"key": "pn", "value": c.results["pn"]})

    async def _on_brake(self, c: LaneCtx, p: dict) -> None:
        key = f"A{p['axle']}{p['side']}"
        c.brake.setdefault(key, []).append((p["t_s"], p["force_kn"]))
        self._reading(c, "brake", p["t_s"], {"wheel": key, "force_kn": p["force_kn"]})
        await self._push(c, "brake", {"wheel": key, "t_s": p["t_s"], "force_kn": p["force_kn"]}, lane=True)

    async def _finish_brakes(self, c: LaneCtx) -> None:
        if not c.brake:
            return
        wheels = {}
        for k, pts in c.brake.items():
            f = np.array([x[1] for x in pts])
            t = np.array([x[0] for x in pts])
            peak = float(np.mean(np.sort(f)[-10:]))
            drag = float(np.mean(f[t < 1.5])) if (t < 1.5).any() else 0.0
            wheels[k] = {"peak_kn": round(peak, 2), "drag_kn": round(drag, 3), "drag_pct": round(100 * drag / max(peak, 1e-6), 1)}
        axles = sorted({k[1] for k in wheels})
        per_axle = {}
        for a in axles:
            L, R = wheels.get(f"A{a}L"), wheels.get(f"A{a}R")
            if L and R:
                imb = 100 * abs(L["peak_kn"] - R["peak_kn"]) / max(L["peak_kn"], R["peak_kn"], 1e-6)
                per_axle[a] = round(imb, 1)
        ref_kn = 9.5  # roller reference force at test axle load (per wheel)
        eff = 100 * np.mean([w["peak_kn"] for w in wheels.values()]) / ref_kn
        heavy = bool(c.vehicle.get("heavy"))
        lim = 45 if heavy else 50
        max_imb = max(per_axle.values()) if per_axle else 0.0
        max_drag = max(w["drag_pct"] for w in wheels.values())
        c.measurements.update(brake_efficiency_pct=round(float(eff), 1), brake_imbalance_pct=max_imb, brake_drag_pct=max_drag)
        c.results["brakes"] = {"wheels": wheels, "imbalance_by_axle": per_axle, "efficiency_pct": round(float(eff), 1),
                               "limit_efficiency_pct": lim, "limit_imbalance_pct": 30, "verdict":
                               "fail" if eff < lim or max_imb > 30 else ("advisory" if max_imb > 20 else "pass")}
        if eff < lim:
            await self._alert(c, "brake:efficiency", f"Brake efficiency {eff:.0f}% (limit {lim}%)",
                              "Service brake efficiency below the minimum on the roller tester.", "Brakes", "high", 0.99,
                              "simulated", {"brakes": c.results["brakes"]}, fail_item=True)
        worst = max(per_axle, key=per_axle.get) if per_axle else None
        if worst and per_axle[worst] > 20:
            await self._alert(c, "brake:imbalance", f"Brake imbalance {per_axle[worst]:.0f}% on axle {worst}",
                              "Left/right braking force differs; the vehicle can pull under braking.", "Brakes",
                              "high" if per_axle[worst] > 30 else "medium", 0.99, "simulated", {"brakes": c.results["brakes"]},
                              fail_item=per_axle[worst] > 30)
        drag_w = [k for k, w in wheels.items() if w["drag_pct"] > 12]
        if drag_w:
            await self._alert(c, "brake:drag", f"Brake drag on {', '.join(drag_w)}",
                              "Braking force present with the pedal released - a sticking caliper or seized slide.",
                              "Brakes", "medium", 0.95, "simulated", {"wheels": {k: wheels[k] for k in drag_w}})
        await self._push(c, "result", {"key": "brakes", "value": c.results["brakes"]})

    async def _on_instrument(self, c: LaneCtx, p: dict) -> None:
        f, v = p["field"], p["value"]
        self._reading(c, "instrument", p.get("sim_t", 0), {"field": f, "value": v})
        res = c.results.setdefault("instruments", {})
        heavy, fuel = bool(c.vehicle.get("heavy")), c.vehicle.get("fuel")
        verdict, limit, fail = "pass", None, False
        if f == "smoke_opacity_pct":
            c.measurements["smoke_opacity_pct"] = v
            limit = 50
            verdict = "fail" if v > limit else "pass"
        elif f == "co_pct":
            c.measurements["co_pct"] = v
            limit = 3.5
            verdict = "fail" if v > limit else "pass"
        elif f == "hc_ppm":
            c.measurements["hc_ppm"] = v
            limit = 600
            verdict = "fail" if v > limit else "pass"
        elif f == "hv_isolation_mohm":
            c.measurements["hv_isolation_mohm"] = v
            limit = 2.0
            verdict = "fail" if v < 0.5 else ("advisory" if v < 2.0 else "pass")
            if verdict != "pass":
                await self._alert(c, "ev:hv_isolation", f"HV isolation {v} MOhm ({verdict})",
                                  "Insulation resistance between the high-voltage system and chassis is below 2 MOhm "
                                  "(demo rule). Moisture ingress is a common cause after flooding.",
                                  "EV battery & electrics", "high" if verdict == "fail" else "medium", 0.99, "simulated",
                                  {"hv_isolation_mohm": v}, fail_item=verdict == "fail")
        elif f == "suspension_eff_pct":
            vals = v if isinstance(v, list) else [v]
            c.measurements["suspension_efficiency_pct"] = float(min(vals))
            limit = 40
            verdict = "fail" if min(vals) < limit else "pass"
            if verdict == "fail":
                await self._alert(c, "suspension", f"Suspension efficiency {min(vals)}% (limit 40%)", "Worn dampers.",
                                  "Suspension", "high", 0.99, "simulated", {"values": vals}, fail_item=True)
        elif f == "side_slip_m_per_km":
            c.measurements["side_slip_m_per_km"] = v
            limit = 5
            verdict = "fail" if abs(v) > limit else "pass"
        elif f == "headlamp_dev_pct":
            c.measurements["headlamp_aim_dev_pct"] = v
            limit = 2
            verdict = "fail" if abs(v) > limit else "pass"
            if verdict == "fail":
                await self._alert(c, "headlamp", f"Headlamp aim off by {v}%", "Re-aim the headlamps.", "Lights & body",
                                  "medium", 0.99, "simulated", {"value": v}, fail_item=True)
        elif f == "tint_vlt_pct":
            c.measurements["tint_vlt_front_pct"] = v
            limit = 50
            verdict = "fail" if v < limit else "pass"
            if verdict == "fail":
                await self._alert(c, "tint", f"Front side window tint VLT {v}% (minimum 50%)",
                                  "Visible light transmission below the legal minimum for front side windows.",
                                  "Lights & body", "medium", 0.99, "simulated", {"value": v}, fail_item=True)
        elif f == "adas_self_test":
            c.results["adas"] = {"status": str(v), "note": "ADAS check is advisory only in this demo (mock UI, feature 32)"}
            await self._push(c, "result", {"key": "adas", "value": c.results["adas"]})
            return
        res[f] = {"value": v, "limit": limit, "verdict": verdict, "overridden": bool(p.get("overridden")), "source": "simulated"}
        _ = (heavy, fuel, fail)
        await self._push(c, "instrument", {"field": f, **res[f]}, lane=True)

    async def _on_thermal(self, c: LaneCtx, p: dict) -> None:
        hubs = p.get("wheel_hub_max_c", {})
        c.results["thermal"] = {"hubs": hubs, "pack": p.get("battery_pack_cells"), "overridden": bool(p.get("overridden"))}
        self._reading(c, "thermal", p.get("sim_t", 0), c.results["thermal"])
        for k, t in hubs.items():
            if t > 100:
                bearing = "wheel_bearing" in str(c.results.get("acoustic", ""))
                await self._alert(c, f"thermal:{k}", f"Hot wheel hub {k}: {t:.0f} °C",
                                  "Hub far hotter than the others after the brake test - dragging brake"
                                  + (" or failing bearing" if bearing else "") + ".", "Brakes", "high", 0.98, "simulated",
                                  {"hubs": hubs}, fail_item=t > 120)
        pack = p.get("battery_pack_cells")
        if pack and pack.get("max_c", 0) > 42:
            await self._alert(c, "thermal:pack", f"Battery hot-spot {pack['max_c']} °C at {pack.get('hotspot_cell')}",
                              f"Cell {pack.get('hotspot_cell')} is {pack['max_c'] - pack.get('mean_c', 0):.0f} °C above the pack mean.",
                              "EV battery & electrics", "medium", 0.95, "simulated", {"pack": pack})
        await self._push(c, "result", {"key": "thermal", "value": c.results["thermal"]}, lane=True)

    async def _on_ev_bms(self, c: LaneCtx, p: dict) -> None:
        age = 2026 - int(c.vehicle.get("year") or 2026)
        res = await self._model(c, "soh", self.rt.models.soh.assess, p["modules"], c.measurements.get("hv_isolation_mohm"), age)
        c.results["ev"] = res
        c.measurements["ev_soh_pct"] = res["pack_soh_pct"]
        if res["pack_soh_pct"] < 80:
            await self._alert(c, "ev:soh", f"Battery state of health {res['pack_soh_pct']}% (expected ~{res['expected_for_age_pct']:.0f}% for age)",
                              f"Weakest module {res['weakest_module']}. About {res['km_to_70']:,} km until 70%.",
                              "EV battery & electrics", "medium", 0.9, "live_model", {"ev": {k: res[k] for k in ('pack_soh_pct', 'band_pct', 'weakest_module')}})
        await self._push(c, "result", {"key": "ev", "value": res}, lane=True)

    async def _on_odometer(self, c: LaneCtx, p: dict) -> None:
        km = int(p["km"])
        c.measurements["odometer_km"] = km
        prev = pd.DataFrame()
        if c.vehicle_id:
            prev = pd.read_sql(text("select date, odometer_km, inspection_type from hist_inspections where vehicle_id = :v order by date"),
                               engine(), params={"v": c.vehicle_id})
        res = {"reading_km": km, "overridden": bool(p.get("overridden")), "history": prev.to_dict("records")}
        if len(prev):
            mx = prev.loc[prev.odometer_km.idxmax()]
            res["max_recorded_km"] = int(mx.odometer_km)
            res["max_recorded_date"] = str(mx.date)
            if km < mx.odometer_km - 1000:
                res["rollback_km"] = int(mx.odometer_km - km)
                await self._alert(c, "identity:odometer", f"Odometer rollback: {km:,} km vs {int(mx.odometer_km):,} km on {mx.date}",
                                  f"The reading is {int(mx.odometer_km - km):,} km lower than recorded at an earlier inspection.",
                                  "Identity & integrity", "high", 0.99, "live_logic", {"odometer": res}, fail_item=False)
        c.results["odometer"] = res
        await self._push(c, "result", {"key": "odometer", "value": res}, lane=True)

    async def _on_camera(self, c: LaneCtx, p: dict) -> None:
        kind = p["kind"]
        if kind == "plate":
            await self._anpr(c, p)
        elif kind == "chassis":
            await self._chassis(c, p)
        elif kind in ("undercarriage", "cabin"):
            await self._corrosion(c, p)
        elif kind == "tyre":
            await self._image_cls(c, p, "tyre")
        elif kind == "body":
            await self._image_cls(c, p, "damage")

    async def _anpr(self, c: LaneCtx, p: dict) -> None:
        img = self._evfile(c, "anpr_plate.jpg")
        await asyncio.to_thread(ocr.render_plate, p.get("plate_text") or "", img)
        r = await self._model(c, "anpr", ocr.read_plate, img)
        expected = c.vehicle.get("plate")
        booking = None
        if r["plate"]:
            with session_scope() as s:
                b = s.execute(select(Booking).where(Booking.plate == r["plate"], Booking.status == "confirmed")
                              .order_by(Booking.created_at.desc())).scalars().first()
                if b:
                    b.status = "checked_in"
                    booking = {"booking_id": b.booking_id, "slot": f"{b.date} {b.slot}", "gear": b.gear}
        res = {"plate": r["plate"], "conf": r["conf"], "matches_session_vehicle": r["plate"] == expected,
               "image": self._media_url(str(img)), "booking": booking, "camera": p.get("camera"),
               "mysikap": {"source": "mock mySIKAP", "found": c.vehicle_id is not None, "chassis_no": c.vehicle.get("chassis_no"),
                           "owner": c.vehicle.get("owner_name")}}
        c.results["anpr"] = res
        evidence.append("anpr", {"plate": r["plate"], "conf": r["conf"], "image_sha256": evidence.file_sha256(img)}, c.inspection_id)
        if not r["plate"] or r["plate"] != expected:
            await self._alert(c, "anpr:mismatch", "Plate not confirmed by ANPR", f"OCR read '{r['plate']}', expected {expected}. "
                              "Confirm the plate manually.", "Identity & integrity", "medium", r["conf"], "live_model", {"anpr": res})
        await self._push(c, "result", {"key": "anpr", "value": res}, lane=True)

    async def _chassis(self, c: LaneCtx, p: dict) -> None:
        chassis = c.vehicle.get("chassis_no") or ""
        img = self._evfile(c, "chassis_plate.jpg")
        await asyncio.to_thread(ocr.render_chassis_plate, chassis, img)
        r = await self._model(c, "chassis_ocr", ocr.read_chassis, img)
        match = bool(r["chassis_no"]) and r["chassis_no"] == chassis
        res = {"read": r["chassis_no"], "conf": r["conf"], "registry": chassis, "match": match,
               "image": self._media_url(str(img)), "camera": p.get("camera")}
        c.results["chassis"] = res
        evidence.append("chassis_ocr", {"read": r["chassis_no"], "registry": chassis, "match": match,
                                        "image_sha256": evidence.file_sha256(img)}, c.inspection_id)
        if not match:
            await self._alert(c, "identity:chassis", "Chassis number does not match the registry",
                              f"Read {r['chassis_no']}, registry {chassis}.", "Identity & integrity", "high", r["conf"],
                              "live_model", {"chassis": res})
        await self._push(c, "result", {"key": "chassis", "value": res}, lane=True)

    async def _corrosion(self, c: LaneCtx, p: dict) -> None:
        r = await self._model(c, "corrosion", self.rt.models.vision.corrosion.analyse, p["path"])
        n = len(c.results.get("images", []))
        out = self._evfile(c, f"{p['kind']}_{n}.jpg")
        await asyncio.to_thread(annotate, p["path"], out, r["boxes"],
                                f"Corrosion {r['corrosion_score']}/10 ({r['level']}) - {p.get('camera')}")
        item = {"kind": p["kind"], "camera": p.get("camera"), "source_image": self._media_url(p["path"]),
                "annotated": self._media_url(str(out)), "model": "corrosion segmentation", **r}
        c.results.setdefault("images", []).append(item)
        if p["kind"] == "undercarriage":
            c.measurements["corrosion_score_0_10"] = max(c.measurements.get("corrosion_score_0_10", 0), r["corrosion_score"])
        else:
            c.results["cabin_corrosion"] = max(c.results.get("cabin_corrosion", 0), r["corrosion_score"])
        evidence.append("image_analysis", {"kind": p["kind"], "score": r["corrosion_score"], "boxes": len(r["boxes"]),
                                           "image_sha256": evidence.file_sha256(p["path"])}, c.inspection_id)
        if r["corrosion_score"] >= 4:
            where = "Undercarriage" if p["kind"] == "undercarriage" else "Cabin floor / seat rails"
            await self._alert(c, f"corrosion:{p['kind']}", f"{where} corrosion {r['corrosion_score']}/10 ({r['level']})",
                              f"{len(r['boxes'])} corroded region(s) segmented. "
                              + ("Corrosion inside the cabin is a flood indicator." if p["kind"] == "cabin" else
                                 "Check structural members and brake lines."),
                              "Lights & body", "high" if r["corrosion_score"] >= 7 else "medium",
                              min(0.97, 0.6 + r["corrosion_score"] / 25), "live_logic", {"image": item}, replace=True)
        await self._push(c, "result", {"key": "images", "value": c.results["images"]}, lane=True)

    async def _image_cls(self, c: LaneCtx, p: dict, task: str) -> None:
        r = await self._model(c, task, self.rt.models.vision.classify, task, p["path"])
        n = len(c.results.get("images", []))
        out = self._evfile(c, f"{task}_{n}.jpg")
        banner = f"{r.get('label', 'model unavailable')} ({r.get('p', 0):.0%}) - {r.get('arch')}" if r.get("available") else "model unavailable"
        await asyncio.to_thread(annotate, p["path"], out, [], banner)
        item = {"kind": p["kind"], "camera": p.get("camera"), "source_image": self._media_url(p["path"]),
                "annotated": self._media_url(str(out)), "model": f"{task} classifier", **r}
        c.results.setdefault("images", []).append(item)
        evidence.append("image_analysis", {"kind": p["kind"], "result": r.get("class"), "p": r.get("p"),
                                           "image_sha256": evidence.file_sha256(p["path"])}, c.inspection_id)
        if r.get("available"):
            if task == "tyre" and r["class"] == "defective" and r["p"] >= 0.6:
                c.measurements["tyre_defect_p"] = r["p"]
                await self._alert(c, "tyre:defect", f"Tyre defect detected ({r['p']:.0%})",
                                  "Cracking, uneven wear or damage on the tyre scanner image. Measure tread depth to confirm.",
                                  "Tyres", "high" if r["p"] >= 0.85 else "medium", r["p"], "live_model", {"image": item},
                                  fail_item=r["p"] >= 0.85, replace=True)
            if task == "damage" and r["class"] != "normal" and r["p"] >= 0.5:
                c.measurements["structural_anomaly"] = c.measurements.get("structural_anomaly", False) or r["class"] == "crushed"
                c.results["body_damage"] = {"class": r["class"], "p": r["p"], "camera": p.get("camera")}
                await self._alert(c, "body:damage", f"{r['label']} - {p.get('camera', '').replace(' camera', '')}",
                                  "ASTRA-style above-carriage check: panel damage or previous repair. Check the repair "
                                  "history and panel gaps.", "Lights & body", "medium", r["p"], "live_model", {"image": item},
                                  replace=True)
        await self._push(c, "result", {"key": "images", "value": c.results["images"]}, lane=True)

    async def _on_audio(self, c: LaneCtx, p: dict) -> None:
        r = await self._model(c, "acoustic", self.rt.models.acoustic.classify, p["path"])
        item = {"purpose": p.get("purpose"), "mic": p.get("mic"), "clip": self._media_url(p["path"]), **r}
        if p.get("purpose") == "engine":
            with session_scope() as s:
                row = s.get(Setting, "prior_audio")
                refs = (row.value if row else {}).get(c.vehicle.get("plate"), [])
            if refs:
                paths = [str(self.rt.settings.data_dir / x) for x in refs]
                fp = await self._model(c, "fingerprint", self.rt.models.acoustic.compare, p["path"], paths)
                fp["reference_clips"] = [self._media_url(x) for x in paths]
                item["fingerprint"] = fp
                if fp["engine_changed"]:
                    await self._alert(c, "identity:engine", f"Engine sound does not match previous visits (similarity {fp['similarity']:.2f})",
                                      f"Acoustic fingerprint similarity {fp['similarity']:.2f} is below the calibrated threshold "
                                      f"{fp['threshold']:.2f}. Possible undeclared engine change - verify the engine number.",
                                      "Identity & integrity", "high", min(0.97, 0.6 + (fp["threshold"] - fp["similarity"])),
                                      "live_model", {"fingerprint": fp})
        c.results.setdefault("acoustic", []).append(item)
        evidence.append("acoustic", {"purpose": p.get("purpose"), "top": r["top"], "fingerprint": item.get("fingerprint"),
                                     "clip_sha256": evidence.file_sha256(p["path"])}, c.inspection_id)
        top = r["top"]
        if top["class"] not in ("normal_engine", "lane_background") and top["p"] >= 0.4:
            await self._alert(c, f"acoustic:{top['class']}", f"{AC_LABELS.get(top['class'], top['class'])} ({top['p']:.0%})",
                              f"Heard on the {p.get('mic', 'microphone').lower()}. Loudest section "
                              f"{r['highlight_s'][0]:.1f}-{r['highlight_s'][1]:.1f} s.",
                              AC_SYSTEM.get(top["class"], "Engine & emissions"), "medium", top["p"], "live_model", {"acoustic": item})
        await self._push(c, "result", {"key": "acoustic", "value": c.results["acoustic"]}, lane=True)

    # ------------------------------------------------------------------ alerts
    async def _alert(self, c: LaneCtx, code: str, title: str, detail: str, system: str, severity: str, confidence: float,
                     source: str, evidence_: dict, fail_item: bool = False, replace: bool = False) -> None:
        if code in c.alert_codes and not replace:
            return
        with session_scope() as s:
            existing = s.execute(select(Alert).where(Alert.inspection_id == c.inspection_id, Alert.code == code)).scalar_one_or_none()
            if existing is not None:
                if existing.status != "open":
                    return
                existing.title, existing.detail, existing.severity = title, detail, severity
                existing.confidence, existing.evidence, existing.fail_item = float(confidence), evidence_, fail_item
                a = existing
            else:
                a = Alert(inspection_id=c.inspection_id, code=code, title=title, detail=detail, system=system,
                          severity=severity, confidence=float(confidence), source=source, evidence=evidence_,
                          fail_item=fail_item)
                s.add(a)
            s.flush()
            data = alert_dict(a)
        c.alert_codes.add(code)
        evidence.append("alert_raised", {"alert_id": data["alert_id"], "code": code, "title": title, "severity": severity,
                                         "confidence": round(float(confidence), 3), "source": source}, c.inspection_id)
        await self._push(c, "alert", data, lane=True)

    # ------------------------------------------------------------------ fusion at examiner review
    async def _finalise(self, c: LaneCtx) -> None:
        m = self.rt.models
        veh = dict(c.vehicle)
        rules = []
        for cond, lvl in c.enose_seen.items():
            title, system, sev, _ = ENOSE_INFO.get(cond, (cond, "Engine & emissions", "medium", ""))
            pts = {"high": 10, "medium": 6, "trace": 4}.get(lvl, 4) if sev != "low" else 3
            rules.append({"rule": f"E-nose: {title.lower()} ({lvl})", "system": system if system in FUSION_SYSTEMS else "Engine & emissions", "points": pts})
        for a in c.results.get("acoustic", []):
            t = a["top"]
            if t["class"] not in ("normal_engine", "lane_background") and t["p"] >= 0.4:
                rules.append({"rule": f"Acoustic: {AC_LABELS.get(t['class'], t['class']).lower()}",
                              "system": AC_SYSTEM.get(t["class"], "Engine & emissions"), "points": 6})
        for k, t in (c.results.get("thermal", {}).get("hubs") or {}).items():
            if t > 100:
                rules.append({"rule": f"Thermal: hub {k} at {t:.0f} °C", "system": "Brakes", "points": 12})
        pack = (c.results.get("thermal") or {}).get("pack")
        if pack and pack.get("max_c", 0) > 42:
            rules.append({"rule": f"Thermal: battery hot-spot {pack['max_c']} °C", "system": "EV battery & electrics", "points": 6})
        if c.measurements.get("tyre_defect_p", 0) >= 0.6:
            rules.append({"rule": "Tyre image: defect", "system": "Tyres", "points": 10})
        if c.results.get("body_damage"):
            rules.append({"rule": "Body image: panel damage / repair", "system": "Lights & body", "points": 5})
        # every other confirmed-looking alert the history model cannot see costs points too (capped per system)
        covered = ("thermal:", "tyre:", "enose:", "acoustic:", "flood", "body:", "identity:", "route:", "anpr:")
        extra: dict[str, float] = {}
        with session_scope() as s:
            pending = s.execute(select(Alert).where(Alert.inspection_id == c.inspection_id)).scalars().all()
            for a in sorted(pending, key=lambda x: (not x.fail_item, -SEV_W.get(x.severity, 0))):
                if a.code.startswith(covered) or a.system not in FUSION_SYSTEMS:
                    continue
                pts = 10 if a.fail_item else (5 if a.severity == "high" else 3)
                if extra.get(a.system, 0) + pts > 15:
                    pts = max(0, 15 - extra.get(a.system, 0))
                if pts:
                    extra[a.system] = extra.get(a.system, 0) + pts
                    rules.append({"rule": a.title, "system": a.system, "points": pts})
        flood = None
        if veh.get("fuel") == "ev" or c.results.get("cabin_corrosion") or "ev_electrolyte_offgas" in c.enose_seen:
            flood = await self._model(c, "flood", self._flood, c)
            c.results["flood"] = flood
            if flood["p"] >= 0.5:
                rules.append({"rule": f"Flood probability {flood['p']:.0%}", "system": "Lights & body", "points": 12})
                await self._alert(c, "flood", f"Likely flood damage ({flood['p']:.0%})",
                                  "Physical-evidence model (corrosion, HV isolation, battery health) plus transparent rules for "
                                  "claim history and e-nose. "
                                  + "; ".join(flood["signals"]), "Lights & body", "high", flood["p"], "live_model", {"flood": flood})
        h = await self._model(c, "health", m.fusion.health_score, dict(c.measurements), veh, rules)
        with session_scope() as s:
            alerts = s.execute(select(Alert).where(Alert.inspection_id == c.inspection_id)).scalars().all()
            failed_now = any(a.fail_item for a in alerts)
            identity = [a.code for a in alerts if a.code.startswith("identity:")]
        nf = await self._model(c, "next_fail", m.fusion.next_fail, dict(c.measurements), veh, failed_now)
        route = "senior" if identity else "normal"
        if identity:
            await self._alert(c, "route:senior", "Route to a senior examiner",
                              "Identity checks disagree (" + ", ".join(i.split(":")[1] for i in identity) + "). "
                              "A senior examiner must confirm identity before any certificate is issued.",
                              "Identity & integrity", "high", 0.99, "live_logic", {"flags": identity})
        fusion = {"health": h, "next_fail": nf, "route": route, "flood": flood, "computed_at": time.time()}
        c.results["fusion"] = fusion
        self._rank(c)
        with session_scope() as s:
            li = s.get(LiveInspection, c.inspection_id)
            li.health_score = h["score"]
            li.next_fail_risk = nf["p_fail_next"]
            li.route = route
            li.status = "review"
            li.fusion = {**(li.fusion or {}), **fusion}
        evidence.append("fusion", {"health": h["score"], "subscores": h["subscores"], "p_fail_next": nf["p_fail_next"],
                                   "route": route, "rules": rules}, c.inspection_id)
        await self._push(c, "fusion", fusion, lane=True)
        await self.rt.hub.broadcast("inspections", "review", {"inspection_id": c.inspection_id, "plate": veh.get("plate"),
                                                              "health": h["score"], "route": route})

    def _flood(self, c: LaneCtx) -> dict:
        veh = c.vehicle
        claims = pd.DataFrame()
        if c.vehicle_id:
            claims = pd.read_sql(text("select * from hist_claims where vehicle_id = :v"), engine(), params={"v": c.vehicle_id})
        flood_claim = bool(len(claims) and claims.claim_type.str.contains("flood").any())
        age = 2026 - int(veh.get("year") or 2026)
        soh = c.measurements.get("ev_soh_pct")
        corr = c.measurements.get("corrosion_score_0_10", np.nan)
        feats = {"age_years": age, "is_ev": float(veh.get("fuel") == "ev"), "corrosion_max": corr, "corrosion_last": corr,
                 "flood_claim": float(flood_claim), "any_claim_rm_log": math.log10(float(claims.amount_rm.sum()) + 1) if len(claims) else 0.0,
                 "hv_isolation_min": c.measurements.get("hv_isolation_mohm", np.nan),
                 "soh_gap": (100 - 2.2 * age) - soh if soh is not None else np.nan,
                 "flood_state": float(veh.get("state") in ("Kelantan", "Terengganu", "Pahang", "Johor", "Selangor", "W.P. Kuala Lumpur", "Kedah", "Sabah")),
                 "structural_any": float(bool(c.measurements.get("structural_anomaly")))}
        base = self.rt.models.fusion.flood_probability(feats)
        p = base["p"]
        signals = []
        if flood_claim:
            signals.append("flood insurance claim on record")
        if corr == corr and corr >= 4:
            signals.append(f"underbody corrosion {corr}/10")
        if c.measurements.get("hv_isolation_mohm") is not None and c.measurements["hv_isolation_mohm"] < 2:
            signals.append(f"HV isolation {c.measurements['hv_isolation_mohm']} MOhm")
        bump = 0.0
        p_after_claims = p
        if flood_claim:
            p_after_claims = 1 - (1 - p) * (1 - 0.5)  # rule: a flood claim on record halves the odds of "no flood"
        if "ev_electrolyte_offgas" in c.enose_seen or "cabin_solvent_or_mould" in c.enose_seen:
            bump += 0.12
            signals.append("e-nose electrolyte / mould trace")
        if c.results.get("cabin_corrosion", 0) >= 4:
            bump += 0.1
            signals.append(f"cabin corrosion {c.results['cabin_corrosion']}/10")
        p_final = min(0.97, 1 - (1 - p_after_claims) * (1 - bump))
        return {"p": round(p_final, 3), "p_model": p, "p_with_claims": round(p_after_claims, 3), "rule_bump": bump, "signals": signals, "factors": base["factors"],
                "features": {k: (None if (isinstance(v, float) and v != v) else v) for k, v in feats.items()}}

    def _rank(self, c: LaneCtx) -> None:
        with session_scope() as s:
            alerts = s.execute(select(Alert).where(Alert.inspection_id == c.inspection_id)).scalars().all()
            order = sorted(alerts, key=lambda a: (-(a.code == "route:senior"), -a.fail_item, -SEV_W.get(a.severity, 0), -a.confidence))
            for i, a in enumerate(order, start=1):
                a.rank = i


FUSION_SYSTEMS = {"Brakes", "Tyres", "Suspension", "Engine & emissions", "Lights & body", "EV battery & electrics"}


def alert_dict(a: Alert) -> dict:
    return {"alert_id": a.alert_id, "inspection_id": a.inspection_id, "code": a.code, "title": a.title, "detail": a.detail,
            "system": a.system, "severity": a.severity, "confidence": round(a.confidence, 3), "source": a.source,
            "evidence": a.evidence, "rank": a.rank, "fail_item": a.fail_item, "status": a.status, "reason": a.reason,
            "decided_by": a.decided_by, "decided_at": a.decided_at.isoformat() if a.decided_at else None}
