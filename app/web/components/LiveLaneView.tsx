"use client";
/* The live lane view: the vehicle glides through the lane's stations while the readings of the station it is at tick,
   and each new finding pops up as it is raised. Full mode (the lane console) or a thin compact strip (dashboard and
   list cards). Positions follow the replay clock, interpolated on the client between the server's player snapshots. */
import Link from "next/link";
import { CSSProperties, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import { SeverityBadge, Source } from "./ui";
import { VehicleImage } from "./VehicleImage";
import { LANE_STEPS, STEP_LABEL, SYSTEM_NAME, fmtN, scoreColor } from "@/lib/format";
import { useLive } from "@/lib/live";
import { SEVERITY, Severity, alertSeverity, hasModelConfidence } from "@/lib/present";

/* ------------------------------------------------------------------ the lane's stations */

const STEPS = LANE_STEPS;

type StationId = "ident" | "above" | "tint" | "emis" | "slip" | "susp" | "brake" | "under" | "speedo" | "headlight" | "examiner" | "report";
type Station = { id: StationId; no?: number; label: string; icon: string; steps: string[]; x: number; end?: boolean; ai?: boolean };

/** The lane's ten stations in order (app/backend/vhi/lane.py), then the examiner and the report: twelve places along
 *  the lane (x: % of the lane from the entrance to the exit). */
const STATIONS: Station[] = [
  { id: "ident", no: 1, label: "Identification", icon: "cam", steps: ["check_in_anpr", "identity_ocr"], x: 6 },
  { id: "above", no: 2, label: "Above-carriage", icon: "vision", steps: ["above_carriage_ai"], x: 14, ai: true },
  { id: "tint", no: 3, label: "Tinted glass", icon: "window", steps: ["tinted_glass"], x: 22 },
  { id: "emis", no: 4, label: "Emission", icon: "smoke", steps: ["emission_idle_rev"], x: 30 },
  { id: "slip", no: 5, label: "Side slip", icon: "steering", steps: ["side_slip"], x: 38 },
  { id: "susp", no: 6, label: "Suspension", icon: "spring", steps: ["suspension"], x: 46 },
  { id: "brake", no: 7, label: "Brake", icon: "brake", steps: ["brake_roller"], x: 54 },
  { id: "under", no: 8, label: "Under\u00ADcarriage", icon: "layers", steps: ["undercarriage_ai"], x: 62, ai: true },
  { id: "speedo", no: 9, label: "Speedometer", icon: "gauge", steps: ["speedometer"], x: 70 },
  { id: "headlight", no: 10, label: "Headlight alignment", icon: "lamp", steps: ["headlight_alignment"], x: 78 },
  { id: "examiner", label: "Examiner", icon: "examiner", steps: ["examiner_review"], x: 87, end: true },
  { id: "report", label: "Report", icon: "report", steps: ["report"], x: 95, end: true },
];
/** A station's name for this vehicle: an EV's emission station runs its battery and high-voltage checks. */
const stationLabel = (s: Station, insp: any) => (s.id === "emis" && fuelOf(insp) === "ev" ? "EV battery & OBD" : s.label);
/** The same without the soft hyphens that let a long name break on the lane (titles, screen readers, the readout). */
const stationName = (s: Station, insp?: any) => stationLabel(s, insp).replace(/\u00AD/g, "");
const ENTRY = 0;
const EXIT = 100;
const STATION_OF: Record<string, Station> = {};
const STEP_X: Record<string, number> = {};
STATIONS.forEach((s) => s.steps.forEach((st, i) => {
  STATION_OF[st] = s;
  STEP_X[st] = s.x + (s.steps.length > 1 ? (i - (s.steps.length - 1) / 2) * 3.2 : 0);  // two steps: two spots
}));
STEP_X.done = EXIT;

/** Where a finding was raised: the module's camera for an image, else its code (vhi/pipeline/processor.py). */
export function stationOfAlert(a: any): StationId {
  const sys = a?.evidence?.image?.system;
  if (sys === "undercarriage" || sys === "tyre") return "under";
  if (sys === "above") return "above";
  const c: string = a?.code || "";
  if (c.startsWith("anpr:") || c === "identity:chassis" || c === "identity:odometer") return "ident";
  if (c.startsWith("route:") || c === "flood") return "examiner";       // the fusion at examiner review
  if (c.startsWith("brake:") || c.startsWith("acoustic:wheel_bearing")) return "brake";  // the roller-bed microphone
  if (c.startsWith("thermal:") || c === "corrosion:undercarriage" || c.startsWith("tyre:")) return "under";  // the pit
  if (c.startsWith("body:") || c.startsWith("corrosion:")) return "above";
  if (c.startsWith("suspension")) return "susp";
  if (c.startsWith("side_slip")) return "slip";
  if (c === "tint") return "tint";
  if (c.startsWith("speedo")) return "speedo";
  if (c === "headlamp") return "headlight";
  return "emis";  // particle number, exhaust gas, fault codes, EV battery, engine sound
}

const moduleOf = (a: any): string | null => {
  const s = a?.evidence?.image?.system;
  if (s) return SYSTEM_NAME[s] || s;
  if (a?.evidence?.acoustic || a?.evidence?.fingerprint) return "Acoustic AI";
  if (a?.code === "flood") return "Flood model";
  return null;
};

/* ------------------------------------------------------------------ small helpers */

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
const TRANSIT_S = 6;  // seconds of replay time to drive from one spot to the next

/** The vehicle's place on the lane (0 entrance … 100 exit) at replay time t. */
function posAt(t: number, tl: any[]): number {
  if (!tl.length || t < tl[0].start_s) return ENTRY;
  for (let i = 0; i < tl.length; i++) {
    const s = tl[i];
    if (t < s.end_s) {
      const from = i === 0 ? ENTRY : STEP_X[tl[i - 1].step] ?? ENTRY;
      const to = STEP_X[s.step] ?? from;
      const tr = Math.max(0.5, Math.min(TRANSIT_S, (s.end_s - s.start_s) * 0.4));
      return from + (to - from) * ease(clamp((t - s.start_s) / tr, 0, 1));
    }
  }
  const last = tl[tl.length - 1];
  const from = STEP_X[last.step] ?? 92;
  return from + (EXIT - from) * ease(clamp((t - last.end_s) / TRANSIT_S, 0, 1));
}

function stepAt(t: number, tl: any[]): string {
  let s = "";
  for (const x of tl) if (t >= x.start_s) s = x.step;
  return s;
}

function prefersReduced() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!m) return;
    const f = () => setR(m.matches);
    f();
    m.addEventListener?.("change", f);
    return () => m.removeEventListener?.("change", f);
  }, []);
  return r;
}

/** A number that counts to its new value instead of jumping (from 0 the first time). */
export function CountUp({ value, fmt = (v: number) => fmtN(v) }: { value: number | null | undefined; fmt?: (v: number) => string }) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const [first] = useState(() => (value == null || Number.isNaN(value) ? "–" : fmt(0)));
  const fmtRef = useRef(fmt);
  fmtRef.current = fmt;
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    if (value == null || Number.isNaN(value)) {
      node.textContent = "–";
      shown.current = null;
      return;
    }
    const from = shown.current ?? 0;
    const to = Number(value);
    if (prefersReduced() || from === to) {
      node.textContent = fmtRef.current(to);
      shown.current = to;
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 650;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const v = from + (to - from) * (1 - Math.pow(1 - k, 3));
      shown.current = v;
      node.textContent = fmtRef.current(k === 1 ? to : v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span ref={el} className="tabular-nums">{first}</span>;
}

function Spark({ pts, color, limit }: { pts: number[]; color: string; limit?: number }) {
  if (pts.length < 3) return null;
  const lo = Math.min(...pts, limit ?? Infinity), hi = Math.max(...pts, limit ?? -Infinity);
  const span = hi - lo || 1;
  const y = (v: number) => 26 - ((v - lo) / span) * 24;
  const d = pts.map((v, i) => `${((i / (pts.length - 1)) * 100).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="mt-0.5 h-[16px] w-full" aria-hidden>
      {limit != null && <line x1="0" x2="100" y1={y(limit)} y2={y(limit)} stroke="#D97706" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      <polygon points={`0,28 ${d} 100,28`} fill={color} opacity="0.1" />
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

const VERDICT_COL: Record<string, string> = { pass: "#059669", advisory: "#D97706", fail: "#DC2626" };
const VERDICT_WORD: Record<string, string> = { pass: "Pass", advisory: "Advisory", fail: "Fail" };

/** One reading of the readout: the label, the (counting) value and, under it, the verdict against its limit. */
function Tile({ label, children, verdict, limit, note, wide, spark }: {
  label: ReactNode; children: ReactNode; verdict?: string | null; limit?: ReactNode; note?: ReactNode; wide?: boolean; spark?: ReactNode;
}) {
  const col = verdict ? VERDICT_COL[verdict] : undefined;
  return (
    <div className={`min-w-0 rounded-xl bg-white/80 px-3 py-1.5 ring-1 ring-ink-600/80 ${wide ? "col-span-2" : ""}`} style={col ? { boxShadow: `inset 3px 0 0 ${col}` } : undefined}>
      <div className="truncate text-[11px] font-medium text-fg-3">{label}</div>
      <div className="flex min-w-0 items-baseline gap-1 truncate text-[18px] font-bold leading-tight tracking-tight">{children}</div>
      {spark}
      {(verdict || limit != null || note) && (
        <div className="truncate text-[11px] font-medium" style={{ color: col || "#64748B" }}>
          {verdict ? VERDICT_WORD[verdict] || verdict : ""}{verdict && limit != null ? " · " : ""}{limit != null ? <>limit {limit}</> : null}{!verdict && limit == null ? note : null}
        </div>
      )}
    </div>
  );
}
const Unit = ({ children }: { children: ReactNode }) => <span className="text-[12px] font-semibold text-fg-3">{children}</span>;
const Waiting = ({ text = "measuring…" }: { text?: string }) => <span className="text-[15px] font-semibold text-fg-4">{text}</span>;

/* ------------------------------------------------------------------ the model shared by both modes */

export type LaneState = {
  insp: any | null; step?: string; player?: any | null; alerts?: any[]; results?: Record<string, any>; instruments?: Record<string, any>;
  brake?: Record<string, { t: number; f: number }[]>; pn?: { t: number; v: number }[]; obd?: { t: number; rpm: number | null; coolant: number | null }[];
  fusion?: any | null; connected?: boolean;
};
export type IdleVehicle = { plate: string; vtype?: string | null; photo?: any; title?: ReactNode; note?: ReactNode };
type Phase = "idle" | "running" | "done";
type StState = "done" | "active" | "pending" | "waiting";

function useLaneModel(L: LaneState, playerProp: any | undefined) {
  const insp = L.insp;
  const raw = playerProp !== undefined ? playerProp || L.player : L.player;
  // the player only describes this inspection when it is playing it
  const pl = raw && insp && raw.inspection_id === insp.inspection_id ? raw : null;
  const tl: any[] = insp?.timeline?.length ? insp.timeline : pl?.timeline?.length ? pl.timeline : STEPS.map((s, i) => ({ step: s, start_s: i, end_s: i + 1 }));
  const stepNow: string = pl?.step || L.step || insp?.step || "";
  const active = pl && (pl.status === "playing" || pl.status === "paused") && stepNow !== "done";
  const phase: Phase = !insp ? "idle" : insp.status === "in_lane" || active ? "running" : "done";
  const stepIdx = tl.findIndex((x) => x.step === stepNow);
  const curStation = phase === "running" ? STATION_OF[stepNow] || (stepIdx < 0 ? STATIONS[0] : null) : null;
  const curIdx = curStation ? STATIONS.indexOf(curStation) : -1;
  const alerts = L.alerts || [];
  const byStation = useMemo(() => {
    const m: Partial<Record<StationId, any[]>> = {};
    for (const a of alerts) if (a.status !== "dismissed") (m[stationOfAlert(a)] ||= []).push(a);
    return m;
  }, [alerts]);
  const stState = (s: Station, i: number): StState => {
    if (phase === "idle") return "pending";
    if (phase === "running") return i < curIdx ? "done" : i === curIdx ? "active" : "pending";
    if (s.id === "report") return insp?.report ? "done" : "pending";
    if (s.id === "examiner") return insp?.report || insp?.status === "decided" ? "done" : "waiting";
    return "done";
  };
  return { insp, pl, tl, stepNow, stepIdx, phase, curStation, curIdx, alerts, byStation, stState };
}

/** The replay clock: the last player snapshot, run forward at its speed while it plays (smoothly re-anchored). */
function useSimClock(pl: any | null) {
  const a = useRef({ t: 0, at: 0, speed: 1, playing: false, off: 0, has: false });
  const shown = useRef(0);
  const key = pl ? `${pl.inspection_id}|${pl.t}|${pl.status}|${pl.speed}` : "";
  useEffect(() => {
    const now = performance.now();
    if (!pl) {
      a.current = { ...a.current, has: false, playing: false };
      return;
    }
    const playing = pl.status === "playing";
    const prev = a.current;
    // a small disagreement with the server melts away instead of jumping; a restart or a seek jumps
    const off = playing && prev.playing && prev.has && Math.abs(shown.current - pl.t) < 3 * Math.max(1, pl.speed || 1) ? shown.current - pl.t : 0;
    a.current = { t: Number(pl.t) || 0, at: now, speed: Number(pl.speed) || 1, playing, off, has: true };
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  return (now: number): number | null => {
    const c = a.current;
    if (!c.has) return null;
    const el = Math.max(0, (now - c.at) / 1000);
    const t = c.t + (c.playing ? Math.min(el, 1.5) * c.speed : 0) + c.off * Math.exp(-el / 0.4);
    shown.current = t;
    return t;
  };
}

/* ------------------------------------------------------------------ the view */

export function LiveLaneView({ L, compact = false, sessionControls, player, idle }: {
  L: LaneState; compact?: boolean; sessionControls?: ReactNode; player?: any | null; idle?: IdleVehicle;
}) {
  const M = useLaneModel(L, player);
  const { insp, pl, tl, stepNow, stepIdx, phase, curIdx, byStation, stState } = M;
  const reduced = useReducedMotion();
  const simT = useSimClock(pl);

  // where the vehicle should be (the animation loop reads this every frame)
  const target = (now: number) => {
    if (phase === "idle") return ENTRY;
    if (phase === "done") return EXIT;
    const t = pl ? simT(now) : null;
    if (t != null && tl.length && pl?.timeline?.length) return reduced ? STEP_X[stepAt(t, tl)] ?? ENTRY : posAt(t, tl);
    return STEP_X[stepNow] ?? ENTRY;
  };
  const x0 = useRef<number | null>(null);
  if (x0.current === null) x0.current = typeof performance !== "undefined" ? target(performance.now()) : phase === "done" ? EXIT : ENTRY;
  const geo = useRef({ target, phase, pl, tl });
  geo.current = { target, phase, pl, tl };

  const vehicleEl = useRef<HTMLDivElement>(null);
  const fillEl = useRef<HTMLDivElement>(null);
  const trailEl = useRef<HTMLDivElement>(null);
  const timeEl = useRef<HTMLSpanElement>(null);
  const progEl = useRef<HTMLDivElement>(null);
  const scrollEl = useRef<HTMLDivElement>(null);
  const userUntil = useRef(0);
  const xNow = useRef(x0.current);
  const simTRef = useRef(simT);
  simTRef.current = simT;
  // a different inspection (the page loaded one, or a new run started): the vehicle is put in place, not driven there
  const snap = useRef(false);
  const iidNow = insp?.inspection_id || null;
  const iidSeen = useRef<string | null>(iidNow);
  if (iidSeen.current !== iidNow) {
    iidSeen.current = iidNow;
    snap.current = true;
  }

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastSec = -1;
    let drawn = false;
    const frame = (now: number) => {
      const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      last = now;
      const g = geo.current;
      const tgt = g.target(now);
      let x = xNow.current;
      if (prefersReduced() || snap.current) {
        x = tgt;
        snap.current = false;
      }
      else {
        const d = tgt - x;
        const vmax = 55 * dt;  // % of the lane per second, at most: a long jump is a drive, not a teleport
        x += clamp(d * (1 - Math.exp(-dt / 0.16)), -vmax, vmax);
        if (Math.abs(tgt - x) < 0.02) x = tgt;
      }
      const vel = Math.abs(x - xNow.current) / dt;
      const moved = x !== xNow.current || !drawn;
      drawn = true;
      xNow.current = x;
      if (moved && vehicleEl.current) vehicleEl.current.style.left = `${x}%`;
      if (moved && fillEl.current) fillEl.current.style.width = compact ? `${x}%` : `calc(${x}% + 52px)`;
      if (trailEl.current) {
        const op = String(Math.round(clamp((vel - 1.5) / 6, 0, 0.9) * 100) / 100);
        if (trailEl.current.style.opacity !== op) trailEl.current.style.opacity = op;
      }
      // the clock and the overall progress
      const p = g.pl;
      const t = p ? simTRef.current(now) : null;
      const dur = Number(p?.duration) || (g.tl.length ? g.tl[g.tl.length - 1].end_s : 0);
      if (timeEl.current && t != null && dur) {
        const sec = Math.floor(Math.min(t, dur));
        if (sec !== lastSec || !timeEl.current.textContent) {
          lastSec = sec;
          timeEl.current.textContent = compact ? clock(sec) : `${clock(sec)} / ${clock(dur)}`;
        }
      }
      if (progEl.current) {
        const pct = g.phase === "done" ? 100 : g.phase === "idle" ? 0 : t != null && dur ? (100 * Math.min(t, dur)) / dur : x;
        const w = `${Math.round(clamp(pct, 0, 100) * 100) / 100}%`;
        if (progEl.current.style.width !== w) progEl.current.style.width = w;
      }
      // phones: the lane scrolls sideways and keeps the vehicle in view (unless the user is scrolling it)
      const sc = scrollEl.current;
      if (sc && vehicleEl.current && sc.scrollWidth > sc.clientWidth + 2 && now > userUntil.current) {
        const vr = vehicleEl.current.getBoundingClientRect(), sr = sc.getBoundingClientRect();
        const vx = vr.left + vr.width / 2 - sr.left + sc.scrollLeft;  // the vehicle's centre in the lane's scroll space
        const want = clamp(vx - sc.clientWidth * 0.45, 0, sc.scrollWidth - sc.clientWidth);
        const diff = want - sc.scrollLeft;
        if (Math.abs(diff) > 1) sc.scrollLeft = prefersReduced() || diff * diff > 4e5 ? want : sc.scrollLeft + diff * (1 - Math.exp(-dt / 0.3));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [compact]);

  // pop-ups: a finding that arrives while this view watches the inspection run (not those already there)
  const [pops, setPops] = useState<{ a: any; station: StationId; key: string }[]>([]);
  const [hl, setHl] = useState<StationId | null>(null);
  const seen = useRef<{ id: string | null; ids: Set<string>; armed: boolean }>({ id: null, ids: new Set(), armed: false });
  const alertKey = M.alerts.map((a) => a.alert_id).join(",");
  useEffect(() => {
    if (compact) return;
    const s = seen.current;
    const iid = insp?.inspection_id || null;
    if (iid !== s.id) {
      s.id = iid;
      s.ids = new Set(M.alerts.map((a) => a.alert_id));
      s.armed = phase === "running";
      setPops([]);
      return;
    }
    if (phase === "running") s.armed = true;
    const fresh = M.alerts.filter((a) => !s.ids.has(a.alert_id));
    fresh.forEach((a) => s.ids.add(a.alert_id));
    if (!s.armed || !fresh.length) return;
    setPops((p) => [...fresh.map((a) => ({ a, station: stationOfAlert(a), key: `${a.alert_id}-${Date.now()}` })), ...p].slice(0, 3));
  }, [alertKey, insp?.inspection_id, phase, compact]);  // eslint-disable-line react-hooks/exhaustive-deps
  const pinned = new Set(pops.map((p) => p.station));

  // the station whose readings show: the one the vehicle is at, or one the user picked
  const [sel, setSel] = useState<StationId | null>(null);
  useEffect(() => setSel(null), [insp?.inspection_id]);
  const shown: Station | null = (sel && STATIONS.find((s) => s.id === sel)) || (phase === "running" ? M.curStation : null);

  const nTotal = tl.length;
  const stepNo = stepIdx >= 0 ? stepIdx + 1 : stepNow === "done" ? nTotal : 0;
  const stepName = STEP_LABEL[stepNow] || (stepNow ? stepNow : "Waiting for the vehicle");
  const paused = pl?.status === "paused";
  const nFind = M.alerts.filter((a) => a.status !== "dismissed").length;
  const nCrit = M.alerts.filter((a) => a.severity === "high" && a.status !== "dismissed").length;
  const nOpen = M.alerts.filter((a) => a.status === "open").length;
  const health = insp?.health_score ?? L.fusion?.health?.score ?? null;
  const vtype = insp?.owner?.vtype || idle?.vtype;
  const plate = insp?.plate || idle?.plate || "";
  const photo = insp ? insp.photo : idle?.photo;
  const initialX = x0.current;

  /* ---------------- compact: a thin strip with the station dots and the moving vehicle */
  if (compact) {
    const caption = phase === "idle" ? "Waiting at the entrance"
      : phase === "running" ? `${paused ? "Paused · " : ""}Step ${stepNo || 1}/${nTotal} · ${stepName}`
      : insp?.report ? `Report issued${insp.report.verdict ? ` · ${insp.report.verdict}` : ""}` : insp?.status === "decided" ? "Decided · report next" : "Complete · with the examiner";
    return (
      <div className="relative h-[56px] w-full min-w-0 select-none" role="group" aria-label={`Lane progress: ${caption}`}>
        <style>{CSS}</style>
        <div className="absolute left-[11px] right-[11px] top-[11px] h-[6px] rounded-full bg-[#E2E8F0] ring-1 ring-inset ring-white/60">
          <div ref={fillEl} className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#93C5FD] to-[#2563EB]" style={{ width: `${initialX}%` }} />
          {STATIONS.map((s, i) => {
            const st = stState(s, i);
            const n = byStation[s.id]?.length || 0;
            const col = st === "done" ? (n ? sevOf(byStation[s.id]!).color : "#10B981") : st === "active" ? "#2563EB" : st === "waiting" ? "#D97706" : "#FFFFFF";
            return (
              <span key={s.id} title={`${s.no ? `${s.no}. ` : ""}${stationName(s, insp)}${st === "done" ? (n ? ` · ${n} finding${n === 1 ? "" : "s"}` : " · done") : st === "active" ? " · now" : ""}`}
                className={`absolute top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 ${s.end ? "rounded-[3px]" : "rounded-full"} ${st === "pending" ? "ring-[1.5px] ring-[#CBD5E1]" : "ring-2 ring-white"}`}
                style={{ left: `${s.x}%`, background: col }}>
                {st === "active" && !reduced && <span className="llv-ring absolute inset-[-3px] rounded-full ring-2 ring-[#2563EB]" aria-hidden />}
              </span>
            );
          })}
          <div ref={vehicleEl} className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: `${initialX}%` }} aria-hidden>
            <span ref={trailEl} className="absolute right-1/2 top-1/2 h-[8px] w-[26px] -translate-y-1/2 rounded-l-full bg-gradient-to-l from-[#2563EB]/50 to-transparent opacity-0" />
            <span className="relative flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white shadow-[0_3px_10px_-2px_rgba(15,23,42,0.45)] ring-2 ring-[#2563EB]">
              <Icon name="car" size={13} color="#1D4ED8" width={2} />
            </span>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 text-[11.5px] leading-tight">
          <span className="flex min-w-0 items-center gap-1.5 truncate font-semibold text-fg-2">
            {phase === "running" && !paused && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok pulse-dot" aria-hidden />}
            <span className="truncate" aria-live="polite">{caption}</span>
          </span>
          {phase === "running" && pl && <span ref={timeEl} className="shrink-0 font-mono text-[11px] text-fg-3" />}
        </div>
      </div>
    );
  }

  /* ---------------- full */
  const station = (s: Station, i: number) => {
    const st = stState(s, i);
    const list = byStation[s.id] || [];
    const sev = list.length ? sevOf(list) : null;
    const isSel = shown?.id === s.id;
    return { st, list, sev, isSel };
  };

  return (
    <section className="card relative mb-4 overflow-hidden p-3 sm:p-4" aria-label="Live lane view">
      <style>{CSS}</style>
      {/* status line and the replay controls */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
          <StatusTag phase={phase} paused={paused} />
          <span className="min-w-0 font-semibold text-fg-2" aria-live="polite">
            {phase === "idle" ? <>Ready for the replay<span className="font-normal text-fg-3"> · {plate} waits at the entrance</span></>
              : phase === "running" ? <>step {stepNo || 1} of {nTotal}<span className="font-normal text-fg-3"> · {stepName}</span></>
              : <>Inspection complete<span className="font-normal text-fg-3"> · {nFind} finding{nFind === 1 ? "" : "s"}{nCrit ? ` (${nCrit} critical)` : ""}{health != null ? <> · health score <b style={{ color: scoreColor(health) }}>{Math.round(health)}</b></> : null}</span></>}
          </span>
          {phase === "running" && (
            <span className="flex flex-wrap items-center gap-x-2 text-fg-3">
              {/* on a phone this group starts its own line: no leading dot there */}
              {pl && <><span className="hidden sm:inline" aria-hidden>·</span><span ref={timeEl} className="min-w-[78px] font-mono text-[12.5px]" /><span aria-hidden>·</span><span>speed {pl.speed}×</span></>}
              {nFind > 0 && <><span aria-hidden>·</span><span className="font-semibold" style={{ color: nCrit ? "#DC2626" : "#D97706" }}>{nFind} finding{nFind === 1 ? "" : "s"} so far</span></>}
            </span>
          )}
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          {phase === "done" && insp && (
            insp.report
              ? <Link className="btn btn-primary btn-sm" href={`/report?id=${insp.report.report_id}`}>View the report<Icon name="arrow" size={14} /></Link>
              : <Link className="btn btn-primary btn-sm" href={`/inspection/${insp.inspection_id}/findings`}>Review findings<Icon name="arrow" size={14} /></Link>
          )}
          {sessionControls}
        </div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#E2E8F0]" aria-hidden>
        <div ref={progEl} className="h-full rounded-full bg-gradient-to-r from-[#60A5FA] to-[#2563EB]" style={{ width: `${phase === "done" ? 100 : phase === "idle" ? 0 : initialX}%` }} />
      </div>

      {/* the lane: stations along an inspection-hall floor; scrolls sideways on a phone */}
      <div ref={scrollEl} className="llv-scroll -mx-3 mt-2 overflow-x-auto px-3 sm:-mx-4 sm:px-4"
        onPointerDown={() => (userUntil.current = performance.now() + 4000)} onWheel={() => (userUntil.current = performance.now() + 4000)}
        onTouchStart={() => (userUntil.current = performance.now() + 4000)}>
        <div className="relative min-w-[980px]">
          {/* station gantry heads */}
          <div className="relative mx-[52px] h-[43px]">
            {STATIONS.map((s, i) => {
              const { st, list, sev, isSel } = station(s, i);
              const fresh = pinned.has(s.id);
              const bg = st === "active" ? "linear-gradient(180deg,#3B82F6,#1D4ED8)" : st === "done" ? "#FFFFFF" : st === "waiting" ? "#FFF7E6" : "rgba(255,255,255,0.6)";
              return (
                <button key={s.id} type="button" onClick={() => setSel((c) => (c === s.id || (st === "active" && !c) ? null : s.id))} aria-pressed={isSel}
                  aria-label={`${s.no ? `Station ${s.no}, ` : ""}${stationName(s, insp)}: ${st === "active" ? "the vehicle is here" : st === "done" ? (list.length ? `done, ${list.length} finding${list.length === 1 ? "" : "s"}` : "done, no findings") : st === "waiting" ? "waiting" : "not reached yet"}. Show its readings`}
                  className={`group absolute top-[2px] flex h-[38px] w-[38px] -translate-x-1/2 items-center justify-center rounded-full shadow-[0_4px_14px_-6px_rgba(15,23,42,0.45)] ring-1 transition ${isSel ? "ring-2 ring-[#2563EB]" : st === "active" ? "ring-white" : "ring-ink-500/70 hover:ring-[#93C5FD]"} ${hl === s.id ? "scale-110" : ""}`}
                  style={{ left: `${s.x}%`, background: bg }}>
                  {st === "active" && !reduced && <span className="llv-ring absolute inset-[-4px] rounded-full ring-2 ring-[#3B82F6]" aria-hidden />}
                  <Icon name={s.icon} size={18} width={1.9} color={st === "active" ? "#FFFFFF" : st === "done" ? "#1D4ED8" : st === "waiting" ? "#B45309" : "#94A3B8"} />
                  {s.no && (
                    <span className={`absolute -left-1.5 -top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-0.5 text-[9.5px] font-bold tabular-nums ring-2 ring-white ${st === "active" ? "bg-[#1D4ED8] text-white" : "bg-[#E2E8F0] text-fg-2"}`} aria-hidden>{s.no}</span>
                  )}
                  {st === "done" && !list.length && (
                    <span className="absolute -bottom-0.5 -right-1 flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[#10B981] text-white ring-2 ring-white" aria-hidden><Icon name="check" size={9} width={3.4} /></span>
                  )}
                  {list.length > 0 && (
                    <span className="absolute -right-1.5 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ring-2 ring-white" style={{ background: sev!.color }} aria-hidden>
                      {fresh && !reduced && <span className="llv-ping absolute inset-0 rounded-full" style={{ background: sev!.color }} />}
                      <span className="relative">{list.length}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* the floor */}
          <div className="llv-floor relative h-[82px] overflow-hidden rounded-2xl">
            <span className="llv-lines absolute inset-x-0 top-[9px] h-[3px]" aria-hidden />
            <span className="llv-lines absolute inset-x-0 bottom-[9px] h-[3px]" aria-hidden />
            <div className="absolute inset-y-0 left-[52px] right-[52px]">
              <div ref={fillEl} className="absolute bottom-[14px] left-[-52px] top-[14px] bg-gradient-to-r from-[#2563EB]/0 via-[#2563EB]/[0.07] to-[#2563EB]/[0.16]" style={{ width: `calc(${initialX}% + 52px)` }} aria-hidden />
              {STATIONS.slice(0, -1).map((s, i) => (
                <span key={`a${s.id}`} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[18px] font-black leading-none text-white/70" style={{ left: `${(s.x + STATIONS[i + 1].x) / 2}%` }} aria-hidden>›</span>
              ))}
              {STATIONS.map((s, i) => {
                const { st } = station(s, i);
                return <Gantry key={s.id} s={s} st={st} reduced={reduced} />;
              })}
              {/* the vehicle */}
              <div ref={vehicleEl} className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: `${initialX}%` }}>
                <div ref={trailEl} className="absolute right-[62%] top-1/2 h-[40px] w-[96px] -translate-y-1/2 rounded-l-full bg-gradient-to-l from-[#3B82F6]/35 via-[#3B82F6]/10 to-transparent opacity-0" aria-hidden />
                <div className={`relative h-[54px] w-[92px] overflow-hidden rounded-xl bg-white ring-2 ${phase === "running" ? "ring-[#3B82F6]" : "ring-white"} shadow-[0_12px_26px_-10px_rgba(15,23,42,0.6)]`}>
                  {plate && <VehicleImage plate={plate} vtype={vtype || undefined} photo={photo || null} size="480" className="h-full w-full" alt={`${plate} on the lane`} />}
                  {shown?.ai && phase === "running" && shown.id === M.curStation?.id && !reduced && <span className="scanline pointer-events-none absolute inset-x-0 h-5 bg-gradient-to-b from-transparent via-[#60A5FA]/70 to-transparent" aria-hidden />}
                </div>
                <span className="absolute -bottom-[9px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#0F172A] px-1.5 py-px font-mono text-[10px] font-bold tracking-wide text-white shadow">{plate}</span>
              </div>
            </div>
          </div>
          {/* station names and results */}
          <div className="relative mx-[52px] h-[54px]">
            {STATIONS.map((s, i) => {
              const { st, list, sev } = station(s, i);
              return (
                <div key={s.id} className="absolute top-[4px] flex w-[70px] -translate-x-1/2 flex-col items-center text-center" style={{ left: `${s.x}%` }}>
                  <span className={`text-[11px] font-semibold leading-[1.15] ${st === "active" ? "text-[#1D4ED8]" : st === "pending" ? "text-fg-3" : "text-fg"}`}>{stationLabel(s, insp)}</span>
                  <StationChip s={s} st={st} n={list.length} sev={sev} insp={insp} open={nOpen} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* what the station is measuring now (or the one picked) */}
      <div className="rounded-2xl bg-white/55 px-3 py-2.5 ring-1 ring-white/80">
        {phase === "idle" ? (
          <div className="flex flex-col gap-1 text-[13px]">
            <b className="text-[14px]">{idle?.title || `${plate || "The vehicle"} waits at the lane entrance`}</b>
            {idle?.note && <span className="text-fg-3">{idle.note}</span>}
          </div>
        ) : shown ? (
          <Readout s={shown} L={L} M={M} live={phase === "running" && shown.id === M.curStation?.id} follow={sel ? () => setSel(null) : undefined} followLabel={phase === "running" ? "Follow the vehicle" : "Summary"} reduced={reduced} />
        ) : (
          <Summary insp={insp} nFind={nFind} nCrit={nCrit} health={health} />
        )}
      </div>

      {/* new findings, as they are raised (the live region is always there, so each one is announced); on a phone only
          the newest, at the foot of the card, so the lane and the controls stay visible */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-30 flex w-[min(340px,calc(100%-1.5rem))] flex-col gap-2 max-sm:[&>*:nth-child(n+2)]:hidden sm:bottom-auto sm:top-12" role="status" aria-live="polite">
        {pops.map((p) => (
          <FindingPop key={p.key} a={p.a} station={STATIONS.find((s) => s.id === p.station)!} insp={insp} reduced={reduced}
            onClose={() => setPops((x) => x.filter((y) => y.key !== p.key))} onHover={(on) => setHl(on ? p.station : null)} />
        ))}
      </div>
    </section>
  );
}

const fuelOf = (insp: any) => insp?.vehicle?.fuel || insp?.owner?.fuel || "";
const sevOf = (list: any[]) => SEVERITY[list.map(alertSeverity).sort((a, b) => SEVERITY[a].rank - SEVERITY[b].rank)[0] as Severity];

function StatusTag({ phase, paused }: { phase: Phase; paused: boolean }) {
  const [txt, col, bg] = phase === "idle" ? ["READY", "#B45309", "#FFF7E6"] : phase === "done" ? ["COMPLETE", "#047857", "#ECFDF3"]
    : paused ? ["PAUSED", "#B45309", "#FFF7E6"] : ["LIVE", "#047857", "#ECFDF3"];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-[0.12em]" style={{ color: col, background: bg, boxShadow: `inset 0 0 0 1px ${col}33` }}>
      <span className={`h-1.5 w-1.5 rounded-full ${phase === "running" && !paused ? "pulse-dot" : ""}`} style={{ background: col }} aria-hidden />{txt}
    </span>
  );
}

/** A station across the lane: the gantry, and the floor equipment under it (rollers, plates, the pit). */
function Gantry({ s, st, reduced }: { s: Station; st: StState; reduced: boolean }) {
  const on = st === "active";
  const pad: CSSProperties = { left: `${s.x}%` };
  return (
    <>
      {(s.id === "brake" || s.id === "speedo") && (
        <>
          <span className="llv-roller absolute top-[16px] h-[11px] w-[50px] -translate-x-1/2 rounded-[4px]" style={pad} aria-hidden />
          <span className="llv-roller absolute bottom-[16px] h-[11px] w-[50px] -translate-x-1/2 rounded-[4px]" style={pad} aria-hidden />
        </>
      )}
      {s.id === "susp" && (
        <>
          <span className="llv-plate absolute top-[15px] h-[14px] w-[56px] -translate-x-1/2 rounded-[3px]" style={pad} aria-hidden />
          <span className="llv-plate absolute bottom-[15px] h-[14px] w-[56px] -translate-x-1/2 rounded-[3px]" style={pad} aria-hidden />
        </>
      )}
      {s.id === "slip" && <span className="llv-plate absolute top-[15px] h-[14px] w-[44px] -translate-x-1/2 rounded-[3px]" style={pad} aria-hidden />}
      {s.id === "under" && <span className="llv-pit absolute bottom-[22px] top-[22px] w-[60px] -translate-x-1/2 rounded-md" style={pad} aria-hidden />}
      {on && <span className={`absolute bottom-[12px] top-[12px] w-[78px] -translate-x-1/2 rounded-lg bg-[#3B82F6]/15 ${reduced ? "" : "llv-glow"}`} style={pad} aria-hidden />}
      <span className={`absolute bottom-[6px] top-[6px] w-[3px] -translate-x-1/2 rounded-full ${on ? "bg-[#3B82F6] shadow-[0_0_12px_2px_rgba(59,130,246,0.55)]" : s.end ? "bg-white/50" : "bg-white/85 shadow-sm"}`} style={pad} aria-hidden />
      {!s.end && (
        <>
          <span className={`absolute top-[3px] h-[7px] w-[11px] -translate-x-1/2 rounded-[2px] ${on ? "bg-[#1D4ED8]" : "bg-[#64748B]/70"}`} style={pad} aria-hidden />
          <span className={`absolute bottom-[3px] h-[7px] w-[11px] -translate-x-1/2 rounded-[2px] ${on ? "bg-[#1D4ED8]" : "bg-[#64748B]/70"}`} style={pad} aria-hidden />
        </>
      )}
    </>
  );
}

function StationChip({ s, st, n, sev, insp, open }: { s: Station; st: StState; n: number; sev: { label: string; color: string } | null; insp: any; open: number }) {
  const chip = (text: ReactNode, col: string, bg: string) => (
    <span className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full px-1.5 py-px text-[10.5px] font-semibold" style={{ color: col, background: bg }}>{text}</span>
  );
  if (st === "active") return chip(<><span className="h-1.5 w-1.5 rounded-full bg-[#2563EB] pulse-dot" aria-hidden />{s.ai ? "Scanning" : s.end ? "Now" : "Measuring"}</>, "#1D4ED8", "#EFF4FF");
  if (n) return chip(`${n} finding${n === 1 ? "" : "s"}`, sev?.color || "#DC2626", (sev?.color || "#DC2626") + "14");
  if (st === "waiting") return chip(open ? `${open} to decide` : "Ready to sign", "#B45309", "#FFF7E6");
  if (st === "done") {
    if (s.id === "report") return chip(insp?.report?.verdict || "Issued", "#047857", "#ECFDF3");
    if (s.id === "examiner") return chip("Decided", "#047857", "#ECFDF3");
    return chip(s.ai ? "Clear" : "Pass", "#047857", "#ECFDF3");
  }
  return null;
}

/* ------------------------------------------------------------------ the readout */

function Readout({ s, L, M, live, follow, followLabel, reduced }: {
  s: Station; L: LaneState; M: ReturnType<typeof useLaneModel>; live: boolean; follow?: () => void; followLabel: string; reduced: boolean;
}) {
  const list = M.byStation[s.id] || [];
  const i = STATIONS.indexOf(s);
  const st = M.stState(s, i);
  const status = live ? (s.ai ? "Scanning now" : s.end ? "Now" : "Measuring now") : st === "done" ? (list.length ? `${list.length} finding${list.length === 1 ? "" : "s"}` : "Done") : st === "waiting" ? "Waiting" : "Not reached yet";
  const label = `${s.no ? `${s.no}. ` : ""}${stationName(s, M.insp)}`;
  return (
    <div className="flex flex-col gap-2.5 lg:flex-row lg:items-stretch lg:gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 lg:w-[196px] lg:shrink-0 lg:flex-col lg:flex-nowrap lg:items-start lg:justify-start lg:gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: live ? "linear-gradient(180deg,#3B82F6,#1D4ED8)" : "#EFF4FF" }}>
            <Icon name={s.icon} size={17} width={1.9} color={live ? "#fff" : "#1D4ED8"} />
          </span>
          <span className="min-w-0 leading-tight">
            <b className="block truncate text-[14.5px]">{label}</b>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold" style={{ color: live ? "#1D4ED8" : list.length ? sevOf(list).color : st === "done" ? "#047857" : "#64748B" }}>
              {live && <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB] pulse-dot" aria-hidden />}{status}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:mt-auto">
          <Source kind={s.ai ? "live_model" : s.end ? "live_logic" : "simulated"} text={s.ai ? "Lane cameras" : s.end ? "Rules + models" : "Lane instruments"} />
          {follow && <button type="button" className="btn btn-sm" onClick={follow}><Icon name={followLabel === "Summary" ? "list" : "live"} size={14} />{followLabel}</button>}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <ReadoutBody s={s} L={L} M={M} live={live} list={list} reduced={reduced} />
      </div>
    </div>
  );
}

const GRID = "grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5";
const lastOf = <T,>(a: T[] | undefined, f: (x: T) => number | null | undefined): number | null => {
  for (let i = (a?.length || 0) - 1; i >= 0; i--) {
    const v = f(a![i]);
    if (v != null && !Number.isNaN(v)) return v;
  }
  return null;
};

function Instrument({ k, ins, label, unit, d = 1 }: { k: string; ins: Record<string, any>; label: string; unit: string; d?: number }) {
  const x = ins[k];
  if (!x) return <Tile label={label} note="measured at the end of the test"><Waiting /></Tile>;
  const v = Array.isArray(x.value) ? null : Number(x.value);
  return (
    <Tile label={<>{label}{x.overridden ? <span className="text-warn"> · edited</span> : null}</>} verdict={x.verdict} limit={typeof x.limit === "number" ? `${x.limit}${unit ? ` ${unit}` : ""}` : String(x.limit)}>
      {v == null ? String(x.value) : <CountUp value={v} fmt={(n) => fmtN(n, d)} />}{unit && <Unit>{unit}</Unit>}
    </Tile>
  );
}

function ReadoutBody({ s, L, M, live, list, reduced }: { s: Station; L: LaneState; M: ReturnType<typeof useLaneModel>; live: boolean; list: any[]; reduced: boolean }) {
  const r = L.results || {};
  const ins = L.instruments || {};
  const fuel = fuelOf(M.insp);
  const findings = list.length > 0 && (
    <div className="flex flex-wrap gap-1.5">
      {list.slice(0, 3).map((a) => (
        <Link key={a.alert_id} href={`/inspection/${M.insp?.inspection_id}/findings?finding=${a.alert_id}`}
          className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-white/90 px-2.5 py-1 text-[11.5px] font-semibold transition hover:bg-white"
          style={{ color: SEVERITY[alertSeverity(a)].color, boxShadow: `inset 0 0 0 1px ${SEVERITY[alertSeverity(a)].color}55` }}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SEVERITY[alertSeverity(a)].color }} aria-hidden /><span className="truncate">{a.title}</span>
        </Link>
      ))}
      {list.length > 3 && <span className="self-center text-[11.5px] text-fg-3">+{list.length - 3} more</span>}
    </div>
  );

  if (s.id === "ident") {
    const a = r.anpr, c = r.chassis, o = r.odometer;
    return (
      <>
        <div className={GRID}>
          <Tile label="Plate camera" verdict={a ? (a.matches_session_vehicle === false ? "fail" : "pass") : null} note={a ? undefined : "reading the plate…"}>
            {a ? <span className="truncate">{a.plate || "not read"}</span> : <Waiting text="reading…" />}
          </Tile>
          <Tile label="Plate read confidence" note={a?.registry ? (a.registry.found ? "registry record found" : "no registry record") : undefined}>
            {a ? <><CountUp value={Math.round((a.conf || 0) * 100)} /><Unit>%</Unit></> : <Waiting text="–" />}
          </Tile>
          <Tile label="Chassis number (OCR)" verdict={c ? (c.match ? "pass" : "fail") : null} note={c ? undefined : "reading the chassis plate…"}>
            {c ? <span className="truncate font-mono text-[14px]">{c.read || "not read"}</span> : <Waiting text="–" />}
          </Tile>
          <Tile label="Odometer" verdict={o ? (o.rollback_km ? "fail" : "pass") : null} note={o ? undefined : "read from the cluster"}
            limit={o?.max_recorded_km ? `${fmtN(o.max_recorded_km)} km on record` : undefined}>
            {o ? <><CountUp value={o.reading_km} /><Unit>km</Unit></> : <Waiting text="–" />}
          </Tile>
        </div>
        {findings}
      </>
    );
  }

  if (s.id === "emis") {
    const pnV = lastOf(L.pn, (p) => p.v);
    const pnPts = (L.pn || []).slice(-60).map((p) => p.v);
    const rpmPts = (L.obd || []).filter((o) => o.rpm != null).slice(-60).map((o) => o.rpm as number);
    const rpm = lastOf(L.obd, (o) => o.rpm);
    const cool = lastOf(L.obd, (o) => o.coolant);
    const pnVerdict = r.pn?.verdict || (pnV == null ? null : pnV > 1e6 ? "fail" : pnV > 250000 ? "advisory" : "pass");
    const pnFmt = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(2) : (v / 1e3).toFixed(0));
    return (
      <>
        <div className={GRID}>
          {(fuel === "diesel" || pnV != null || r.pn) && (
            <Tile label="Particle number (idle)" verdict={pnVerdict} limit="250k /cm³" spark={<Spark pts={pnPts} color="#DC2626" limit={250000} />}>
              {pnV == null ? <Waiting /> : <><CountUp value={pnV} fmt={pnFmt} /><Unit>{pnV >= 1e6 ? "M/cm³" : "k/cm³"}</Unit></>}
            </Tile>
          )}
          {fuel === "diesel" && <Instrument k="smoke_opacity_pct" ins={ins} label="Smoke opacity" unit="%" />}
          {fuel !== "diesel" && fuel !== "ev" && (
            <>
              <Instrument k="co_pct" ins={ins} label="CO" unit="%" d={2} />
              <Instrument k="hc_ppm" ins={ins} label="HC" unit="ppm" d={0} />
              <Instrument k="lambda" ins={ins} label="Lambda (λ)" unit="" d={2} />
            </>
          )}
          {fuel === "ev" && (
            <>
              <Instrument k="hv_isolation_mohm" ins={ins} label="HV isolation" unit="MΩ" />
              <Tile label="Battery state of health" verdict={r.ev ? (r.ev.pack_soh_pct < 80 ? "advisory" : "pass") : null} limit={r.ev ? "80%" : undefined} note="from the battery modules">
                {r.ev ? <><CountUp value={r.ev.pack_soh_pct} fmt={(n) => fmtN(n, 1)} /><Unit>%</Unit></> : <Waiting />}
              </Tile>
            </>
          )}
          {(rpm != null || fuel !== "ev") && (
            <Tile label="OBD · engine speed" note={rpm == null ? "OBD dongle connecting…" : "live"} spark={<Spark pts={rpmPts} color="#2563EB" />}>
              {rpm == null ? <Waiting text="–" /> : <><CountUp value={rpm} /><Unit>rpm</Unit></>}
            </Tile>
          )}
          {cool != null && (
            <Tile label="OBD · coolant" note={r.obd?.dtcs?.length ? `${r.obd.dtcs.length} fault code${r.obd.dtcs.length === 1 ? "" : "s"} stored` : r.obd ? "no fault codes" : "live"}>
              <CountUp value={cool} /><Unit>°C</Unit>
            </Tile>
          )}
        </div>
        {findings}
      </>
    );
  }

  if (s.id === "brake") {
    const br = r.brakes;
    const wheels = Array.from(new Set([...Object.keys(L.brake || {}), ...Object.keys(br?.wheels || {})])).sort();
    const now = (w: string) => lastOf(L.brake?.[w], (p) => p.f);
    const scale = Math.max(6, ...wheels.map((w) => br?.wheels?.[w]?.peak_kn || 0), ...wheels.map((w) => now(w) || 0)) * 1.08;
    const imb = br ? Math.max(0, ...Object.values(br.imbalance_by_axle || {}).map(Number)) : null;
    return (
      <>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)]">
          <div className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-ink-600/80">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-fg-3"><span>Brake force per wheel (kN)</span><span>{live ? "rollers turning" : br ? "peak" : ""}</span></div>
            {!wheels.length ? <Waiting text="the rollers start in a moment…" /> : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                {wheels.map((w) => {
                  const v = live ? now(w) ?? 0 : br?.wheels?.[w]?.peak_kn ?? now(w) ?? 0;
                  return (
                    <div key={w} className="min-w-0">
                      <div className="flex items-baseline justify-between text-[11.5px]"><b className="font-mono">{w}</b><span className="font-semibold tabular-nums"><CountUp value={v} fmt={(n) => n.toFixed(2)} /></span></div>
                      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[#E2E8F0]">
                        <div className={`h-full rounded-full bg-gradient-to-r from-[#60A5FA] to-[#2563EB] ${reduced ? "" : "transition-[width] duration-300 ease-linear"}`} style={{ width: `${clamp((100 * v) / scale, 0, 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Brake efficiency" verdict={br ? (br.efficiency_pct < br.limit_efficiency_pct ? "fail" : "pass") : null} limit={br ? `${br.limit_efficiency_pct}%` : undefined} note="after the test">
              {br ? <><CountUp value={br.efficiency_pct} fmt={(n) => fmtN(n, 1)} /><Unit>%</Unit></> : <Waiting text="–" />}
            </Tile>
            <Tile label="Imbalance (worst axle)" verdict={imb == null ? null : imb > 30 ? "fail" : imb > 20 ? "advisory" : "pass"} limit={imb == null ? undefined : "30%"} note="after the test">
              {imb == null ? <Waiting text="–" /> : <><CountUp value={imb} fmt={(n) => fmtN(n, 1)} /><Unit>%</Unit></>}
            </Tile>
          </div>
        </div>
        {findings}
      </>
    );
  }

  if (s.id === "susp") {
    const sx = ins.suspension_eff_pct;
    const axles: number[] = Array.isArray(sx?.value) ? sx.value : sx ? [sx.value] : [];
    return (
      <>
        <div className={GRID}>
          {axles.length ? axles.map((v, i) => (
            <Tile key={i} label={`Suspension · axle ${i + 1}`} verdict={v < (sx.limit ?? 40) ? "fail" : "pass"} limit={`${sx.limit}% min`}>
              <CountUp value={v} /><Unit>%</Unit>
            </Tile>
          )) : <Tile label="Suspension efficiency" note="per axle, on the shaker plates"><Waiting /></Tile>}
        </div>
        {findings}
      </>
    );
  }

  // the single-instrument stations
  const ONE: Partial<Record<StationId, [string, string, string, number]>> = {
    tint: ["tint_vlt_pct", "Window tint (light let through)", "%", 0],
    slip: ["side_slip_m_per_km", "Side slip (front wheels)", "m/km", 1],
    speedo: ["speedo_kmh_at_40", "Speedometer at a true 40 km/h", "km/h", 0],
    headlight: ["headlamp_dev_pct", "Headlamp aim (deviation)", "%", 1],
  };
  const one = ONE[s.id];
  if (one) {
    return (
      <>
        <div className={GRID}><Instrument k={one[0]} ins={ins} label={one[1]} unit={one[2]} d={one[3]} /></div>
        {findings}
      </>
    );
  }

  if (s.id === "under" || s.id === "above") {
    const mine = (r.images || []).filter((im: any) => (s.id === "under" ? im.system === "undercarriage" || im.system === "tyre" : im.system === "above"));
    const latest = mine[mine.length - 1];
    const corr = mine.filter((im: any) => im.corrosion_score !== undefined).map((im: any) => Number(im.corrosion_score));
    const tyre = mine.filter((im: any) => im.system === "tyre").pop();
    const hubs = r.thermal?.hubs ? Object.entries(r.thermal.hubs as Record<string, number>).sort((a, b) => b[1] - a[1]) : [];
    const cls = mine.filter((im: any) => im.label).pop();
    return (
      <>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative h-[92px] w-full shrink-0 overflow-hidden rounded-xl bg-[#0F172A] ring-1 ring-ink-600 sm:w-[150px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {latest ? <img src={latest.annotated} alt={`${SYSTEM_NAME[latest.system] || latest.kind} frame from ${latest.camera}`} className="h-full w-full object-cover" />
              : <span className="flex h-full items-center justify-center text-[11.5px] font-semibold text-white/70">{live ? "Waiting for the first frame…" : "No frame"}</span>}
            {live && !reduced && <span className="scanline pointer-events-none absolute inset-x-0 h-6 bg-gradient-to-b from-transparent via-[#60A5FA]/60 to-transparent" aria-hidden />}
            {live && <span className="absolute left-1.5 top-1.5 rounded bg-[#0F172A]/75 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-[#93C5FD]">SCANNING…</span>}
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 lg:grid-cols-4">
            <Tile label="Frames analysed" note={latest ? `${SYSTEM_NAME[latest.system] || latest.kind} · ${latest.camera}` : live ? "cameras running" : undefined}>
              <CountUp value={mine.length} />
            </Tile>
            {s.id === "under" ? (
              <>
                <Tile label="Corrosion (worst)" verdict={corr.length ? (Math.max(...corr) >= 7 ? "fail" : Math.max(...corr) >= 4 ? "advisory" : "pass") : null} limit={corr.length ? "4 / 10" : undefined} note="pit cameras">
                  {corr.length ? <><CountUp value={Math.max(...corr)} fmt={(n) => n.toFixed(1)} /><Unit>/ 10</Unit></> : <Waiting text="–" />}
                </Tile>
                <Tile label="Tyre AI" verdict={tyre ? (tyre.class === "defective" ? "fail" : "pass") : null} note="tyre scanner">
                  {tyre ? <span className="truncate text-[14px]">{tyre.class === "defective" ? "Defect" : "Good"} <Unit>{Math.round((tyre.p || 0) * 100)}%</Unit></span> : <Waiting text="–" />}
                </Tile>
                <Tile label={hubs.length ? `Hottest wheel hub · ${hubs[0][0]}` : "Thermal camera"} verdict={hubs.length ? (hubs[0][1] > 120 ? "fail" : "pass") : null} note="wheel hubs">
                  {hubs.length ? <><CountUp value={hubs[0][1]} /><Unit>°C</Unit></> : r.thermal?.pack ? <><CountUp value={r.thermal.pack.max_c} /><Unit>°C pack</Unit></> : <Waiting text="–" />}
                </Tile>
              </>
            ) : (
              <>
                <Tile label="Latest result" note={cls?.camera}>{cls ? <span className="truncate text-[14px]">{cls.label}</span> : <Waiting text="–" />}</Tile>
                <Tile label="Cabin floor corrosion" verdict={r.cabin_corrosion != null ? (r.cabin_corrosion >= 4 ? "fail" : "pass") : null} note="cabin camera">
                  {corr.length ? <><CountUp value={Math.max(...corr)} fmt={(n) => n.toFixed(1)} /><Unit>/ 10</Unit></> : <Waiting text="–" />}
                </Tile>
                <Tile label="Findings from this module" verdict={list.length ? "fail" : mine.length ? "pass" : null}><CountUp value={list.length} /></Tile>
              </>
            )}
          </div>
        </div>
        {findings}
      </>
    );
  }

  if (s.id === "examiner") {
    const h = M.insp?.health_score ?? L.fusion?.health?.score ?? null;
    const open = M.alerts.filter((a) => a.status === "open").length;
    return (
      <>
        <div className={GRID}>
          <Tile label="Vehicle health score" note={h == null ? "the fusion runs as the vehicle arrives" : "fusion of every result"}>
            {h == null ? <Waiting text="–" /> : <span style={{ color: scoreColor(h) }}><CountUp value={h} /></span>}{h != null && <Unit>/ 100</Unit>}
          </Tile>
          <Tile label="Findings" note={`${M.alerts.filter((a) => a.severity === "high").length} critical`}><CountUp value={M.alerts.length} /></Tile>
          <Tile label="Waiting for a decision" verdict={open ? "advisory" : M.alerts.length ? "pass" : null}><CountUp value={open} /></Tile>
          {M.insp?.route === "senior" && <Tile label="Route" verdict="advisory"><span className="text-[14px]">Senior examiner</span></Tile>}
        </div>
        {findings}
      </>
    );
  }

  // report
  const rep = M.insp?.report;
  return (
    <div className={GRID}>
      <Tile label="Verdict" verdict={rep ? (rep.verdict === "FAIL" ? "fail" : rep.verdict === "PASS" ? "pass" : "advisory") : null} note={rep ? undefined : "issued after the examiner's decisions"}>
        {rep ? <span className="text-[16px]">{rep.verdict}</span> : <Waiting text="not issued yet" />}
      </Tile>
      {rep && <Tile label="Report"><Link className="truncate text-[14px] text-cyan hover:underline" href={`/report?id=${rep.report_id}`}>Open the report</Link></Tile>}
    </div>
  );
}

function Summary({ insp, nFind, nCrit, health }: { insp: any; nFind: number; nCrit: number; health: number | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-white ring-1 ring-ink-600" style={{ color: scoreColor(health) }}>
          <span className="text-[18px] font-extrabold leading-none">{health == null ? "–" : <CountUp value={Math.round(health)} />}</span>
          <span className="text-[9px] font-semibold uppercase tracking-wider text-fg-3">health</span>
        </span>
        <div className="min-w-0 text-[13px]">
          <b className="block text-[14.5px]">{insp?.report ? `Report issued · ${insp.report.verdict}` : nFind ? `${nFind} finding${nFind === 1 ? "" : "s"} for the examiner${nCrit ? ` · ${nCrit} critical` : ""}` : "No findings: the examiner can issue the report"}</b>
          <span className="text-fg-3">Every station is done. Pick a station on the lane to see what it measured.</span>
        </div>
      </div>
    </div>
  );
}

/** A finding as it is raised: slides in, stays about 7 s (paused while hovered), and links to the examiner workspace. */
function FindingPop({ a, station, insp, onClose, onHover, reduced }: { a: any; station: Station; insp: any; onClose: () => void; onHover: (on: boolean) => void; reduced: boolean }) {
  const sev = alertSeverity(a);
  const col = SEVERITY[sev].color;
  const img = a.evidence?.image?.annotated;
  const mod = moduleOf(a);
  const meta = `${mod || a.system}${hasModelConfidence(a) ? ` · ${Math.round(a.confidence * 100)}% confidence` : ""}`;
  const [hover, setHover] = useState(false);
  const left = useRef(7000);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (hover) return;
    const t0 = Date.now();
    const id = setTimeout(() => close.current(), left.current);
    return () => {
      clearTimeout(id);
      left.current = Math.max(600, left.current - (Date.now() - t0));
    };
  }, [hover]);
  return (
    <div className={`${reduced ? "" : "llv-pop"} pointer-events-auto relative overflow-hidden rounded-2xl border border-white bg-white/95 shadow-float backdrop-blur-xl`}
      style={{ borderLeft: `4px solid ${col}` }}
      onMouseEnter={() => { setHover(true); onHover(true); }} onMouseLeave={() => { setHover(false); onHover(false); }}
      onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <div className="flex gap-2.5 p-2.5 pr-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {img ? <img src={img} alt="" className="h-[52px] w-[64px] shrink-0 rounded-lg object-cover ring-1 ring-ink-600" />
          : <span className="flex h-[52px] w-[44px] shrink-0 items-center justify-center rounded-lg" style={{ background: col + "14" }}><Icon name={station.icon} size={20} color={col} /></span>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-fg-3">
            <span className="font-bold uppercase tracking-[0.12em]" style={{ color: col }}>New finding</span>
            <span aria-hidden>·</span><span className="truncate">{station.label}</span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-snug">{a.title}</div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-fg-3">
              <SeverityBadge s={sev} className="!px-1.5 !py-0 !text-[10.5px]" />
              <span className="truncate" title={`${mod ? `${mod} · ` : ""}${a.system}`}>{meta}</span>
            </span>
            {insp && <Link href={`/inspection/${insp.inspection_id}/findings?finding=${a.alert_id}`} className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-blue-50 px-2 py-0.5 text-[12px] font-semibold text-[#1D4ED8] ring-1 ring-blue-100 hover:bg-blue-100">Open finding<Icon name="chev" size={13} /></Link>}
          </div>
        </div>
      </div>
      <button type="button" onClick={onClose} aria-label={`Dismiss: ${a.title}`} className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-fg-3 hover:bg-ink-700 hover:text-fg">
        <Icon name="close" size={13} width={2.2} />
      </button>
      {!reduced && <span className="llv-timer absolute bottom-0 left-0 h-[3px]" style={{ background: col, animationPlayState: hover ? "paused" : "running" }} aria-hidden />}
    </div>
  );
}

/* ------------------------------------------------------------------ a lane followed by itself (dashboard and list cards) */

/** A lane's place in its replay from its own lane channel: the player clock, the step and the status. Seeded with what
 *  the page already knows (null: nothing on the lane yet, so only a replay that starts now shows). */
export type LaneSeed = { inspection_id?: string | null; step?: string | null; status?: string | null; verdict?: string | null } | null;

export function useLaneTrack(lane: string | null, seed: LaneSeed) {
  const mk = (): { insp: any; step: string; player: any } => ({
    insp: seed?.inspection_id ? {
      inspection_id: seed.inspection_id, status: seed.status || "in_lane", step: seed.step || "",
      report: seed.status === "reported" ? { verdict: seed.verdict || "" } : null,
    } : null,
    step: seed?.step || "", player: null,
  });
  const [s, setS] = useState(mk);
  const sid = seed?.inspection_id || null;
  useEffect(() => {
    setS((x) => (sid && x.insp?.inspection_id !== sid ? mk()
      : sid && seed?.status && x.insp && x.insp.status !== seed.status && x.player?.status !== "playing" ? { ...x, insp: { ...x.insp, status: seed.status, report: mk().insp.report || x.insp.report } } : x));
  }, [sid, seed?.status]);  // eslint-disable-line react-hooks/exhaustive-deps
  useLive(lane ? [`lane:${lane}`] : [], (m) => {
    const d = m.data;
    setS((x) => {
      switch (m.type) {
        case "player": {
          if (x.insp && d.inspection_id && d.inspection_id !== x.insp.inspection_id) {
            // a newer run on this lane
            if (d.status === "playing" || d.status === "paused") return { insp: { inspection_id: d.inspection_id, status: "in_lane", step: d.step || "", timeline: d.timeline }, step: d.step || "", player: d };
            return x;
          }
          if (!x.insp) {
            if (d.status === "playing" || d.status === "paused") return { insp: { inspection_id: d.inspection_id, status: "in_lane", step: d.step || "", timeline: d.timeline }, step: d.step || "", player: d };
            return x;
          }
          return { ...x, player: d, insp: { ...x.insp, timeline: x.insp.timeline || d.timeline } };
        }
        case "inspection":
          // the same run, or (with nothing on the lane yet) a run that may be old: wait for its player to play
          if (x.insp?.inspection_id === d.inspection_id || !x.insp) return x;
          return { insp: { inspection_id: d.inspection_id, status: "in_lane", step: "", timeline: d.timeline }, step: "", player: x.player };
        case "step":
          if (!x.insp) return x;
          return { ...x, step: d.step, insp: { ...x.insp, step: d.step, status: ["examiner_review", "report", "done"].includes(d.step) && x.insp.status === "in_lane" ? "review" : x.insp.status } };
        case "fusion":
          return x.insp ? { ...x, insp: { ...x.insp, status: x.insp.status === "in_lane" ? "review" : x.insp.status, health_score: d.health?.score } } : x;
        case "report":
          return x.insp ? { ...x, insp: { ...x.insp, status: "reported", report: d } } : x;
        default:
          return x;
      }
    });
  });
  return s;
}

/** The compact lane strip for a card: the lane's own live state, no readout and no pop-ups. */
export function LiveLaneStrip({ lane, seed }: { lane: string; seed: LaneSeed }) {
  const t = useLaneTrack(lane, seed);
  return <LiveLaneView L={t} compact />;
}

/* ------------------------------------------------------------------ styles (scoped by the llv- prefix) */

const CSS = `
@keyframes llv-ring { 0% { transform: scale(.85); opacity: .75 } 100% { transform: scale(1.55); opacity: 0 } }
.llv-ring { animation: llv-ring 1.6s ease-out infinite; }
@keyframes llv-ping { 0% { transform: scale(1); opacity: .7 } 100% { transform: scale(2.2); opacity: 0 } }
.llv-ping { animation: llv-ping 1.2s ease-out infinite; }
@keyframes llv-pop { from { opacity: 0; transform: translateX(28px) scale(.97) } to { opacity: 1; transform: none } }
.llv-pop { animation: llv-pop .35s cubic-bezier(.2,.9,.3,1.2); }
@keyframes llv-timer { from { width: 100% } to { width: 0% } }
.llv-timer { animation: llv-timer 7s linear forwards; }
@keyframes llv-glow { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
.llv-glow { animation: llv-glow 1.8s ease-in-out infinite; }
.llv-floor {
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,.10) 0 1px, transparent 1px 34px),
    linear-gradient(180deg, #E3E8EF 0%, #D2D9E2 55%, #CBD3DD 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.8), inset 0 -14px 24px -20px rgba(15,23,42,.45), 0 8px 22px -16px rgba(15,23,42,.35);
}
.llv-lines { background: repeating-linear-gradient(90deg, #EAB308 0 26px, transparent 26px 44px); opacity: .85; }
.llv-roller { background: repeating-linear-gradient(90deg, #475569 0 3px, #64748B 3px 6px); box-shadow: inset 0 1px 1px rgba(255,255,255,.35); opacity: .8; }
.llv-plate { background: repeating-linear-gradient(45deg, #94A3B8 0 2px, #B6C1CF 2px 6px); box-shadow: inset 0 0 0 1px rgba(71,85,105,.35); opacity: .85; }
.llv-pit { background: repeating-linear-gradient(0deg, rgba(51,65,85,.75) 0 2px, rgba(30,41,59,.55) 2px 6px); box-shadow: inset 0 0 0 1px rgba(15,23,42,.35); }
.llv-scroll { scrollbar-width: thin; }
@media (prefers-reduced-motion: reduce) { .llv-ring, .llv-ping, .llv-pop, .llv-timer, .llv-glow { animation: none; } }
`;
