"use client";
import { useState } from "react";
import { Bars, LineChart } from "@/components/charts";
import { Shell } from "@/components/Shell";
import { Card, Kpi, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtN, pct } from "@/lib/format";
import { useFetch } from "@/lib/live";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Peninsular + East Malaysia bounding box for the simple map projection
const BB = { lon0: 99.5, lon1: 119.5, lat0: 0.8, lat1: 7.5 };
// Approximate coastline / border outlines (lon, lat) - illustrative only
const PENINSULAR: [number, number][] = [[100.13, 6.44], [100.4, 6.6], [100.8, 6.3], [101.1, 5.9], [101.6, 5.8], [102.1, 6.2], [102.35, 6.15],
  [103.1, 5.5], [103.4, 4.8], [103.45, 4.2], [103.4, 3.8], [103.8, 2.6], [104.2, 1.9], [104.25, 1.4], [103.5, 1.27], [103.0, 1.6],
  [102.5, 2.0], [101.9, 2.5], [101.3, 2.9], [101.1, 3.4], [100.7, 3.9], [100.6, 4.4], [100.35, 5.0], [100.4, 5.5], [100.3, 6.0]];
const BORNEO: [number, number][] = [[109.6, 1.9], [110.3, 1.7], [111.0, 1.6], [111.4, 2.4], [113.0, 3.1], [114.0, 4.6], [115.0, 5.0],
  [115.4, 5.3], [116.0, 6.0], [116.8, 7.0], [117.3, 6.6], [117.7, 6.4], [118.1, 5.8], [119.2, 5.2], [118.6, 4.4], [117.6, 4.2],
  [116.0, 4.3], [115.6, 4.0], [115.0, 2.5], [114.5, 1.5], [113.0, 1.2], [112.0, 1.0], [111.0, 1.0], [110.0, 0.95], [109.6, 1.5]];

function MalaysiaMap({ branches, sites }: { branches: any[]; sites: any[] }) {
  const W = 900, H = 320;
  const x = (lon: number) => ((lon - BB.lon0) / (BB.lon1 - BB.lon0)) * W;
  const y = (lat: number) => H - ((lat - BB.lat0) / (BB.lat1 - BB.lat0)) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl bg-ink-950" role="img" aria-label="Branch and roadside-sensing map">
      {/* simplified outlines (approximate lon/lat) */}
      {[PENINSULAR, BORNEO].map((poly, i) => (
        <path key={i} d={"M" + poly.map(([lo, la]) => `${x(lo).toFixed(1)} ${y(la).toFixed(1)}`).join(" L") + " Z"} fill="#132038" stroke="#2A3957" />
      ))}
      {branches.filter((b) => b.lat).map((b) => (
        <g key={b.branch_id}>
          <circle cx={x(b.lon)} cy={y(b.lat)} r={4 + b.fail_rate * 30} fill="#F59E0B" opacity="0.35" />
          <circle cx={x(b.lon)} cy={y(b.lat)} r="3" fill="#FBBF24"><title>{`${b.name}: fail rate ${pct(b.fail_rate)} of ${b.inspections}`}</title></circle>
        </g>
      ))}
      {sites.map((s) => (
        <g key={s.site}>
          <rect x={x(s.lon) - 5} y={y(s.lat) - 5} width="10" height="10" fill="#F87171" transform={`rotate(45 ${x(s.lon)} ${y(s.lat)})`}><title>{`${s.site}: ${s.high_emitters} high emitters / ${s.readings}`}</title></rect>
        </g>
      ))}
    </svg>
  );
}

export default function Regulator() {
  const { data: r, reload } = useFetch<any>("/api/regulator");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    const res = await api.post("/api/regulator/refresh-web").finally(() => setBusy(false));
    toast(res.updated.length ? `Updated from data.gov.my: ${res.updated.join(", ")}` : `Offline - kept the snapshot (${Object.keys(res.errors).length} feeds unreachable)`);
    reload();
  };
  const reg = r?.registrations;
  const fuel = r?.web?.fuelprice?.records?.[0] || r?.web?.fuelprice?.records?.data?.[0];
  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold">Regulator view · JPJ / DOE</h1>
          <p className="text-[13px] text-fg-3">Registrations, defect trends, emissions and EV incidents (session S5).</p>
        </div>
        <button className="btn" disabled={busy} onClick={refresh}>{busy ? "Refreshing…" : "Refresh live data.gov.my feeds"}</button>
      </div>
      {!r ? <p className="text-fg-3">Loading…</p> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="New registrations 2025" value={fmtN(reg.total)} sub="JPJ via data.gov.my" right={<Source kind="real" text="Real" />} />
            <Kpi label="Cars · motorcycles 2025" value={`${fmtN(reg.by_category.car / 1000)}k · ${fmtN(reg.by_category.motorcycle / 1000)}k`} sub="by category" right={<Source kind="real" text="Real" />} />
            <Kpi label="Fail rate (last month)" value={pct(r.defects.monthly.at(-1)?.fail_rate, 1)} sub={`${fmtN(r.defects.monthly.at(-1)?.inspections)} inspections`} right={<Source kind="synthetic" text="Synthetic" />} />
            <Kpi label="Roadside high emitters" value={fmtN(r.remote_sensing.high_emitters)} sub={`of ${fmtN(r.remote_sensing.total)} plume readings`} right={<Source kind="simulated" text="Simulated" />} />
            <Kpi label="EV inspections flagged" value={fmtN(r.ev.flagged)} sub={`of ${fmtN(r.ev.inspections)} · ${r.ev.live_alerts} live EV alerts`} right={<Source kind="synthetic" text="Synthetic + live" />} />
          </div>
          <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="New vehicle registrations by month, 2025" right={<Source kind="real" text={`Real · data.gov.my (${reg.fetched_at?.slice(0, 10)})`} />}>
              <Bars height={200} values={reg.monthly_2025} labels={MON} fmt={(v) => fmtN(v)} color="#34D399" />
              <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-fg-3">
                {Object.entries(reg.top_states).map(([k, v]: any) => <span key={k} className="chip border-ink-500">{k} {fmtN(v)}</span>)}
              </div>
            </Card>
            <Card title="Inspection fail rate and top defects" right={<Source kind="synthetic" />}>
              <LineChart height={150} yFmt={(v) => pct(v)} xLabels={r.defects.monthly.map((m: any, i: number) => ({ x: i, label: m.month.slice(2) }))} xTickEvery={2}
                series={[{ color: "#F87171", dots: true, points: r.defects.monthly.map((m: any, i: number) => ({ x: i, y: m.fail_rate })) }]} />
              <div className="mt-3 flex flex-col gap-1.5">
                {r.defects.top_reasons.map((d: any) => {
                  const mx = r.defects.top_reasons[0].count;
                  return (
                    <div key={d.reason} className="grid grid-cols-[150px_1fr_50px] items-center gap-2 text-[12.5px]">
                      <span>{d.reason.replaceAll("_", " ")}</span>
                      <div className="h-2 rounded bg-ink-600"><div className="h-2 rounded bg-warn" style={{ width: `${(100 * d.count) / mx}%` }} /></div>
                      <span className="text-right text-fg-3">{d.count}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Card title="Branches (fail rate) and roadside remote-sensing sites" right={<><Source kind="synthetic" text="Branches: synthetic" /><Source kind="simulated" text="Sites: simulated" /></>}>
              <MalaysiaMap branches={r.branches} sites={r.remote_sensing.sites} />
              <div className="mt-2 flex gap-4 text-[11.5px] text-fg-3"><span><span className="text-warn">●</span> branch (size = fail rate)</span><span><span className="text-bad">◆</span> remote-sensing site</span></div>
            </Card>
            <Card title="High-emitter hits (latest)" right={<Source kind="simulated" />}>
              <table className="w-full text-left text-[12.5px]">
                <thead className="text-fg-3"><tr><th>Time</th><th>Site</th><th>Plate</th><th>HC ppm</th><th>Smoke</th></tr></thead>
                <tbody>
                  {r.remote_sensing.hits.map((h: any, i: number) => (
                    <tr key={i} className="border-t border-ink-600"><td className="py-1.5">{String(h.timestamp).slice(5, 16)}</td><td>{h.site}</td><td><b>{h.plate}</b></td><td>{h.hc_ppm}</td><td>{h.pm_uv_smoke}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
          <Card title="Live public data" right={<Source kind={r.web.mode === "live" ? "real" : "real"} text={r.web.mode === "live" ? `Live · refreshed ${r.web.refreshed_at}` : "Snapshot (offline) · data.gov.my"} />}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-[13px]">
              <div className="rounded-lg border border-ink-600 bg-ink-850 p-3">
                <div className="label mb-1">Fuel price (RM/litre)</div>
                {fuel ? <div>RON95 <b>{fuel.ron95}</b> · RON97 <b>{fuel.ron97}</b> · Diesel <b>{fuel.diesel}</b> <span className="text-fg-3">({fuel.date})</span></div> : "–"}
              </div>
              <div className="rounded-lg border border-ink-600 bg-ink-850 p-3">
                <div className="label mb-1">Weather warnings</div>
                {JSON.stringify(r.web.weather_warnings).length > 30 ? <div className="max-h-24 overflow-auto text-[12px] text-fg-2">{(r.web.weather_warnings.records || r.web.weather_warnings.data || []).slice?.(0, 3).map((w: any, i: number) => <div key={i}>{w.warning_issue?.title_en || w.title_en || JSON.stringify(w).slice(0, 90)}</div>)}</div> : "No active warnings in the snapshot"}
              </div>
              <div className="rounded-lg border border-ink-600 bg-ink-850 p-3">
                <div className="label mb-1">JPS flood stations</div>
                <div className="text-[12px] text-fg-2">{(r.web.flood_stations.records || r.web.flood_stations.data || []).length || 0} stations in the snapshot (used for flood-risk context).</div>
              </div>
            </div>
          </Card>
        </>
      )}
    </Shell>
  );
}
