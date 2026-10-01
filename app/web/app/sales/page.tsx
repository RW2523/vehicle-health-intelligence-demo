"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { LineChart } from "@/components/charts";
import { Icon } from "@/components/icons";
import { ImageCard, ImageViewer, LibImage } from "@/components/ImageViewer";
import { FLAGS, PRICES, RESULT_COL, rm, TRUST_COL, TRUST_MARK, VehicleThumb } from "@/components/sales";
import { Shell } from "@/components/Shell";
import { Card, Empty, Modal, PageHeader, Pill, ScoreRing, Source, Tabs } from "@/components/ui";
import { nextFailNote, dmy, fmtN, pct, scoreColor } from "@/lib/format";
import { useFetch } from "@/lib/live";
import { visitStep } from "@/components/Demo";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} '${iso.slice(2, 4)}`;
const days = (iso: string) => new Date(iso + "T00:00:00").getTime() / 86_400_000;
const num = (v: number) => fmtN(v, Math.abs(v) < 10 ? 2 : Math.abs(v) < 100 ? 1 : 0);

function Filter({ label, value, options, onChange }: { label: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="flex min-w-[150px] flex-1 flex-col gap-1 sm:flex-none">
      <span className="text-[12px] text-fg-3">{label}</span>
      <select aria-label={label} className="input py-1.5" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
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
  const [shown, setShown] = useState(20);
  // the newest filters, including a change whose navigation has not landed yet: building on the current URL instead
  // lets a quick second change (typing right after picking a tab) undo the first
  const next = useRef<string | null>(null);
  useEffect(() => {
    if (next.current === sp.toString()) next.current = null;
  }, [sp]);
  const set = (patch: Record<string, string>) => {
    setShown(20);
    const u = new URLSearchParams(next.current ?? sp.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? u.set(k, v) : u.delete(k)));
    next.current = u.toString();
    router.replace(u.toString() ? `/sales?${u}` : "/sales", { scroll: false });
  };
  const { data: d, error } = useFetch<any>("/api/sales", { kind, flag, state, max_price: max, q });
  const c = d?.counts;
  const tiles = c && [
    { t: "For sale", v: d.total, sub: `${c.car} cars · ${c.motorcycle} motorcycles`, col: "#22D3EE", f: "" },
    { t: "Serious red flags", v: c.flagged, sub: "Rollback, flood, write-off or failed test", col: "#F87171", f: "" },
    { t: "Odometer rollbacks", v: c.rollback, sub: "Readings lower than an earlier one", col: "#F87171", f: "rollback" },
    { t: "No red flags", v: c.clean, sub: "Clean record end to end", col: "#34D399", f: "clean" },
  ];
  return (
    <>
      <PageHeader title="Used-vehicle sales"
        sub="Every car and motorcycle advertised for sale, with its whole record: inspections, odometer readings, OBD fault codes, insurance claims and photos. Buyers see the same record in the owner app."
        actions={<><Source kind="synthetic" text="Synthetic listings" /><Link className="btn" href="/owner?tab=sale">What the buyer sees<Icon name="arrow" size={15} /></Link></>} />
      {tiles && (
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {tiles.map((k) => {
            const body = (
              <>
                <div className="text-[13.5px] font-semibold">{k.t}</div>
                <div className="font-display text-[30px] font-semibold" style={{ color: k.col }}>{k.v}</div>
                <div className="text-[12px] text-[#B7C5DA]">{k.sub}</div>
              </>
            );
            const style = { background: `linear-gradient(135deg, ${k.col}1A, #0F1A2E 60%)` };
            // the tiles with a matching record filter apply it
            return k.f ? (
              <button key={k.t} onClick={() => set({ flag: flag === k.f ? "" : k.f })} aria-pressed={flag === k.f} style={style}
                className={`card p-4 text-left transition hover:border-cyan/60 ${flag === k.f ? "border-cyan" : ""}`}>{body}</button>
            ) : <div key={k.t} className="card p-4" style={style}>{body}</div>;
          })}
        </div>
      )}
      <section className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <Tabs value={kind} onChange={(v: string) => set({ kind: v })}
          items={[{ id: "", label: "All" }, { id: "car", label: "Cars" }, { id: "motorcycle", label: "Motorcycles" }]} />
        <label className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className="text-[12px] text-fg-3">Search</span>
          <input className="input py-1.5" aria-label="Search listings" placeholder="Plate, make or model" value={q}
            onChange={(e) => { setQ(e.target.value); set({ q: e.target.value }); }} />
        </label>
        <Filter label="State" value={state} onChange={(v) => set({ state: v })} options={[{ v: "", l: "All states" }, ...(d?.states || []).map((s: string) => ({ v: s, l: s }))]} />
        <Filter label="Price" value={max} onChange={(v) => set({ max: v })} options={[{ v: "", l: "Any price" }, ...PRICES.map((p) => ({ v: String(p), l: `Up to ${rm(p)}` }))]} />
        <Filter label="Record" value={flag} onChange={(v) => set({ flag: v })} options={[{ v: "", l: "Any record" }, ...FLAGS.map((f) => ({ v: f.id, l: f.label }))]} />
      </section>
      <section className="card flex flex-col">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <h2 className="text-[17px] font-semibold">Listings</h2>
          {d && <span className="chip border-ink-500 text-fg-2">{d.listings.length} of {d.total}</span>}
          <span className="text-[12.5px] text-fg-3">Newest first · click a vehicle for its whole record</span>
          <span className="ml-auto flex flex-wrap gap-2"><Source kind="synthetic" text="Synthetic history" /><Source kind="live_model" text="Health model" /></span>
        </div>
        {error ? <p className="px-4 pb-4 text-bad">{error}</p> : !d ? <p className="px-4 pb-4 text-fg-3">Loading listings…</p> : !d.listings.length ? (
          <div className="px-4 pb-4"><Empty title="Nothing matches" actions={<Link className="btn" href="/sales">Clear the filters</Link>}>No listing matches these filters.</Empty></div>
        ) : (
          <>
            {/* nine columns do not fit a phone: the table scrolls inside the card, not the page */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-[13px]">
                <thead className="border-y border-ink-600 bg-ink-850 text-[12.5px] text-[#A9BAD3]">
                  <tr><th className="px-4 py-2">Vehicle</th><th>Asking price</th><th>Seller</th><th>Inspections</th><th>Health</th><th>Odometer</th><th>Claims</th><th>OBD</th><th className="pr-4">Buyer check</th></tr>
                </thead>
                <tbody>
                  {d.listings.slice(0, shown).map((r: any) => {
                    const b = r.badges;
                    return (
                      <tr key={r.listing_id} className="cursor-pointer border-b border-[#16233B] align-top hover:bg-ink-750" onClick={() => router.push(`/sales?id=${r.listing_id}`)}>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-3">
                            <VehicleThumb src={r.photo} vtype={r.vtype} className="h-11 w-16 shrink-0 rounded-md" icon={18} />
                            <span className="flex flex-col">
                              <Link href={`/sales?id=${r.listing_id}`} onClick={(e) => e.stopPropagation()} className="text-[14px] font-bold hover:text-cyan">{r.plate}</Link>
                              <span className="text-[11.5px] text-[#B7C5DA]">{r.make} {r.model} · {r.year}</span>
                              <span className="text-[11.5px] text-fg-3">{r.vtype} · {fmtN(r.odometer_km)} km{r.images ? ` · ${r.images} photo${r.images > 1 ? "s" : ""}` : ""}</span>
                            </span>
                          </div>
                        </td>
                        <td className="py-2"><b>{rm(r.asking_price_rm)}</b><div className="text-[11.5px] text-fg-3">listed {dmy(r.listed_at)}</div></td>
                        <td className="py-2">{r.seller === "dealer" ? "Dealer" : "Private"}<div className="text-[11.5px] text-fg-3">{r.state}</div></td>
                        <td className="py-2">{b.inspections} · <b style={{ color: RESULT_COL[b.last_result] }}>{b.last_result || "none"}</b><div className="text-[11.5px] text-fg-3">latest {dmy(b.last_date)}</div></td>
                        <td className="py-2">
                          {b.health == null ? <span className="text-fg-4">–</span> : <b style={{ color: scoreColor(b.health) }}>{b.health}</b>}
                          {b.next_fail != null && <div className="text-[11.5px] text-fg-3">{pct(b.next_fail)} next-test risk</div>}
                        </td>
                        <td className="py-2">{b.odometer_ok ? <span className="text-ok">✓ Consistent</span> : <b className="text-bad">Rollback {fmtN(b.rollback_km)} km</b>}</td>
                        <td className="py-2 text-[12.5px]">
                          {!b.flood_claims && !b.accident_claims && <span className="text-fg-3">none</span>}
                          {b.flood_claims > 0 && <div className="font-semibold text-bad">Flood</div>}
                          {b.accident_claims > 0 && <div className="text-warn">{b.accident_claims} accident{b.accident_claims > 1 ? "s" : ""}</div>}
                        </td>
                        <td className="py-2 font-mono text-[12px]">{b.open_obd.length ? <span className="text-warn">{b.open_obd.join(", ")}</span> : <span className="font-sans text-fg-3">no codes</span>}</td>
                        <td className="py-2 pr-4"><Pill color={TRUST_COL[r.trust.level]}>{r.trust.label}</Pill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-[12.5px] text-fg-3">
              <span>Showing {Math.min(shown, d.listings.length)} of {d.listings.length}</span>
              {shown < d.listings.length && (
                <span className="flex gap-2">
                  <button className="btn btn-sm" onClick={() => setShown((n) => n + 20)}>Show 20 more</button>
                  <button className="btn btn-sm" onClick={() => setShown(d.listings.length)}>Show all</button>
                </span>
              )}
            </div>
          </>
        )}
      </section>
    </>
  );
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
        { color: "#60A5FA", width: 2.4, dots: true, points: pts.map((p: any) => ({ x: days(p.date) - x0, y: p.km })) },
      ]}
      markers={[
        ...pts.filter((p: any) => bad.has(`${p.date}|${p.km}`)).map((p: any) => ({ x: days(p.date) - x0, y: p.km, color: "#EF4444", ring: true, r: 9 })),
        ...pts.filter((p: any) => p.source === "Seller's advert").map((p: any) => ({ x: days(p.date) - x0, y: p.km, color: "#22D3EE", square: true })),
      ]} />
  );
}

function Dossier({ id }: { id: string }) {
  const { data: d, error } = useFetch<any>(`/api/sales/${id}`);
  const [viewer, setViewer] = useState<number | null>(null);
  const [lane, setLane] = useState<any>(null);
  const [showReport, setShowReport] = useState(false);
  const back = <Link href="/sales" className="btn">‹ All listings</Link>;
  if (error) return <Empty title="Listing not found" actions={back}>{error}</Empty>;
  if (!d) return <Empty>Loading the record…</Empty>;
  const x = d.listing, v = d.vehicle, t = d.trust, odo = d.odometer, h = d.health;
  const lib: LibImage[] = d.images.library;
  const ins = [...d.inspections].reverse();
  const thumb = d.images.photo || lib[0]?.web_url || d.images.lane[0]?.url;
  return (
    <>
      <PageHeader title={`${v.plate} · ${v.make} ${v.model} ${v.year}`} sub="The whole record a buyer should see before paying: every inspection, the odometer, fault codes, claims and photos."
        actions={back} />
      <section className="card mb-3 flex flex-wrap items-center gap-5 p-4">
        <VehicleThumb src={thumb} vtype={v.vtype} className="h-24 w-36 shrink-0 rounded-xl" icon={34} />
        <div className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className="font-display text-[26px] font-bold">{rm(x.asking_price_rm)}</span>
          <span className="text-[13.5px] text-fg-2">{v.vtype} · {v.fuel} · {fmtN(v.odometer_km)} km in the advert</span>
          <span className="text-[12.5px] text-fg-3">{x.seller === "dealer" ? "Dealer" : "Private seller"} · {x.state} · listed {dmy(x.listed_at)} · {x.listing_id}</span>
          <span className="text-[13px] italic text-[#B7C5DA]">“{x.description}”</span>
        </div>
        <div className="flex flex-col items-start gap-2">
          <span className="chip px-4 py-2 text-[14px]" style={{ borderColor: TRUST_COL[t.level], color: TRUST_COL[t.level], background: TRUST_COL[t.level] + "1F" }}>{t.label}</span>
          <Source kind="synthetic" text="Synthetic listing" />
        </div>
      </section>
      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card title="What the record says" right={<Source kind="live_logic" text="Checks on the record" />}>
          <ul className="flex flex-col gap-2" aria-label="Trust summary">
            {t.points.map((p: any, i: number) => (
              <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-ink-950" style={{ background: TRUST_COL[p.level] }}>{TRUST_MARK[p.level]}</span>
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
            <div><div className="text-fg-3">Chassis no.</div><b className="break-all font-mono text-[12px]">{v.chassis_no}</b></div>
            <div><div className="text-fg-3">Engine no.</div><b className="break-all font-mono text-[12px]">{v.engine_no}</b></div>
            <div><div className="text-fg-3">Road tax until</div><b>{dmy(v.mvl_expiry)}</b></div>
            <div><div className="text-fg-3">Registered in</div><b>{v.state || x.state}</b></div>
          </div>
        </Card>
        <div className="flex flex-col gap-3">
          <Card title="Health" right={<Source kind="live_model" text="Health model (LightGBM)" />}>
            <div className="flex items-center gap-4">
              <ScoreRing value={h.latest} size={104} />
              <div className="flex flex-1 flex-col gap-1 text-[13px]">
                {h.latest != null ? <span>Latest scored inspection, <b>{dmy(h.date)}</b></span> : <span className="text-fg-2">Not scored</span>}
                {h.next_fail && <span><b>{pct(h.next_fail.p_fail_next)}</b> chance of failing the next inspection{nextFailNote(h.next_fail) ? ` · ${nextFailNote(h.next_fail)}` : ""}</span>}
                <span className="text-[11.5px] text-fg-3">{h.note}</span>
              </div>
            </div>
          </Card>
          <div id="report" className="scroll-mt-20">
          <Card title="Latest inspection report" right={<>{d.report?.synthetic && <Source kind="synthetic" text="Seeded demo record" />}<Source kind="live_logic" text="Hash-chained report" /></>}>
            {d.report ? (
              <div className="flex flex-wrap items-start gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/reports/${d.report.report_id}/qr.svg`} alt="QR code to verify the report" className="h-28 w-28 rounded-lg bg-white p-1.5" />
                <div className="flex min-w-[180px] flex-1 flex-col gap-1.5 text-[13px]">
                  <span><Pill color={RESULT_COL[d.report.verdict]}>{d.report.verdict}</Pill> <span className="text-fg-3">{d.report.kind} · {dmy(d.report.issued_at || d.report.created_at)}</span></span>
                  <p className="text-[12.5px] leading-relaxed text-[#B7C5DA]">{d.report.summary}</p>
                  {showReport && (
                    <dl className="fade-in grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-ink-600 bg-ink-850 p-2.5 text-[12.5px]">
                      <dt className="text-fg-3">Inspection hub</dt><dd>{d.report.branch || "–"}</dd>
                      <dt className="text-fg-3">Examiner</dt><dd>{d.report.examiner?.name || "–"}{d.report.examiner?.senior ? " (senior)" : ""}</dd>
                      {d.report.odometer_km != null && <><dt className="text-fg-3">Odometer then</dt><dd><b>{fmtN(d.report.odometer_km)} km</b> <span className="text-fg-3">(advert: {fmtN(v.odometer_km)} km)</span></dd></>}
                      <dt className="text-fg-3">Confirmed findings</dt><dd>{(d.report.findings || []).join("; ") || "none"}</dd>
                    </dl>
                  )}
                  <span className="flex flex-wrap gap-2">
                    <Link className="btn btn-sm btn-primary" href={`/verify/${d.report.verify_token}`}>Verify this report</Link>
                    {!showReport && <button className="btn btn-sm" onClick={() => { setShowReport(true); visitStep(`/sales?id=${id}#report`); }}>Review the report</button>}
                    <Link className="btn btn-sm" href={`/report?id=${d.report.report_id}`}>Full report</Link>
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-fg-3">No lane report issued for this vehicle in this demo yet{d.pending_lane_inspection ? `; the lane inspection on ${dmy(d.pending_lane_inspection)} is waiting for the examiner` : ""}. The inspection history below is on record.</p>
            )}
          </Card>
          </div>
        </div>
      </div>
      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card title={`Inspection history (${d.inspections.length})`}
          right={<><Source kind="synthetic" text="Synthetic history" />{d.inspections.some((i: any) => i.source === "lane") && <Source kind="live_model" text="Live lane report" />}</>}>
          {!ins.length && <p className="text-[13px] text-fg-3">No inspection on record.</p>}
          <ol className="flex flex-col" aria-label="Inspections, newest first">
            {ins.map((i: any) => (
              <li key={i.id} className="border-t border-[#16233B] py-3 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <b className="text-[13.5px]">{dmy(i.date)}</b>
                  <span className="text-[13px] text-fg-2">{i.type_label}</span>
                  <span className="text-[12px] text-fg-3">{i.branch}{i.examiner_id ? ` · ${i.examiner_id}` : ""}</span>
                  <span className="ml-auto"><Pill color={RESULT_COL[i.result] || "#9AA8BF"}>{i.result}</Pill></span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-[#B7C5DA]">
                  <span>{i.odometer_km != null ? `${fmtN(i.odometer_km)} km` : "Odometer not read"}</span>
                  {i.health != null && <span>Health <b style={{ color: scoreColor(i.health) }}>{i.health}</b> (lane)</span>}
                  <span>OBD {!i.obd.read ? "not read" : i.obd.dtcs.length ? <b className="font-mono text-warn">{i.obd.dtcs.map((c: any) => c.code).join(", ")}</b> : "no fault codes"}</span>
                  {i.source === "lane" && <span className="text-cyan">Live lane inspection</span>}
                </div>
                {i.reasons.length > 0 && (
                  <div className="mt-1 text-[12.5px]" style={{ color: i.result === "PASS" ? "#B7C5DA" : RESULT_COL[i.result] }}>
                    {i.result === "FAIL" ? "Failed on: " : "Noted: "}{i.reasons.slice(0, 4).join("; ")}{i.reasons.length > 4 ? ` and ${i.reasons.length - 4} more` : ""}
                  </div>
                )}
                <details className="mt-1.5 text-[12.5px]">
                  <summary className="cursor-pointer text-cyan">What the lane measured ({i.measures.length})</summary>
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
        </Card>
        <div className="flex flex-col gap-3">
          <Card title="Odometer" right={<Source kind="live_logic" text={`Rollback check (±${fmtN(odo.tolerance_km)} km)`} />}>
            <OdometerChart odo={odo} />
            <div className="mt-1 flex flex-wrap gap-4 text-[12px] text-[#B7C5DA]">
              <span className="flex items-center gap-1.5"><span className="h-[3px] w-4 bg-[#60A5FA]" />Recorded reading</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 bg-cyan" />Advert</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-[#EF4444]" />Lower than an earlier reading</span>
            </div>
            <p className="mt-2 text-[13px]">
              {odo.consistent ? <span className="text-ok">The readings only go up.</span>
                : <span className="text-bad">Highest reading {fmtN(odo.max_recorded_km)} km on {dmy(odo.max_recorded_date)}; the advert says {fmtN(odo.advertised_km)} km.</span>}
            </p>
          </Card>
          <Card title="OBD fault codes" right={<Source kind="synthetic" text="Synthetic read-outs · code dictionary" />}>
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
                  {d.obd.history.map((o: any) => (
                    <span key={o.date} className="chip border-ink-500 text-[11px] text-fg-2">{short(o.date)} · {o.codes.length ? o.codes.join(", ") : "clear"}</span>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card title={`Photos (${d.images.count})`} right={<Source kind="sample" text="Sample images" />}>
          {!d.images.count ? (
            <div className="flex items-center gap-4">
              <VehicleThumb vtype={v.vtype} className="h-20 w-28 shrink-0 rounded-xl" icon={30} />
              <p className="text-[13px] text-fg-3">No photos on file for this {v.vtype === "Motorcycle" ? "motorcycle" : "vehicle"} yet. Lane cameras add them at the next inspection.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {d.images.photo && (
                <figure className="overflow-hidden rounded-xl border border-ink-600 bg-ink-850">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.images.photo} alt={`${v.plate} photo`} className="aspect-[4/3] w-full object-cover" />
                  <figcaption className="p-2.5 text-[12.5px] font-semibold">Vehicle photo</figcaption>
                </figure>
              )}
              {lib.map((e, k) => <ImageCard key={e.id} e={e} compact onOpen={() => setViewer(k)} />)}
              {d.images.lane.map((im: any, k: number) => (
                <button key={k} onClick={() => setLane(im)} aria-label={`Lane photo: ${im.title}`}
                  className="flex flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-850 text-left transition hover:border-cyan/70">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.url} alt={im.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                  <span className="p-2.5 text-[12.5px]"><b>{im.title}</b><span className="block text-[11.5px] text-fg-3">{im.camera} · {dmy(im.date)} · {im.model}</span></span>
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card title="Claims and insurance" right={<Source kind="synthetic" text="Synthetic insurer feed" />}>
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
              <div className="grid grid-cols-2 gap-2">
                <div><div className="text-[12px] text-fg-3">Policy</div><b className="capitalize">{d.insurance.type}</b> · {d.insurance.insurer}</div>
                <div><div className="text-[12px] text-fg-3">Sum insured</div><b>{rm(d.insurance.sum_insured_rm)}</b></div>
                <div><div className="text-[12px] text-fg-3">No-claim discount</div><b>{d.insurance.ncd_pct}%</b></div>
                <div><div className="text-[12px] text-fg-3">Flood cover · renewal</div><b>{d.insurance.flood_cover ? "Yes" : "No"}</b> · {dmy(d.insurance.renewal_due)}</div>
              </div>
            ) : <p className="text-fg-3">No insurance policy on record.</p>}
          </div>
        </Card>
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
  return <Shell context={<span className="chip hidden border-ink-500 text-fg-2 xl:inline-flex">Oversight view</span>}>{id ? <Dossier id={id} /> : <Listings />}</Shell>;
}

export default function Page() {
  return <Suspense><SalesPage /></Suspense>;
}
