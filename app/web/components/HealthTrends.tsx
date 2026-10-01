"use client";
/* A vehicle's health trends (Vehicle Records → Health trends): twelve months of readings per subsystem, anomalies, a
   time-to-limit forecast with its range, the latest inspection, the pattern report and the booking before the fail
   date. Fleet vehicles only: their readings come from the fleet's telematics and earlier inspections. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { LineChart } from "@/components/charts";
import { Icon } from "@/components/icons";
import { ImageCard, ImageViewer, LibImage } from "@/components/ImageViewer";
import { NextAction, refreshUseCase, useActiveUseCase } from "@/components/Demo";
import { Bar, LoadingState, Modal, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { dmy, fmtN, riskColor, scoreColor } from "@/lib/format";
import { useFetch } from "@/lib/live";
import { VERDICT } from "@/lib/present";

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
  for (let i = 0; i <= Math.ceil(end); i += 2) xl.push({ x: i, label: lab(addMonths(pts[0].date, i)), color: i > n - 1 ? "#3B82F6" : undefined });
  const col = riskColor(m.risk);
  const anoms = m.anomalies.filter((a: any) => a.kind !== "repair");
  const crosses = fc.months_to_limit != null && fc.months_to_limit <= 6;
  return (
    <LineChart height={300} yMin={Math.min(lo, m.limit) - Math.abs(hi - lo) * 0.08} yMax={Math.max(hi, m.limit) + Math.abs(hi - lo) * 0.08}
      yFmt={(v) => (Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0))} xLabels={xl}
      hlines={[{ y: m.limit, color: "#DC2626", label: `Fail limit ${m.limit} ${m.unit}` }]}
      vlines={[{ x: n - 1, color: "#94A3B8", label: "Today" }]}
      bands={[{ color: col + "26", points: steps.map((x) => ({ x, lo: Math.min(at(x, 1.25), at(x, 0.8)), hi: Math.max(at(x, 1.25), at(x, 0.8)) })) }]}
      series={[
        { color: "#94A3B8", dashed: true, width: 2, points: m.model.line.slice(0, n + 3).map((y: number, i: number) => ({ x: i, y })) },
        { color: col, dashed: true, width: 2.4, points: [{ x: n - 1, y: lvl }, { x: end, y: at(end) }] },
        { color: "#3B82F6", width: 2.6, dots: true, points: pts.map((p: any, i: number) => ({ x: i, y: p.value })) },
      ]}
      markers={[
        ...anoms.map((a: any, k: number) => ({ x: a.idx, y: a.value, color: "#DC2626", ring: true, label: String(k + 1) })),
        ...pts.map((p: any, i: number) => (p.photo ? { x: i, y: p.value, color: "#2563EB", square: true } : null)).filter(Boolean),
        ...(crosses ? [{ x: n - 1 + fc.months_to_limit, y: m.limit, color: col, r: 7 }] : []),
      ] as any}
    />
  );
}

export function HealthTrends({ plate }: { plate: string }) {
  const { data: d, reload, error } = useFetch<any>(`/api/fleet/vehicles/${encodeURIComponent(plate)}`);
  const [metric, setMetric] = useState<string | null>(null);
  const [zoom, setZoom] = useState<any>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const { active: uc } = useActiveUseCase();
  const user = useUser();
  const canBook = user?.role === "presenter" || user?.role === "fleet";
  useEffect(() => setMetric(null), [plate]);
  const m = d ? (d.metrics.find((x: any) => x.metric === metric) || d.primary) : null;
  const v = d?.vehicle;
  const images: LibImage[] = d?.images || [];
  const progression = images.findIndex((e) => e.kind === "progression");
  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/api/fleet/vehicles/${encodeURIComponent(plate)}/report`);
      toast(`Pattern report for ${plate} sent to ${v.operator} and the driver app`, "ok");
      reload();
    } finally { setBusy(false); }
  };
  const book = async () => {
    setBusy(true);
    try {
      const [b] = await api.post("/api/fleet/bookings", { plates: [plate] });
      toast(b.status ? `${plate}: inspection booked ${dmy(b.date)} ${b.slot}, before the forecast fail date` : b.error, b.status ? "ok" : "err");
      reload();
      refreshUseCase();
    } finally { setBusy(false); }
  };
  const col = m ? riskColor(m.risk) : "#64748B";
  const anoms = m ? m.anomalies.filter((a: any) => a.kind !== "repair") : [];
  const fc = m?.forecast;
  if (error) return <p className="card card-pad text-[13.5px] text-fg-3">No health readings for {plate}.</p>;
  return (
    <>
      {d && (canBook && !d.bookings?.length || uc?.plate === plate) ? (
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          {canBook && !d.bookings?.length && <button className="btn btn-primary" disabled={busy} onClick={book}>Book an inspection before the fail date<Icon name="arrow" size={15} /></button>}
          {uc?.plate === plate && (d.bookings?.length || !canBook) ? <NextAction uc={uc} here={`/vehicles/${encodeURIComponent(plate)}`} /> : null}
        </div>
      ) : null}
      {!d ? <div className="card card-pad"><LoadingState label={`Loading the history of ${plate}…`} rows={4} /></div> : (
        <>
          <section className="card mb-3 flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]" aria-label="Latest inspection and next action">
            {d.lane_reports?.[0] ? (() => {
              const r = d.lane_reports[0];
              return (
                <>
                  <span className="label">Latest inspection</span>
                  <b style={{ color: VERDICT[r.verdict]?.color }}>{r.verdict}</b>
                  <span>{r.kind} · {dmy(r.issued_at || r.created_at)}{r.health != null ? ` · health ${r.health}` : ""}</span>
                  {r.findings?.length > 0 && <span className="text-fg-3">· {r.findings.slice(0, 3).join("; ")}</span>}
                  <span className="ml-auto flex gap-2"><Link className="btn btn-sm" href={`/report?id=${r.report_id}`}>Report</Link><Link className="btn btn-sm" href={`/verify/${r.verify_token}`}>Verify</Link></span>
                </>
              );
            })() : d.bookings?.length ? (
              <>
                <span className="label">Next action</span>
                <b className="text-cyan">Inspection booked</b>
                <span>{d.bookings[0].type_label} · {dmy(d.bookings[0].date)} {d.bookings[0].slot} · {d.bookings[0].branch_name}</span>
                <span className="text-fg-3">· {d.bookings[0].status === "checked_in" ? "checked in at the lane" : "confirmed"}</span>
              </>
            ) : (
              <><span className="label">Next action</span><span className="text-fg-3">No inspection booked. The forecast below says how long this vehicle has before it reaches its fail limit.</span></>
            )}
          </section>
          <section className="card mb-3 flex flex-wrap items-center gap-6 p-4 text-[13px]">
            <div><div className="text-fg-3">Odometer</div><b className="text-[17px]">{fmtN(v.odometer_km)} km</b><div className="text-[11.5px] text-fg-3">~{fmtN(v.km_per_month)} km a month</div></div>
            <div><div className="text-fg-3">Vehicle health</div><b className="text-[17px]" style={{ color: scoreColor(d.health) }}>{d.health}%</b><div className="text-[11.5px] text-fg-3">6 subsystems</div></div>
            <div><div className="text-fg-3">Pattern</div><b className="text-[15px]" style={{ color: col }}>{m?.pattern}</b><div className="max-w-[260px] truncate text-[11.5px] text-fg-3">{m?.ratio_text}</div></div>
            <div><div className="text-fg-3">Operator</div><b className="text-[15px]">{v.operator}</b></div>
            <span className="chip ml-auto px-4 py-2 text-[14px]" style={{ borderColor: col, color: col, background: col + "1F" }}>{m?.risk} risk</span>
          </section>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {d.metrics.map((x: any) => (
              <button key={x.metric} onClick={() => setMetric(x.metric)} aria-pressed={x.metric === m.metric}
                className={`chip ${x.metric === m.metric ? "border-cyan bg-cyan/10 text-fg" : "border-ink-500 text-fg-2"}`}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: x.attention ? riskColor(x.risk) : "#059669" }} />{x.name}
              </button>
            ))}
          </div>
          <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
            <section className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[17px] font-semibold">{m.name} <span className="text-[13px] font-normal text-fg-3">({m.unit}) · 12 months of readings + forecast</span></h2>
                <Source kind="live_logic" text="Degradation analysis" />
              </div>
              <div className="my-2 flex flex-wrap gap-4 text-[12px] text-[#475569]">
                <span className="flex items-center gap-1.5"><span className="h-[3px] w-4 bg-[#3B82F6]" />Measured</span>
                <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[#94A3B8]" />Normal wear model</span>
                <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: col }} />Forecast + range</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-[#DC2626]" />Anomaly</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 bg-cyan" />Photo on file</span>
              </div>
              <DegradationChart m={m} />
            </section>
            <div className="flex flex-col gap-3">
              <section className="card p-4" style={{ borderColor: col, background: `linear-gradient(135deg, ${col}22, #FFFFFF 70%)` }}>
                <h2 className="text-[15px] font-semibold text-fg-2">How long will it go?</h2>
                <div className="mt-1 font-display text-[34px] font-bold" style={{ color: col }}>{fc.weeks_label}</div>
                <div className="text-[13px] text-fg-2">{fc.date ? `until it reaches the fail limit (${m.limit} ${m.unit})` : "at the current drift; action needed anyway"}</div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
                  <div><div className="text-[11.5px] text-fg-3">Expected date</div><b>{fc.date ? dmy(fc.date) : "–"}</b></div>
                  <div><div className="text-[11.5px] text-fg-3">Likely range</div><b>{fc.range_weeks ? `${Math.round(fc.range_weeks[0])}–${Math.round(fc.range_weeks[1])} weeks` : "–"}</b></div>
                  <div><div className="text-[11.5px] text-fg-3">Distance left</div><b>{fc.km_left != null ? `~${fmtN(fc.km_left)} km` : "–"}</b></div>
                </div>
                <p className="mt-3 text-[12.5px] text-[#475569]">Line through the last 4 readings ({fc.slope_per_month > 0 ? "+" : ""}{fc.slope_per_month} {m.unit} a month). The range allows the rate to run 25% faster or 20% slower.</p>
              </section>
              <section className="card flex-1 p-4">
                <h2 className="mb-2 text-[15px] font-semibold">Anomalies detected <span className="text-[12.5px] font-normal text-fg-3">{anoms.length || "none"}</span></h2>
                {!anoms.length && <p className="text-[13px] text-[#475569]">No anomalies. The readings follow the normal wear model; the forecast is a straight projection.</p>}
                {anoms.map((a: any, k: number) => (
                  <div key={k} className="flex gap-2.5 border-t border-[#E8EDF4] py-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#DC2626] text-[11px] font-bold">{k + 1}</span>
                    <div className="text-[12.5px]">
                      <b>{dmy(a.date)} · {a.value} {m.unit}</b> <span className="text-[#DC2626]">{a.deviation > 0 ? "+" : ""}{a.deviation} vs model</span>
                      <div className="text-[#475569]">{a.text}{a.context ? `. Recorded: ${a.context}.` : "."}</div>
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </div>
          {images.length > 0 && (
            <section className="card mb-3 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold">Inspection images <span className="text-[12.5px] font-normal text-fg-3">· what the lane cameras and inspectors captured on {plate}</span></h2>
                <Source kind="sample" text="Sample images · AI boxes pre-drawn" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {images.map((e, k) => <ImageCard key={e.id} e={e} compact onOpen={() => setViewer(k)} />)}
              </div>
            </section>
          )}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.15fr)_260px_minmax(0,1fr)]">
            <section className="card p-4">
              <h2 className="mb-2 text-[15px] font-semibold">Inspection history</h2>
              <table className="w-full text-left text-[12.5px]">
                <thead className="text-fg-3"><tr><th className="pb-1">Date</th><th>Check</th><th>Reading</th><th>Result</th></tr></thead>
                <tbody>
                  {d.checks.map((c: any, i: number) => (
                    <tr key={i} className="border-t border-[#E8EDF4]">
                      <td className="py-1.5">{dmy(c.date)}</td>
                      <td><b>{c.kind}</b><div className="text-[11.5px] text-fg-3">{c.photo ? "Photo on file · " : ""}{c.note || "Scheduled"}</div></td>
                      <td><b>{c.value} {c.unit.length < 5 ? c.unit : ""}</b></td>
                      <td><span className="chip border-transparent" style={{ color: c.result === "Pass" ? "#047857" : c.result === "Advisory" ? "#B45309" : "#DC2626", background: c.result === "Pass" ? "rgba(5,150,105,.10)" : c.result === "Advisory" ? "rgba(217,119,6,.10)" : "rgba(220,38,38,.10)" }}>{c.result}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3">
                <div className="mb-1.5 flex justify-between text-[13px]"><b>{d.photos.length ? "Visual history: same spot over time" : "Evidence photos"}</b>{(d.photos.length > 0 || (v.evidence || []).length > 0) && <span className="text-[11px] text-fg-3">Click to enlarge</span>}</div>
                <div className="flex gap-2">
                  {(d.photos.length ? d.photos.map((p: any) => ({ src: `/media/assets/${p.photo}`, l: lab(p.date), v: `${p.value} ${p.unit}` }))
                    : (v.evidence || []).map((e: string, i: number) => ({ src: `/media/assets/${e}`, l: i === 0 ? "Close-up (AI)" : "Lane camera", v: "" }))).map((p: any, i: number) => (
                    <button key={i} onClick={() => (d.photos.length && progression >= 0 ? setViewer(progression) : images.length ? setViewer(0) : setZoom(p))}
                      className="max-w-[140px] flex-1 overflow-hidden rounded-lg border border-ink-500 bg-ink-850 text-left transition hover:border-cyan/70">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.src} alt={p.l} className="h-20 w-full object-cover" />
                      <span className="flex justify-between px-2 py-1 text-[11.5px]"><b>{p.l}</b><span className="text-[#DC2626]">{p.v}</span></span>
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
                  <div key={r.who} className="flex justify-between gap-3"><span className="text-[#475569]">{r.who}</span><span className="text-right font-semibold" style={{ color: r.ok ? "#059669" : "#B45309" }}>{r.status}</span></div>
                ))}
              </div>
              <p className="text-[11.5px] text-fg-3">{d.report.rule}</p>
              <div className="mt-auto flex gap-2">
                <button className="btn flex-1" disabled={busy || !canBook} onClick={send}>{d.report.sent_at ? "Report sent ✓ · send again" : "Send report now"}</button>
                <button className="btn flex-1" disabled={busy || !!v.booked || !canBook} onClick={book}>{v.booked ? `Booked ${dmy(v.booked.date)}` : "Book inspection"}</button>
              </div>
            </section>
          </div>
        </>
      )}
      <ImageViewer items={images} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      <Modal open={!!zoom} onClose={() => setZoom(null)} title={zoom ? `${plate} · ${zoom.l} ${zoom.v}` : ""}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {zoom && <img src={zoom.src} alt={zoom.l} className="max-h-[75vh] rounded-lg" />}
      </Modal>
    </>
  );
}
