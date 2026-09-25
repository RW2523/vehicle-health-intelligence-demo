"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { LineChart } from "@/components/charts";
import { FleetShell } from "@/components/FleetShell";
import { Bar, Modal, Pill, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { dmy, fmtN, riskColor, scoreColor } from "@/lib/format";
import { useFetch } from "@/lib/live";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lab = (iso: string) => { const d = new Date(iso); return `${MON[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`; };
const addMonths = (iso: string, k: number) => { const d = new Date(iso); d.setMonth(d.getMonth() + k); return d.toISOString().slice(0, 10); };

function DegradationChart({ m }: { m: any }) {
  const pts = m.points;
  const n = pts.length;
  const fc = m.forecast;
  const months = fc.months_to_limit != null ? Math.min(6, Math.max(0.5, fc.months_to_limit)) : 6;
  const end = n - 1 + months;
  const b = fc.slope_per_month, lvl = fc.level_now;
  const at = (x: number, f = 1) => lvl + b * f * (x - (n - 1));
  const steps = [n - 1, (n - 1 + end) / 2, end];
  const lo = m.up ? Math.min(...pts.map((p: any) => p.value)) : m.limit;
  const hi = m.up ? m.limit : Math.max(...pts.map((p: any) => p.value));
  const xl = [];
  for (let i = 0; i <= Math.ceil(end); i += 2) xl.push({ x: i, label: lab(addMonths(pts[0].date, i)), color: i > n - 1 ? "#60A5FA" : undefined });
  const col = riskColor(m.risk);
  const anoms = m.anomalies.filter((a: any) => a.kind !== "repair");
  const crosses = fc.months_to_limit != null && fc.months_to_limit <= 6;
  return (
    <LineChart height={300} yMin={Math.min(lo, m.limit) - Math.abs(hi - lo) * 0.08} yMax={Math.max(hi, m.limit) + Math.abs(hi - lo) * 0.08}
      yFmt={(v) => (Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0))} xLabels={xl}
      hlines={[{ y: m.limit, color: "#EF4444", label: `Fail limit ${m.limit} ${m.unit}` }]}
      vlines={[{ x: n - 1, color: "#4B5E82", label: "Today" }]}
      bands={[{ color: col + "26", points: steps.map((x) => ({ x, lo: Math.min(at(x, 1.25), at(x, 0.8)), hi: Math.max(at(x, 1.25), at(x, 0.8)) })) }]}
      series={[
        { color: "#7C8BA5", dashed: true, width: 2, points: m.model.line.slice(0, n + 3).map((y: number, i: number) => ({ x: i, y })) },
        { color: col, dashed: true, width: 2.4, points: [{ x: n - 1, y: lvl }, { x: end, y: at(end) }] },
        { color: "#60A5FA", width: 2.6, dots: true, points: pts.map((p: any, i: number) => ({ x: i, y: p.value })) },
      ]}
      markers={[
        ...anoms.map((a: any, k: number) => ({ x: a.idx, y: a.value, color: "#EF4444", ring: true, label: String(k + 1) })),
        ...pts.map((p: any, i: number) => (p.photo ? { x: i, y: p.value, color: "#22D3EE", square: true } : null)).filter(Boolean),
        ...(crosses ? [{ x: n - 1 + fc.months_to_limit, y: m.limit, color: col, r: 7 }] : []),
      ] as any}
    />
  );
}

export default function VehicleHistory({ params }: { params: Promise<{ plate: string }> }) {
  const { plate: raw } = use(params);
  const plate = decodeURIComponent(raw);
  const { data: d, reload } = useFetch<any>(`/api/fleet/vehicles/${encodeURIComponent(plate)}`);
  const ov = useFetch<any>("/api/fleet/overview");
  const [metric, setMetric] = useState<string | null>(null);
  const [zoom, setZoom] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setMetric(null), [plate]);
  const m = d ? (d.metrics.find((x: any) => x.metric === metric) || d.primary) : null;
  const v = d?.vehicle;
  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/api/fleet/vehicles/${encodeURIComponent(plate)}/report`);
      toast(`Pattern report for ${plate} sent to ${v.operator} and the driver app`);
      reload();
    } finally { setBusy(false); }
  };
  const book = async () => {
    setBusy(true);
    try {
      const [b] = await api.post("/api/fleet/bookings", { plates: [plate] });
      toast(b.status ? `${plate}: inspection booked ${dmy(b.date)} ${b.slot}, before the forecast fail date` : b.error);
      reload();
    } finally { setBusy(false); }
  };
  const col = m ? riskColor(m.risk) : "#9AA8BF";
  const anoms = m ? m.anomalies.filter((a: any) => a.kind !== "repair") : [];
  const fc = m?.forecast;
  return (
    <FleetShell pill="VEHICLE HISTORY">
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <Link href="/fleet" className="btn btn-sm">‹ Fleet Intelligence</Link>
        <h1 className="font-display text-[26px] font-semibold">Vehicle history &amp; degradation</h1>
        <span className="text-[13px] text-fg-3">History, anomalies, time-to-failure forecast and the pattern report for each flagged vehicle</span>
      </div>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {(ov.data?.attention || []).map((r: any) => (
          <Link key={r.plate} href={`/fleet/vehicle/${encodeURIComponent(r.plate)}`} aria-current={r.plate === plate ? "page" : undefined}
            className={`chip shrink-0 px-3 py-1.5 text-[12.5px] ${r.plate === plate ? "border-cyan bg-cyan/10 text-fg" : "border-ink-500 bg-ink-800 text-fg-2"}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: riskColor(r.issue.risk) }} />{r.plate}
          </Link>
        ))}
      </div>
      {!d ? <p className="text-fg-3">Loading…</p> : (
        <>
          <section className="card mb-3 flex flex-wrap items-center gap-5 p-4">
            {v.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/media/assets/${v.photo}`} alt={v.model} className="h-24 w-36 rounded-xl object-cover" />
            ) : <span className="flex h-24 w-36 items-center justify-center rounded-xl bg-ink-700 text-fg-4">{v.vtype}</span>}
            <div className="flex min-w-[190px] flex-col gap-1">
              <span className="font-display text-[24px] font-bold">{v.plate}</span>
              <span className="text-[14px] text-fg-2">{v.make} {v.model} · {v.vtype} · {v.year}</span>
              <span className="text-[13px] text-fg-3">{v.operator}</span>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-6 text-[13px]">
              <div><div className="text-fg-3">Odometer</div><b className="text-[17px]">{fmtN(v.odometer_km)} km</b><div className="text-[11.5px] text-fg-3">~{fmtN(v.km_per_month)} km a month</div></div>
              <div><div className="text-fg-3">Vehicle health</div><b className="text-[17px]" style={{ color: scoreColor(d.health) }}>{d.health}%</b><div className="text-[11.5px] text-fg-3">6 subsystems</div></div>
              <div><div className="text-fg-3">Pattern</div><b className="text-[15px]" style={{ color: col }}>{m?.pattern}</b><div className="max-w-[210px] truncate text-[11.5px] text-fg-3">{m?.ratio_text}</div></div>
              <span className="chip px-4 py-2 text-[14px]" style={{ borderColor: col, color: col, background: col + "1F" }}>{m?.risk} risk</span>
            </div>
          </section>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {d.metrics.map((x: any) => (
              <button key={x.metric} onClick={() => setMetric(x.metric)} aria-pressed={x.metric === m.metric}
                className={`chip ${x.metric === m.metric ? "border-cyan bg-cyan/10 text-fg" : "border-ink-500 text-fg-2"}`}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: x.attention ? riskColor(x.risk) : "#34D399" }} />{x.name}
              </button>
            ))}
          </div>
          <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
            <section className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[17px] font-semibold">{m.name} <span className="text-[13px] font-normal text-fg-3">({m.unit}) · 12 months of readings + forecast</span></h2>
                <Source kind="live_logic" text="Degradation analysis" />
              </div>
              <div className="my-2 flex flex-wrap gap-4 text-[12px] text-[#B7C5DA]">
                <span className="flex items-center gap-1.5"><span className="h-[3px] w-4 bg-[#60A5FA]" />Measured</span>
                <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[#7C8BA5]" />Normal wear model</span>
                <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: col }} />Forecast + range</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-[#EF4444]" />Anomaly</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 bg-cyan" />Photo on file</span>
              </div>
              <DegradationChart m={m} />
            </section>
            <div className="flex flex-col gap-3">
              <section className="card p-4" style={{ borderColor: col, background: `linear-gradient(135deg, ${col}22, #0F1A2E 70%)` }}>
                <h2 className="text-[15px] font-semibold text-fg-2">How long will it go?</h2>
                <div className="mt-1 font-display text-[34px] font-bold" style={{ color: col }}>{fc.weeks_label}</div>
                <div className="text-[13px] text-fg-2">{fc.date ? `until it reaches the fail limit (${m.limit} ${m.unit})` : "at the current drift; action needed anyway"}</div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
                  <div><div className="text-[11.5px] text-fg-3">Expected date</div><b>{fc.date ? dmy(fc.date) : "–"}</b></div>
                  <div><div className="text-[11.5px] text-fg-3">Likely range</div><b>{fc.range_weeks ? `${Math.round(fc.range_weeks[0])}–${Math.round(fc.range_weeks[1])} weeks` : "–"}</b></div>
                  <div><div className="text-[11.5px] text-fg-3">Distance left</div><b>{fc.km_left != null ? `~${fmtN(fc.km_left)} km` : "–"}</b></div>
                </div>
                <p className="mt-3 text-[12.5px] text-[#B7C5DA]">Line through the last 4 readings ({fc.slope_per_month > 0 ? "+" : ""}{fc.slope_per_month} {m.unit} a month). The range allows the rate to run 25% faster or 20% slower.</p>
              </section>
              <section className="card flex-1 p-4">
                <h2 className="mb-2 text-[15px] font-semibold">Anomalies detected <span className="text-[12.5px] font-normal text-fg-3">{anoms.length || "none"}</span></h2>
                {!anoms.length && <p className="text-[13px] text-[#B7C5DA]">No anomalies. The readings follow the normal wear model; the forecast is a straight projection.</p>}
                {anoms.map((a: any, k: number) => (
                  <div key={k} className="flex gap-2.5 border-t border-[#16233B] py-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#EF4444] text-[11px] font-bold">{k + 1}</span>
                    <div className="text-[12.5px]">
                      <b>{dmy(a.date)} · {a.value} {m.unit}</b> <span className="text-[#FCA5A5]">{a.deviation > 0 ? "+" : ""}{a.deviation} vs model</span>
                      <div className="text-[#B7C5DA]">{a.text}{a.context ? `. Recorded: ${a.context}.` : "."}</div>
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.15fr)_260px_minmax(0,1fr)]">
            <section className="card p-4">
              <h2 className="mb-2 text-[15px] font-semibold">Inspection history</h2>
              <table className="w-full text-left text-[12.5px]">
                <thead className="text-fg-3"><tr><th className="pb-1">Date</th><th>Check</th><th>Reading</th><th>Result</th></tr></thead>
                <tbody>
                  {d.checks.map((c: any, i: number) => (
                    <tr key={i} className="border-t border-[#16233B]">
                      <td className="py-1.5">{dmy(c.date)}</td>
                      <td><b>{c.kind}</b><div className="text-[11.5px] text-fg-3">{c.photo ? "Photo on file · " : ""}{c.note || "Scheduled"}</div></td>
                      <td><b>{c.value} {c.unit.length < 5 ? c.unit : ""}</b></td>
                      <td><span className="chip border-transparent" style={{ color: c.result === "Pass" ? "#6EE7B7" : c.result === "Advisory" ? "#FCD34D" : "#FCA5A5", background: c.result === "Pass" ? "rgba(16,185,129,.15)" : c.result === "Advisory" ? "rgba(245,158,11,.15)" : "rgba(239,68,68,.15)" }}>{c.result}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3">
                <div className="mb-1.5 flex justify-between text-[13px]"><b>{d.photos.length ? "Visual history: same spot over time" : "Evidence photos"}</b><span className="text-[11px] text-fg-3">Click to enlarge</span></div>
                <div className="flex gap-2">
                  {(d.photos.length ? d.photos.map((p: any) => ({ src: `/media/assets/${p.photo}`, l: lab(p.date), v: `${p.value} ${p.unit}` }))
                    : (v.evidence || []).map((e: string, i: number) => ({ src: `/media/assets/${e}`, l: i === 0 ? "Close-up (AI)" : "Lane camera", v: "" }))).map((p: any, i: number) => (
                    <button key={i} onClick={() => setZoom(p)} className="max-w-[140px] flex-1 overflow-hidden rounded-lg border border-ink-500 bg-ink-850 text-left">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.src} alt={p.l} className="h-20 w-full object-cover" />
                      <span className="flex justify-between px-2 py-1 text-[11.5px]"><b>{p.l}</b><span className="text-[#FCA5A5]">{p.v}</span></span>
                    </button>
                  ))}
                  {!d.photos.length && !(v.evidence || []).length && <p className="text-[12px] text-fg-3">No photos on file for this vehicle - readings only.</p>}
                </div>
              </div>
            </section>
            <section className="card p-4">
              <h2 className="mb-2 text-[15px] font-semibold">Subsystem health</h2>
              {Object.entries(d.subsystems).map(([k, val]: any) => (
                <div key={k} className="mb-2.5">
                  <div className="flex justify-between text-[12.5px]"><span className={k === m.system ? "font-bold" : ""}>{k}</span><b style={{ color: scoreColor(val) }}>{val}</b></div>
                  <Bar value={val} color={scoreColor(val)} />
                </div>
              ))}
            </section>
            <section className="card flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Pattern report</h2><span className="text-[11.5px] text-fg-3">Auto-generated</span></div>
              <p className="rounded-lg border border-ink-600 bg-ink-850 p-3 text-[12.5px] leading-relaxed">{d.report.text}</p>
              <div className="flex flex-col gap-1 text-[12px]">
                {d.report.recipients.map((r: any) => (
                  <div key={r.who} className="flex justify-between gap-3"><span className="text-[#B7C5DA]">{r.who}</span><span className="text-right font-semibold" style={{ color: r.ok ? "#34D399" : "#FCD34D" }}>{r.status}</span></div>
                ))}
              </div>
              <p className="text-[11.5px] text-fg-3">{d.report.rule}</p>
              <div className="mt-auto flex gap-2">
                <button className="btn btn-primary flex-1" disabled={busy} onClick={send}>{d.report.sent_at ? "Report sent ✓ · send again" : "Send report now"}</button>
                <button className="btn flex-1 border-[#2F7BFF] text-[#9CC3FF]" disabled={busy || !!v.booked} onClick={book}>{v.booked ? `Booked ${dmy(v.booked.date)}` : "Book inspection"}</button>
              </div>
            </section>
          </div>
        </>
      )}
      <Modal open={!!zoom} onClose={() => setZoom(null)} title={zoom ? `${plate} · ${zoom.l} ${zoom.v}` : ""}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {zoom && <img src={zoom.src} alt={zoom.l} className="max-h-[75vh] rounded-lg" />}
      </Modal>
      <span className="hidden"><Pill>.</Pill></span>
    </FleetShell>
  );
}
