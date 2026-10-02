"use client";
/* Mobile app · Marketplace (the owner app's Sale tab): used cars and motorcycles for sale, each with its whole
   inspection record (odometer, fault codes, claims, photos, the latest report), and the owner's own listing. */
import { useRouter, useSearchParams } from "next/navigation";
import { ReactNode, Suspense, useState } from "react";
import { Icon } from "@/components/icons";
import { MobileShell, useMobileHref, useMobilePlate } from "@/components/MobileShell";
import { BTN, MCard, MEmpty, MError, MSkeleton, MTitle, OwnerSource, Plate, Segmented, Verdict, dayLabel, scoreCol } from "@/components/mobileKit";
import { useProfile } from "@/components/mobileData";
import { MobileVehicleThumb } from "@/components/mobilePhoto";
import { rm, TRUST_COL, TRUST_MARK } from "@/components/sales";
import { fmtN, nextFailNote } from "@/lib/format";
import { useFetch } from "@/lib/live";

const TONE: Record<string, string> = { ok: "bg-emerald-50 text-emerald-700", warn: "bg-amber-50 text-amber-800", bad: "bg-rose-50 text-rose-700", info: "bg-sky-50 text-sky-800", "": "bg-slate-100 text-slate-600" };
const TONE_BOX: Record<string, string> = { ok: "border-emerald-200 bg-emerald-50/90", warn: "border-amber-200 bg-amber-50/90", bad: "border-rose-200 bg-rose-50/90" };
const RESULT_TONE: Record<string, string> = { PASS: "ok", FAIL: "bad", CONDITIONAL: "warn", REFERRED: "info", PASS_ADVISORY: "warn" };

function Badge({ tone = "", children }: { tone?: string; children: ReactNode }) {
  return <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${TONE[tone]}`}>{children}</span>;
}

function SaleCard({ r, onOpen }: { r: any; onOpen: () => void }) {
  const b = r.badges;
  return (
    <button onClick={onOpen} aria-label={`${r.make} ${r.model} · ${r.plate}`}
      className="flex w-full gap-3 rounded-[20px] border border-white/90 bg-white/90 p-2.5 text-left shadow-[0_10px_24px_-18px_rgba(15,23,42,0.4)] transition active:scale-[.99]">
      <MobileVehicleThumb plate={r.plate} src={r.photo} vtype={r.vtype} className="h-[84px] w-[92px] shrink-0 overflow-hidden rounded-[14px]" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-start justify-between gap-2"><b className="line-clamp-2 min-w-0 break-words text-[14.5px] leading-snug">{r.make} {r.model}</b><b className="shrink-0 text-[14px] leading-snug text-[#1D4ED8]">{rm(r.asking_price_rm)}</b></span>
        <span className="text-[11.5px] text-slate-500">{r.year} · {fmtN(r.odometer_km)} km · {r.state}</span>
        <span className="flex flex-wrap gap-1">
          <Badge tone={r.trust.level}>{r.trust.label}</Badge>
          <Badge>{b.inspections} inspection{b.inspections === 1 ? "" : "s"}</Badge>
          {b.last_result && <Badge tone={RESULT_TONE[b.last_result]}>Latest {b.last_result}</Badge>}
          {!b.odometer_ok && <Badge tone="bad">Odometer rollback</Badge>}
          {b.flood_claims > 0 && <Badge tone="bad">Flood claim</Badge>}
          {b.open_obd.length > 0 && <Badge tone="warn">Fault {b.open_obd.join(", ")}</Badge>}
          {b.health != null && <Badge>Health {b.health}</Badge>}
        </span>
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <MCard>
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </MCard>
  );
}

function SaleDetail({ d }: { d: any }) {
  const [big, setBig] = useState(0);
  const x = d.listing, v = d.vehicle, t = d.trust;
  const photos: { src: string; title: string }[] = [
    ...(d.images.photo ? [{ src: d.images.photo, title: "Vehicle photo" }] : []),
    ...d.images.library.map((e: any) => ({ src: e.web_url, title: e.title })),
    ...d.images.lane.map((im: any) => ({ src: im.url, title: `${im.title} (${dayLabel(im.date, true)})` })),
  ];
  const shown = photos[Math.min(big, photos.length - 1)];
  const bad = new Set(d.odometer.rollbacks.map((e: any) => `${e.date}|${e.km}`));
  return (
    <div className="flex flex-col gap-3">
      {shown ? (
        <figure className="-mx-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown.src} alt={shown.title} className="aspect-[4/3] w-full object-cover" />
          <figcaption className="px-4 pt-1.5 text-[11.5px] text-slate-500">{shown.title}</figcaption>
          {photos.length > 1 && (
            <div className="m-noscroll mt-1.5 flex gap-1.5 overflow-x-auto px-4" aria-label="Photos">
              {photos.map((ph, i) => (
                <button key={i} onClick={() => setBig(i)} aria-label={`Photo ${i + 1}: ${ph.title}`} className={`shrink-0 overflow-hidden rounded-xl border-2 ${i === big ? "border-[#2563EB]" : "border-transparent"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ph.src} alt="" className="h-12 w-16 object-cover" />
                </button>
              ))}
            </div>
          )}
        </figure>
      ) : (
        <div>
          <MobileVehicleThumb plate={v.plate} vtype={v.vtype} className="h-40 w-full overflow-hidden rounded-[22px]" />
          <p className="mt-1.5 text-[11.5px] text-slate-500">No photos on file yet. Lane cameras add them at the next inspection.</p>
        </div>
      )}
      <div>
        <div className="flex items-baseline justify-between gap-2"><b className="text-[21px] font-extrabold tracking-tight">{v.make} {v.model}</b><b className="shrink-0 text-[18px] text-[#1D4ED8]">{rm(x.asking_price_rm)}</b></div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-slate-500"><Plate plate={v.plate} size="sm" /><span>{v.year} · {fmtN(v.odometer_km)} km · {x.seller === "dealer" ? "Dealer" : "Private seller"}, {x.state}</span></div>
        <p className="mt-1.5 text-[13px] italic text-slate-600">“{x.description}”</p>
      </div>
      <section className={`rounded-[20px] border p-3.5 ${TONE_BOX[t.level]}`} aria-label="What the record says">
        <div className="text-[15px] font-bold">{t.label}</div>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {t.points.map((pt: any, i: number) => (
            <li key={i} className="flex gap-2 text-[13px] leading-snug">
              <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: TRUST_COL[pt.level] }}>{TRUST_MARK[pt.level]}</span>
              <span>{pt.text}</span>
            </li>
          ))}
        </ul>
      </section>
      <Section title="Health">
        <div className="text-[13px]">
          {d.health.latest != null && (
            <div><b className="text-[26px] font-extrabold" style={{ color: scoreCol(d.health.latest) }}>{d.health.latest}</b><span className="text-slate-500">/100 at the lane on {dayLabel(d.health.date, true)}</span></div>
          )}
          {d.health.next_fail && <div><b>{Math.round(d.health.next_fail.p_fail_next * 100)}%</b> chance of failing the next inspection{nextFailNote(d.health.next_fail) ? ` (${nextFailNote(d.health.next_fail)})` : ""}.</div>}
          <p className="mt-1 text-[12px] text-slate-500">{d.health.note}</p>
        </div>
      </Section>
      <Section title={`Inspection history (${d.inspections.length})`}>
        <ol className="flex flex-col gap-2">
          {[...d.inspections].reverse().map((i: any) => (
            <li key={i.id} className="border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2"><b className="text-[13.5px]">{dayLabel(i.date, true)}</b><Verdict v={i.result} className="!px-2 !py-0.5 !text-[10.5px]" /></div>
              <div className="text-[12px] text-slate-500">{i.type_label} · {i.branch}{i.source === "lane" ? " · live lane" : ""}</div>
              <div className="text-[12px] text-slate-600">
                {i.odometer_km != null ? `${fmtN(i.odometer_km)} km` : "odometer not read"}{i.health != null ? ` · health ${i.health}` : ""} · OBD {!i.obd.read ? "not read" : i.obd.dtcs.length ? i.obd.dtcs.map((c: any) => c.code).join(", ") : "clear"}
              </div>
              {i.reasons.length > 0 && <div className="text-[12px] text-rose-700">{i.result === "FAIL" ? "Failed on: " : "Noted: "}{i.reasons.slice(0, 3).join("; ")}</div>}
              <details className="text-[12px]">
                <summary className="-my-1 cursor-pointer py-2 font-semibold text-[#2563EB]">Measurements</summary>
                <div className="mt-1 grid grid-cols-1 gap-0.5">
                  {i.measures.map((m: any) => <div key={m.key} className="flex justify-between gap-2"><span className="text-slate-500">{m.label}</span><b>{fmtN(m.value, Math.abs(m.value) < 10 ? 2 : Math.abs(m.value) < 100 ? 1 : 0)} {m.unit}</b></div>)}
                </div>
              </details>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Odometer">
        <ol className="flex flex-col gap-1 text-[12.5px]">
          {d.odometer.points.map((pt: any, i: number) => (
            <li key={i} className={`flex justify-between gap-2 ${bad.has(`${pt.date}|${pt.km}`) ? "font-semibold text-rose-700" : ""}`}>
              <span className="min-w-0">{dayLabel(pt.date, true)} · {pt.source}</span><span className="shrink-0 whitespace-nowrap">{fmtN(pt.km)} km{bad.has(`${pt.date}|${pt.km}`) ? " ▼" : ""}</span>
            </li>
          ))}
        </ol>
        <p className={`mt-1.5 text-[12.5px] ${d.odometer.consistent ? "text-emerald-700" : "text-rose-700"}`}>
          {d.odometer.consistent ? "The readings only go up." : `Highest reading ${fmtN(d.odometer.max_recorded_km)} km on ${dayLabel(d.odometer.max_recorded_date, true)}.`}
        </p>
      </Section>
      <Section title="OBD fault codes">
        {!d.obd.latest ? <p className="text-[13px] text-slate-600">{d.obd.note}</p> : !d.obd.latest.dtcs.length ? (
          <p className="text-[13px] text-emerald-700">No fault codes at the latest read-out ({dayLabel(d.obd.latest.date, true)}).</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[13px]">
            {d.obd.latest.dtcs.map((c: any) => <li key={c.code}><b className="font-mono text-amber-700">{c.code}</b> {c.description}</li>)}
            {d.obd.latest.mil_on && <li className="text-rose-700">Check-engine lamp on</li>}
          </ul>
        )}
      </Section>
      <Section title="Claims and insurance">
        {!d.claims.length ? <p className="text-[13px] text-emerald-700">No insurance claims on record.</p> : (
          <ul className="flex flex-col gap-1 text-[13px]">
            {d.claims.map((c: any, i: number) => (
              <li key={i} className={`flex justify-between gap-2 ${c.type === "flood_natural_disaster" ? "font-semibold text-rose-700" : ""}`}><span>{c.label}</span><span className="shrink-0">{rm(c.amount_rm)} · {dayLabel(c.date, true)}</span></li>
            ))}
          </ul>
        )}
        {d.insurance && <p className="mt-1.5 text-[12px] text-slate-500">Insured: {d.insurance.type}, {d.insurance.insurer}, no-claim discount {d.insurance.ncd_pct}%.</p>}
      </Section>
      {d.report && (
        <Section title="Latest inspection report">
          <div className="flex items-center justify-between gap-2 text-[13px]"><span>{d.report.kind} · {dayLabel(d.report.created_at, true)}</span><Verdict v={d.report.verdict} /></div>
          <a className={`${BTN} mt-3 w-full`} href={`/verify/${d.report.verify_token}`}><Icon name="shield" size={17} color="#fff" />Verify the report</a>
          <p className="mt-1.5 text-center text-[11.5px] text-slate-500">Opens the public check: no login needed, the same page a buyer sees.</p>
        </Section>
      )}
      <div className="flex flex-wrap gap-1.5"><OwnerSource kind="synthetic" text="Listing and history" /><OwnerSource kind="live_model" text="Lane reports and health" /></div>
    </div>
  );
}

function MyListing({ plate, onOpen }: { plate: string; onOpen: (id: string) => void }) {
  const href = useMobileHref();
  const prof = useProfile(plate);
  if (!prof.data) return null;
  const id = (prof.data.links?.sale || "").split("id=")[1];
  const v = prof.data.vehicle;
  return (
    <MCard className="mb-4 flex items-center gap-3" label="Your vehicle">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 ring-1 ring-amber-200"><Icon name="sale" size={21} color="#D97706" /></span>
      <span className="min-w-0 flex-1 leading-snug">
        <b className="block text-[14px]">{id ? `Your ${v.model} is listed` : `Selling your ${v.model}?`}</b>
        <span className="block text-[12.5px] text-slate-500">{id ? "Buyers see its whole record, as below." : "An Ownership Transfer inspection gives buyers a report they can verify."}</span>
      </span>
      {id ? <button className="shrink-0 rounded-full bg-blue-50 px-4 py-2.5 text-[13px] font-semibold text-[#1D4ED8]" onClick={() => onOpen(id)}>View</button>
        : <a className="shrink-0 rounded-full bg-blue-50 px-4 py-2.5 text-[13px] font-semibold text-[#1D4ED8]" href={href("/mobile/book", { type: "TRANSFER" })}>Book</a>}
    </MCard>
  );
}

function SellScreen() {
  const sp = useSearchParams();
  const router = useRouter();
  const href = useMobileHref();
  const { plate } = useMobilePlate();
  const listing = sp.get("listing");
  const [kind, setKind] = useState<"" | "car" | "motorcycle">("");
  const [q, setQ] = useState("");
  const list = useFetch<any>(listing ? null : "/api/sales", { kind, q });
  const one = useFetch<any>(listing ? `/api/sales/${listing}` : null);
  const open = (id: string | null) => router.push(href("/mobile/sell", { listing: id }), { scroll: false });
  if (listing)
    return (
      <MobileShell tab="vehicle" title={one.data ? `${one.data.vehicle.make} ${one.data.vehicle.model}` : "For sale"} back={href("/mobile/sell")} backLabel="All for sale" scrollKey={listing}>
        {one.error ? <MError onRetry={one.reload}>This listing could not load. {one.error}</MError> : !one.data ? <MSkeleton rows={4} h={120} label="Loading the vehicle's record…" /> : <SaleDetail d={one.data} />}
      </MobileShell>
    );
  return (
    <MobileShell tab="vehicle" title="Marketplace" back={href("/mobile/vehicle")} backLabel="Vehicle">
      {plate && <MyListing plate={plate} onOpen={(id) => open(id)} />}
      <div>
        <h2 className="text-[20px] font-extrabold tracking-tight">Vehicles for sale</h2>
        <p className="text-[13px] text-slate-500">Every car and motorcycle comes with its full inspection record: odometer, fault codes, claims and photos.</p>
      </div>
      <div className="sticky top-[var(--m-head)] z-20 -mx-4 mb-3 mt-3 flex flex-col gap-2 bg-[#F1F5FB]/[0.97] px-4 pb-3 pt-2 shadow-[0_1px_0_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <Segmented label="Vehicle type" value={kind} onChange={setKind} items={[{ id: "", label: "All" }, { id: "car", label: "Cars" }, { id: "motorcycle", label: "Motorcycles" }]} />
        <label className="flex cursor-text items-center gap-2 rounded-[14px] bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-blue-300">
          <Icon name="search" size={17} color="#64748B" />
          <input aria-label="Search vehicles for sale" placeholder="Make, model or plate" className="w-full bg-transparent text-[14px] focus:outline-none" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-col gap-2.5">
        {list.error ? <MError onRetry={list.reload}>The listings could not load. {list.error}</MError> : !list.data ? <MSkeleton rows={4} h={100} label="Loading the listings…" /> : !list.data.listings.length ? <MEmpty icon="search" title="Nothing for sale matches">Try another make, model or plate.</MEmpty>
          : list.data.listings.map((r: any) => <SaleCard key={r.listing_id} r={r} onOpen={() => open(r.listing_id)} />)}
      </div>
      <div className="mt-4"><OwnerSource kind="synthetic" text="Listings of fictional vehicles" /></div>
    </MobileShell>
  );
}


export default function Page() {
  return <Suspense><SellScreen /></Suspense>;
}
