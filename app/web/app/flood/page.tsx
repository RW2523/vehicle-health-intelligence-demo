"use client";
/* Flood watch: JPS river levels and rainfall (real) x the vehicles registered in each district (synthetic) -> which
   vehicles need a flood-damage inspection or an underbody corrosion check, and why. */
import { useCallback, useEffect, useState } from "react";
import { LineChart } from "@/components/charts";
import { BORNEO_BOX, MALAYSIA, MalaysiaMap, PENINSULA } from "@/components/MalaysiaMap";
import { Shell } from "@/components/Shell";
import { Card, Empty, Kpi, Modal, PageHeader, Pill, Source, Tabs, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { dmy, fmtN, pct } from "@/lib/format";
import { useFetch } from "@/lib/live";

const STATUS: Record<string, { label: string; c: string; r: number }> = {
  danger: { label: "Danger", c: "#EF4444", r: 8 },
  warning: { label: "Warning", c: "#F97316", r: 7 },
  alert: { label: "Alert", c: "#FACC15", r: 6 },
  normal: { label: "Normal", c: "#34D399", r: 3.2 },
  no_reading: { label: "No reading", c: "#6F7E98", r: 2.6 },
  no_thresholds: { label: "No thresholds", c: "#9AA8BF", r: 2.6 },
};
const DRAW_ORDER = ["no_thresholds", "no_reading", "normal", "alert", "warning", "danger"];
const AT_RISK = ["danger", "warning", "alert"];
const REC_COL: Record<string, string> = { "Flood-damage inspection": "#F87171", "Underbody corrosion check": "#FBBF24", "No inspection needed yet": "#9AA8BF" };
const SRC: Record<string, { kind: string; text: string }> = {
  real: { kind: "real", text: "JPS" }, public_record: { kind: "real", text: "Public record" },
  synthetic: { kind: "synthetic", text: "Synthetic" }, live_model: { kind: "live_model", text: "Flood model" },
};
const SRC_DOT: Record<string, string> = { real: "#34D399", public_record: "#34D399", synthetic: "#FB923C", live_model: "#22D3EE" };
const REGIONS = [{ id: "my", label: "Malaysia", box: MALAYSIA }, { id: "pen", label: "Peninsular", box: PENINSULA }, { id: "bor", label: "Sabah & Sarawak", box: BORNEO_BOX }];
const RISK_FILTERS = [{ v: 70, l: "High risk (70+)" }, { v: 45, l: "All to inspect (45+)" }, { v: 0, l: "All exposed" }];

const bandColor = (b: string) => (b === "High" ? "#EF4444" : b === "Medium" ? "#F59E0B" : "#60A5FA");
const when = (iso?: string | null) => (iso ? `${dmy(iso.slice(0, 10))}, ${iso.slice(11, 16)}` : "–");
const monthYear = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const ago = (min: number) => (min < 90 ? `${min} min` : min < 60 * 48 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} days`);

/** Where the river data came from: JPS live (with the fetch time) or the committed snapshot. ``short`` for card headers. */
function JpsSource({ s, short = false }: { s: any; short?: boolean }) {
  if (!s) return null;
  const stale = s.mode === "live" && s.age_min > 2 * s.ttl_min ? ` (${ago(s.age_min)} ago)` : "";
  const text = s.mode === "live"
    ? short ? `Real · JPS ${s.fetched_at.slice(11, 16)}${stale}` : `Real · JPS Public InfoBanjir · fetched ${when(s.fetched_at)}${stale}`
    : short ? "Real · JPS snapshot" : `Real · JPS snapshot, fetched ${when(s.fetched_at)}`;
  return <Source kind="real" text={text} />;
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

/** A reason in the table: a dot in its source's colour instead of the full chip (the chips sit in the card header). */
function WhyDot({ r }: { r: any }) {
  return (
    <li className="flex items-start gap-2" title={SRC[r.source]?.text}>
      <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SRC_DOT[r.source] || "#9AA8BF" }} />
      <span className="min-w-0">{r.text}{r.effect && <span className="ml-1 text-fg-4">({r.effect})</span>}</span>
    </li>
  );
}

function StationMap({ stations, areas, box, selected, onStation }: { stations: any[]; areas: any[]; box: any; selected: string | null; onStation: (id: string) => void }) {
  const inBox = (lat: number, lon: number) => lat >= box.lat0 && lat <= box.lat1 && lon >= box.lon0 && lon <= box.lon1;
  const drawn = DRAW_ORDER.flatMap((k) => stations.filter((s) => s.status === k && s.lat != null && inBox(s.lat, s.lon)));
  return (
    <MalaysiaMap label="JPS water-level stations by status" bbox={box} className={box === PENINSULA ? "mx-auto max-w-[520px]" : ""}>{({ x, y }) => (<>
      {/* districts where a river is at alert or above (rain alone is not drawn) */}
      {areas.filter((a) => a.level_exposure > 0 && a.lat != null && inBox(a.lat, a.lon)).map((a) => (
        <circle key={a.state + a.district} cx={x(a.lon)} cy={y(a.lat)} r={11 + Math.min(16, a.to_inspect / 2)} fill="#22D3EE" fillOpacity="0.08" stroke="#22D3EE" strokeDasharray="4 3" strokeWidth="1.5">
          <title>{`${a.district}, ${a.state}: ${a.to_inspect} vehicles to inspect (exposure ${a.exposure.toFixed(2)})`}</title>
        </circle>
      ))}
      {drawn.map((s) => {
        const st = STATUS[s.status];
        const hollow = s.status === "no_thresholds";
        const on = s.id === selected;
        return (
          <circle key={s.id} cx={x(s.lon)} cy={y(s.lat)} r={on ? st.r + 2 : st.r} fill={hollow ? "none" : st.c} fillOpacity={s.status === "normal" ? 0.7 : 1}
            stroke={on ? "#FFFFFF" : hollow ? st.c : "#0B1220"} strokeWidth={on ? 2.5 : 0.8} className="cursor-pointer" onClick={() => onStation(s.id)}>
            <title>{`${s.name} (${s.district}, ${s.state}): ${st.label}${s.level != null ? ` · ${s.level.toFixed(2)} m` : ""}${s.position === "district" ? " · position approximate (near the district's main town)" : ""}`}</title>
          </circle>
        );
      })}
    </>)}</MalaysiaMap>
  );
}

function StationTrend({ h }: { h: any }) {
  const s = h.station;
  const series = h.jps_7d?.length ? h.jps_7d : h.recorded.filter((p: any) => p.level != null);
  const t0 = series.length ? new Date(series[0].t).getTime() : 0;
  const hx = (t: string) => (new Date(t).getTime() - t0) / 3.6e6;
  const days: { x: number; label: string }[] = [];
  series.forEach((p: any) => { if (p.t.slice(11, 13) === "00" || days.length === 0) days.push({ x: hx(p.t), label: p.t.slice(8, 10) + "/" + p.t.slice(5, 7) }); });
  // the three thresholds are often a few cm apart: only danger is labelled on the chart, the others in the legend
  const th = (["alert", "warning", "danger"] as const).filter((k) => s[k] != null && s[k] > 0);
  const hl = th.map((k) => ({ y: s[k], color: STATUS[k].c, label: k === "danger" ? "Danger" : undefined, dashed: true }));
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
        <Pill color={STATUS[s.status].c}>{STATUS[s.status].label}</Pill>
        <span><b>{s.level != null ? `${s.level.toFixed(2)} m` : "no reading"}</b> at {when(s.updated)}</span>
        {s.change && <span className="text-fg-3">{s.change.m > 0 ? "▲" : s.change.m < 0 ? "▼" : "="} {Math.abs(s.change.m).toFixed(2)} m since {s.change.since.slice(11, 16)}</span>}
        {s.note && <span className="text-fg-3">{s.note}</span>}
      </div>
      {series.length >= 2 ? (
        <LineChart height={200} yFmt={(v) => v.toFixed(1)} hlines={hl} xLabels={days} xTickEvery={Math.max(1, Math.ceil(days.length / 7))}
          series={[{ color: "#22D3EE", dots: !h.jps_7d?.length, points: series.map((p: any) => ({ x: hx(p.t), y: p.level })) }]} />
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
  return (
    <div className="flex w-[min(820px,calc(100vw-5rem))] flex-col gap-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-[34px] font-semibold leading-none" style={{ color: bandColor(d.band) }}>{d.risk}</span>
        <span className="flex flex-col"><b className="text-[15px]">{d.plate} · {d.make} {d.model}</b><span className="text-fg-3">{d.vtype} · {d.fuel} · {d.year} · {d.district}, {d.state} <span className="text-fg-4">(synthetic district)</span></span></span>
        <span className="ml-auto flex flex-wrap gap-2"><Pill color={bandColor(d.band)}>{d.band} risk</Pill><Pill color={REC_COL[d.recommendation]}>{d.recommendation}</Pill></span>
      </div>
      <section>
        <div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="h-title">How the score adds up</h3><Source kind="live_logic" text="Scoring logic" /></div>
        <p className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 font-mono text-[12px] text-fg-2">{d.how}</p>
      </section>
      <section>
        <h3 className="h-title mb-2">Why</h3>
        <ul className="flex flex-col gap-1.5">{d.reasons.map((r: any, i: number) => <Why key={i} r={r} />)}</ul>
        {!d.exposed && <p className="mt-2 text-fg-3">Not in an exposed district for this view: only the vehicle's own factors apply.</p>}
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
            <LineChart height={120} yMin={0} yMax={10} yFmt={(v) => String(v)} hlines={[{ y: 5, color: "#FBBF24", dashed: true }]}
              xLabels={corr.map((c: any, i: number) => ({ x: i, label: c.date.slice(2, 7) }))} series={[{ color: "#FB923C", dots: true, points: corr.map((c: any, i: number) => ({ x: i, y: c.corrosion })) }]} />
          ) : <p className="text-fg-3">{corr.length ? `${corr[0].corrosion}/10 on ${dmy(corr[0].date)}` : "No corrosion reading on record."}</p>}
          {d.flood_claims.length > 0 && (
            <ul className="mt-2 text-[12.5px] text-fg-2">
              {d.flood_claims.map((c: any) => <li key={c.date}>Flood claim {dmy(c.date)} · RM {fmtN(c.amount_rm)}{c.written_off ? " · written off" : ""}</li>)}
            </ul>
          )}
        </section>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-ink-600 pt-3">
        {d.invited_at ? <span className="text-ok">Invited {when(d.invited_at)}</span> : (
          <button className="btn btn-primary" disabled={busy} onClick={onInvite}>Invite for flood inspection</button>
        )}
        <Source kind="mock" text="Mock: recorded, no message is sent" />
      </div>
    </div>
  );
}

export default function FloodWatch() {
  const ov = useFetch<any>("/api/floodwatch");
  const src = ov.data?.source;
  const fetchedAt = src?.fetched_at;
  const st = useFetch<any>("/api/floodwatch/stations", undefined, [fetchedAt]);
  const [scope, setScope] = useState("live");
  const [minRisk, setMinRisk] = useState(45);
  const [area, setArea] = useState<{ state: string; district: string } | null>(null);
  const [page, setPage] = useState(1);
  const areas = useFetch<any>("/api/floodwatch/areas", { scope }, [fetchedAt]);
  const veh = useFetch<any>("/api/floodwatch/vehicles", { scope, min_risk: minRisk, page, page_size: 20, state: area?.state, district: area?.district }, [fetchedAt]);
  const inv = useFetch<any[]>("/api/floodwatch/invitations");
  const [station, setStation] = useState<string | null>(null);
  const hist = useFetch<any>(station ? `/api/floodwatch/stations/${encodeURIComponent(station)}/history` : null, undefined, [fetchedAt]);
  const [open, setOpen] = useState<string | null>(null);
  const detail = useFetch<any>(open ? `/api/floodwatch/vehicles/${encodeURIComponent(open)}` : null, { scope });
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [region, setRegion] = useState("my");
  const [allAreas, setAllAreas] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setOpen(null), []);

  // a fetch from JPS runs in the background when the data is older than 15 minutes: follow it, then everything reloads
  useEffect(() => {
    if (!src?.refreshing) return;
    const t = setInterval(ov.reload, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src?.refreshing]);
  useEffect(() => {
    if (station || !st.data) return;
    const worst = st.data.items.find((s: any) => AT_RISK.includes(s.status));
    if (worst) setStation(worst.id);
  }, [st.data, station]);
  useEffect(() => { setPage(1); setSel({}); }, [scope, minRisk, area]);

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
      inv.reload();
      if (open) detail.reload();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const o = ov.data;
  const events: any[] = o?.events || [];
  const ev = events.find((e) => e.id === scope);
  const V = veh.data;
  const A: any[] = areas.data?.items || [];
  const selected = Object.keys(sel).filter((k) => sel[k]);
  const box = REGIONS.find((r) => r.id === region)!.box;
  const trend = (o?.trend || []).map((t: any, i: number) => ({ x: i, y: AT_RISK.reduce((n, k) => n + (t.counts[k] || 0), 0), t: t.fetched_at }));
  return (
    <Shell>
      <PageHeader title="Flood watch"
        sub="River levels and rainfall from JPS for every state, set against the vehicles registered in each district: which cars need a flood-damage inspection or an underbody corrosion check, and why."
        actions={<>
          <JpsSource s={src} />
          <button className="btn" disabled={busy || src?.refreshing} onClick={refresh}>{src?.refreshing ? "Fetching from JPS…" : "Refresh from JPS"}</button>
        </>} />
      {!o ? <p className="text-fg-3">{ov.error ? `Could not load flood watch: ${ov.error}` : "Loading JPS river levels…"}</p> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {AT_RISK.map((k) => (
              <Kpi key={k} label={`Stations at ${STATUS[k].label.toLowerCase()}`} value={o.counts[k]} color={o.counts[k] ? STATUS[k].c : undefined}
                sub={k === "danger" ? "at or over the danger level" : k === "warning" ? "between warning and danger" : "between alert and warning"} />
            ))}
            <Kpi label="Stations normal" value={o.counts.normal} sub={`of ${o.total} · ${o.counts.no_reading} no reading · ${o.counts.no_thresholds} no thresholds`} />
            <div className="col-span-2 flex flex-col lg:col-span-1 [&>*]:flex-1">
              <Kpi label="Vehicles to inspect now" value={fmtN(o.live.to_inspect)} color="#22D3EE" right={<Source kind="synthetic" text="Synthetic" />}
                sub={`${fmtN(o.live.flood_inspection)} flood-damage inspections · ${fmtN(o.live.corrosion_check)} underbody corrosion checks`} />
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <Card title="Water-level stations" right={<JpsSource s={src} short />}>
                <div className="mb-2"><Tabs size="sm" value={region} onChange={setRegion} items={REGIONS.map((r) => ({ id: r.id, label: r.label }))} /></div>
                <StationMap stations={st.data?.items || []} areas={scope === "live" ? A : []} box={box} selected={station} onStation={setStation} />
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-fg-3">
                  {DRAW_ORDER.slice().reverse().map((k) => (
                    <span key={k} className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={k === "no_thresholds" ? { border: `1.5px solid ${STATUS[k].c}` } : { background: STATUS[k].c }} />{STATUS[k].label} {o.counts[k]}
                    </span>
                  ))}
                  {scope === "live" && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-dashed border-cyan" />district with a river at alert or above</span>}
                </div>
                <p className="mt-1.5 text-[11.5px] text-fg-4">
                  Click a station for its levels. {o.source.positions.jps} stations at their published position (JPS station list, data.gov.my); {o.source.positions.district || 0} without one are drawn near their district&apos;s main town.
                </p>
              </Card>
              <Card title="Stations at alert or above, per fetch" right={<Source kind="real" text={`Real · ${trend.length} fetch${trend.length === 1 ? "" : "es"}`} />}>
                {trend.length >= 2 ? (
                  <LineChart height={120} yMin={0} yFmt={(v) => String(Math.round(v))} xLabels={trend.map((p: any) => ({ x: p.x, label: p.t.slice(11, 16) }))} xTickEvery={Math.max(1, Math.ceil(trend.length / 6))}
                    series={[{ color: "#F97316", dots: true, area: true, points: trend }]} />
                ) : <p className="text-[12.5px] text-fg-3">One fetch so far ({trend[0]?.y ?? 0} stations at alert or above). The line fills in as the data refreshes, every {o.source.ttl_min} minutes while someone has the page open.</p>}
              </Card>
            </div>
            <Card title="Stations by state" right={<JpsSource s={src} short />}>
              {/* six columns do not fit a phone: the table scrolls inside the card */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] whitespace-nowrap text-left text-[12.5px]">
                  <thead className="text-fg-3"><tr><th className="pb-1">State</th><th className="text-right">Danger</th><th className="text-right">Warning</th><th className="text-right">Alert</th><th className="text-right">Normal</th><th className="text-right">No reading</th></tr></thead>
                  <tbody>
                    {o.by_state.map((r: any) => (
                      <tr key={r.state} className="border-t border-ink-600">
                        <td className="py-[5px] pr-3">{r.state}</td>
                        {[...AT_RISK, "normal"].map((k) => <td key={k} className="text-right font-semibold" style={{ color: r[k] && k !== "normal" ? STATUS[k].c : undefined }}>{r[k] || <span className="text-fg-4">·</span>}</td>)}
                        <td className="text-right text-fg-3">{r.no_reading + r.no_thresholds || "·"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11.5px] text-fg-4">No reading: JPS shows 0.00 m, nothing, or a reading more than a day old; or the station has no published thresholds.</p>
            </Card>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Tabs value={scope} onChange={(v: string) => { setScope(v); setArea(null); }}
              items={[{ id: "live", label: "Now · live JPS" }, ...events.map((e) => ({ id: e.id, label: `${monthYear(e.date)}${e.real ? ` · ${e.title.split(",")[0]}` : " · claims"}` }))]} />
          </div>
          {ev && (
            <div className="mb-4 flex flex-wrap items-start gap-3 rounded-xl border border-ink-600 bg-ink-850 px-4 py-3 text-[13px]">
              <div className="min-w-0 flex-1">
                <b>{ev.title}</b> · {fmtN(ev.claims)} flood claims on {dmy(ev.date)} ({ev.states.map((s: any) => `${s.state} ${s.claims}`).join(", ")})
                <p className="mt-1 text-fg-3">{ev.note}</p>
              </div>
              <div className="flex flex-wrap gap-2">{ev.real && <Source kind="real" text="Event: public record" />}<Source kind="synthetic" text="Claims: synthetic" /></div>
            </div>
          )}

          <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title={ev ? "Districts hit" : "Districts at risk"}
              right={<>{ev ? <Source kind={ev.real ? "real" : "synthetic"} text={ev.real ? "Public record" : "Synthetic claims"} /> : <JpsSource s={src} short />}<Source kind="live_logic" text="Exposure logic" /></>}>
              {!A.length ? (
                <Empty title="No district is exposed right now">No JPS station is above its alert level and no district had 60 mm of rain in a day this week. Pick a past flood above to see the ranking at work.</Empty>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {(allAreas ? A : A.slice(0, 5)).map((a) => {
                    const on = area?.state === a.state && area?.district === a.district;
                    const sc = Object.entries(a.stations || {}).filter(([, n]) => n).map(([k, n]) => `${n} ${STATUS[k]?.label.toLowerCase() || k}`).join(" · ");
                    return (
                      <button key={a.state + a.district} onClick={() => setArea(on ? null : { state: a.state, district: a.district })}
                        className={`rounded-lg border px-3 py-2 text-left text-[12.5px] transition ${on ? "border-cyan bg-ink-750" : "border-ink-600 bg-ink-850 hover:border-ink-500"}`}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <b className="text-[13.5px]">{a.district}</b><span className="text-fg-3">{a.state}</span>
                          <span className="ml-auto text-fg-2"><b className="text-cyan">{a.to_inspect}</b> to inspect of {a.vehicles} registered</span>
                        </div>
                        <div className="my-1.5 h-1.5 rounded bg-ink-600"><div className="h-1.5 rounded" style={{ width: `${Math.max(3, a.exposure * 100)}%`, background: a.exposure >= 0.6 ? "#EF4444" : a.exposure >= 0.3 ? "#F97316" : "#FACC15" }} /></div>
                        <div className="text-fg-2">{a.reasons[0]?.text}</div>
                        {(a.reasons.length > 1 || sc) && <div className="mt-0.5 text-[11.5px] text-fg-3">{a.reasons.slice(1).map((r: any) => r.text).join(" · ")}{a.reasons.length > 1 && sc ? " · " : ""}{sc && `stations: ${sc}`}</div>}
                      </button>
                    );
                  })}
                  {A.length > 5 && <button className="btn btn-sm self-start" onClick={() => setAllAreas((x) => !x)}>{allAreas ? "Show fewer" : `Show all ${A.length} districts`}</button>}
                </div>
              )}
            </Card>
            <Card title={hist.data ? `${hist.data.station.name} · ${hist.data.station.district}, ${hist.data.station.state}` : "Station levels"}>
              {hist.data ? <StationTrend h={hist.data} /> : <p className="text-[12.5px] text-fg-3">{station ? "Loading the station's levels…" : "Click a station on the map to see its water level against its thresholds."}</p>}
            </Card>
          </div>

          <section className="card mb-4 flex flex-col">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <h2 className="h-title">Vehicles to inspect{ev ? ` · ${monthYear(ev.date)} flood` : ""}</h2>
              {V && <span className="chip border-cyan/50 text-cyan">{fmtN(V.total)} vehicles</span>}
              {area && <button className="chip border-ink-500 text-fg-2 hover:border-cyan" onClick={() => setArea(null)}>{area.district} ✕</button>}
              <div className="flex flex-wrap gap-2"><Source kind="synthetic" text="Vehicles and districts: synthetic" /><Source kind="live_logic" text="Risk: scoring logic" /><Source kind="live_model" text="Flood model" /></div>
              <div className="ml-auto flex flex-wrap items-center gap-1" role="group" aria-label="Minimum risk">
                {RISK_FILTERS.map((f) => <button key={f.v} className={`btn btn-sm ${minRisk === f.v ? "btn-primary" : ""}`} onClick={() => setMinRisk(f.v)}>{f.l}</button>)}
              </div>
              {selected.length > 0 && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => invite(selected)}>Invite {selected.length} for flood inspection</button>}
            </div>
            {!V ? <p className="px-4 pb-4 text-fg-3">Ranking vehicles…</p> : !V.items.length ? (
              <div className="px-4 pb-4">
                <Empty title={V.counts.exposed ? `No vehicle at risk ${minRisk} or more` : "No vehicle is exposed in this view"}>
                  {V.counts.exposed ? `${fmtN(V.counts.exposed)} vehicles are registered in exposed districts; lower the risk filter to see them.` : "Pick a past flood above, or wait for a JPS station to pass its alert level."}
                </Empty>
              </div>
            ) : (
              <>
                {/* seven columns do not fit a phone: the table scrolls inside the card, not the page */}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[940px] text-left text-[13px]">
                    <thead className="border-y border-ink-600 bg-ink-850 text-[12px] text-fg-3">
                      <tr><th className="w-10 px-4 py-2"></th><th>Vehicle</th><th>District and exposure</th><th>Risk</th><th>Recommendation</th><th>Why this vehicle</th><th className="pr-4"></th></tr>
                    </thead>
                    <tbody>
                      {V.items.map((r: any) => {
                        const own = r.reasons.filter((x: any) => !x.district);  // the district's own reasons are in its column
                        return (
                          <tr key={r.vehicle_id} data-flood-vehicle={r.plate} className="border-b border-ink-700 align-top" style={{ background: sel[r.plate] ? "rgba(34,211,238,0.06)" : undefined }}>
                            <td className="px-4 pt-3">
                              <input type="checkbox" aria-label={`Select ${r.plate}`} disabled={!!r.invited_at} checked={!!sel[r.plate]} onChange={(e) => setSel((s) => ({ ...s, [r.plate]: e.target.checked }))} className="h-4 w-4 accent-cyan" />
                            </td>
                            <td className="py-2.5 pr-3"><b className="text-[14px]">{r.plate}</b><div className="text-[11.5px] text-fg-2">{r.make} {r.model}</div><div className="text-[11.5px] text-fg-3">{r.vtype} · {r.fuel} · {r.year}</div></td>
                            <td className="max-w-[240px] py-2.5 pr-3 text-[12.5px]">
                              {r.district} <span className="text-[11.5px] text-fg-3">{r.state}</span>
                              {r.exposure_headline && <ul className="mt-0.5 text-[11.5px] text-fg-2"><WhyDot r={{ text: r.exposure_headline, source: r.exposure_source }} /></ul>}
                            </td>
                            <td className="py-2.5 pr-3">
                              <span className="font-display text-[20px] font-semibold" style={{ color: bandColor(r.band) }}>{r.risk}</span>
                              <div className="whitespace-nowrap text-[11px] text-fg-3">exposure {r.exposure.toFixed(2)} · ×{r.susceptibility.toFixed(2)}</div>
                            </td>
                            <td className="py-2.5 pr-3"><Pill color={REC_COL[r.recommendation]}><span className="whitespace-nowrap">{r.recommendation}</span></Pill></td>
                            <td className="py-2.5 pr-3 text-[12px] text-fg-2">
                              <ul className="flex max-w-[400px] flex-col gap-0.5">{own.slice(0, 2).map((x: any, i: number) => <WhyDot key={i} r={x} />)}</ul>
                              {own.length > 2 && <span className="text-[11.5px] text-fg-4">+{own.length - 2} more in the details</span>}
                            </td>
                            <td className="py-2.5 pr-4 text-right">
                              <button className="btn btn-sm" onClick={() => setOpen(r.plate)}>Details</button>
                              {r.invited_at && <div className="mt-1 text-[11px] text-ok">Invited</div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[12.5px] text-fg-3">
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

          <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="Invitations sent" right={<Source kind="mock" text="Mock: recorded, no message is sent" />}>
              {!inv.data?.length ? <p className="text-[12.5px] text-fg-3">None yet. Tick vehicles in the list, or open one, and invite the owners for a flood inspection.</p> : (
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-left text-[12.5px]">
                    <thead className="text-fg-3"><tr><th>Plate</th><th>District</th><th>Risk</th><th>For</th><th>When</th></tr></thead>
                    <tbody>
                      {inv.data.map((i) => (
                        <tr key={i.invite_id} className="border-t border-ink-600"><td className="py-1.5 pr-2"><b>{i.plate}</b></td><td className="pr-2">{i.district}</td><td className="pr-2">{i.risk}</td><td className="pr-2">{i.recommendation}</td><td className="whitespace-nowrap">{when(i.created_at)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title="How it works" right={<Source kind="live_logic" text="Scoring logic over real + synthetic data" />}>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[12.5px] text-fg-2">
                <li><b>River levels and rainfall</b> (real): JPS Public InfoBanjir, all states, read again every {o.source.ttl_min} minutes while the page is in use; the committed JPS snapshot when the site cannot be reached.</li>
                <li><b>Status</b>: each station against its own JPS thresholds. A 0.00 m level under a positive normal level, or a reading more than a day old, counts as no reading.</li>
                <li><b>Vehicles and their districts</b> (synthetic): fictional vehicles, each placed in a district of its registered state.</li>
                <li><b>Past floods</b>: the flood dates in the synthetic insurance claims; Dec 2021 and Nov 2024 match real floods (public record).</li>
                <li><b>Risk</b>: {o.method}</li>
              </ul>
            </Card>
          </div>
        </>
      )}
      <Modal open={!!open} onClose={close} title={open ? `${open} · flood and corrosion risk` : ""}>
        {detail.data && detail.data.plate === open ? <VehicleDetail d={detail.data} busy={busy} onInvite={() => invite([detail.data.plate])} /> : <p className="text-fg-3">Loading…</p>}
      </Modal>
    </Shell>
  );
}
