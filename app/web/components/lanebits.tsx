"use client";
import { LineChart } from "./charts";
import { Pill, Source } from "./ui";
import { STEP_LABEL, fmtN } from "@/lib/format";

const ENOSE_COLORS = ["#22D3EE", "#60A5FA", "#A78BFA", "#F472B6", "#FB923C", "#FBBF24", "#34D399", "#2DD4BF",
  "#38BDF8", "#818CF8", "#C084FC", "#F87171", "#FACC15", "#4ADE80", "#94A3B8", "#E879F9"];

export function Timeline({ timeline, step, t }: { timeline: any[]; step: string; t?: number }) {
  const idx = timeline.findIndex((s) => s.step === step);
  return (
    <ol className="flex flex-col gap-1.5">
      {timeline.map((s, i) => {
        const done = step === "done" || (idx >= 0 && i < idx);
        const cur = i === idx;
        return (
          <li key={s.step} className={`flex items-center gap-3 rounded-lg px-2.5 py-1.5 ${cur ? "bg-cyan/10 ring-1 ring-cyan/50" : ""}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-ok text-ink-900" : cur ? "bg-cyan text-ink-900" : "bg-ink-600 text-fg-3"}`}>
              {done ? "✓" : i + 1}
            </span>
            <span className={`flex-1 text-[13px] ${cur ? "font-semibold text-fg" : done ? "text-fg-2" : "text-fg-3"}`}>{STEP_LABEL[s.step] || s.step}</span>
            <span className="font-mono text-[11px] text-fg-4">{s.start_s}–{s.end_s}s</span>
          </li>
        );
      })}
      {t !== undefined && <li className="mt-1 text-right font-mono text-[11px] text-fg-3">sim t = {Math.round(t)} s</li>}
    </ol>
  );
}

const TILES: [string, string, string, (v: any) => string][] = [
  ["smoke_opacity_pct", "Smoke opacity", "%", (v) => `${v}`],
  ["co_pct", "CO", "%", (v) => `${v}`],
  ["hc_ppm", "HC", "ppm", (v) => `${v}`],
  ["hv_isolation_mohm", "HV isolation", "MΩ", (v) => `${v}`],
  ["suspension_eff_pct", "Suspension eff.", "%", (v) => (Array.isArray(v) ? v.join(" / ") : `${v}`)],
  ["side_slip_m_per_km", "Side slip", "m/km", (v) => `${v}`],
  ["headlamp_dev_pct", "Headlamp aim", "%", (v) => `${v}`],
  ["tint_vlt_pct", "Tint VLT", "%", (v) => `${v}`],
];

export function Instruments({ instruments, results }: { instruments: Record<string, any>; results: Record<string, any> }) {
  const pn = results.pn;
  const br = results.brakes;
  const ev = results.ev;
  const tiles = TILES.filter(([k]) => instruments[k]).map(([k, label, unit, f]) => ({
    k, label, value: `${f(instruments[k].value)} ${unit}`, verdict: instruments[k].verdict, limit: instruments[k].limit, overridden: instruments[k].overridden,
  }));
  if (pn) tiles.unshift({ k: "pn", label: "Particle number", value: `${(pn.median_per_cm3 / 1e6).toFixed(2)} M/cm³`, verdict: pn.verdict, limit: "250k", overridden: false });
  if (br) {
    tiles.push({ k: "be", label: "Brake efficiency", value: `${br.efficiency_pct}%`, verdict: br.efficiency_pct < br.limit_efficiency_pct ? "fail" : "pass", limit: br.limit_efficiency_pct, overridden: false });
    const imb = Math.max(0, ...Object.values(br.imbalance_by_axle || {}).map(Number));
    tiles.push({ k: "bi", label: "Brake imbalance", value: `${imb}%`, verdict: imb > 30 ? "fail" : imb > 20 ? "advisory" : "pass", limit: 30, overridden: false });
  }
  if (ev) tiles.push({ k: "soh", label: "Battery SOH", value: `${ev.pack_soh_pct}%`, verdict: ev.pack_soh_pct < 80 ? "advisory" : "pass", limit: "80%", overridden: false });
  const col = (v: string) => (v === "fail" ? "#F87171" : v === "advisory" ? "#FBBF24" : "#34D399");
  if (!tiles.length) return <p className="text-[13px] text-fg-3">Instrument readings appear as each lane step completes.</p>;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.k} className="rounded-xl border bg-ink-850 px-3 py-2.5" style={{ borderColor: col(t.verdict) + "55" }}>
          <div className="flex items-center justify-between text-[11.5px] text-fg-3">
            <span>{t.label}</span>
            {t.overridden && <span className="text-warn">edited</span>}
          </div>
          <div className="mt-0.5 font-display text-[18px] font-semibold">{t.value}</div>
          <div className="text-[11px]" style={{ color: col(t.verdict) }}>{t.verdict} · limit {t.limit}</div>
        </div>
      ))}
    </div>
  );
}

export function ENoseChart({ enose, events = [], height = 200 }: { enose: { t: number; ch: number[] }[]; events?: any[]; height?: number }) {
  if (enose.length < 3) return <p className="text-[13px] text-fg-3">Waiting for the e-nose stream…</p>;
  const step = Math.max(1, Math.floor(enose.length / 400));
  const pts = enose.filter((_, i) => i % step === 0);
  const series = Array.from({ length: 16 }, (_, c) => ({ color: ENOSE_COLORS[c], width: 1.2, points: pts.map((p) => ({ x: p.t, y: p.ch[c] })) }));
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  return (
    <LineChart series={series} height={height} yFmt={(v) => v.toFixed(1)}
      xLabels={[0, 0.25, 0.5, 0.75, 1].map((f) => ({ x: t0 + f * (t1 - t0), label: `${Math.round(t0 + f * (t1 - t0))}s` }))}
      vlines={events.flatMap((e) => (e.peak_s >= t0 && e.peak_s <= t1 ? [{ x: e.peak_s, color: "#F87171", label: e.condition.replaceAll("_", " ") }] : []))}
    />
  );
}

export function BrakeChart({ brake, height = 180 }: { brake: Record<string, { t: number; f: number }[]>; height?: number }) {
  const wheels = Object.keys(brake).sort();
  if (!wheels.length) return <p className="text-[13px] text-fg-3">Brake roller curves appear during the brake test.</p>;
  const col = ["#22D3EE", "#60A5FA", "#34D399", "#FBBF24", "#F472B6", "#F87171"];
  return (
    <div>
      <LineChart height={height} yFmt={(v) => `${v.toFixed(0)}`} xLabels={[0, 3, 6, 9, 12].map((x) => ({ x, label: `${x}s` }))}
        series={wheels.map((w, i) => ({ name: w, color: col[i % col.length], width: 1.8, points: brake[w].map((p) => ({ x: p.t, y: p.f })) }))} />
      <div className="mt-1 flex flex-wrap gap-2 text-[11.5px] text-fg-3">
        {wheels.map((w, i) => <span key={w} className="flex items-center gap-1"><span className="h-0.5 w-3" style={{ background: col[i % col.length] }} />{w} kN</span>)}
      </div>
    </div>
  );
}

export function PNChart({ pn, height = 160 }: { pn: { t: number; v: number }[]; height?: number }) {
  if (!pn.length) return <p className="text-[13px] text-fg-3">Particle-number test runs during the emission step.</p>;
  return (
    <LineChart height={height} yMin={0} yFmt={(v) => `${(v / 1e6).toFixed(1)}M`}
      hlines={[{ y: 250000, color: "#FBBF24", label: "250k advisory", dashed: true }]}
      xLabels={[0, 15, 30, 45, 59].map((x) => ({ x, label: `${x}s` }))}
      series={[{ color: "#F87171", points: pn.map((p) => ({ x: p.t, y: p.v })), area: true }]} />
  );
}

export function OBDChart({ obd, height = 150 }: { obd: { t: number; rpm: number | null }[]; height?: number }) {
  if (obd.length < 2) return <p className="text-[13px] text-fg-3">OBD readout starts at check-in.</p>;
  const step = Math.max(1, Math.floor(obd.length / 300));
  const pts = obd.filter((_, i) => i % step === 0 && _.rpm != null);
  return (
    <LineChart height={height} yFmt={(v) => fmtN(v)} xLabels={[pts[0].t, pts[pts.length - 1].t].map((x) => ({ x, label: `${Math.round(x)}s` }))}
      series={[{ color: "#60A5FA", points: pts.map((p) => ({ x: p.t, y: p.rpm as number })) }]} />
  );
}

export function Frames({ images, onOpen }: { images: any[]; onOpen?: (img: any) => void }) {
  if (!images?.length) return <p className="text-[13px] text-fg-3">Camera frames arrive during the undercarriage and above-carriage steps.</p>;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {images.map((im, i) => (
        <button key={i} className="overflow-hidden rounded-xl border border-ink-600 bg-ink-850 text-left" onClick={() => onOpen?.(im)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={im.annotated} alt={`${im.kind} frame`} className="h-40 w-full object-cover" />
          <div className="flex flex-col gap-1 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold capitalize">{im.kind} · {im.camera}</span>
              <Source kind={im.model === "corrosion segmentation" ? "live_logic" : "live_model"} />
            </div>
            <span className="text-[12px] text-fg-3">
              {im.corrosion_score !== undefined ? `Corrosion ${im.corrosion_score}/10 · ${im.boxes?.length || 0} regions` : `${im.label} (${Math.round((im.p || 0) * 100)}%)`}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

export function AlertMini({ a }: { a: any }) {
  const c = a.severity === "high" ? "#F87171" : a.severity === "medium" ? "#FBBF24" : "#93C5FD";
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2">
      <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">{a.title}</div>
        <div className="text-[11.5px] text-fg-3">{a.system} · {Math.round(a.confidence * 100)}% · {a.source.replace("_", " ")}</div>
      </div>
      {a.fail_item && <Pill color="#F87171">fail item</Pill>}
    </div>
  );
}
