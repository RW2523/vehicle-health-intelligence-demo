"use client";
/* Oversight > Regulator: national registrations (real, data.gov.my), inspection fail rates and defects, roadside
   emissions and EV incidents, with the hubs and roadside sites on a map. */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bars, LineChart } from "@/components/charts";
import { Panel } from "@/components/glass";
import { Icon } from "@/components/icons";
import { LiveMap, MapPoint } from "@/components/LiveMap";
import { OversightShell } from "@/components/OversightShell";
import { ErrorState, LoadingState, PageHeader, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtN, pct } from "@/lib/format";
import { useFetch } from "@/lib/live";
import { OvStat, THEAD, TROW, TableBox } from "../parts";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CAT_COL: Record<string, string> = { car: "#2563EB", motorcycle: "#0EA5E9", lorry: "#7C3AED", van: "#059669", trailer: "#D97706", other: "#94A3B8" };

function BranchMap({ branches, sites }: { branches: any[]; sites: any[] }) {
  const points = useMemo<MapPoint[]>(() => [
    ...branches.filter((b) => b.lat != null).map((b): MapPoint => ({
      id: b.branch_id, layer: "hubs", lat: b.lat, lon: b.lon, color: b.fail_rate >= 0.25 ? "#DC2626" : b.fail_rate >= 0.18 ? "#D97706" : "#059669",
      shape: "area", radius: 5 + b.fail_rate * 40, title: b.name, lines: [`Fail rate ${pct(b.fail_rate)} of ${fmtN(b.inspections)} inspections`],
    })),
    ...sites.map((s): MapPoint => ({
      id: s.site, layer: "sites", lat: s.lat, lon: s.lon, color: "#DC2626", shape: "diamond", radius: 5, title: s.site,
      lines: [`${fmtN(s.high_emitters)} high emitters of ${fmtN(s.readings)} plume readings`, `HC ${fmtN(s.hc, 0)} ppm · NO ${fmtN(s.no, 0)} ppm · smoke ${s.smoke}`],
    })),
  ], [branches, sites]);
  return (
    <LiveMap label="Branch and roadside-sensing map" points={points} className="h-[380px] lg:h-[440px]"
      views={[{ id: "kv", label: "Klang Valley", bounds: [[2.85, 101.35], [3.4, 101.85]] }, { id: "my", label: "Malaysia", bounds: [[0.85, 99.6], [7.45, 119.3]] }]}
      layers={[{ id: "hubs", label: "Hubs", color: "#D97706", count: branches.length }, { id: "sites", label: "Roadside sites", color: "#DC2626", count: sites.length }]}
      legend={[{ label: "Hub, size = fail rate (under 18%)", color: "#059669", shape: "area" }, { label: "18–25%", color: "#D97706", shape: "area" }, { label: "25% and over", color: "#DC2626", shape: "area" }, { label: "Remote-sensing site", color: "#DC2626", shape: "diamond" }]} />
  );
}

export default function Regulator() {
  const { data: r, error, reload } = useFetch<any>("/api/regulator");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try {
      const res = await api.post("/api/regulator/refresh-web");
      toast(res.updated.length ? `Live from data.gov.my: ${res.updated.join(", ").replaceAll("_", " ")} (see "Live public data" below)`
        : `data.gov.my is unreachable - kept the snapshot (${Object.keys(res.errors).length} feeds)`, res.updated.length ? "ok" : "err");
      reload();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  const reg = r?.registrations;
  const fuel = r?.web?.fuelprice?.records?.[0] || r?.web?.fuelprice?.records?.data?.[0];
  const cats = reg ? (Object.entries(reg.by_category) as [string, number][]).sort((a, b) => b[1] - a[1]) : [];
  const last = r?.defects.monthly.at(-1);
  const prev = r?.defects.monthly.at(-2);
  const failDelta = last && prev ? last.fail_rate - prev.fail_rate : null;
  return (
    <OversightShell>
      <PageHeader eyebrow="Oversight · Regulator" title="Regulator view" sub="Registrations, defect trends, roadside emissions and EV incidents across Malaysia."
        actions={<button className="btn" disabled={busy} onClick={refresh}><Icon name="refresh" size={15} />{busy ? "Refreshing…" : "Refresh live data.gov.my feeds"}</button>} />
      {!r ? (error ? <ErrorState title="The regulator view could not load" onRetry={reload}>{error}</ErrorState> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="card p-4"><LoadingState label="" rows={2} /></div>)}
          <div className="card col-span-2 p-5 lg:col-span-5"><LoadingState label="Loading registrations, defects and roadside readings…" rows={4} /></div>
        </div>
      )) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
            <OvStat icon="car" tone="green" label="New registrations 2025" value={fmtN(reg.total)} sub="National registrations · data.gov.my" source={<Source kind="real" text="Real" />} />
            <OvStat icon="bike" tone="sky" label="Cars · motorcycles 2025" value={`${fmtN(reg.by_category.car / 1000)}k · ${fmtN(reg.by_category.motorcycle / 1000)}k`} sub="by category" source={<Source kind="real" text="Real" />} />
            <OvStat icon="warn" tone="red" alert label="Fail rate (last month)" value={pct(last?.fail_rate, 1)}
              sub={<>{fmtN(last?.inspections)} inspections{failDelta != null && (Math.abs(failDelta) < 0.0005 ? <span> · as the month before</span>
                : <span className={failDelta > 0 ? "font-semibold text-bad" : "font-semibold text-ok"}> · {failDelta > 0 ? "▲" : "▼"} {Math.abs(failDelta * 100).toFixed(1)} pts</span>)}</>}
              source={<Source kind="synthetic" text="Synthetic" />} />
            <OvStat icon="smoke" tone="amber" label="Roadside high emitters" value={fmtN(r.remote_sensing.high_emitters)} sub={`of ${fmtN(r.remote_sensing.total)} plume readings`} source={<Source kind="simulated" text="Simulated" />} />
            <OvStat icon="batt" tone="purple" label="EV inspections flagged" value={fmtN(r.ev.flagged)} sub={`of ${fmtN(r.ev.inspections)} · ${r.ev.live_alerts} live EV alerts`} source={<Source kind="synthetic" text="Synthetic + live" />} />
          </div>

          <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="New vehicle registrations by month, 2025" action={<Source kind="real" text={`Real · data.gov.my (${reg.fetched_at?.slice(0, 10)})`} />}>
              <Bars height={200} values={reg.monthly_2025} labels={MON} fmt={(v) => fmtN(v)} color="#059669" />
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="label mb-2">By category</div>
                  <ul className="flex flex-col gap-1.5">
                    {cats.map(([k, v]) => (
                      <li key={k} className="grid grid-cols-[80px_minmax(0,1fr)_64px] items-center gap-2 text-[12.5px]">
                        <span className="capitalize text-fg-2">{k}</span>
                        <span className="h-2 overflow-hidden rounded-full bg-[#E8EEF7]"><span className="block h-2 rounded-full" style={{ width: `${Math.max(1.5, (100 * v) / cats[0][1])}%`, background: CAT_COL[k] || "#94A3B8" }} /></span>
                        <span className="text-right font-semibold tabular-nums">{fmtN(v)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="label mb-2">Top states</div>
                  <div className="flex flex-wrap gap-1.5 text-[12px]">
                    {Object.entries(reg.top_states).map(([k, v]: any) => <span key={k} className="pill bg-white/80 text-fg-2 ring-1 ring-ink-600">{k} <b className="ml-1 text-fg">{fmtN(v)}</b></span>)}
                  </div>
                </div>
              </div>
            </Panel>
            <Panel title="Inspection fail rate and top defects" action={<Source kind="synthetic" />}>
              <LineChart height={150} yFmt={(v) => pct(v)} xLabels={r.defects.monthly.map((m: any, i: number) => ({ x: i, label: m.month.slice(2) }))} xTickEvery={2}
                series={[{ color: "#DC2626", dots: true, area: true, points: r.defects.monthly.map((m: any, i: number) => ({ x: i, y: m.fail_rate })) }]} />
              <div className="label mb-2 mt-4">Top defects</div>
              <div className="flex flex-col gap-2">
                {r.defects.top_reasons.map((d: any) => {
                  const mx = r.defects.top_reasons[0].count;
                  return (
                    <div key={d.reason} className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_50px] items-center gap-2 text-[12.5px]">
                      <span className="truncate capitalize text-fg-2" title={d.reason.replaceAll("_", " ")}>{d.reason.replaceAll("_", " ")}</span>
                      <div className="h-2 overflow-hidden rounded-full bg-[#E8EEF7]"><div className="h-2 rounded-full bg-gradient-to-r from-[#F59E0B] to-[#D97706]" style={{ width: `${(100 * d.count) / mx}%` }} /></div>
                      <span className="text-right font-semibold tabular-nums text-fg-2">{d.count}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Panel title="Branches (fail rate) and roadside remote-sensing sites" action={<><Source kind="synthetic" text="Branches: synthetic" /><Source kind="simulated" text="Sites: simulated" /></>}>
              <BranchMap branches={r.branches} sites={r.remote_sensing.sites} />
            </Panel>
            <Panel title="High-emitter hits (latest)" action={<Source kind="simulated" />}>
              <TableBox className="max-h-[440px]">
                <table className="w-full whitespace-nowrap text-[13px]">
                  <thead className={THEAD}><tr><th>Time</th><th>Site</th><th>Plate</th><th className="text-right">HC ppm</th><th className="text-right">Smoke</th></tr></thead>
                  <tbody>
                    {r.remote_sensing.hits.map((h: any, i: number) => (
                      <tr key={i} className={TROW}><td className="text-fg-3">{String(h.timestamp).slice(5, 16)}</td><td>{h.site}</td><td><b>{h.plate}</b></td><td className="text-right tabular-nums">{h.hc_ppm}</td><td className="text-right tabular-nums">{h.pm_uv_smoke}</td></tr>
                    ))}
                  </tbody>
                </table>
              </TableBox>
            </Panel>
          </div>

          <Panel title="Live public data" action={<Source kind="real" text={r.web.mode === "live" ? `Live · refreshed ${r.web.refreshed_at}` : "Snapshot (offline) · data.gov.my"} />}>
            <div className="grid grid-cols-1 gap-3 text-[13px] md:grid-cols-3">
              <div className="rounded-2xl bg-[#F4F7FB] p-4 ring-1 ring-ink-600/60">
                <div className="label mb-1.5 flex items-center gap-1.5"><Icon name="oil" size={14} color="#64748B" />Fuel price (RM/litre)</div>
                {fuel ? <div>RON95 <b>{fuel.ron95}</b> · RON97 <b>{fuel.ron97}</b> · Diesel <b>{fuel.diesel}</b> <span className="text-fg-3">({fuel.date})</span></div> : "–"}
              </div>
              <div className="rounded-2xl bg-[#F4F7FB] p-4 ring-1 ring-ink-600/60">
                <div className="label mb-1.5 flex items-center gap-1.5"><Icon name="warn" size={14} color="#64748B" />Weather warnings</div>
                {JSON.stringify(r.web.weather_warnings).length > 30 ? <div className="max-h-24 overflow-auto text-[12px] text-fg-2">{(r.web.weather_warnings.records || r.web.weather_warnings.data || []).slice?.(0, 3).map((w: any, i: number) => <div key={i}>{w.warning_issue?.title_en || w.title_en || JSON.stringify(w).slice(0, 90)}</div>)}</div> : "No active warnings in the snapshot"}
              </div>
              <div className="rounded-2xl bg-[#F4F7FB] p-4 ring-1 ring-ink-600/60">
                <div className="label mb-1.5 flex items-center gap-1.5"><Icon name="flood" size={14} color="#64748B" />River-level stations (public data)</div>
                <div className="text-[12px] text-fg-2">{(r.web.flood_stations.records || r.web.flood_stations.data || []).length || 0} stations in the snapshot (used for flood-risk context).</div>
                <Link href="/oversight/flood" className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-cyan hover:underline">Flood watch: every state&apos;s river levels and the vehicles to inspect<Icon name="chev" size={14} /></Link>
              </div>
            </div>
          </Panel>
        </>
      )}
    </OversightShell>
  );
}
