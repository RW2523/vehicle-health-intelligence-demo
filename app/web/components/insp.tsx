"use client";
/* What the three inspection screens share: loading the inspection (by id, or the latest of a lane replay "S1"), the
   vehicle strip, the step navigation (capture, findings, approval), the checklist and the photo views computed from the
   live state (the API computes the same, vhi/services/inspection_view.py), and the evidence and assistant panels. */
import Link from "next/link";
import { ReactNode, useEffect, useState } from "react";
import { BrakeChart, ENoseChart, PNChart } from "@/components/lanebits";
import { Card, LoadingState, Pill, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { STATUS_LABEL, fmtN, laneLabel, llmLabel, pct } from "@/lib/format";
import { useInspection } from "@/lib/inspection";
import { useUser } from "@/lib/auth";
import { PlayerControls, useSessions } from "./Player";
import { StatusPill, Tone } from "./glass";
import { Icon } from "./icons";
import { VehicleArt } from "./VehicleArt";
import { useVehiclePhotos } from "./Photo";
import { VehicleImage } from "./VehicleImage";

/** The inspection a page is about: an inspection id, or "S1".."S7" for the latest run of that lane replay. */
export function useInspectionParam(id: string) {
  const session = /^S\d+$/i.test(id) ? id.toUpperCase() : undefined;
  return { L: useInspection(session ? { session } : { id }), session };
}

const STEPS = ["check_in_anpr", "identity_ocr", "emission_idle_rev", "brake_roller", "suspension", "side_slip", "headlamp_tint",
  "undercarriage_ai", "above_carriage_ai", "examiner_review", "report"];
const ITEMS: [string, string, string, string[], string[]][] = [
  ["identification", "Vehicle Identification", "car", ["check_in_anpr", "identity_ocr"], ["anpr:", "identity:", "route:"]],
  ["exterior", "Exterior Condition", "car", ["above_carriage_ai"], ["body:", "capture:front", "capture:rear", "capture:left", "capture:right"]],
  ["lighting", "Lighting System", "lamp", ["headlamp_tint"], ["headlamp"]],
  ["braking", "Braking System", "brake", ["brake_roller"], ["brake:", "thermal:A"]],
  ["suspension", "Suspension & Steering", "steering", ["suspension", "side_slip"], ["suspension", "acoustic:wheel_bearing"]],
  ["tyres", "Tyres & Wheels", "tyre", ["undercarriage_ai"], ["tyre:", "capture:tyre"]],
  ["emissions", "Emissions", "smoke", ["emission_idle_rev"], ["pn:", "emissions:"]],
  ["engine", "Engine & Diagnostics", "oil", ["emission_idle_rev"], ["dtc:", "acoustic:"]],
  ["underbody", "Underbody", "layers", ["undercarriage_ai"], ["corrosion:undercarriage", "capture:underbody"]],
  ["interior", "Interior & Safety", "seat", ["headlamp_tint", "above_carriage_ai"], ["tint", "corrosion:cabin", "capture:interior", "flood"]],
  ["ev", "EV Battery & High Voltage", "batt", ["emission_idle_rev"], ["ev:", "thermal:pack"]],
  ["final", "Final Review", "list", ["examiner_review"], []],
];

export function itemOf(code: string, ev: boolean): string {
  if (code === "flood" && ev) return "ev";
  if (code.startsWith("acoustic:") && code.includes("wheel_bearing")) return "suspension";
  for (const [id, , , , codes] of ITEMS) if (codes.some((c) => code.startsWith(c))) return id;
  return "engine";
}

/** The checklist item a finding belongs to, by its label: the same words as the checklist and the finding tabs. */
export function itemLabel(code: string, ev: boolean): string {
  const id = itemOf(code, ev);
  return ITEMS.find((x) => x[0] === id)?.[1] || "Engine & Diagnostics";
}

/** A fuel code as people write it ("ev" → "EV", "petrol" → "Petrol"). */
export const FUEL_LABEL: Record<string, string> = { ev: "EV", petrol: "Petrol", diesel: "Diesel", hybrid: "Hybrid", phev: "Plug-in hybrid", lpg: "LPG", cng: "CNG" };
export const fuelLabel = (f?: string | null) => (f ? FUEL_LABEL[String(f).toLowerCase()] || String(f).replace(/^./, (c) => c.toUpperCase()) : "");

export type CheckItem = { id: string; label: string; icon: string; status: string; findings: number; open: number };

/** The inspection checklist from the live state: what the lane has measured, and the decisions on its findings. */
export function checklistOf(insp: any, alerts: any[], step: string): { items: CheckItem[]; done: number; total: number } {
  const ev = insp?.vehicle?.fuel === "ev";
  const s = step || insp?.step || "";
  const cur = insp?.status !== "in_lane" || s === "done" ? STEPS.length : STEPS.indexOf(s);
  const by: Record<string, any[]> = {};
  alerts.forEach((a) => (by[itemOf(a.code, ev)] ||= []).push(a));
  const items: CheckItem[] = [];
  for (const [id, label, icon, steps] of ITEMS) {
    if ((id === "ev" && !ev) || (id === "emissions" && ev)) continue;
    const f = by[id] || [];
    const first = Math.min(...steps.map((x) => STEPS.indexOf(x))), last = Math.max(...steps.map((x) => STEPS.indexOf(x)));
    let st: string;
    if (id === "final") st = insp?.report ? "pass" : insp && insp.status !== "in_lane" ? "review" : "not_started";
    else if (f.some((a) => a.status === "open")) st = "review";
    else if (f.some((a) => a.status === "confirmed" && a.fail_item)) st = "fail";
    else if (f.some((a) => ["confirmed", "advisory", "deferred"].includes(a.status))) st = "advisory";
    else if (cur > last) st = "pass";
    else if (cur >= first) st = "in_progress";
    else st = "not_started";
    items.push({ id, label, icon, status: st, findings: f.length, open: f.filter((a) => a.status === "open").length });
  }
  return { items, done: items.filter((i) => ["pass", "advisory", "fail"].includes(i.status)).length, total: items.length };
}

export const ITEM_STATUS: Record<string, { label: string; tone: Tone }> = {
  pass: { label: "Pass", tone: "green" }, advisory: { label: "Advisory", tone: "amber" }, fail: { label: "Fail", tone: "red" },
  review: { label: "To review", tone: "purple" }, in_progress: { label: "In Progress", tone: "amber" }, not_started: { label: "Not Started", tone: "gray" },
};

const CAMERA_VIEW: Record<string, string> = { "Rear-left camera": "left", "Rear camera": "rear", "Cabin camera": "interior", "Tyre scanner": "tyre" };
export const VIEWS: { id: string; label: string }[] = [
  { id: "front", label: "Front View" }, { id: "rear", label: "Rear View" }, { id: "left", label: "Left Side" }, { id: "right", label: "Right Side" },
  { id: "underbody", label: "Underbody" }, { id: "interior", label: "Interior" }, { id: "tyre", label: "Tyre Scan" },
];
const MODULE: Record<string, string> = { undercarriage: "Undercarriage AI", above: "Above-carriage AI", tyre: "Tyre AI", examiner: "Examiner" };

/** The photo per camera view: the lane's frames, then the examiner's own captures (the newest wins). */
export function capturesOf(results: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const im of results?.images || []) {
    const view = im.view || (im.kind === "undercarriage" ? "underbody" : CAMERA_VIEW[im.camera] || (im.kind === "body" ? "rear" : im.kind));
    out[view] = {
      ...im, view, module: MODULE[im.system] || im.system,
      result: im.corrosion_score != null ? `Corrosion ${im.corrosion_score}/10` : im.label ? `${im.label} (${Math.round((im.p || 0) * 100)}%)` : "",
    };
  }
  return out;
}

export const atTime = (iso?: string | null) =>
  iso ? new Date(/Z|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + "Z").toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" }) : "";

/** The running use case, when this inspection is the one it runs (its next step is then offered here). */
export function ucFor(uc: any, insp: any) {
  const sid = insp?.session_id || insp?.session;
  return uc && uc.session && sid === uc.session && (!uc.inspection || uc.inspection.inspection_id === insp.inspection_id) ? uc : null;
}

/** The vehicle strip at the top of every inspection screen. */
export function VehicleStrip({ insp, right }: { insp: any; right?: ReactNode }) {
  const v = insp?.vehicle || {};
  const o = insp?.owner || {};
  const running = insp?.status === "in_lane";
  const tone: Tone = insp?.report ? "green" : running ? "amber" : "purple";
  const label = insp?.report ? `Report issued · ${insp.report.verdict}` : running ? "In Progress" : STATUS_LABEL[insp?.status] || insp?.status;
  const field = (k: string, val: ReactNode, sub?: ReactNode) => (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-3">{k}</div>
      <div className="mt-0.5 text-[16px] font-semibold leading-snug">{val}</div>
      {sub && <div className="truncate text-[12.5px] text-fg-3">{sub}</div>}
    </div>
  );
  return (
    <section className="card mb-5 flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6" aria-label="Vehicle">
      <div className="flex aspect-[2/1] w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-b from-[#F1F5FB] to-[#E3EAF5] sm:aspect-auto sm:h-[96px] sm:w-[176px] sm:shrink-0">
        {insp?.photo ? <VehicleImage plate={insp.plate} vtype={o.vtype} photo={insp.photo} size="480" className="h-full w-full" /> : <VehicleArt vtype={o.vtype} seed={insp?.plate} className="h-[86px] w-[164px]" />}
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-5 gap-y-3 sm:min-w-[320px] sm:grid-cols-3 2xl:grid-cols-6">
        <div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-3">Vehicle No.</div><div className="whitespace-nowrap text-[24px] font-extrabold leading-tight tracking-tight sm:text-[26px]">{insp?.plate}</div></div>
        {field("Vehicle Type", o.vtype || "–", v.fuel ? fuelLabel(v.fuel) : undefined)}
        {field("Make / Model", `${v.make || ""} ${v.model || ""}`.trim() || "–", v.year || o.year)}
        {field("Owner", o.name || "–", insp?.inspection_type)}
        {field("Lane", `${laneLabel(insp?.lane_id)}`, insp?.branch_name)}
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-3">Status</div>
          <div className="mt-1"><StatusPill tone={tone} dot className="max-w-full whitespace-normal text-left">{label}</StatusPill></div>
          <div className="mt-1 text-[12.5px] text-fg-3">Started {atTime(insp?.started_at)}</div>
        </div>
      </div>
      {right}
    </section>
  );
}

/** Capture → Findings → Final review: where this screen sits in the inspection. */
export function StepNav({ id, at, findings, open }: { id: string; at: "capture" | "findings" | "review"; findings: number; open: number }) {
  const steps = [
    { k: "capture", label: "Capture & checklist", href: `/inspection/${id}` },
    { k: "findings", label: "Findings", href: `/inspection/${id}/findings` },
    { k: "review", label: "Final review & approval", href: `/inspection/${id}/review` },
  ];
  const idx = steps.findIndex((s) => s.k === at);
  return (
    <nav aria-label="Inspection steps" className="mb-5 flex flex-wrap items-center gap-2">
      {steps.map((s, i) => {
        const on = s.k === at;
        const done = i < idx && !(s.k === "findings" && open > 0);  // a step behind this one, finished (findings: all decided)
        // the findings count, once: how many still need a decision while some do, else how many there are
        const badge = s.k !== "findings" || !findings ? null : open > 0
          ? <span className={`rounded-full px-1.5 text-[11px] ${on ? "bg-white/25" : "bg-red-100 text-red-700"}`} title={`${open} of ${findings} still to decide`}>{open} open</span>
          : <span className={`rounded-full px-1.5 text-[11px] ${on ? "bg-white/25" : "bg-ink-700 text-fg-2"}`} title={`${findings} findings, all decided`}>{findings}</span>;
        return (
          <span key={s.k} className="flex items-center gap-2">
            <Link href={s.href} aria-current={on ? "step" : undefined}
              className={`flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-semibold ring-1 transition ${on ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white ring-transparent shadow" : done ? "bg-white/80 text-[#047857] ring-emerald-200" : "bg-white/70 text-fg-2 ring-ink-600 hover:bg-white"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${on ? "bg-white/25" : done ? "bg-emerald-100" : "bg-ink-700"}`}>{done ? "✓" : i + 1}</span>
              {s.label}{badge}
            </Link>
            {i < steps.length - 1 && <Icon name="chev" size={14} color="#94A3B8" />}
          </span>
        );
      })}
    </nav>
  );
}

export function NoInspection({ id }: { id: string }) {
  const session = /^S\d+$/i.test(id) ? id.toUpperCase() : null;
  const { sessions, setPlayer } = useSessions();
  const user = useUser();
  const s = sessions.find((x) => x.session_id === session);
  const refs = useVehiclePhotos(s?.vehicle?.plate);
  const canRun = user?.role === "presenter" || user?.role === "examiner";
  return (
    <div className="card mx-auto mt-6 max-w-[620px] p-6 text-center">
      {s?.vehicle && (refs.data?.hero
        ? <VehicleImage plate={s.vehicle.plate} photo={refs.data.hero} size="960" className="mx-auto mb-4 aspect-[16/9] w-full max-w-[420px] rounded-2xl" />
        : <VehicleArt vtype={session === "S1" ? "Prime mover" : session === "S2" ? "SUV" : session === "S7" ? "Hatchback" : "Sedan"} seed={s.vehicle.plate} className="mx-auto mb-2 h-[90px] w-[200px]" />)}
      <h2 className="text-[20px] font-bold">{s?.vehicle ? `${s.vehicle.plate} has not entered the lane yet` : "This inspection has not started yet"}</h2>
      <p className="mt-2 text-[14px] text-fg-3">{session ? (canRun ? "Start the lane replay: sensors, cameras and AI modules then fill this screen in real time. Fast-forward runs the whole lane at once." : "The presenter starts the lane replay.") : "No inspection has this number."}</p>
      {s && canRun && <div className="mt-4 flex justify-center"><PlayerControls s={s} onState={setPlayer} compact /></div>}
      <div className="mt-4 flex justify-center gap-2"><Link className="btn" href="/inspection">All inspections</Link><Link className="btn" href="/">Dashboard</Link></div>
    </div>
  );
}

export function PageLoading() {
  return <div className="card p-6"><LoadingState label="Loading the inspection…" rows={5} /></div>;
}

export function Spectrogram({ img, hl }: { img: number[][]; hl?: number[] }) {
  if (!img?.length) return null;
  const rows = img.length, cols = img[0].length;
  return (
    <svg viewBox={`0 0 ${cols} ${rows}`} className="h-32 w-full rounded-lg bg-ink-950" preserveAspectRatio="none" role="img" aria-label="Spectrogram of the recording">
      {img.map((row, y) => row.map((v, x) => <rect key={`${x}-${y}`} x={x} y={rows - 1 - y} width="1.05" height="1.05" fill={`rgba(37,99,235,${0.06 + 0.94 * v})`} />))}
      {hl && <rect x={(hl[0] / 5) * cols} y="0" width={((hl[1] - hl[0]) / 5) * cols} height={rows} fill="none" stroke="#DC2626" strokeWidth="0.6" />}
    </svg>
  );
}

/** The measured value against its limit, when the finding is a measurement with one (never invented); `status` says
 *  which way it is off ("Over the limit", "Under the limit", ...), for the pill next to the value. */
export function measureOf(a: any, L: any): { observed: string; limit: string; delta?: string; status: string } | null {
  const ev = a.evidence || {};
  const r = L.results || {};
  const code: string = a.code || "";
  const num = (v: any) => typeof v === "number" && Number.isFinite(v);
  const fmt = (v: number, unit: string, d = 1) => `${fmtN(v, Math.abs(v) < 10 ? Math.min(2, d + 1) : d)}${unit}`;
  const over = (v: number, lim: number, unit: string, d = 1) => ({ observed: fmt(v, unit, d), limit: `at most ${fmt(lim, unit, d)}`, delta: `${fmt(v - lim, unit, d)} over`, status: "Over the limit" });
  const under = (v: number, lim: number, unit: string, d = 1) => ({ observed: fmt(v, unit, d), limit: `at least ${fmt(lim, unit, d)}`, delta: `${fmt(lim - v, unit, d)} under`, status: "Under the limit" });
  if (code === "pn:high" && ev.pn) {
    const lim = ev.pn.verdict === "fail" ? ev.pn.limit_tamper : ev.pn.limit_advisory;
    return { observed: `${(ev.pn.median_per_cm3 / 1e6).toFixed(2)} M/cm³`, limit: `${ev.pn.verdict === "fail" ? "tamper level" : "advisory level"} ${(lim / 1e6).toFixed(2)} M/cm³`, delta: `${(ev.pn.median_per_cm3 / lim).toFixed(1)}× the level`, status: "Above the level" };
  }
  if (code === "brake:efficiency" && ev.brakes) return under(ev.brakes.efficiency_pct, ev.brakes.limit_efficiency_pct, "%", 0);
  if (code === "brake:imbalance" && ev.brakes) {
    const imb = Math.max(0, ...Object.values(ev.brakes.imbalance_by_axle || {}).map(Number));
    return { ...over(imb, ev.brakes.limit_imbalance_pct, "%", 0), limit: `at most ${ev.brakes.limit_imbalance_pct}% (advisory above 20%)` };
  }
  if (code.startsWith("emissions:")) {
    const f = code.split(":")[1];
    const ins = r.instruments?.[f];
    const v = ev[f];
    if (f === "lambda" && num(v)) return { observed: Number(v).toFixed(2), limit: `between ${ins?.limit || "0.97-1.03"}`, delta: v < 0.97 ? "rich mixture" : "lean mixture", status: "Outside the range" };
    if (num(v) && num(ins?.limit)) return over(v, ins.limit, f === "co_pct" ? "%" : " ppm", f === "co_pct" ? 1 : 0);
  }
  if (code === "ev:hv_isolation" && num(ev.hv_isolation_mohm)) return under(ev.hv_isolation_mohm, 2, " MΩ");
  if (code === "suspension" && ev.values) return under(Math.min(...ev.values), 40, "%", 0);
  if (code === "headlamp" && num(ev.value)) return over(Math.abs(ev.value), 2, "%");
  if (code === "tint" && num(ev.value)) return under(ev.value, 50, "%", 0);
  if (code.startsWith("thermal:") && ev.hubs) {
    const k = code.split(":")[1];
    if (num(ev.hubs[k])) return over(ev.hubs[k], 100, " °C", 0);
  }
  if (code.startsWith("corrosion:") && ev.image) return { observed: `${ev.image.corrosion_score}/10`, limit: "flagged from 4/10", delta: ev.image.level, status: "At or above the flag level" };
  if (code === "identity:odometer" && ev.odometer?.max_recorded_km) return { observed: `${fmtN(ev.odometer.reading_km)} km`, limit: `at least ${fmtN(ev.odometer.max_recorded_km)} km (highest on record)`, delta: `${fmtN(ev.odometer.rollback_km)} km lower`, status: "Lower than on record" };
  if (code === "identity:engine" && ev.fingerprint) return { observed: `similarity ${ev.fingerprint.similarity}`, limit: `at least ${ev.fingerprint.threshold} to match`, delta: `${(ev.fingerprint.threshold - ev.fingerprint.similarity).toFixed(2)} under`, status: "Under the match threshold" };
  if (code === "flood" && ev.flood) return { observed: pct(ev.flood.p), limit: "flagged from 50%", status: "At or above the flag level" };
  return null;
}

/** The health-score deduction this finding caused, when the rule layer names it. */
export function ruleFor(a: any, h: any): any | null {
  const rules: any[] = h?.rules || [];
  const code: string = a.code || "";
  if (code.startsWith("thermal:")) return rules.find((r) => r.rule.includes(`hub ${code.split(":")[1]}`)) || null;
  if (code.startsWith("tyre:")) return rules.find((r) => r.rule.startsWith("Tyre AI")) || null;
  if (code.startsWith("body:")) return rules.find((r) => r.rule.startsWith("Above-carriage AI")) || null;
  if (code === "flood") return rules.find((r) => r.rule.startsWith("Flood probability")) || null;
  if (code.startsWith("acoustic:")) return rules.find((r) => r.rule.startsWith("Acoustic")) || null;
  return rules.find((r) => r.rule === a.title) || null;
}

export const SOURCE_KIND: Record<string, string> = {
  simulated: "Lane instrument reading (simulated sensor)", live_model: "AI model result on this inspection's data", live_logic: "Rule applied to this inspection's data",
};

export function Evidence({ a, L }: { a: any; L: any }) {
  const ev = a.evidence || {};
  const r = L.results;
  const img = ev.image;
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img.annotated} alt={`Evidence frame: ${a.title}`} className="max-h-[300px] w-full rounded-xl bg-ink-950 object-contain" />
      )}
      {ev.acoustic && (
        <div className="flex flex-col gap-2">
          <audio controls src={ev.acoustic.clip} className="w-full" aria-label="Recording" />
          <Spectrogram img={ev.acoustic.spectrogram} hl={ev.acoustic.highlight_s} />
          <div className="flex flex-wrap gap-2">{ev.acoustic.ranked.map((x: any) => <Pill key={x.class} color="#2563EB">{x.label} {Math.round(x.p * 100)}%</Pill>)}</div>
        </div>
      )}
      {ev.fingerprint && (
        <div className="rounded-xl border border-ink-600 bg-ink-850 p-3">
          <div className="mb-2 flex justify-between"><span>Engine sound match with earlier visits</span><b>{ev.fingerprint.similarity}</b></div>
          <div className="relative h-3 rounded bg-ink-600">
            <div className="h-3 rounded bg-bad" style={{ width: `${ev.fingerprint.similarity * 100}%` }} />
            <div className="absolute top-[-4px] h-5 w-0.5 bg-ok" style={{ left: `${ev.fingerprint.threshold * 100}%` }} title="threshold" />
          </div>
          <p className="mt-2 text-[12px] text-fg-3">Threshold {ev.fingerprint.threshold} (calibrated at the equal-error rate) · {ev.fingerprint.n_refs} earlier recording(s).</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div><div className="label mb-1">Today</div><audio controls src={(r.acoustic || []).find((x: any) => x.fingerprint)?.clip} className="w-full" aria-label="Today's engine sound" /></div>
            <div><div className="label mb-1">Earlier visit</div><audio controls src={ev.fingerprint.reference_clips?.[0]} className="w-full" aria-label="Earlier engine sound" /></div>
          </div>
        </div>
      )}
      {ev.event && <ENoseChart enose={L.enose} events={[ev.event]} height={170} />}
      {ev.pn && <PNChart pn={L.pn} height={150} />}
      {ev.brakes && <BrakeChart brake={L.brake} height={160} />}
      {ev.hubs && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(ev.hubs).map(([k, v]: any) => (
            <div key={k} className="rounded-lg border px-3 py-2 text-center" style={{ borderColor: v > 100 ? "#DC2626" : "#E2E8F0" }}>
              <div className="text-[11px] text-fg-3">{k}</div><div className="font-display text-[18px]" style={{ color: v > 100 ? "#DC2626" : undefined }}>{v} °C</div>
            </div>
          ))}
        </div>
      )}
      {ev.dtc && <div className="rounded-lg border border-ink-600 bg-ink-850 p-3"><b>{ev.dtc.code}</b> · {ev.dtc.description} <span className="text-fg-3">({ev.source || ev.dtc.source})</span></div>}
      {ev.flood && (
        <div className="rounded-xl border border-ink-600 bg-ink-850 p-3">
          <div className="mb-1">Flood likelihood <b>{pct(ev.flood.p)}</b> <span className="text-fg-3">(physical-evidence model {pct(ev.flood.p_model)}, then the claim and cabin rules)</span></div>
          <ul className="list-disc pl-5 text-fg-2">{ev.flood.signals.map((s: string) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      {ev.ev && <div className="rounded-lg border border-ink-600 bg-ink-850 p-3">Pack state of health <b>{ev.ev.pack_soh_pct}%</b> (modules {ev.ev.band_pct?.join("–")}%), weakest module {ev.ev.weakest_module}</div>}
      {ev.flags && <div className="rounded-lg border border-bad/50 bg-bad/10 p-3">Identity checks that disagree: {ev.flags.map((f: string) => f.split(":")[1]).join(", ")}</div>}
    </div>
  );
}


/** Context-aware assistant, scoped to this inspection: retrieved facts, then the explanation. */
export function InspectionAssistant({ iid, alertId }: { iid: string; alertId?: string }) {
  const [res, setRes] = useState<any>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const QUICK = ["Why was this vehicle flagged?", "Summarise the unresolved findings", "Show the previous inspection trend", "What evidence supports this finding?", "What should the examiner verify next?"];
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    try {
      setRes(await api.post(`/api/inspections/${iid}/ask`, { question, alert_id: alertId }));
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => setRes(null), [iid]);
  const llm = res && llmLabel(res.source);
  return (
    <Card title="Ask about this inspection" right={res ? <Source kind={llm ? "llm" : "template"} text={llm ? `Local LLM · ${llm}` : "Template (no LLM)"} /> : null}>
      <div className="flex flex-wrap gap-1.5">
        {QUICK.map((x) => <button key={x} className="btn btn-sm" disabled={busy} onClick={() => { setQ(x); ask(x); }}>{x}</button>)}
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input className="input flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this vehicle or inspection" aria-label="Question about this inspection" />
        <button className="btn" disabled={busy || !q.trim()}>{busy ? "Asking…" : "Ask"}</button>
      </form>
      {busy && !res && <LoadingState label="Looking up the inspection…" rows={2} className="mt-3" />}
      {res && (
        <div className="mt-3 flex flex-col gap-3 text-[13px]">
          <div>
            <div className="label mb-1">From the inspection record</div>
            {res.facts.length ? (
              <ol className="flex flex-col gap-1">
                {res.facts.map((f: any) => (
                  <li key={f.n} className="flex gap-2"><span className="shrink-0 font-mono text-[11.5px] text-cyan">[{f.n}]</span><span className="text-fg-2">{f.text}</span></li>
                ))}
              </ol>
            ) : <p className="text-fg-3">Nothing on record answers this.</p>}
            {res.missing.map((m: string) => <p key={m} className="mt-1 text-fg-3">{m}</p>)}
          </div>
          <div className="rounded-xl border border-ink-600 bg-ink-850 p-3">
            <div className="label mb-1">Explanation {llm ? "(generated from the facts above)" : "(assembled from the facts above)"}</div>
            <p className="leading-relaxed">{res.answer}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

