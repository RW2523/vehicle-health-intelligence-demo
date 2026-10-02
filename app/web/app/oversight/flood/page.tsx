"use client";
/* Flood watch: JPS river levels and rainfall (real) x the vehicles registered in each district (synthetic) -> which
   vehicles need a flood-damage inspection or an underbody corrosion check, and why. A live map polls the API, updating
   its markers in place; the view (live levels or a past flood) and the open vehicle live in the address:
   /oversight/flood?scope=event:2025-12-10&vehicle=DMO 9002 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LineChart } from "@/components/charts";
import { refreshUseCase } from "@/components/Demo";
import { Panel, StatusPill } from "@/components/glass";
import { Icon } from "@/components/icons";
import { LiveBadge, LiveMap, MapPoint, keyOf } from "@/components/LiveMap";
import { OversightShell, useEdgeFade } from "@/components/OversightShell";
import { Empty, ErrorState, LoadingState, Modal, PageHeader, Pill, Source, Tabs, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { dmy, fmtN, pct } from "@/lib/format";
import { useFetch } from "@/lib/live";
import { VERDICT } from "@/lib/present";
import { FilterPill, FlowSteps, OvStat, THEAD, TableBox, useNarrow, vehicleRecordHref } from "../parts";

const BASE = "/oversight/flood";
const POLL_MS = 45_000;
const STATUS: Record<string, { label: string; c: string; r: number }> = {
  danger: { label: "Danger", c: "#DC2626", r: 7 },
  warning: { label: "Warning", c: "#EA580C", r: 6 },
  alert: { label: "Alert", c: "#CA8A04", r: 5.5 },
  normal: { label: "Normal", c: "#059669", r: 3.4 },
  no_reading: { label: "No reading", c: "#94A3B8", r: 2.8 },
  no_thresholds: { label: "No thresholds", c: "#64748B", r: 2.8 },
};
/** the KPI numbers in their status colour, a shade darker so they read as text */
const STATUS_TEXT: Record<string, string> = { danger: "#DC2626", warning: "#C2410C", alert: "#A16207" };
const DRAW_ORDER = ["no_thresholds", "no_reading", "normal", "alert", "warning", "danger"];
const AT_RISK = ["danger", "warning", "alert"];
const REC_COL: Record<string, string> = { "Flood-damage inspection": "#DC2626", "Underbody corrosion check": "#D97706", "No inspection needed yet": "#64748B" };
const SRC: Record<string, { kind: string; text: string }> = {
  real: { kind: "real", text: "JPS" }, public_record: { kind: "real", text: "Public record" },
  synthetic: { kind: "synthetic", text: "Synthetic" }, live_model: { kind: "live_model", text: "Flood model" },
};
const SRC_DOT: Record<string, string> = { real: "#059669", public_record: "#059669", synthetic: "#EA580C", live_model: "#2563EB" };
const RISK_FILTERS = [{ v: 70, l: "High risk (70+)" }, { v: 45, l: "All to inspect (45+)" }, { v: 0, l: "All exposed" }];

/** The path from a flood risk to an inspection result; the page and the vehicle's record show where it is. */
const FLOOD_STEPS = ["Select risk area/vehicle", "Review reasons", "Invite for inspection (mock)", "View inspection result"];
const utcMs = (iso?: string | null) => (iso ? Date.parse(iso + (/Z|[+-]\d\d:\d\d$/.test(iso) ? "" : "Z")) : 0);
/** The lane reports issued since the owner was invited (the result of the invitation), and the earlier ones. */
function resultsOf(d: any) {
  const t0 = utcMs(d.invited_at);
  const all: any[] = d.lane_reports || [];
  return { after: all.filter((r) => !t0 || utcMs(r.created_at) >= t0), before: all.filter((r) => t0 && utcMs(r.created_at) < t0) };
}
/** Where a vehicle is on the path: reasons to review (1), invited and waiting (3), or its result is in (4). */
const vehicleStep = (d: any) => (!d.invited_at ? 1 : resultsOf(d).after.length ? 4 : 3);

const bandColor = (b: string) => (b === "High" ? "#DC2626" : b === "Medium" ? "#D97706" : "#3B82F6");
const exposureColor = (e: number) => (e >= 0.6 ? "#DC2626" : e >= 0.3 ? "#EA580C" : "#CA8A04");
const when = (iso?: string | null) => (iso ? `${dmy(iso.slice(0, 10))}, ${iso.slice(11, 16)}` : "–");  // JPS times are Malaysia time
/** A time this server recorded (UTC), shown in Malaysia time. */
const whenUtc = (iso?: string | null) => (iso ? new Date(/Z|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + "Z").toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");
const monthYear = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const ago = (min: number) => (min < 90 ? `${min} min` : min < 60 * 48 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} days`);
const trendText = (s: any) => (s.change ? `${s.change.m > 0 ? "▲ rising" : s.change.m < 0 ? "▼ falling" : "= steady"} ${Math.abs(s.change.m).toFixed(2)} m since ${s.change.since.slice(11, 16)}` : "no earlier reading to compare");

/** Where the river data came from: JPS live (with the fetch time) or the committed snapshot. ``short`` for card headers. */
function JpsSource({ s, short = false }: { s: any; short?: boolean }) {
  if (!s) return null;
  const stale = s.mode === "live" && s.age_min > 2 * s.ttl_min ? ` (${ago(s.age_min)} ago)` : "";
  const text = s.mode === "live"
    ? short ? `JPS ${s.fetched_at.slice(11, 16)}${stale}` : `JPS Public InfoBanjir · fetched ${when(s.fetched_at)}${stale}`
    : short ? "JPS snapshot" : `Stored JPS snapshot, fetched ${when(s.fetched_at)}`;
  return <Source kind={s.mode === "live" ? "live_feed" : "real"} text={text} />;
}

function Why({ r }: { r: any }) {
  const s = SRC[r.source] || { kind: r.source, text: r.source };
  return (
    <li className="flex items-start gap-2">
      <span className="mt-[1px] shrink-0"><Source kind={s.kind} text={s.text} /></span>
      <span className="min-w-0">{r.text}{r.effect && <span className="ml-1 text-fg-4">({r.effect})</span>}</span>
    </li>
  );
}

/** A reason in a list: a dot in its source's colour instead of the full chip (the chips sit in the card header). */
function WhyDot({ r }: { r: any }) {
  return (
    <li className="flex items-start gap-2" title={SRC[r.source]?.text}>
      <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SRC_DOT[r.source] || "#64748B" }} />
      <span className="min-w-0">{r.text}{r.effect && <span className="ml-1 text-fg-4">({r.effect})</span>}</span>
    </li>
  );
}

function StationTrend({ h, height = 200 }: { h: any; height?: number }) {
  const s = h.station;
  const series = h.jps_7d?.length ? h.jps_7d : h.recorded.filter((p: any) => p.level != null);
  const t0 = series.length ? new Date(series[0].t).getTime() : 0;
  const hx = (t: string) => (new Date(t).getTime() - t0) / 3.6e6;
  const days: { x: number; label: string }[] = [];
  series.forEach((p: any) => { if (p.t.slice(11, 13) === "00" || days.length === 0) days.push({ x: hx(p.t), label: p.t.slice(8, 10) + "/" + p.t.slice(5, 7) }); });
  // the three thresholds are often a few cm apart and the level crosses them: the legend under the chart names them,
  // a label on the chart would sit on the line
  const th = (["alert", "warning", "danger"] as const).filter((k) => s[k] != null && s[k] > 0);
  const hl = th.map((k) => ({ y: s[k], color: STATUS[k].c, dashed: true }));
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
        <Pill color={STATUS[s.status].c}>{STATUS[s.status].label}</Pill>
        <span><b>{s.level != null ? `${s.level.toFixed(2)} m` : "no reading"}</b> at {when(s.updated)}</span>
        {s.change && <span className="text-fg-3">{s.change.m > 0 ? "▲" : s.change.m < 0 ? "▼" : "="} {Math.abs(s.change.m).toFixed(2)} m since {s.change.since.slice(11, 16)}</span>}
        {s.note && <span className="text-fg-3">{s.note}</span>}
      </div>
      {series.length >= 2 ? (
        <LineChart height={height} yFmt={(v) => v.toFixed(1)} hlines={hl} xLabels={days} xTickEvery={Math.max(1, Math.ceil(days.length / 7))}
          series={[{ color: "#2563EB", dots: !h.jps_7d?.length, area: true, points: series.map((p: any) => ({ x: hx(p.t), y: p.level })) }]} />
      ) : <p className="py-6 text-center text-[12.5px] text-fg-3">Only one reading recorded so far: the line fills in with every fetch.</p>}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-fg-3">
        {th.map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: STATUS[k].c }} />{STATUS[k].label} {s[k].toFixed(2)} m</span>)}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11.5px] text-fg-3">
        <Source kind="real" text={h.jps_7d?.length ? "Real · JPS 7-day series (hourly)" : `Real · ${h.recorded.length} readings recorded by this server`} />
        <span>{s.river} · {s.basin} basin{s.station_no ? ` · JPS station ${s.station_no}` : ""}</span>
        {s.position === "district" && <span>Position approximate (JPS publishes none for this station)</span>}
      </div>
    </>
  );
}

function VehicleDetail({ d, onInvite, busy }: { d: any; onInvite: () => void; busy: boolean }) {
  const corr = d.inspections.filter((i: any) => i.corrosion != null);
  const { after, before } = resultsOf(d);
  const record = vehicleRecordHref(d.plate);
  const latest = [...(d.lane_reports || [])].sort((a: any, b: any) => utcMs(b.created_at) - utcMs(a.created_at))[0];
  return (
    <div className="flex w-[min(820px,calc(100vw-5rem))] flex-col gap-4 text-[13px]">
      <FlowSteps steps={FLOOD_STEPS} at={vehicleStep(d)} label="Where this vehicle is" />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[38px] font-extrabold leading-none tracking-tight" style={{ color: bandColor(d.band) }}>{d.risk}</span>
        <span className="flex min-w-0 flex-col"><b className="text-[15px]">{d.plate} · {d.make} {d.model}</b><span className="text-fg-3">{d.vtype} · {d.fuel} · {d.year} · {d.district}, {d.state} <span className="text-fg-4">(synthetic district)</span></span></span>
        <span className="ml-auto flex flex-wrap gap-2"><Pill color={bandColor(d.band)}>{d.band} risk</Pill><Pill color={REC_COL[d.recommendation]}>{d.recommendation}</Pill></span>
      </div>
      {/* the one thing to do here, then where else this vehicle has a record */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#F4F7FB] px-3 py-2.5 ring-1 ring-ink-600/60">
        {d.invited_at ? <span className="font-semibold text-ok">Invitation recorded {whenUtc(d.invited_at)}</span> : (
          <button className="btn btn-primary" disabled={busy} onClick={onInvite}>Invite the owner for a flood inspection</button>
        )}
        <Source kind="mock" text="Recorded only: no SMS, e-mail or letter is sent" className="max-sm:whitespace-normal max-sm:rounded-xl max-sm:[&>span]:whitespace-normal" />
        <span className="flex flex-wrap gap-2 sm:ml-auto">
          {latest?.inspection_id && <Link className="btn btn-sm" href={`/inspection/${latest.inspection_id}`}>Latest inspection<Icon name="arrow" size={13} /></Link>}
          {record && <Link className="btn btn-sm" href={record}>Vehicle record<Icon name="arrow" size={13} /></Link>}
        </span>
      </div>
      <section>
        <div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="h-title">How the score adds up</h3><Source kind="live_logic" text="Scoring logic" /></div>
        <p className="rounded-xl bg-[#F4F7FB] px-3 py-2 font-mono text-[12px] text-fg-2 ring-1 ring-ink-600/60">{d.how}</p>
      </section>
      <section>
        <h3 className="h-title mb-2">Why</h3>
        <ul className="flex flex-col gap-1.5">{d.reasons.map((r: any, i: number) => <Why key={i} r={r} />)}</ul>
        {!d.exposed && <p className="mt-2 text-fg-3">Not in an exposed district for this view: only the vehicle&apos;s own factors apply.</p>}
      </section>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section>
          <div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="h-title">Flood model</h3><Source kind="live_model" text="LightGBM · physical evidence" /></div>
          {d.flood_model.available ? (
            <>
              <p className="mb-1">{d.flood_model.p >= 0.995 ? "Over 99%" : pct(d.flood_model.p)} likely to have flood damage already, from its inspection history.</p>
              <ul className="flex flex-col gap-0.5 text-[12.5px] text-fg-2">
                {d.flood_model.factors.map((f: any) => <li key={f.label}>{f.label}{f.value != null ? ` (${typeof f.value === "number" ? +f.value.toFixed(2) : f.value})` : ""}: <span className={f.direction === "raises" ? "text-bad" : "text-ok"}>{f.direction} it</span></li>)}
              </ul>
            </>
          ) : <p className="text-fg-3">No inspection on record, so the model has nothing to go on.</p>}
        </section>
        <section>
          <div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="h-title">Corrosion at past inspections</h3><Source kind="synthetic" /></div>
          {corr.length >= 2 ? (
            <LineChart height={120} yMin={0} yMax={10} yFmt={(v) => String(v)} hlines={[{ y: 5, color: "#D97706", dashed: true }]}
              xLabels={corr.map((c: any, i: number) => ({ x: i, label: c.date.slice(2, 7) }))} series={[{ color: "#EA580C", dots: true, points: corr.map((c: any, i: number) => ({ x: i, y: c.corrosion })) }]} />
          ) : <p className="text-fg-3">{corr.length ? `${corr[0].corrosion}/10 on ${dmy(corr[0].date)}` : "No corrosion reading on record."}</p>}
          {d.flood_claims.length > 0 && (
            <ul className="mt-2 text-[12.5px] text-fg-2">
              {d.flood_claims.map((c: any) => <li key={c.date}>Flood claim {dmy(c.date)} · RM {fmtN(c.amount_rm)}{c.written_off ? " · written off" : ""}</li>)}
            </ul>
          )}
        </section>
      </div>
      <section aria-label="Inspection result">
        <div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="h-title">Inspection result</h3><Source kind="live_logic" text="Issued lane reports" /></div>
        {/* after an invitation, the result is an inspection issued since; anything older is earlier history */}
        <>
            {after.length ? (
              <ul className="flex flex-col gap-1.5">
                {after.map((r: any) => (
                  <li key={r.report_id} className="flex flex-wrap items-center gap-2 rounded-xl bg-[#F4F7FB] px-3 py-2 ring-1 ring-ink-600/60">
                    <b style={{ color: VERDICT[r.verdict]?.color }}>{r.verdict}</b>
                    <span>{r.kind} · {dmy(r.issued_at || r.created_at)}{r.health != null ? ` · health ${r.health}` : ""}{r.synthetic ? " · synthetic record" : ""}</span>
                    {r.findings?.length > 0 && <span className="text-fg-3">· {r.findings.slice(0, 2).join("; ")}</span>}
                    <span className="ml-auto flex flex-wrap gap-2">
                      {r.inspection_id && <Link className="btn btn-sm" href={`/inspection/${r.inspection_id}`}>Inspection</Link>}
                      <Link className="btn btn-sm" href={`/report?id=${r.report_id}`}>Report</Link><Link className="btn btn-sm" href={`/verify/${r.verify_token}`}>Verify</Link>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-fg-3">{d.invited_at ? "Invited: the result appears here once the vehicle has been inspected." : "No inspection since the flood risk was raised."}</p>}
            {before.length > 0 && <p className="mt-1.5 text-[12px] text-fg-4">Earlier: {before.map((r: any) => `${r.verdict} on ${dmy(r.issued_at || r.created_at)}`).join(", ")}.</p>}
        </>
      </section>
    </div>
  );
}

/** What was clicked on the map (or in the lists): a river station, a district or a vehicle. */
function Selected({ pick, stations, areas, vehicles, pinned, hist, ev, onArea, onOpen, onInvite, busy, area }: {
  pick: string | null; stations: any[]; areas: any[]; vehicles: any[]; pinned: any; hist: any; ev: any;
  onArea: (a: any) => void; onOpen: (plate: string) => void; onInvite: (plate: string) => void; busy: boolean; area: { state: string; district: string } | null;
}) {
  if (!pick) return (
    <div className="flex items-start gap-3 text-[13px]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 ring-1 ring-blue-100"><Icon name="map" size={18} color="#2563EB" /></span>
      <span className="text-fg-2"><b className="block text-fg">Start here: pick a district or a vehicle at risk</b>Click one on the map, or in the lists below. Its reasons appear here, with the invitation to inspect.</span>
    </div>
  );
  const [layer, ...rest] = pick.split(":");
  const id = rest.join(":");
  if (layer === "stations") {
    const s = stations.find((x) => x.id === id);
    if (!s) return <p className="text-[13px] text-fg-3">This station is not in the latest reading. Pick another station, or a district or vehicle at risk.</p>;
    return (
      <div className="fade-in">
        <div className="eyebrow mb-1 text-[10.5px]">River station</div>
        <h3 className="text-[17px] font-bold leading-snug tracking-tight">{s.name}</h3>
        <p className="mb-3 text-[12.5px] text-fg-3">{s.river} · {s.district}, {s.state}</p>
        {hist?.station?.id === s.id ? <StationTrend h={hist} height={110} /> : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[13px]"><Pill color={STATUS[s.status].c}>{STATUS[s.status].label}</Pill><b>{s.level != null ? `${s.level.toFixed(2)} m` : "no reading"}</b><span className="text-fg-3">{trendText(s)}</span></div>
            <LoadingState label="Loading the station's levels…" rows={2} className="mt-3" />
          </>
        )}
      </div>
    );
  }
  if (layer === "districts") {
    const a = areas.find((x) => `${x.state}|${x.district}` === id);
    if (!a) return <p className="text-[13px] text-fg-3">This district is not exposed in this view. Pick a district from the list below.</p>;
    const on = area?.state === a.state && area?.district === a.district;
    return (
      <div className="fade-in">
        <div className="eyebrow mb-1 text-[10.5px]">{ev ? "District hit" : "District at risk"}</div>
        <h3 className="text-[17px] font-bold leading-snug tracking-tight">{a.district} <span className="text-[13px] font-medium text-fg-3">{a.state}</span></h3>
        <div className="my-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-blue-50/70 p-2 ring-1 ring-blue-100"><div className="text-[20px] font-bold text-cyan">{a.to_inspect}</div><div className="text-[11px] text-fg-3">to inspect</div></div>
          <div className="rounded-xl bg-white/70 p-2 ring-1 ring-ink-600"><div className="text-[20px] font-bold">{fmtN(a.vehicles)}</div><div className="text-[11px] text-fg-3">registered</div></div>
          <div className="rounded-xl bg-white/70 p-2 ring-1 ring-ink-600"><div className="text-[20px] font-bold" style={{ color: exposureColor(a.exposure) }}>{a.exposure.toFixed(2)}</div><div className="text-[11px] text-fg-3">exposure</div></div>
        </div>
        <ul className="flex flex-col gap-1.5 text-[12.5px]">{a.reasons.map((r: any, i: number) => <Why key={i} r={r} />)}</ul>
        <button className={`btn btn-sm mt-3 ${on ? "" : "btn-primary"}`} onClick={() => onArea(a)}>{on ? "Show every district's vehicles" : "List this district's vehicles"}</button>
      </div>
    );
  }
  const v = layer === "focus" ? pinned : vehicles.find((x) => x.plate === id) || (pinned?.plate === id ? pinned : null);
  if (!v) return <p className="text-[13px] text-fg-3">This vehicle is not in the current list. Lower the risk filter, or pick another vehicle.</p>;
  const own = (v.reasons || []).filter((x: any) => !x.district);
  const record = vehicleRecordHref(v.plate);
  return (
    <div className="fade-in">
      <div className="eyebrow mb-1 text-[10.5px]">Vehicle at risk</div>
      <div className="flex items-start gap-3">
        <span className="text-[34px] font-extrabold leading-none tracking-tight" style={{ color: bandColor(v.band) }}>{v.risk}</span>
        <span className="min-w-0"><b className="block text-[16px]">{v.plate}</b><span className="block text-[12.5px] text-fg-3">{v.make} {v.model} · {v.district}, {v.state}</span></span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5"><Pill color={bandColor(v.band)}>{v.band} risk</Pill><Pill color={REC_COL[v.recommendation]}>{v.recommendation}</Pill>{v.invited_at && <StatusPill tone="green" dot>Invited</StatusPill>}</div>
      <ul className="mt-3 flex flex-col gap-1 text-[12.5px] text-fg-2">
        {v.exposure_headline && !own.some((x: any) => x.kind === "exposure") && <WhyDot r={{ text: v.exposure_headline, source: v.exposure_source }} />}
        {own.slice(0, 3).map((x: any, i: number) => <WhyDot key={i} r={x} />)}
      </ul>
      {/* the next step for this vehicle: invite the owner, or (invited) look at the result */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {v.invited_at
          ? <button className="btn btn-sm btn-primary" onClick={() => onOpen(v.plate)}>View inspection result<Icon name="arrow" size={13} /></button>
          : <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onInvite(v.plate)} title="Mock: recorded only, no SMS, e-mail or letter is sent">Invite for inspection</button>}
        {!v.invited_at && <button className="btn btn-sm" onClick={() => onOpen(v.plate)}>Full record</button>}
        {record && <Link className="btn btn-sm" href={record}>Vehicle record<Icon name="arrow" size={13} /></Link>}
      </div>
      {!v.invited_at && <p className="mt-1.5 text-[11.5px] text-fg-4">Mock: the invitation is recorded only; no message is sent.</p>}
    </div>
  );
}

function FloodWatch() {
  const router = useRouter();
  const sp = useSearchParams();
  const [poll, setPoll] = useState(0);
  const ov = useFetch<any>("/api/floodwatch", undefined, [poll]);
  const src = ov.data?.source;
  const fetchedAt = src?.fetched_at;
  const st = useFetch<any>("/api/floodwatch/stations", undefined, [fetchedAt, poll]);
  // the view (live river levels, or a past flood) and the open vehicle live in the address, so a use case or a
  // colleague can link straight to them: /oversight/flood?scope=event:2025-12-10&vehicle=DMO 9002
  const scope = sp.get("scope") || "live";
  const go = useCallback((s: string, plate: string | null) => {
    const u = new URLSearchParams();
    if (s !== "live") u.set("scope", s);
    if (plate) u.set("vehicle", plate);
    router.replace(u.toString() ? `${BASE}?${u}` : BASE, { scroll: false });
  }, [router]);
  const [minRisk, setMinRisk] = useState(45);
  const [area, setArea] = useState<{ state: string; district: string } | null>(null);
  const [page, setPage] = useState(1);
  const narrow = useNarrow();
  const areas = useFetch<any>("/api/floodwatch/areas", { scope }, [fetchedAt]);
  // a phone shows the list as cards: ten to a page keeps the page a sensible length
  const veh = useFetch<any>("/api/floodwatch/vehicles", { scope, min_risk: minRisk, page, page_size: narrow ? 10 : 20, state: area?.state, district: area?.district }, [fetchedAt]);
  // the map's vehicle layer: the hundred most at risk in this view
  const vmap = useFetch<any>("/api/floodwatch/vehicles", { scope, min_risk: minRisk, page: 1, page_size: 100 }, [fetchedAt]);
  const inv = useFetch<any[]>("/api/floodwatch/invitations");
  const [station, setStation] = useState<string | null>(null);
  const hist = useFetch<any>(station ? `/api/floodwatch/stations/${encodeURIComponent(station)}/history` : null, undefined, [fetchedAt]);
  // the open vehicle lives in the address (?vehicle=DMO 9002), so a use case or a colleague can link straight to it
  const open = sp.get("vehicle");
  const setOpen = useCallback((plate: string | null) => go(scope, plate), [go, scope]);
  const detail = useFetch<any>(open ? `/api/floodwatch/vehicles/${encodeURIComponent(open)}` : null, { scope });
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [pick, setPick] = useState<string | null>(null);
  const [pinned, setPinned] = useState<any>(null);
  const [focus, setFocus] = useState<{ key: string; lat: number; lon: number; zoom?: number } | null>(null);
  const [side, setSide] = useState<"districts" | "vehicles">("districts");
  const [allAreas, setAllAreas] = useState(false);
  const [allVeh, setAllVeh] = useState(false);
  const tabsRow = useRef<HTMLDivElement>(null);
  useEdgeFade(tabsRow, "[role=tablist]");
  const [busy, setBusy] = useState(false);
  const [polledAt, setPolledAt] = useState<Date | null>(null);
  const table = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(null), [setOpen]);

  // live: poll the API while the page is in view; the map keeps its view and updates its markers in place
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && setPoll((n) => n + 1), POLL_MS);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (st.data) setPolledAt(new Date());
  }, [st.data]);
  // a fetch from JPS runs in the background when the data is older than 15 minutes: follow it, then everything reloads
  useEffect(() => {
    if (!src?.refreshing) return;
    const t = setInterval(ov.reload, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src?.refreshing]);
  // start on the worst river station
  useEffect(() => {
    if (station || !st.data) return;
    const worst = st.data.items.find((s: any) => AT_RISK.includes(s.status));
    if (worst) {
      setStation(worst.id);
      setPick((p) => p ?? keyOf({ layer: "stations", id: worst.id }));
    }
  }, [st.data, station]);
  useEffect(() => { setPage(1); setSel({}); }, [scope, minRisk, area, narrow]);
  // a vehicle opened from the address: pin it on the map, fly there and keep it selected after the dialog closes
  useEffect(() => {
    const d = detail.data;
    if (!d || d.plate !== open || d.lat == null) return;
    setPinned(d);
    setPick(keyOf({ layer: "focus", id: d.plate }));
    setFocus({ key: `${d.plate}|${scope}`, lat: d.lat, lon: d.lon, zoom: 12 });
  }, [detail.data, open, scope]);

  const refresh = async () => {
    setBusy(true);
    try {
      const r = await api.post("/api/floodwatch/refresh");
      toast(r.note, r.updated ? "ok" : r.errors ? "err" : "info");
      ov.reload();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  const invite = async (plates: string[]) => {
    setBusy(true);
    try {
      const r = await api.post("/api/floodwatch/invitations", { plates, scope });
      toast(r.invited.length ? `Invitation recorded for ${r.invited.map((i: any) => i.plate).join(", ")} (mock: no message is sent)`
        : `Already invited: ${r.already.join(", ")}`, r.invited.length ? "ok" : "info");
      setSel({});
      veh.reload();
      vmap.reload();
      inv.reload();
      refreshUseCase();
      if (open) detail.reload();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  const setScope = (s: string) => {
    setArea(null);
    setPinned(null);
    setPick((p) => (p && !p.startsWith("stations:") ? null : p));
    go(s, null);
  };
  const pickArea = (a: any) => {
    const on = area?.state === a.state && area?.district === a.district;
    setArea(on ? null : { state: a.state, district: a.district });
    setPick(keyOf({ layer: "districts", id: `${a.state}|${a.district}` }));
    if (a.lat != null) setFocus({ key: `d|${a.state}|${a.district}|${Date.now()}`, lat: a.lat, lon: a.lon, zoom: 9.5 });
  };
  const onMap = (p: MapPoint) => {
    setPick(keyOf(p));
    if (p.layer === "stations") setStation(p.id);
  };

  const o = ov.data;
  const events: any[] = o?.events || [];
  const ev = events.find((e) => e.id === scope);
  const V = veh.data;
  const A: any[] = useMemo(() => areas.data?.items || [], [areas.data]);
  const S: any[] = useMemo(() => st.data?.items || [], [st.data]);
  const MV: any[] = useMemo(() => vmap.data?.items || [], [vmap.data]);
  const selected = Object.keys(sel).filter((k) => sel[k]);
  const trend = (o?.trend || []).map((t: any, i: number) => ({ x: i, y: AT_RISK.reduce((n, k) => n + (t.counts[k] || 0), 0), t: t.fetched_at }));
  const live = src?.mode === "live";

  // where the follow-up is: nothing picked yet, reasons to review, invited and waiting, or the result is in
  const [pickLayer, ...pickRest] = (pick || "").split(":");
  const pickId = pickRest.join(":");
  const pickedVeh = pickLayer === "focus" ? pinned : pickLayer === "vehicles" ? MV.find((x) => x.plate === pickId) || (pinned?.plate === pickId ? pinned : null) : null;
  const openD = open && detail.data?.plate === open ? detail.data : null;
  const flowAt = openD ? vehicleStep(openD) : pickedVeh ? (pickedVeh.invited_at ? 3 : 1) : pickLayer === "districts" ? 1 : 0;
  const flowPlate = openD?.plate || pickedVeh?.plate;
  const flowHint = flowAt === 0 ? "Start with a district or a vehicle at risk: click it on the map, or pick it from the lists."
    : flowAt === 1 ? (flowPlate ? `${flowPlate}: its reasons are beside the map. Next: invite the owner for an inspection (mock).` : "The district's reasons are beside the map. Next: pick one of its vehicles.")
    : flowAt === 3 ? `${flowPlate} has been invited (mock). Its result shows in its record once the vehicle has been inspected.`
    : `${flowPlate}'s inspection result is in its record.`;

  // every district in the list is on the map (a district picked in the list is always there to see)
  const mapAreas = useMemo(() => A.filter((a) => a.lat != null), [A]);
  const points = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    for (const k of DRAW_ORDER) {
      for (const s of S) {
        if (s.status !== k || s.lat == null) continue;
        const stt = STATUS[k];
        const risk = AT_RISK.includes(k);
        out.push({
          id: s.id, layer: "stations", lat: s.lat, lon: s.lon, color: stt.c, radius: stt.r,
          shape: k === "danger" || k === "warning" ? "pulse" : k === "no_thresholds" ? "ring" : "dot", faint: !risk,
          title: s.name,
          lines: [`${s.river} · ${s.district}, ${s.state}`,
            `${stt.label}${s.level != null ? ` · ${s.level.toFixed(2)} m` : ""}${s.danger ? ` (danger ${s.danger.toFixed(2)} m)` : ""}`,
            `Trend: ${trendText(s)}`, `Reading at ${when(s.updated)}${s.position === "district" ? " · position approximate" : ""}`],
        });
      }
    }
    for (const a of mapAreas) {
      out.push({
        id: `${a.state}|${a.district}`, layer: "districts", lat: a.lat, lon: a.lon, shape: "area",
        color: scope === "live" ? exposureColor(a.exposure) : "#2563EB", radius: 9 + Math.min(26, Math.sqrt(a.to_inspect) * 3.2),
        title: `${a.district}, ${a.state}`,
        lines: [`${a.to_inspect} to inspect of ${fmtN(a.vehicles)} registered`, ...(a.headline ? [a.headline] : []), `Exposure ${a.exposure.toFixed(2)}`],
      });
    }
    for (const v of MV) {
      if (v.lat == null) continue;
      out.push({
        id: v.plate, layer: "vehicles", lat: v.lat, lon: v.lon, color: bandColor(v.band), radius: v.band === "High" ? 5 : 4,
        title: `${v.plate} · ${v.make} ${v.model}`,
        lines: [`Risk ${v.risk} · ${v.band} · ${v.recommendation}`, `${v.district}, ${v.state}`, ...(v.exposure_headline ? [v.exposure_headline] : [])],
      });
    }
    if (pinned?.lat != null) {
      out.push({ id: pinned.plate, layer: "focus", lat: pinned.lat, lon: pinned.lon, color: bandColor(pinned.band), shape: "pin", label: pinned.plate,
        title: `${pinned.plate} · ${pinned.make} ${pinned.model}`, lines: [`Risk ${pinned.risk} · ${pinned.recommendation}`, `${pinned.district}, ${pinned.state} (synthetic district)`] });
    }
    return out;
  }, [S, mapAreas, MV, pinned, scope]);

  // the one height of the map row: the details beside the map take the map card's height from xl
  const MAP_H = "h-[400px] sm:h-[440px] md:h-[540px] xl:h-[calc(100vh-170px)] xl:min-h-[620px] xl:max-h-[920px]";
  const topVeh = (vmap.data?.total || 0) > MV.length;
  const kpiLabels = ["Stations at danger", "Stations at warning", "Stations at alert", "Stations normal", "Vehicles to inspect now"];
  return (
    <OversightShell wide>
      <PageHeader eyebrow="Oversight · Flood watch" title="Flood watch"
        sub="River levels and rainfall from JPS for every state, set against the vehicles registered in each district: which cars need a flood-damage inspection or an underbody corrosion check, and why."
        actions={<>
          <span className="contents sm:hidden"><JpsSource s={src} short /></span>
          <span className="hidden sm:contents"><JpsSource s={src} /></span>
          <button className="btn" disabled={busy || src?.refreshing} onClick={refresh}><Icon name="refresh" size={15} />{src?.refreshing ? "Fetching river levels…" : "Refresh river levels"}</button>
        </>}>
        {src && (
          <p className="mt-2 text-[12.5px] text-fg-3" role="status">
            {src.mode === "live"
              ? <>Last updated <b className="text-fg-2">{when(src.fetched_at)}</b> from a live fetch{src.refreshing ? " · fetching newer data in the background" : ""}{src.last_error ? " · the latest fetch failed, so these are the last fetched levels" : ""}.</>
              : <><b className="text-warn">Live feed unavailable:</b> showing the latest stored snapshot, from {when(src.fetched_at)}{src.refreshing ? " · trying a live fetch now" : ""}.</>}
          </p>
        )}
      </PageHeader>
      {!o ? (
        ov.error ? <Empty title="Flood watch could not load" actions={<button className="btn" onClick={ov.reload}>Try again</button>}>{ov.error}</Empty> : (
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {kpiLabels.map((k) => (
              <div key={k} className="card p-4"><div className="text-[12.5px] text-fg-3">{k}</div><LoadingState label="" rows={1} className="mt-2" /></div>
            ))}
            <div className="col-span-2 lg:col-span-5"><div className="card p-5"><LoadingState label="Loading the latest river levels and ranking the registered vehicles…" rows={4} /></div></div>
          </div>
        )
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
            <OvStat icon="warn" tone="red" color={o.counts.danger ? STATUS_TEXT.danger : undefined} label="Stations at danger" value={o.counts.danger} sub="at or over the danger level" />
            <OvStat icon="flood" tone="amber" color={o.counts.warning ? STATUS_TEXT.warning : undefined} label="Stations at warning" value={o.counts.warning} sub="between warning and danger" />
            <OvStat icon="bell" tone="amber" color={o.counts.alert ? STATUS_TEXT.alert : undefined} label="Stations at alert" value={o.counts.alert} sub="between alert and warning" />
            <OvStat icon="checkc" tone="green" label="Stations normal" value={o.counts.normal} sub={`of ${o.total} · ${o.counts.no_reading} no reading · ${o.counts.no_thresholds} no thresholds`} />
            <OvStat icon="car" tone="blue" alert label="Vehicles to inspect now" value={fmtN(o.live.to_inspect)}
              sub={`${fmtN(o.live.flood_inspection)} flood-damage inspections · ${fmtN(o.live.corrosion_check)} underbody corrosion checks`} source={<Source kind="synthetic" text="Synthetic" />} />
          </div>

          {/* the views: one row that scrolls sideways on a narrow screen, its edge fading while more are hidden */}
          <div className="mb-3 flex min-w-0 items-center gap-3">
            <span className="shrink-0 text-[12.5px] font-semibold text-fg-2">View</span>
            <div ref={tabsRow} className="min-w-0">
              <Tabs nowrap value={scope} onChange={(v: string) => setScope(v)}
                items={[{ id: "live", label: "Now · live JPS" }, ...events.map((e) => ({ id: e.id, label: `${monthYear(e.date)}${e.real ? ` · ${e.title.split(",")[0]}` : " · claims"}` }))]} />
            </div>
          </div>
          {ev && (
            <div className="mb-4 flex flex-col items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-[13px] shadow-glass sm:flex-row">
              <span className="hidden sm:block"><Icon name="calendar" size={18} color="#2563EB" /></span>
              <div className="min-w-0 flex-1">
                <b>{ev.title}</b> · {fmtN(ev.claims)} flood claims on {dmy(ev.date)} ({ev.states.map((s: any) => `${s.state} ${s.claims}`).join(", ")})
                <p className="mt-1 text-fg-3">{ev.note}</p>
              </div>
              <div className="flex flex-wrap gap-2">{ev.real && <Source kind="real" text="Event: public record" />}<Source kind="synthetic" text="Claims: synthetic" /></div>
            </div>
          )}

          {/* the path from a risk to a result, and where this follow-up is on it */}
          <section aria-label="Follow-up path" className="mb-4 flex flex-col gap-2 rounded-2xl border border-white/80 bg-white/70 px-3.5 py-2.5 shadow-glass xl:flex-row xl:items-center xl:gap-4">
            <FlowSteps steps={FLOOD_STEPS} at={flowAt} label="Flood follow-up" className="xl:shrink-0" />
            <p className="min-w-0 text-[12.5px] leading-snug text-fg-2 xl:ml-auto xl:text-right" aria-live="polite">{flowHint}</p>
          </section>

          <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
            <section className="card min-w-0 p-2 sm:p-3" aria-label="Live map">
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1.5 pt-1">
                <h2 className="text-[17px] font-bold tracking-tight">Water-level stations{ev ? " · districts hit" : " · districts at risk"}</h2>
                <span className="ml-auto flex flex-wrap gap-1.5"><JpsSource s={src} short /><Source kind="synthetic" text="Districts, vehicles" /></span>
              </div>
              <LiveMap label="JPS water-level stations by status" points={points} className={MAP_H}
                status={st.error && !st.data ? "River stations could not load: the district and vehicle lists still work." : !st.data ? "Loading river stations…" : null}
                selected={pick} onSelect={onMap} focus={focus}
                layers={[
                  { id: "stations", label: "Stations", color: "#059669", count: S.length },
                  { id: "districts", label: ev ? "Districts hit" : "Districts at risk", color: "#2563EB", count: mapAreas.length },
                  // the map draws the hundred most at risk; the lists count them all
                  { id: "vehicles", label: topVeh ? `Top ${MV.length} vehicles` : "Vehicles", color: "#DC2626", count: topVeh ? undefined : MV.length },
                ]}
                legend={[
                  { label: `Danger ${o.counts.danger}`, color: STATUS.danger.c, shape: "pulse" }, { label: `Warning ${o.counts.warning}`, color: STATUS.warning.c, shape: "pulse" },
                  { label: `Alert ${o.counts.alert}`, color: STATUS.alert.c }, { label: "Normal", color: STATUS.normal.c }, { label: "No reading", color: STATUS.no_reading.c },
                  { label: "No thresholds", color: STATUS.no_thresholds.c, shape: "ring" },
                  { label: ev ? "District hit (size = vehicles to inspect)" : "District at risk (size = vehicles to inspect)", color: ev ? "#2563EB" : "#EA580C", shape: "area" },
                  { label: "High-risk vehicle", color: "#DC2626" }, { label: "Medium-risk vehicle", color: "#D97706" },
                  ...(pinned ? [{ label: pinned.plate, color: bandColor(pinned.band), shape: "pin" as const }] : []),
                ]}
                overlay={<LiveBadge at={polledAt} live={live} busy={st.loading || ov.loading} onRefresh={() => setPoll((n) => n + 1)}
                  title={`River data from JPS at ${when(src?.fetched_at)}; the map checks for new data every ${POLL_MS / 1000} s`} />} />
              <p className="px-1.5 pb-1 pt-2 text-[11.5px] text-fg-4">
                Click a station, district or vehicle for its details. {o.source.positions.jps} stations at their published position (JPS station list, data.gov.my); {o.source.positions.district || 0} without one are drawn near their district&apos;s main town. The map checks for new readings every {POLL_MS / 1000} s; JPS is read again every {o.source.ttl_min} minutes.
              </p>
            </section>

            {/* from xl the details fill the map card's height exactly: the map alone sets the row's height */}
            <div className="relative min-w-0">
            <aside className="flex min-w-0 flex-col gap-4 xl:absolute xl:inset-0" aria-label="Details and lists">
              <section className="card max-h-[60vh] shrink-0 overflow-auto p-4 xl:max-h-[44%]" aria-label="Selected on the map">
                <Selected pick={pick} stations={S} areas={A} vehicles={MV} pinned={pinned} hist={hist.data} ev={ev} area={area}
                  onArea={(a) => { pickArea(a); setTimeout(() => table.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }}
                  onOpen={(plate) => setOpen(plate)} onInvite={(plate) => invite([plate])} busy={busy} />
              </section>
              <section className="card flex min-h-[220px] flex-1 flex-col overflow-hidden xl:min-h-0" aria-label={side === "districts" ? "Districts" : "Vehicles"}>
                <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-600/70 px-3 py-2.5">
                  <FilterPill on={side === "districts"} onClick={() => setSide("districts")} count={A.length}>{ev ? "Districts hit" : "Districts at risk"}</FilterPill>
                  <FilterPill on={side === "vehicles"} onClick={() => setSide("vehicles")} count={vmap.data?.total}>Vehicles at risk</FilterPill>
                  <span className="ml-auto">{ev ? <Source kind={ev.real ? "real" : "synthetic"} /> : <Source kind="live_logic" />}</span>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-2.5">
                  {side === "districts" ? (
                    areas.error && !areas.data ? <ErrorState title="Districts could not load" onRetry={areas.reload}>{areas.error}</ErrorState>
                    : !areas.data ? <LoadingState label="Working out which districts are exposed…" rows={4} />
                    : !A.length ? (
                      <Empty title="No district is exposed right now">No JPS station is above its alert level and no district had 60 mm of rain in a day this week. Pick a past flood above to see the ranking at work.</Empty>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {/* the first four below xl (the page is long already), twelve beside the map; "Show all" for the rest */}
                        {(allAreas ? A : A.slice(0, 12)).map((a, i) => {
                          const on = area?.state === a.state && area?.district === a.district;
                          const picked = pick === keyOf({ layer: "districts", id: `${a.state}|${a.district}` });
                          const sc = Object.entries(a.stations || {}).filter(([, n]) => n).map(([k, n]) => `${n} ${STATUS[k]?.label.toLowerCase() || k}`).join(" · ");
                          return (
                            <button key={a.state + a.district} onClick={() => pickArea(a)} aria-pressed={on}
                              className={`${!allAreas && i >= 4 ? "hidden xl:block" : ""} rounded-xl px-3 py-2.5 text-left text-[12.5px] transition ${on || picked ? "bg-white shadow-glass ring-1 ring-blue-200" : "bg-white/45 ring-1 ring-ink-600/70 hover:bg-white"}`}>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <b className="text-[13.5px]">{a.district}</b><span className="text-fg-3">{a.state}</span>
                                <span className="ml-auto text-fg-2"><b className="text-cyan">{a.to_inspect}</b> to inspect of {fmtN(a.vehicles)}</span>
                              </div>
                              <div className="my-1.5 h-1.5 overflow-hidden rounded-full bg-[#E8EEF7]"><div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, a.exposure * 100)}%`, background: exposureColor(a.exposure) }} /></div>
                              <div className="text-fg-2 xl:line-clamp-2" title={a.reasons[0]?.text}>{a.reasons[0]?.text}</div>
                              {(a.reasons.length > 1 || sc) && (() => {
                                const more = `${a.reasons.slice(1).map((r: any) => r.text).join(" · ")}${a.reasons.length > 1 && sc ? " · " : ""}${sc ? `stations: ${sc}` : ""}`;
                                // beside the map one line each (the card picked shows it all above); in full below xl
                                return <div className="mt-0.5 text-[11.5px] text-fg-3 xl:truncate" title={more}>{more}</div>;
                              })()}
                            </button>
                          );
                        })}
                        {A.length > 4 && (
                          <button className={`btn btn-sm self-start ${A.length <= 12 ? "xl:hidden" : ""}`} onClick={() => setAllAreas((x) => !x)}>{allAreas ? "Show fewer" : `Show all ${A.length} districts`}</button>
                        )}
                      </div>
                    )
                  ) : vmap.error && !vmap.data ? <ErrorState title="The vehicle ranking could not load" onRetry={vmap.reload}>{vmap.error}</ErrorState>
                    : !vmap.data ? <LoadingState label="Ranking vehicles…" rows={4} /> : !MV.length ? (
                    <Empty title={vmap.data.counts.exposed ? `No vehicle at risk ${minRisk} or more` : "No vehicle is exposed in this view"}>Lower the risk filter under the map, or pick a past flood above.</Empty>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {MV.map((v, i) => {
                        const k = keyOf({ layer: "vehicles", id: v.plate });
                        return (
                          <li key={v.plate} className={!allVeh && i >= 6 ? "hidden xl:block" : ""}>
                            <button onClick={() => { setPick(k); if (v.lat != null) setFocus({ key: `v|${v.plate}|${Date.now()}`, lat: v.lat, lon: v.lon, zoom: 12 }); }}
                              className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${pick === k ? "bg-white shadow-glass ring-1 ring-blue-200" : "hover:bg-white/70"}`}>
                              <span className="w-9 shrink-0 text-center text-[17px] font-extrabold tracking-tight" style={{ color: bandColor(v.band) }}>{v.risk}</span>
                              <span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-[13px]">{v.plate} <span className="font-medium text-fg-3">{v.make} {v.model}</span></b><span className="block truncate text-[11.5px] text-fg-3">{v.district}, {v.state} · {v.recommendation}</span></span>
                              {v.invited_at && <Icon name="checkc" size={16} color="#059669" />}
                            </button>
                          </li>
                        );
                      })}
                      {!allVeh && MV.length > 6 && <li className="xl:hidden"><button className="btn btn-sm mt-1" onClick={() => setAllVeh(true)}>Show {MV.length - 6} more</button></li>}
                      {vmap.data.total > MV.length && <li className={`px-2.5 py-2 text-[11.5px] text-fg-3 ${!allVeh ? "hidden xl:list-item" : ""}`}>The {MV.length} most at risk of {fmtN(vmap.data.total)}; the full list is below the map.</li>}
                    </ul>
                  )}
                </div>
              </section>
            </aside>
            </div>
          </div>

          <section ref={table} className="card mb-5 flex scroll-mt-24 flex-col" aria-label="Vehicles to inspect">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 lg:px-5">
              <h2 className="text-[18px] font-bold tracking-tight">Vehicles to inspect{ev ? ` · ${monthYear(ev.date)} flood` : ""}</h2>
              {V && <span className="chip border-cyan/50 text-cyan">{fmtN(V.total)} vehicles</span>}
              {area && <button className="chip border-ink-500 text-fg-2 hover:border-cyan" onClick={() => setArea(null)}>{area.district} ✕</button>}
              <div className="flex flex-wrap gap-2"><Source kind="synthetic" text="Vehicles and districts: synthetic" /><Source kind="live_logic" text="Risk: scoring logic" /><Source kind="live_model" text="Flood model" /></div>
              <div className="ml-auto flex flex-wrap items-center gap-1.5" role="group" aria-label="Minimum risk">
                {RISK_FILTERS.map((f) => <FilterPill key={f.v} on={minRisk === f.v} onClick={() => setMinRisk(f.v)}>{f.l}</FilterPill>)}
              </div>
              {selected.length > 0 && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => invite(selected)}>Invite {selected.length} for flood inspection</button>}
            </div>
            {veh.error && !V ? <div className="px-4 pb-4"><ErrorState title="The vehicles to inspect could not load" onRetry={veh.reload}>{veh.error}</ErrorState></div>
              : !V ? <div className="px-4 pb-4"><LoadingState label="Ranking the registered vehicles by flood risk…" rows={4} /></div> : !V.items.length ? (
              <div className="px-4 pb-4">
                <Empty title={V.counts.exposed ? `No vehicle at risk ${minRisk} or more` : "No vehicle is exposed in this view"}>
                  {V.counts.exposed ? `${fmtN(V.counts.exposed)} vehicles are registered in exposed districts; lower the risk filter to see them.` : "Pick a past flood above, or wait for a JPS station to pass its alert level."}
                </Empty>
              </div>
            ) : (
              <>
                {/* from sm up a table (it pages, so it does not scroll on its own; sideways it scrolls inside the card) */}
                <div className="hidden px-3 sm:block lg:px-4">
                  <TableBox className="max-h-none">
                    <table className="w-full min-w-[940px] text-[13px]">
                      <thead className={THEAD}>
                        <tr><th className="w-10"></th><th>Vehicle</th><th>District and exposure</th><th>Risk</th><th>Recommendation</th><th>Why this vehicle</th><th></th></tr>
                      </thead>
                      <tbody>
                        {V.items.map((r: any) => {
                          const own = r.reasons.filter((x: any) => !x.district);  // the district's own reasons are in its column
                          return (
                            <tr key={r.vehicle_id} data-flood-vehicle={r.plate} className="border-b border-ink-600/60 align-top last:border-0 [&>td]:px-3 [&>td]:py-2.5" style={{ background: sel[r.plate] ? "rgba(37,99,235,0.06)" : undefined }}>
                              <td className="!pt-3">
                                <input type="checkbox" aria-label={`Select ${r.plate}`} disabled={!!r.invited_at} checked={!!sel[r.plate]} onChange={(e) => setSel((s) => ({ ...s, [r.plate]: e.target.checked }))} className="h-4 w-4 accent-cyan" />
                              </td>
                              <td>
                                <button className="text-left" onClick={() => { setPick(keyOf({ layer: "vehicles", id: r.plate })); if (r.lat != null) setFocus({ key: `t|${r.plate}|${Date.now()}`, lat: r.lat, lon: r.lon, zoom: 12 }); window.scrollTo({ top: 0, behavior: "smooth" }); }} title="Show on the map">
                                  <b className="text-[14px] hover:text-cyan">{r.plate}</b>
                                </button>
                                <div className="text-[11.5px] text-fg-2">{r.make} {r.model}</div><div className="text-[11.5px] text-fg-3">{r.vtype} · {r.fuel} · {r.year}</div>
                              </td>
                              <td className="max-w-[240px] text-[12.5px]">
                                {r.district} <span className="text-[11.5px] text-fg-3">{r.state}</span>
                                {r.exposure_headline && <ul className="mt-0.5 text-[11.5px] text-fg-2"><WhyDot r={{ text: r.exposure_headline, source: r.exposure_source }} /></ul>}
                              </td>
                              <td>
                                <span className="text-[22px] font-extrabold tracking-tight" style={{ color: bandColor(r.band) }}>{r.risk}</span>
                                <div className="whitespace-nowrap text-[11px] text-fg-3">exposure {r.exposure.toFixed(2)} · ×{r.susceptibility.toFixed(2)}</div>
                              </td>
                              <td><Pill color={REC_COL[r.recommendation]}><span className="whitespace-nowrap">{r.recommendation}</span></Pill></td>
                              <td className="text-[12px] text-fg-2">
                                <ul className="flex max-w-[400px] flex-col gap-0.5">{own.slice(0, 2).map((x: any, i: number) => <WhyDot key={i} r={x} />)}</ul>
                                {own.length > 2 && <span className="text-[11.5px] text-fg-4">+{own.length - 2} more in the details</span>}
                              </td>
                              <td className="text-right">
                                <button className="btn btn-sm" onClick={() => setOpen(r.plate)}>Details</button>
                                {r.invited_at && <div className="mt-1 text-[11px] text-ok">Invited</div>}
                                {vehicleRecordHref(r.plate) && <Link className="mt-1 block whitespace-nowrap text-[11.5px] font-semibold text-cyan hover:underline" href={vehicleRecordHref(r.plate)!}>Vehicle record ›</Link>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableBox>
                </div>
                {/* a phone: one card per vehicle, the risk, the recommendation and the details button in view */}
                <ul className="flex flex-col gap-2 px-3 sm:hidden" aria-label="Vehicles to inspect">
                  {V.items.map((r: any) => {
                    const own = r.reasons.filter((x: any) => !x.district);
                    return (
                      <li key={r.vehicle_id} data-flood-vehicle={r.plate} className="rounded-2xl p-3 ring-1 ring-ink-600/70" style={{ background: sel[r.plate] ? "rgba(37,99,235,0.08)" : "rgba(255,255,255,0.7)" }}>
                        <div className="flex items-start gap-2.5">
                          <input type="checkbox" aria-label={`Select ${r.plate}`} disabled={!!r.invited_at} checked={!!sel[r.plate]} onChange={(e) => setSel((x) => ({ ...x, [r.plate]: e.target.checked }))} className="mt-1 h-4 w-4 shrink-0 accent-cyan" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <span className="min-w-0">
                                <b className="block text-[14px]">{r.plate} <span className="font-medium text-fg-2">{r.make} {r.model}</span></b>
                                <span className="block text-[11.5px] text-fg-3">{r.district}, {r.state} · {r.vtype} · {r.year}</span>
                              </span>
                              <span className="shrink-0 text-[22px] font-extrabold leading-none tracking-tight" style={{ color: bandColor(r.band) }}>{r.risk}</span>
                            </div>
                            <ul className="mt-1.5 flex flex-col gap-0.5 text-[12px] text-fg-2">
                              {/* the vehicle's own reason (the district's is in the district list above) */}
                              {own.length ? <WhyDot r={own[0]} /> : r.exposure_headline && <WhyDot r={{ text: r.exposure_headline, source: r.exposure_source }} />}
                            </ul>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Pill color={REC_COL[r.recommendation]}>{r.recommendation}</Pill>
                              {r.invited_at && <span className="text-[11.5px] font-semibold text-ok">Invited</span>}
                              {vehicleRecordHref(r.plate) && <Link className="ml-auto text-[12px] font-semibold text-cyan" href={vehicleRecordHref(r.plate)!}>Vehicle record</Link>}
                              <button className={`btn btn-sm ${vehicleRecordHref(r.plate) ? "" : "ml-auto"}`} onClick={() => setOpen(r.plate)}>Details</button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[12.5px] text-fg-3 lg:px-5">
                  <span>{fmtN(V.counts.to_inspect)} to inspect of {fmtN(V.counts.exposed)} vehicles in exposed districts: {fmtN(V.counts.flood_inspection)} flood-damage inspections, {fmtN(V.counts.corrosion_check)} underbody corrosion checks · {fmtN(V.counts.high)} high risk</span>
                  <span className="flex items-center gap-2">
                    <button className="btn btn-sm" disabled={V.page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Previous</button>
                    <span>Page {V.page} of {V.pages}</span>
                    <button className="btn btn-sm" disabled={V.page >= V.pages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
                  </span>
                </div>
              </>
            )}
          </section>

          <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-start">
            <Panel title="Stations by state" action={<JpsSource s={src} short />}>
              <TableBox className="max-h-[420px]">
                <table className="w-full min-w-[420px] whitespace-nowrap text-[12.5px]">
                  <thead className={THEAD}><tr><th>State</th><th className="!text-right">Danger</th><th className="!text-right">Warning</th><th className="!text-right">Alert</th><th className="!text-right">Normal</th><th className="!text-right">No reading</th></tr></thead>
                  <tbody>
                    {o.by_state.map((r: any) => (
                      <tr key={r.state} className="border-b border-ink-600/60 last:border-0 [&>td]:px-3 [&>td]:py-[7px]">
                        <td>{r.state}</td>
                        {[...AT_RISK, "normal"].map((k) => <td key={k} className="text-right font-semibold tabular-nums" style={{ color: r[k] && k !== "normal" ? STATUS[k].c : undefined }}>{r[k] || <span className="text-fg-4">·</span>}</td>)}
                        <td className="text-right tabular-nums text-fg-3">{r.no_reading + r.no_thresholds || "·"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableBox>
              <p className="mt-2 text-[11.5px] text-fg-4">No reading: JPS shows 0.00 m, nothing, or a reading more than a day old; or the station has no published thresholds.</p>
            </Panel>
            <Panel title="Stations at alert or above, per fetch" action={<Source kind="real" text={`Real · ${trend.length} fetch${trend.length === 1 ? "" : "es"}`} />}>
              {trend.length >= 2 ? (
                <LineChart height={180} yMin={0} yFmt={(v) => String(Math.round(v))} xLabels={trend.map((p: any) => ({ x: p.x, label: p.t.slice(11, 16) }))} xTickEvery={Math.max(1, Math.ceil(trend.length / 6))}
                  series={[{ color: "#EA580C", dots: true, area: true, points: trend }]} />
              ) : <p className="text-[12.5px] text-fg-3">One fetch so far ({trend[0]?.y ?? 0} stations at alert or above). The line fills in as the data refreshes, every {o.source.ttl_min} minutes while someone has the page open.</p>}
              {o.rain?.wettest && (
                <div className="mt-3 rounded-xl bg-[#F4F7FB] p-3 text-[12.5px] text-fg-2 ring-1 ring-ink-600/60">
                  <b>Rain this week:</b> {o.rain.days_60mm} district-days of 60 mm or more across {o.rain.districts} districts. Wettest: {o.rain.wettest.district}, {o.rain.wettest.state}, {o.rain.wettest.max_mm} mm on {dmy(o.rain.wettest.max_day)}.
                </div>
              )}
            </Panel>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
            <Panel title="Invitations sent" action={<Source kind="mock" text="Mock: recorded, no message is sent" />}>
              {!inv.data?.length ? <p className="text-[12.5px] text-fg-3">None yet. Tick vehicles in the list, or open one, and invite the owners for a flood inspection.</p> : (
                <TableBox className="max-h-72">
                  <table className="w-full whitespace-nowrap text-[12.5px]">
                    <thead className={THEAD}><tr><th>Plate</th><th>District</th><th className="!text-right">Risk</th><th>For</th><th>When</th></tr></thead>
                    <tbody>
                      {inv.data.map((i) => (
                        <tr key={i.invite_id} className="border-b border-ink-600/60 last:border-0 [&>td]:px-3 [&>td]:py-2"><td><b>{i.plate}</b></td><td>{i.district}</td><td className="text-right font-semibold tabular-nums">{i.risk}</td><td>{i.recommendation}</td><td>{whenUtc(i.created_at)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </TableBox>
              )}
            </Panel>
            <Panel title="How it works" action={<Source kind="live_logic" text="Scoring real + synthetic data" />}>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[12.5px] text-fg-2">
                <li><b>River levels and rainfall</b> (real): JPS Public InfoBanjir, all states, read again every {o.source.ttl_min} minutes while the page is in use; the committed JPS snapshot when the site cannot be reached.</li>
                <li><b>Status</b>: each station against its own JPS thresholds. A 0.00 m level under a positive normal level, or a reading more than a day old, counts as no reading.</li>
                <li><b>Vehicles and their districts</b> (synthetic): fictional vehicles, each placed in a district of its registered state.</li>
                <li><b>Past floods</b>: the flood dates in the synthetic insurance claims; Dec 2021 and Nov 2024 match real floods (public record).</li>
                <li>
                  {/* the scoring formula is long: open on request */}
                  <details className="group">
                    <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden"><b>Risk</b>: <span className="font-medium text-cyan hover:underline group-open:hidden">how the score is worked out ›</span><span className="hidden font-medium text-cyan hover:underline group-open:inline">hide the formula</span></summary>
                    <p className="mt-1.5 rounded-xl bg-[#F4F7FB] px-3 py-2 ring-1 ring-ink-600/60">{o.method}</p>
                  </details>
                </li>
              </ul>
            </Panel>
          </div>
        </>
      )}
      <Modal open={!!open} onClose={close} title={open ? `${open} · flood and corrosion risk` : ""}>
        {detail.data && detail.data.plate === open ? <VehicleDetail d={detail.data} busy={busy} onInvite={() => invite([detail.data.plate])} />
          : detail.error ? <div className="w-[min(560px,calc(100vw-5rem))]"><ErrorState title={`${open}'s flood record could not load`} onRetry={detail.reload}>{detail.error}</ErrorState></div>
          : <div className="w-[min(560px,calc(100vw-5rem))]"><LoadingState label={`Loading ${open}'s flood and corrosion record…`} rows={4} /></div>}
      </Modal>
    </OversightShell>
  );
}

export default function Page() {
  return <Suspense><FloodWatch /></Suspense>;
}
