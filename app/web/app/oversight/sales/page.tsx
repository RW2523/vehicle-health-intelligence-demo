"use client";
/* Oversight > Used-vehicle sales: every car and motorcycle advertised for sale, and each one's whole record
   (?id=LS0001). Buyers see the same record in the mobile app. */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { LineChart } from "@/components/charts";
import { visitStep } from "@/components/Demo";
import { Panel, StatusPill } from "@/components/glass";
import { Icon } from "@/components/icons";
import { ImageCard, ImageViewer, LibImage } from "@/components/ImageViewer";
import { OversightShell, useEdgeFade } from "@/components/OversightShell";
import { FLAGS, PRICES, RESULT_COL, rm, TRUST_COL, TRUST_MARK, VehicleThumb } from "@/components/sales";
import { Empty, ErrorState, LoadingState, Modal, PageHeader, Pill, ScoreRing, Source, Tabs } from "@/components/ui";
import { nextFailNote, dmy, fmtN, pct, scoreColor } from "@/lib/format";
import { useFetch } from "@/lib/live";
import { FilterPill, FlowSteps, OvStat, THEAD, TableBox, useNarrow, vehicleRecordHref } from "../parts";

const BASE = "/oversight/sales";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} '${iso.slice(2, 4)}`;
const days = (iso: string) => new Date(iso + "T00:00:00").getTime() / 86_400_000;
const num = (v: number) => fmtN(v, Math.abs(v) < 10 ? 2 : Math.abs(v) < 100 ? 1 : 0);
const TRUST_TONE: Record<string, "green" | "amber" | "red" | "blue"> = { ok: "green", warn: "amber", bad: "red", info: "blue" };
/** The buyer's path through a listing; the listings and each record show where the user is on it. */
const SALE_STEPS = ["Search", "Vehicle record", "Red flags/history", "Latest report", "Public verification"];

function Filter({ label, value, options, onChange }: { label: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="flex min-w-[150px] flex-1 flex-col gap-1 sm:flex-none">
      <span className="text-[12px] font-medium text-fg-3">{label}</span>
      <select aria-label={label} className="input h-10 py-0" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

/** The next-inspection fail risk's colour: green, amber from 25%, red from 45%. */
const riskColor = (p: number) => (p >= 0.45 ? "#DC2626" : p >= 0.25 ? "#D97706" : "#059669");

/** The record in one line, for the phone cards: inspections, odometer, claims, fault codes. */
function RecordLine({ r }: { r: any }) {
  const b = r.badges;
  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11.5px] text-fg-3">
      <span>{b.inspections} inspection{b.inspections === 1 ? "" : "s"} · <b style={{ color: RESULT_COL[b.last_result] }}>{b.last_result || "none"}</b></span>
      {b.next_fail != null && <span><b style={{ color: riskColor(b.next_fail) }}>{pct(b.next_fail)}</b> next-test risk</span>}
      {!b.odometer_ok && <b className="text-bad">Rollback {fmtN(b.rollback_km)} km</b>}
      {b.flood_claims > 0 && <b className="text-bad">Flood claim</b>}
      {b.accident_claims > 0 && <span className="text-warn">{b.accident_claims} accident{b.accident_claims > 1 ? "s" : ""}</span>}
      {b.open_obd.length > 0 && <span className="font-mono text-warn">{b.open_obd.join(", ")}</span>}
    </span>
  );
}

function Listings() {
  const sp = useSearchParams();
  const router = useRouter();
  const kind = sp.get("kind") || "";
  const flag = sp.get("flag") || "";
  const state = sp.get("state") || "";
  const max = sp.get("max") || "";
  const [q, setQ] = useState(sp.get("q") || "");
  // a phone shows cards, ten at a time; a wider screen the table, twenty at a time
  const narrow = useNarrow();
  const per = narrow ? 10 : 20;
  const [shown, setShown] = useState(20);
  useEffect(() => setShown(per), [per]);
  // the newest filters, including a change whose navigation has not landed yet: building on the current URL instead
  // lets a quick second change (typing right after picking a tab) undo the first
  const next = useRef<string | null>(null);
  useEffect(() => {
    if (next.current === sp.toString()) next.current = null;
  }, [sp]);
  const set = (patch: Record<string, string>) => {
    setShown(per);
    const u = new URLSearchParams(next.current ?? sp.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? u.set(k, v) : u.delete(k)));
    next.current = u.toString();
    router.replace(u.toString() ? `${BASE}?${u}` : BASE, { scroll: false });
  };
  // the type, search, state and price filters ask the API; the record filter applies here, so the counts on the tiles
  // and the record pills follow the other filters (each pill says how many it would show)
  const { data: d, error } = useFetch<any>("/api/sales", { kind, state, max_price: max, q });
  const scope: any[] = d?.listings || [];
  const list = flag ? scope.filter((r) => r.trust.flags.includes(flag)) : scope;
  const c = d ? {
    car: scope.filter((r) => r.kind === "car").length, motorcycle: scope.filter((r) => r.kind === "motorcycle").length,
    flagged: scope.filter((r) => r.trust.level === "bad").length,
    ...Object.fromEntries(FLAGS.map((f) => [f.id, scope.filter((r) => r.trust.flags.includes(f.id)).length])),
  } as Record<string, number> : null;
  const scoped = !!(kind || state || max || q);
  const filtered = scoped || !!flag;
  const ofAll = scoped && d ? ` · of ${d.total} listed` : "";
  return (
    <>
      <PageHeader eyebrow="Oversight · Used-vehicle sales" title="Used-vehicle sales"
        sub="Every car and motorcycle advertised for sale, with its whole record: inspections, odometer readings, OBD fault codes, insurance claims and photos. Buyers see the same record in the mobile app."
        actions={<><Source kind="synthetic" text="Synthetic listings" /><Link className="btn" href="/mobile?tab=sale"><Icon name="owner" size={15} />What the buyer sees<Icon name="arrow" size={15} /></Link></>} />
      {!c ? (
        <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="card p-4"><LoadingState label="" rows={2} /></div>)}</div>
      ) : (
        <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <OvStat icon="sale" tone="blue" label={scoped ? "For sale, matching" : "For sale"} value={scope.length} sub={`${c.car} cars · ${c.motorcycle} motorcycles${ofAll}`} />
          <OvStat icon="warn" tone="red" alert={!!c.flagged} label="Serious red flags" value={c.flagged} sub="Rollback, flood, write-off or failed test" />
          <OvStat icon="trend" tone="red" alert={!!c.rollback} label="Odometer rollbacks" value={c.rollback} sub="Readings lower than an earlier one"
            onClick={() => set({ flag: flag === "rollback" ? "" : "rollback" })} pressed={flag === "rollback"} />
          <OvStat icon="checkc" tone="green" alert label="No red flags" value={c.clean} sub="Clean record end to end"
            onClick={() => set({ flag: flag === "clean" ? "" : "clean" })} pressed={flag === "clean"} />
        </div>
      )}
      <section className="card mb-5 flex flex-col gap-4 p-4 lg:p-5" aria-label="Filters">
        <div className="flex flex-col gap-2 border-b border-ink-600/70 pb-3.5 xl:flex-row xl:items-center xl:gap-4">
          <FlowSteps steps={SALE_STEPS} at={0} label="Checking a used vehicle" className="xl:shrink-0" />
          <p className="min-w-0 text-[12.5px] leading-snug text-fg-2 xl:ml-auto xl:text-right">Search by plate, make or model, then open a vehicle for its whole record.</p>
        </div>
        {/* one height for every control in the row: the segmented control, the search box and the two selects */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-fg-3">Vehicle type</span>
            <div className="[&>[role=tablist]]:h-10 [&>[role=tablist]]:items-center [&>[role=tablist]]:py-0">
              <Tabs value={kind} onChange={(v: string) => set({ kind: v })}
                items={[{ id: "", label: "All" }, { id: "car", label: "Cars" }, { id: "motorcycle", label: "Motorcycles" }]} />
            </div>
          </div>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-[12px] font-medium text-fg-3">Search</span>
            <span className="flex h-10 items-center gap-2 rounded-xl border border-ink-500/80 bg-white/90 px-3 focus-within:border-cyan focus-within:ring-4 focus-within:ring-blue-100">
              <Icon name="search" size={16} color="#64748B" />
              <input className="w-full bg-transparent text-[13px] focus:outline-none" aria-label="Search listings" placeholder="Plate, make or model" value={q}
                onChange={(e) => { setQ(e.target.value); set({ q: e.target.value }); }} />
            </span>
          </label>
          <Filter label="State" value={state} onChange={(v) => set({ state: v })} options={[{ v: "", l: "All states" }, ...(d?.states || []).map((s: string) => ({ v: s, l: s }))]} />
          <Filter label="Price" value={max} onChange={(v) => set({ max: v })} options={[{ v: "", l: "Any price" }, ...PRICES.map((p) => ({ v: String(p), l: `Up to ${rm(p)}` }))]} />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[12px] font-medium text-fg-3">Record</span>
          <PillRow>
            <FilterPill on={!flag} onClick={() => set({ flag: "" })} count={scoped ? scope.length : undefined}>Any record</FilterPill>
            {FLAGS.map((f) => (
              <FilterPill key={f.id} on={flag === f.id} onClick={() => set({ flag: flag === f.id ? "" : f.id })} count={c?.[f.id]} tone={f.id === "clean" ? "green" : "red"}>{f.label}</FilterPill>
            ))}
          </PillRow>
        </div>
      </section>
      <Panel pad={false} title={<span className="flex flex-wrap items-center gap-2.5"><h2 className="text-[18px] font-bold tracking-tight">Listings</h2>{d && <span className="chip border-ink-500 text-fg-2">{list.length} of {d.total}</span>}<span className="text-[12.5px] text-fg-3">Newest first · click a vehicle for its whole record</span></span>}
        action={<><Source kind="synthetic" text="Synthetic history" /><Source kind="live_model" text="Next-test risk model" /></>}>
        <div className="px-3 pb-3 lg:px-4 lg:pb-4">
          {error ? <ErrorState title="The listings could not load">{error}</ErrorState> : !d ? <LoadingState label="Loading listings…" rows={4} /> : !list.length ? (
            <Empty title="Nothing matches" actions={<Link className="btn" href={BASE}>Clear the filters</Link>}>No listing matches these filters.</Empty>
          ) : (
            <>
              {/* a phone: one card per listing, the price and the buyer check in view */}
              <ul className="flex flex-col gap-2 sm:hidden" aria-label="Listings">
                {list.slice(0, shown).map((r: any) => (
                  <li key={r.listing_id}>
                    <Link href={`${BASE}?id=${r.listing_id}`} className="flex gap-3 rounded-2xl bg-white/70 p-3 ring-1 ring-ink-600/70 transition active:bg-white">
                      <VehicleThumb src={r.photo} vtype={r.vtype} className="h-16 w-20 shrink-0 rounded-xl" icon={18} />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <b className="text-[14px]">{r.plate}</b>
                          <b className="whitespace-nowrap text-[14px] tabular-nums">{rm(r.asking_price_rm)}</b>
                        </span>
                        <span className="text-[12px] leading-snug text-fg-2">{r.make} {r.model} · {r.year} · {fmtN(r.odometer_km)} km</span>
                        <span><StatusPill tone={TRUST_TONE[r.trust.level] || "gray"} dot>{r.trust.label}</StatusPill></span>
                        <RecordLine r={r} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {/* from sm up a table: the key columns first; it scrolls inside the card, its edge fading while more is hidden */}
              <div className="hidden sm:block">
                <TableBox className="max-h-none">
                  <table className="w-full min-w-[1080px] text-[13px]">
                    <thead className={THEAD}>
                      <tr><th>Vehicle</th><th className="!text-right">Asking price</th><th>Buyer check</th><th>Inspections</th><th className="!text-right">Next-test risk</th><th>Odometer</th><th>Claims</th><th>OBD</th><th>Seller</th></tr>
                    </thead>
                    <tbody>
                      {list.slice(0, shown).map((r: any) => {
                        const b = r.badges;
                        return (
                          <tr key={r.listing_id} className="cursor-pointer border-b border-ink-600/60 align-top transition last:border-0 hover:bg-blue-50/50 [&>td]:px-3 [&>td]:py-2.5" onClick={() => router.push(`${BASE}?id=${r.listing_id}`)}>
                            <td>
                              <div className="flex items-center gap-3">
                                <VehicleThumb src={r.photo} vtype={r.vtype} className="h-12 w-[72px] shrink-0 rounded-xl" icon={18} />
                                <span className="flex flex-col">
                                  <Link href={`${BASE}?id=${r.listing_id}`} onClick={(e) => e.stopPropagation()} className="text-[14px] font-bold hover:text-cyan">{r.plate}</Link>
                                  <span className="text-[11.5px] text-fg-2">{r.make} {r.model} · {r.year}</span>
                                  <span className="text-[11.5px] text-fg-3">{r.vtype} · {fmtN(r.odometer_km)} km{r.images ? ` · ${r.images} photo${r.images > 1 ? "s" : ""}` : ""}</span>
                                  {vehicleRecordHref(r.plate) && (
                                    <Link href={vehicleRecordHref(r.plate)!} onClick={(e) => e.stopPropagation()} className="text-[11.5px] font-semibold text-cyan hover:underline"
                                      title="This vehicle's record in the inspection app">Inspection app record ›</Link>
                                  )}
                                </span>
                              </div>
                            </td>
                            <td className="whitespace-nowrap text-right"><b className="tabular-nums">{rm(r.asking_price_rm)}</b><div className="text-[11.5px] text-fg-3">listed {dmy(r.listed_at)}</div></td>
                            <td><StatusPill tone={TRUST_TONE[r.trust.level] || "gray"} dot>{r.trust.label}</StatusPill></td>
                            <td className="whitespace-nowrap">{b.inspections} · <b style={{ color: RESULT_COL[b.last_result] }}>{b.last_result || "none"}</b><div className="text-[11.5px] text-fg-3">latest {dmy(b.last_date)}</div></td>
                            <td className="whitespace-nowrap text-right" title={b.next_fail != null ? "Chance of failing the next inspection (risk model)" : r.vtype === "Motorcycle" ? "The risk model covers cars and heavier vehicles" : "No inspection to score"}>
                              {b.next_fail != null ? <b className="tabular-nums" style={{ color: riskColor(b.next_fail) }}>{pct(b.next_fail)}</b> : <span className="text-fg-3">Not scored</span>}
                              {b.health != null && <div className="text-[11.5px] text-fg-3">health <b style={{ color: scoreColor(b.health) }}>{b.health}</b></div>}
                            </td>
                            <td className="whitespace-nowrap">{b.odometer_ok ? <span className="text-ok">✓ Consistent</span> : <b className="text-bad">Rollback {fmtN(b.rollback_km)} km</b>}</td>
                            <td className="text-[12.5px]">
                              {!b.flood_claims && !b.accident_claims && <span className="text-fg-3">none</span>}
                              {b.flood_claims > 0 && <div className="font-semibold text-bad">Flood</div>}
                              {b.accident_claims > 0 && <div className="whitespace-nowrap text-warn">{b.accident_claims} accident{b.accident_claims > 1 ? "s" : ""}</div>}
                            </td>
                            <td className="font-mono text-[12px]">{b.open_obd.length ? <span className="text-warn">{b.open_obd.join(", ")}</span> : <span className="font-sans text-fg-3">no codes</span>}</td>
                            <td>{r.seller === "dealer" ? "Dealer" : "Private"}<div className="text-[11.5px] text-fg-3">{r.state}</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableBox>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-[12.5px] text-fg-3">
                <span>Showing {Math.min(shown, list.length)} of {list.length}{filtered && <> · <Link className="font-semibold text-cyan hover:underline" href={BASE}>clear the filters</Link></>}</span>
                {shown < list.length && (
                  <span className="flex gap-2">
                    <button className="btn btn-sm" onClick={() => setShown((n) => n + per)}>Show {Math.min(per, list.length - shown)} more</button>
                    <button className="btn btn-sm" onClick={() => setShown(list.length)}>Show all</button>
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </Panel>
    </>
  );
}

/** The record pills: one row that scrolls sideways, its edge fading while more pills are hidden. */
function PillRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEdgeFade(ref);
  return <div ref={ref} role="group" aria-label="Record" className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">{children}</div>;
}

function OdometerChart({ odo }: { odo: any }) {
  const pts = odo.points;
  const x0 = days(pts[0].date);
  const span = Math.max(30, days(pts[pts.length - 1].date) - x0);
  const bad = new Set(odo.rollbacks.map((e: any) => `${e.date}|${e.km}`));
  // newest label first; an older one only where it does not collide with the next
  const labels: { x: number; label: string }[] = [];
  for (const p of [...pts].reverse()) {
    const x = days(p.date) - x0;
    if (!labels.length || labels[labels.length - 1].x - x >= span * 0.16) labels.push({ x, label: short(p.date) });
  }
  return (
    <LineChart height={210} yFmt={(v) => `${Math.round(v / 1000)}k`} xLabels={labels}
      series={[
        { color: "transparent", width: 0, points: [{ x: -span * 0.05, y: pts[0].km }, { x: span * 1.05, y: pts[0].km }] },  // room for the end labels
        { color: "#3B82F6", width: 2.4, dots: true, points: pts.map((p: any) => ({ x: days(p.date) - x0, y: p.km })) },
      ]}
      markers={[
        ...pts.filter((p: any) => bad.has(`${p.date}|${p.km}`)).map((p: any) => ({ x: days(p.date) - x0, y: p.km, color: "#DC2626", ring: true, r: 9 })),
        ...pts.filter((p: any) => p.source === "Seller's advert").map((p: any) => ({ x: days(p.date) - x0, y: p.km, color: "#2563EB", square: true })),
      ]} />
  );
}

function Dossier({ id }: { id: string }) {
  const { data: d, error } = useFetch<any>(`/api/sales/${id}`);
  const [viewer, setViewer] = useState<number | null>(null);
  const [lane, setLane] = useState<any>(null);
  const [showReport, setShowReport] = useState(false);
  const back = <Link href={BASE} className="btn">‹ All listings</Link>;
  if (error) return <Empty title="Listing not found" actions={back}>{error}</Empty>;
  if (!d) return <div className="card p-5"><LoadingState label="Loading the record…" rows={5} /></div>;
  const x = d.listing, v = d.vehicle, t = d.trust, odo = d.odometer, h = d.health;
  const lib: LibImage[] = d.images.library;
  const ins = [...d.inspections].reverse();
  const thumb = d.images.photo || lib[0]?.web_url || d.images.lane[0]?.url;
  const record = vehicleRecordHref(v.plate);
  const verifyHref = d.report ? `/verify/${d.report.verify_token}` : null;
  return (
    <>
      <PageHeader eyebrow={<Link href={BASE} className="hover:text-cyan">Oversight · Used-vehicle sales</Link>} title={`${v.plate} · ${v.make} ${v.model} ${v.year}`}
        sub="The whole record a buyer should see before paying: every inspection, the odometer, fault codes, claims and photos."
        actions={<>{back}{record && <Link className="btn" href={record}>Record in the inspection app<Icon name="arrow" size={15} /></Link>}</>} />
      <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-white/80 bg-white/70 px-3.5 py-2.5 shadow-glass xl:flex-row xl:items-center xl:gap-4">
        <FlowSteps steps={SALE_STEPS} at={showReport ? 3 : 2} label="Checking this vehicle" className="xl:shrink-0"
          links={[BASE, null, "#record", d.report ? "#report" : null, verifyHref]} />
        <p className="min-w-0 text-[12.5px] leading-snug text-fg-2 xl:ml-auto xl:text-right">
          {!d.report ? "Check the red flags and the history below. No lane report has been issued for this vehicle yet, so there is nothing to verify."
            : showReport ? "Then verify the report: the public page re-checks it without a login, as a buyer would."
            : "Check the red flags and the history, then review the latest report and verify it."}
        </p>
      </div>
      <section className="card mb-5 flex flex-wrap items-center gap-5 p-4 lg:p-5">
        <VehicleThumb src={thumb} vtype={v.vtype} className="h-28 w-44 shrink-0 rounded-2xl" icon={34} />
        <div className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className="text-[28px] font-extrabold tracking-tight">{rm(x.asking_price_rm)}</span>
          <span className="text-[13.5px] text-fg-2">{v.vtype} · {v.fuel} · {fmtN(v.odometer_km)} km in the advert</span>
          <span className="text-[12.5px] text-fg-3">{x.seller === "dealer" ? "Dealer" : "Private seller"} · {x.state} · listed {dmy(x.listed_at)} · {x.listing_id}</span>
          <span className="text-[13px] italic text-fg-2">“{x.description}”</span>
        </div>
        <div className="flex flex-col items-start gap-2">
          <span className="pill px-4 py-2 text-[14px]" style={{ color: TRUST_COL[t.level], background: TRUST_COL[t.level] + "14", boxShadow: `inset 0 0 0 1px ${TRUST_COL[t.level]}55` }}>{t.label}</span>
          <Source kind="synthetic" text="Synthetic listing" />
        </div>
      </section>
      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] xl:items-start">
        <div id="record" className="scroll-mt-24">
        <Panel title="What the record says" action={<Source kind="live_logic" text="Checks on the record" />}>
          <ul className="flex flex-col gap-2" aria-label="Trust summary">
            {t.points.map((p: any, i: number) => (
              <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: TRUST_COL[p.level] }}>{TRUST_MARK[p.level]}</span>
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-[#F4F7FB] p-3 text-[12.5px] sm:grid-cols-4">
            <div><div className="text-fg-3">Chassis no.</div><b className="break-all font-mono text-[12px]">{v.chassis_no}</b></div>
            <div><div className="text-fg-3">Engine no.</div><b className="break-all font-mono text-[12px]">{v.engine_no}</b></div>
            <div><div className="text-fg-3">Road tax until</div><b>{dmy(v.mvl_expiry)}</b></div>
            <div><div className="text-fg-3">Registered in</div><b>{v.state || x.state}</b></div>
          </div>
        </Panel>
        </div>
        <div className="flex flex-col gap-5">
          <Panel title="Health" action={<Source kind="live_model" text="Health model (LightGBM)" />}>
            <div className="flex items-center gap-4">
              <ScoreRing value={h.latest} size={104} />
              <div className="flex flex-1 flex-col gap-1 text-[13px]">
                {h.latest != null ? <span>Latest scored inspection, <b>{dmy(h.date)}</b></span> : <span className="text-fg-2">Not scored</span>}
                {h.next_fail && <span><b>{pct(h.next_fail.p_fail_next)}</b> chance of failing the next inspection{nextFailNote(h.next_fail) ? ` · ${nextFailNote(h.next_fail)}` : ""}</span>}
                <span className="text-[11.5px] text-fg-3">{h.note}</span>
              </div>
            </div>
          </Panel>
          <div id="report" className="scroll-mt-24">
            <Panel title="Latest inspection report" action={<>{d.report?.synthetic && <Source kind="synthetic" text="Seeded demo record" />}<Source kind="live_logic" text="Hash-chained report" /></>}>
              {d.report ? (
                <div className="flex flex-wrap items-start gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/reports/${d.report.report_id}/qr.svg`} alt="QR code to verify the report" className="h-28 w-28 rounded-xl bg-white p-1.5 ring-1 ring-ink-600" />
                  <div className="flex min-w-[180px] flex-1 flex-col gap-1.5 text-[13px]">
                    <span><Pill color={RESULT_COL[d.report.verdict]}>{d.report.verdict}</Pill> <span className="text-fg-3">{d.report.kind} · {dmy(d.report.issued_at || d.report.created_at)}</span></span>
                    <p className="text-[12.5px] leading-relaxed text-fg-2">{d.report.summary}</p>
                    {showReport && (
                      <dl className="fade-in grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-[#F4F7FB] p-3 text-[12.5px]">
                        <dt className="text-fg-3">Inspection hub</dt><dd>{d.report.branch || "–"}</dd>
                        <dt className="text-fg-3">Examiner</dt><dd>{d.report.examiner?.name || "–"}{d.report.examiner?.senior ? " (senior)" : ""}</dd>
                        {d.report.odometer_km != null && <><dt className="text-fg-3">Odometer then</dt><dd><b>{fmtN(d.report.odometer_km)} km</b> <span className="text-fg-3">(advert: {fmtN(v.odometer_km)} km)</span></dd></>}
                        <dt className="text-fg-3">Confirmed findings</dt><dd>{(d.report.findings || []).join("; ") || "none"}</dd>
                      </dl>
                    )}
                    <span className="flex flex-wrap gap-2">
                      <Link className="btn btn-sm btn-primary" href={`/verify/${d.report.verify_token}`}>Verify this report</Link>
                      {!showReport && <button className="btn btn-sm" onClick={() => { setShowReport(true); visitStep(`${BASE}?id=${id}#report`); }}>Review the report</button>}
                      <Link className="btn btn-sm" href={`/report?id=${d.report.report_id}`}>Full report</Link>
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-fg-3">No lane report issued for this vehicle in this demo yet{d.pending_lane_inspection ? `; the lane inspection on ${dmy(d.pending_lane_inspection)} is waiting for the examiner` : ""}. The inspection history below is on record.</p>
              )}
            </Panel>
          </div>
        </div>
      </div>
      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] xl:items-start">
        <Panel title={`Inspection history (${d.inspections.length})`}
          action={<><Source kind="synthetic" text="Synthetic history" />{d.inspections.some((i: any) => i.source === "lane") && <Source kind="live_model" text="Live lane report" />}</>}>
          {!ins.length && <p className="text-[13px] text-fg-3">No inspection on record.</p>}
          <ol className="relative flex flex-col" aria-label="Inspections, newest first">
            {ins.map((i: any) => (
              <li key={i.id} className="relative border-t border-ink-600/60 py-3 pl-6 first:border-t-0 first:pt-0">
                <span className="absolute left-0 top-[18px] h-3 w-3 rounded-full ring-4 ring-white [li:first-child>&]:top-[6px]" style={{ background: RESULT_COL[i.result] || "#94A3B8" }} aria-hidden />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <b className="text-[13.5px]">{dmy(i.date)}</b>
                  <span className="text-[13px] text-fg-2">{i.type_label}</span>
                  <span className="text-[12px] text-fg-3">{i.branch}{i.examiner_id ? ` · ${i.examiner_id}` : ""}</span>
                  <span className="ml-auto"><Pill color={RESULT_COL[i.result] || "#64748B"}>{i.result}</Pill></span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-fg-2">
                  <span>{i.odometer_km != null ? `${fmtN(i.odometer_km)} km` : "Odometer not read"}</span>
                  {i.health != null && <span>Health <b style={{ color: scoreColor(i.health) }}>{i.health}</b> (lane)</span>}
                  <span>OBD {!i.obd.read ? "not read" : i.obd.dtcs.length ? <b className="font-mono text-warn">{i.obd.dtcs.map((c: any) => c.code).join(", ")}</b> : "no fault codes"}</span>
                  {i.source === "lane" && <span className="text-cyan">Live lane inspection</span>}
                </div>
                {i.reasons.length > 0 && (
                  <div className="mt-1 text-[12.5px]" style={{ color: i.result === "PASS" ? "#475569" : RESULT_COL[i.result] }}>
                    {i.result === "FAIL" ? "Failed on: " : "Noted: "}{i.reasons.slice(0, 4).join("; ")}{i.reasons.length > 4 ? ` and ${i.reasons.length - 4} more` : ""}
                  </div>
                )}
                <details className="mt-1.5 text-[12.5px]">
                  <summary className="cursor-pointer font-medium text-cyan">What the lane measured ({i.measures.length})</summary>
                  <div className="mt-2 grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
                    {i.measures.map((m: any) => (
                      <div key={m.key} className="flex justify-between gap-2 border-b border-ink-700 py-0.5"><span className="text-fg-3">{m.label}</span><b>{num(m.value)} {m.unit}</b></div>
                    ))}
                  </div>
                </details>
                {i.report && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link className="btn btn-sm" href={`/report?id=${i.report.report_id}`}>Open the report</Link>
                    <Link className="btn btn-sm" href={`/verify/${i.report.verify_token}`}>Verify</Link>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </Panel>
        <div className="flex flex-col gap-5">
          <Panel title="Odometer" action={<Source kind="live_logic" text={`Rollback check (±${fmtN(odo.tolerance_km)} km)`} />}>
            <OdometerChart odo={odo} />
            <div className="mt-1 flex flex-wrap gap-4 text-[12px] text-fg-2">
              <span className="flex items-center gap-1.5"><span className="h-[3px] w-4 bg-[#3B82F6]" />Recorded reading</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 bg-cyan" />Advert</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-[#DC2626]" />Lower than an earlier reading</span>
            </div>
            <p className="mt-2 text-[13px]">
              {odo.consistent ? <span className="text-ok">The readings only go up.</span>
                : <span className="text-bad">Highest reading {fmtN(odo.max_recorded_km)} km on {dmy(odo.max_recorded_date)}; the advert says {fmtN(odo.advertised_km)} km.</span>}
            </p>
          </Panel>
          <Panel title="OBD fault codes" action={<Source kind="synthetic" text="Synthetic read-outs · code dictionary" />}>
            {!d.obd.latest ? <p className="text-[13px] text-fg-3">{d.obd.note}</p> : (
              <>
                <div className="text-[12.5px] text-fg-3">Latest read-out {dmy(d.obd.latest.date)} · check-engine lamp {d.obd.latest.mil_on ? <b className="text-bad">on</b> : "off"}</div>
                {!d.obd.latest.dtcs.length ? <p className="mt-1 text-[13px] text-ok">No fault codes stored.</p> : (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {d.obd.latest.dtcs.map((c: any) => (
                      <li key={c.code} className="flex gap-2 text-[13px]"><b className="font-mono text-warn">{c.code}</b><span>{c.description}<span className="text-[11.5px] text-fg-3"> · {c.system} · {c.severity}</span></span></li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {d.obd.history.map((o: any, k: number) => (
                    <span key={`${o.date}-${k}`} className="chip border-ink-500 text-[11px] text-fg-2">{short(o.date)} · {o.codes.length ? o.codes.join(", ") : "clear"}</span>
                  ))}
                </div>
              </>
            )}
          </Panel>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] xl:items-start">
        <Panel title={`Photos (${d.images.count})`} action={<Source kind="sample" text="Sample images" />}>
          {!d.images.count ? (
            <div className="flex items-center gap-4">
              <VehicleThumb vtype={v.vtype} className="h-20 w-28 shrink-0 rounded-xl" icon={30} />
              <p className="text-[13px] text-fg-3">No photos on file for this {v.vtype === "Motorcycle" ? "motorcycle" : "vehicle"} yet. Lane cameras add them at the next inspection.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {d.images.photo && (
                <figure className="overflow-hidden rounded-2xl border border-white/80 bg-white/70 shadow-glass">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.images.photo} alt={`${v.plate} photo`} className="aspect-[4/3] w-full object-cover" />
                  <figcaption className="p-2.5 text-[12.5px] font-semibold">Vehicle photo</figcaption>
                </figure>
              )}
              {lib.map((e, k) => <ImageCard key={e.id} e={e} compact onOpen={() => setViewer(k)} />)}
              {d.images.lane.map((im: any, k: number) => (
                <button key={k} onClick={() => setLane(im)} aria-label={`Lane photo: ${im.title}`}
                  className="flex flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/70 text-left shadow-glass transition hover:border-cyan/70">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.url} alt={im.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                  <span className="p-2.5 text-[12.5px]"><b>{im.title}</b><span className="block text-[11.5px] text-fg-3">{im.camera} · {dmy(im.date)} · {im.model}</span></span>
                </button>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Claims and insurance" action={<Source kind="synthetic" text="Synthetic insurer feed" />}>
          {!d.claims.length ? <p className="text-[13px] text-ok">No insurance claims on record.</p> : (
            <ul className="flex flex-col gap-1.5">
              {d.claims.map((c: any, i: number) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-ink-700 pb-1.5 text-[13px]">
                  <span className={c.type === "flood_natural_disaster" || c.ber_total_loss ? "font-semibold text-bad" : ""}>{c.label}{c.ber_total_loss ? " · beyond economic repair" : ""}</span>
                  <span className="text-fg-2">{rm(c.amount_rm)} · {dmy(c.date)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 text-[13px]">
            {d.insurance ? (
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#F4F7FB] p-3">
                <div><div className="text-[12px] text-fg-3">Policy</div><b className="capitalize">{d.insurance.type}</b> · {d.insurance.insurer}</div>
                <div><div className="text-[12px] text-fg-3">Sum insured</div><b>{rm(d.insurance.sum_insured_rm)}</b></div>
                <div><div className="text-[12px] text-fg-3">No-claim discount</div><b>{d.insurance.ncd_pct}%</b></div>
                <div><div className="text-[12px] text-fg-3">Flood cover · renewal</div><b>{d.insurance.flood_cover ? "Yes" : "No"}</b> · {dmy(d.insurance.renewal_due)}</div>
              </div>
            ) : <p className="text-fg-3">No insurance policy on record.</p>}
          </div>
        </Panel>
      </div>
      <ImageViewer items={lib} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      <Modal open={!!lane} onClose={() => setLane(null)} title={lane ? `${v.plate} · ${lane.title}` : ""}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {lane && <img src={lane.url} alt={lane.title} className="max-h-[75vh] rounded-lg" />}
      </Modal>
    </>
  );
}

function SalesPage() {
  const id = useSearchParams().get("id");
  return <OversightShell>{id ? <Dossier id={id} /> : <Listings />}</OversightShell>;
}

export default function Page() {
  return <Suspense><SalesPage /></Suspense>;
}
