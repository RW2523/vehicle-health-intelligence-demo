"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { rm, TRUST_COL, TRUST_MARK, VehicleThumb } from "@/components/sales";
import { Shell } from "@/components/Shell";
import { toast } from "@/components/ui";
import { api } from "@/lib/api";
import { dmy, fmtN, nextFailNote } from "@/lib/format";
import { useUser } from "@/lib/auth";
import { useFetch } from "@/lib/live";
import { refreshUseCase } from "@/components/Demo";

type Tab = "passport" | "book" | "check" | "chat" | "sale";
const TABS: { id: Tab; label: string; d: string }[] = [
  { id: "passport", label: "Passport", d: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5" },
  { id: "book", label: "Book", d: "M4 6h16v14H4zM4 10h16M9 3v5M15 3v5" },
  { id: "check", label: "Self-check", d: "M5 12l4 4L19 6" },
  { id: "chat", label: "Assistant", d: "M4 5h16v11H9l-5 4z" },
  { id: "sale", label: "Sale", d: "M3 12V3h9l9 9-9 9zM7.5 7.5h.01" },
];
const TONE: Record<string, string> = { ok: "bg-emerald-50 text-emerald-700", warn: "bg-amber-50 text-amber-800", bad: "bg-rose-50 text-rose-700", info: "bg-sky-50 text-sky-800", "": "bg-slate-100 text-slate-600" };
const TONE_BOX: Record<string, string> = { ok: "border-emerald-200 bg-emerald-50", warn: "border-amber-200 bg-amber-50", bad: "border-rose-200 bg-rose-50" };
const RESULT_TONE: Record<string, string> = { PASS: "ok", FAIL: "bad", CONDITIONAL: "warn", REFERRED: "info" };

function Badge({ tone = "", children }: { tone?: string; children: ReactNode }) {
  return <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${TONE[tone]}`}>{children}</span>;
}

function SaleCard({ r, onOpen }: { r: any; onOpen: () => void }) {
  const b = r.badges;
  return (
    <button onClick={onOpen} aria-label={`${r.make} ${r.model} · ${r.plate}`} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-2.5 text-left shadow-sm">
      <VehicleThumb src={r.photo} vtype={r.vtype} light className="h-[76px] w-[88px] shrink-0 rounded-xl" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2"><b className="truncate text-[14px]">{r.make} {r.model}</b><b className="shrink-0 text-[14px] text-sky-700">{rm(r.asking_price_rm)}</b></span>
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
    <section className="rounded-2xl border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function SaleDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: d, error } = useFetch<any>(`/api/sales/${id}`);
  const [big, setBig] = useState(0);
  if (error) return <div className="p-4 text-[13px] text-rose-700">{error} <button className="font-semibold text-sky-700" onClick={onBack}>Back</button></div>;
  if (!d) return <p className="p-4 text-[13px] text-slate-500">Loading…</p>;
  const x = d.listing, v = d.vehicle, t = d.trust;
  const photos: { src: string; title: string }[] = [
    ...(d.images.photo ? [{ src: d.images.photo, title: "Vehicle photo" }] : []),
    ...d.images.library.map((e: any) => ({ src: e.web_url, title: e.title })),
    ...d.images.lane.map((im: any) => ({ src: im.url, title: `${im.title} (${dmy(im.date)})` })),
  ];
  const shown = photos[Math.min(big, photos.length - 1)];
  const bad = new Set(d.odometer.rollbacks.map((e: any) => `${e.date}|${e.km}`));
  return (
    <div className="flex flex-col gap-3 p-4 text-slate-900">
      <button onClick={onBack} className="self-start text-[13px] font-semibold text-sky-700">‹ All for sale</button>
      {shown ? (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown.src} alt={shown.title} className="aspect-[4/3] w-full rounded-2xl object-cover" />
          <figcaption className="mt-1 text-[11px] text-slate-500">{shown.title}</figcaption>
          {photos.length > 1 && (
            <div className="mt-1.5 flex gap-1.5 overflow-x-auto" aria-label="Photos">
              {photos.map((p, i) => (
                <button key={i} onClick={() => setBig(i)} aria-label={`Photo ${i + 1}: ${p.title}`} className={`shrink-0 overflow-hidden rounded-lg border-2 ${i === big ? "border-sky-600" : "border-transparent"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.src} alt="" className="h-12 w-16 object-cover" />
                </button>
              ))}
            </div>
          )}
        </figure>
      ) : (
        <div>
          <VehicleThumb vtype={v.vtype} light className="h-36 w-full rounded-2xl" icon={44} />
          <p className="mt-1 text-[11px] text-slate-500">No photos on file yet. Lane cameras add them at the next inspection.</p>
        </div>
      )}
      <div>
        <div className="flex items-baseline justify-between gap-2"><b className="font-display text-[19px]">{v.make} {v.model}</b><b className="shrink-0 text-[17px] text-sky-700">{rm(x.asking_price_rm)}</b></div>
        <div className="text-[12px] text-slate-500">{v.plate} · {v.year} · {fmtN(v.odometer_km)} km · {x.seller === "dealer" ? "Dealer" : "Private seller"}, {x.state}</div>
        <p className="mt-1 text-[12.5px] italic text-slate-600">“{x.description}”</p>
      </div>
      <section className={`rounded-2xl border p-3 ${TONE_BOX[t.level]}`} aria-label="What the record says">
        <div className="text-[14px] font-bold">{t.label}</div>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {t.points.map((p: any, i: number) => (
            <li key={i} className="flex gap-2 text-[12.5px] leading-snug">
              <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: TRUST_COL[p.level] }}>{TRUST_MARK[p.level]}</span>
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      </section>
      <Section title="Health">
        <div className="text-[13px]">
          {d.health.latest != null && (
            <div>
              <b className="font-display text-[24px]" style={{ color: TRUST_COL[d.health.latest >= 70 ? "ok" : d.health.latest >= 50 ? "warn" : "bad"] }}>{d.health.latest}</b>
              <span className="text-slate-500">/100 at the lane on {dmy(d.health.date)}</span>
            </div>
          )}
          {d.health.next_fail && (
            <div><b>{Math.round(d.health.next_fail.p_fail_next * 100)}%</b> chance of failing the next inspection{nextFailNote(d.health.next_fail) ? ` (${nextFailNote(d.health.next_fail)})` : ""}.</div>
          )}
          <p className="mt-1 text-[12px] text-slate-500">{d.health.note}</p>
        </div>
      </Section>
      <Section title={`Inspection history (${d.inspections.length})`}>
        <ol className="flex flex-col gap-2">
          {[...d.inspections].reverse().map((i: any) => (
            <li key={i.id} className="border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2"><b className="text-[13px]">{dmy(i.date)}</b><Badge tone={RESULT_TONE[i.result]}>{i.result}</Badge></div>
              <div className="text-[11.5px] text-slate-500">{i.type_label} · {i.branch}{i.source === "lane" ? " · live lane" : ""}</div>
              <div className="text-[11.5px] text-slate-600">
                {i.odometer_km != null ? `${fmtN(i.odometer_km)} km` : "odometer not read"}{i.health != null ? ` · health ${i.health}` : ""} · OBD {!i.obd.read ? "not read" : i.obd.dtcs.length ? i.obd.dtcs.map((c: any) => c.code).join(", ") : "clear"}
              </div>
              {i.reasons.length > 0 && <div className="text-[11.5px] text-rose-700">{i.result === "FAIL" ? "Failed on: " : "Noted: "}{i.reasons.slice(0, 3).join("; ")}</div>}
              <details className="text-[11.5px]">
                <summary className="cursor-pointer text-sky-700">Measurements</summary>
                <div className="mt-1 grid grid-cols-1 gap-0.5">
                  {i.measures.map((m: any) => <div key={m.key} className="flex justify-between gap-2"><span className="text-slate-500">{m.label}</span><b>{fmtN(m.value, Math.abs(m.value) < 10 ? 2 : Math.abs(m.value) < 100 ? 1 : 0)} {m.unit}</b></div>)}
                </div>
              </details>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Odometer">
        <ol className="flex flex-col gap-1 text-[12px]">
          {d.odometer.points.map((p: any, i: number) => (
            <li key={i} className={`flex justify-between gap-2 ${bad.has(`${p.date}|${p.km}`) ? "font-semibold text-rose-700" : ""}`}>
              <span>{dmy(p.date)} · {p.source}</span><span>{fmtN(p.km)} km{bad.has(`${p.date}|${p.km}`) ? " ▼" : ""}</span>
            </li>
          ))}
        </ol>
        <p className={`mt-1.5 text-[12px] ${d.odometer.consistent ? "text-emerald-700" : "text-rose-700"}`}>
          {d.odometer.consistent ? "The readings only go up." : `Highest reading ${fmtN(d.odometer.max_recorded_km)} km on ${dmy(d.odometer.max_recorded_date)}.`}
        </p>
      </Section>
      <Section title="OBD fault codes">
        {!d.obd.latest ? <p className="text-[12.5px] text-slate-600">{d.obd.note}</p> : !d.obd.latest.dtcs.length ? (
          <p className="text-[12.5px] text-emerald-700">No fault codes at the latest read-out ({dmy(d.obd.latest.date)}).</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[12.5px]">
            {d.obd.latest.dtcs.map((c: any) => <li key={c.code}><b className="font-mono text-amber-700">{c.code}</b> {c.description}</li>)}
            {d.obd.latest.mil_on && <li className="text-rose-700">Check-engine lamp on</li>}
          </ul>
        )}
      </Section>
      <Section title="Claims and insurance">
        {!d.claims.length ? <p className="text-[12.5px] text-emerald-700">No insurance claims on record.</p> : (
          <ul className="flex flex-col gap-1 text-[12.5px]">
            {d.claims.map((c: any, i: number) => (
              <li key={i} className={`flex justify-between gap-2 ${c.type === "flood_natural_disaster" ? "font-semibold text-rose-700" : ""}`}><span>{c.label}</span><span>{rm(c.amount_rm)} · {dmy(c.date)}</span></li>
            ))}
          </ul>
        )}
        {d.insurance && <p className="mt-1.5 text-[11.5px] text-slate-500">Insured: {d.insurance.type}, {d.insurance.insurer}, no-claim discount {d.insurance.ncd_pct}%.</p>}
      </Section>
      {d.report && (
        <Section title="Latest inspection report">
          <div className="flex items-center justify-between gap-2 text-[12.5px]"><span>{d.report.kind} · {dmy(d.report.created_at)}</span><Badge tone={RESULT_TONE[d.report.verdict]}>{d.report.verdict}</Badge></div>
          <a className="mt-1.5 inline-block text-[12.5px] font-semibold text-sky-700 underline" href={`/verify/${d.report.verify_token}`}>Verify the report</a>
        </Section>
      )}
      <p className="text-[10.5px] text-slate-400">Synthetic listing and history; lane reports and health scores are live. Fictional vehicle.</p>
    </div>
  );
}

function Sale({ listing, onOpen }: { listing: string | null; onOpen: (id: string | null) => void }) {
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const list = useFetch<any>(listing ? null : "/api/sales", { kind, q });
  if (listing) return <SaleDetail id={listing} onBack={() => onOpen(null)} />;
  return (
    <div className="flex flex-col gap-3 p-4 text-slate-900">
      <div>
        <div className="font-display text-[18px] font-bold">Vehicles for sale</div>
        <p className="text-[12.5px] text-slate-500">Every car and motorcycle comes with its full inspection record: odometer, fault codes, claims and photos.</p>
      </div>
      <div role="group" aria-label="Vehicle type" className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-[12.5px] font-semibold">
        {[["", "All"], ["car", "Cars"], ["motorcycle", "Motorcycles"]].map(([k, l]) => (
          <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)} className={`rounded-lg py-1.5 ${kind === k ? "bg-white text-sky-700 shadow-sm" : "text-slate-500"}`}>{l}</button>
        ))}
      </div>
      <input aria-label="Search vehicles for sale" placeholder="Make, model or plate" className="rounded-xl border border-slate-300 px-3 py-2 text-[13px]" value={q} onChange={(e) => setQ(e.target.value)} />
      {!list.data ? <p className="text-[13px] text-slate-500">Loading…</p> : !list.data.listings.length ? <p className="text-[13px] text-slate-500">Nothing for sale matches.</p>
        : list.data.listings.map((r: any) => <SaleCard key={r.listing_id} r={r} onOpen={() => onOpen(r.listing_id)} />)}
      <p className="text-[10.5px] text-slate-400">Synthetic listings of fictional vehicles.</p>
    </div>
  );
}

function Passport({ plate, refreshKey }: { plate: string; refreshKey: number }) {
  const { data: p } = useFetch<any>(`/api/owner/passport/${encodeURIComponent(plate)}`, undefined, [refreshKey]);
  if (!p) return <p className="p-4 text-[13px] text-slate-500">Loading…</p>;
  const v = p.vehicle;
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="rounded-2xl bg-gradient-to-br from-[#0F4C81] to-[#0B2B4F] p-4 text-white">
        <div className="text-[12px] opacity-80">Vehicle Health Passport</div>
        <div className="mt-1 font-display text-[24px] font-bold">{v.plate}</div>
        <div className="text-[13px] opacity-90">{v.make} {v.model} · {v.year} · {fmtN(v.odometer_km)} km</div>
        <div className="mt-3 flex items-center justify-between">
          {p.health != null || !p.latest ? (
            <div><div className="text-[11px] opacity-75">Latest health score</div><div className="font-display text-[28px] font-bold">{p.health ?? "–"}</div></div>
          ) : (
            <div><div className="text-[11px] opacity-75">Latest inspection · {dmy(p.latest.date)}</div><div className="font-display text-[28px] font-bold">{p.latest.result}</div></div>
          )}
          {p.reminders?.map((r: any) => <div key={r.kind} className="text-right text-[12px]"><div className="opacity-75">Road tax expires</div><b>{dmy(r.date)}</b><div className="opacity-75">in {r.days} days</div></div>)}
        </div>
      </div>
      {p.certificates?.length > 0 && (
        <>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Health certificates · {p.certificates.length}</div>
          <ol className="flex flex-col gap-2">
            {p.certificates.map((c: any, i: number) => (
              <li key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] font-display text-[14px] font-bold"
                  title={c.score != null ? "Health score from the lane" : c.result}
                  style={{ borderColor: (c.score ?? (c.result === "PASS" ? 100 : c.result === "FAIL" ? 0 : 60)) < 50 ? "#F87171" : (c.score ?? (c.result === "PASS" ? 100 : 60)) < 70 ? "#FBBF24" : "#34D399", color: "#0F172A" }}>
                  {c.score ?? (c.result === "PASS" ? "✓" : c.result === "FAIL" ? "✕" : "!")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2"><b className="truncate text-[13px] text-slate-900">{c.kind}</b><span className="shrink-0 text-[11.5px] text-slate-500">{dmy(c.date)}</span></span>
                  <span className="flex items-center gap-2 text-[12px]">
                    <span className={c.result === "PASS" ? "font-semibold text-emerald-600" : c.result === "FAIL" ? "font-semibold text-rose-600" : "font-semibold text-amber-600"}>{c.result}</span>
                    {c.odometer_km != null && <span className="text-slate-500">{fmtN(c.odometer_km)} km</span>}
                    {c.verify_token && <a className="text-sky-700 underline" href={`/verify/${c.verify_token}`}>Verify</a>}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Timeline</div>
      <ol className="flex flex-col gap-2">
        {p.events.map((e: any, i: number) => (
          <li key={i} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2"><b className="text-[13.5px] text-slate-900">{e.title}</b><span className="text-[11.5px] text-slate-500">{dmy(e.date)}</span></div>
            <div className="text-[12px] text-slate-500">
              {e.kind === "inspection" && `${fmtN(e.odometer_km)} km${e.fail_reasons ? ` · ${e.fail_reasons}` : ""}`}
              {e.kind === "self_check" && e.items?.filter((x: any) => !x.ok).map((x: any) => x.item).join(", ")}
              {e.kind === "claim" && `RM ${fmtN(e.amount_rm)}`}
              {e.kind === "report" && <a className="text-sky-700 underline" href={`/verify/${e.verify_token}`}>Verify report</a>}
              {e.kind === "booking" && e.status}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Without the phone's location (not allowed, or a plain-http address, where browsers do not offer it), start from the
// owner's home area.
const HOME = { lat: 3.0567, lon: 101.5851, label: "your home area (Subang Jaya)" };

function useHere() {
  const [here, setHere] = useState<{ lat: number; lon: number; label: string } | null>(null);
  useEffect(() => {
    if (!navigator.geolocation || !window.isSecureContext) return setHere(HOME);
    navigator.geolocation.getCurrentPosition((p) => setHere({ lat: p.coords.latitude, lon: p.coords.longitude, label: "your location" }),
      () => setHere(HOME), { timeout: 4000, maximumAge: 600000 });
  }, []);
  return here;
}

function Book({ plate, onBooked }: { plate: string; onBooked: () => void }) {
  const [selling, setSelling] = useState(true);
  const [loan, setLoan] = useState(true);
  const types = useFetch<any>("/api/owner/inspection-types", { selling, buyer_loan: loan });
  const branches = useFetch<any[]>("/api/branches");
  const [itype, setItype] = useState("");
  const [branch, setBranch] = useState("BR00");
  const gear = useFetch<any>("/api/owner/gear", { branch_id: branch });
  const [date, setDate] = useState("");
  const slots = useFetch<any>(date ? "/api/owner/slots" : null, { branch_id: branch, date });
  const [slot, setSlot] = useState<any>(null);
  const [booking, setBooking] = useState<any>(null);
  const [wanted, setWanted] = useState<string | null>(null);  // a full time: look for it at nearby branches
  const [pending, setPending] = useState<{ branch: string; time: string } | null>(null);  // pick once that branch's slots load
  const where = useHere();
  const dayFull = !!slots.data && !slots.data.slots.some((s: any) => s.available);
  const near = useFetch<any>(where && date && (wanted || dayFull) ? "/api/owner/nearby-slots" : null,
    { date, time: wanted || undefined, lat: where?.lat, lon: where?.lon, exclude: branch });
  useEffect(() => {
    if (pending && slots.data?.branch_id === pending.branch) {
      setSlot(slots.data.slots.find((s: any) => s.time === pending.time && s.available) || null);
      setPending(null);
    }
  }, [slots.data, pending]);
  const moveTo = (b: any, time: string) => {
    setBranch(b.branch_id);
    setSlot(null);
    setWanted(null);
    setPending({ branch: b.branch_id, time });
  };
  const branchName = branches.data?.find((b) => b.branch_id === branch)?.name;
  useEffect(() => { if (types.data) setItype(types.data.recommended[0]); }, [types.data]);
  useEffect(() => { if (gear.data && !date) setDate(gear.data.date); }, [gear.data, date]);
  const price = (types.data?.types.find((t: any) => t.code === itype)?.price || 0) + (slot?.gear ? types.data?.gear_surcharge_rm || 0 : 0);
  const confirm = async () => {
    try {
      const b = await api.post("/api/owner/bookings", { plate, branch_id: branch, date, slot: slot.time, inspection_type: itype, gear: !!slot.gear });
      const paid = await api.post(`/api/owner/bookings/${b.booking_id}/pay`, { method: "FPX" });
      setBooking(paid);
      toast(`Booked and paid (mock payment ${paid.payment_ref})`, "ok");
      refreshUseCase();
      onBooked();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };
  if (booking)
    return (
      <div className="flex flex-col items-center gap-3 p-5 text-center text-slate-900">
        <div className="text-[13px] font-semibold text-emerald-600">Booking confirmed</div>
        <div className="font-display text-[20px] font-bold">{booking.type_label}</div>
        <dl className="grid w-full grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl border border-slate-200 bg-white p-3 text-left text-[12.5px]">
          <dt className="text-slate-500">Inspection hub</dt><dd className="font-semibold">{booking.branch_name}</dd>
          <dt className="text-slate-500">Date and time</dt><dd className="font-semibold">{dmy(booking.date)} · {booking.slot}{booking.gear ? " (Express)" : ""}</dd>
          <dt className="text-slate-500">Payment</dt><dd className="font-semibold">RM {booking.price_rm.toFixed(2)} · paid <span className="rounded bg-slate-100 px-1 text-[10.5px] font-bold text-slate-600">MOCK</span></dd>
          <dt className="text-slate-500">Check-in code</dt><dd className="font-mono font-semibold">{booking.checkin_token.slice(0, 8).toUpperCase()}</dd>
        </dl>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/owner/bookings/${booking.booking_id}/qr.svg`} alt="Check-in QR code" className="h-40 w-40" />
        <div className="text-[12px] text-slate-500">Show this code at the lane entry: the plate camera and the code check you in. The payment ran through a mock gateway ({booking.payment_ref}); nothing was charged.</div>
        <a className="text-[12.5px] font-semibold text-sky-700 underline" href={`/checkin/${booking.checkin_token}`}>Open the check-in page</a>
        <button className="rounded-xl border border-slate-300 px-4 py-2 text-[13px] font-semibold" onClick={() => { setBooking(null); setSlot(null); }}>Make another booking</button>
      </div>
    );
  return (
    <div className="flex flex-col gap-3 p-4 text-slate-900">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">1 · What are you doing?</div>
      <div className="flex flex-wrap gap-2 text-[13px]">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={selling} onChange={(e) => setSelling(e.target.checked)} /> Selling the car</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={loan} onChange={(e) => setLoan(e.target.checked)} /> Buyer takes a bank loan</label>
      </div>
      <div className="flex flex-wrap gap-2">
        {(types.data?.types || []).map((t: any) => (
          <button key={t.code} onClick={() => setItype(t.code)}
            className={`rounded-xl border px-3 py-2 text-left text-[12.5px] ${itype === t.code ? "border-sky-600 bg-sky-50" : "border-slate-200"}`}>
            <b>{t.label}</b> · RM {t.price}{types.data?.recommended.includes(t.code) && <span className="ml-1 text-emerald-600">recommended</span>}
          </button>
        ))}
      </div>
      <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">2 · Where and when?</div>
      <select aria-label="Branch" className="rounded-xl border border-slate-300 px-3 py-2 text-[13px]" value={branch} onChange={(e) => { setBranch(e.target.value); setSlot(null); setWanted(null); }}>
        {(branches.data || []).map((b) => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
      </select>
      <input aria-label="Date" type="date" className="rounded-xl border border-slate-300 px-3 py-2 text-[13px]" value={date} onChange={(e) => { setDate(e.target.value); setSlot(null); setWanted(null); }} />
      {gear.data && date === gear.data.date && <div className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-800">Tomorrow: Express next-day slots available (+RM {gear.data.surcharge_rm}).</div>}
      <div className="grid grid-cols-4 gap-1.5">
        {(slots.data?.slots || []).map((s: any) => (
          <button key={s.time} onClick={() => (s.available ? (setSlot(s), setWanted(null)) : (setSlot(null), setWanted(s.time)))}
            aria-label={s.available ? s.time : `${s.time} full`}
            className={`rounded-lg border px-1 py-1.5 text-[12px] ${slot?.time === s.time ? "border-sky-600 bg-sky-600 text-white" : !s.available ? (wanted === s.time ? "border-rose-400 bg-rose-50 text-rose-700" : "border-slate-200 text-slate-400") : s.gear ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}>
            {s.time}{s.gear && s.available && <span className="block text-[9.5px] font-bold">EXPRESS</span>}{!s.available && <span className="block text-[9.5px]">Full</span>}
          </button>
        ))}
      </div>
      {(wanted || dayFull) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12.5px] text-amber-900">
          <b>{wanted ? `${wanted} is full at ${branchName}.` : `${branchName} is full on this day.`}</b>{" "}
          Nearest branches {wanted ? `with ${wanted} free` : "with free slots"}, from {where?.label}:
          <div className="mt-2 flex flex-col gap-1.5">
            {near.loading && <span className="text-amber-700">Looking…</span>}
            {near.data?.branches?.map((b: any) => (
              <button key={b.branch_id} onClick={() => moveTo(b, b.time_free ? wanted! : b.other_times[0])}
                className="flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-left text-slate-900">
                <span><b>{b.name}</b> <span className="text-slate-500">· {b.km} km</span></span>
                <span className="text-[12px] font-semibold text-emerald-700">{b.time_free ? `${wanted} free` : `free ${b.other_times.join(", ")}`}</span>
              </button>
            ))}
            {near.data && !near.data.branches.length && <span>No nearby branch has a free slot then. Try another day.</span>}
          </div>
        </div>
      )}
      {slot && itype && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-[12.5px]">
          <div className="font-semibold">{types.data?.types.find((x: any) => x.code === itype)?.label}</div>
          <div className="text-slate-600">{branchName} · {dmy(date)} · {slot.time}{slot.gear ? " (Express)" : ""}</div>
        </div>
      )}
      <button disabled={!slot || !itype} onClick={confirm} className="mt-1 rounded-xl bg-sky-600 px-4 py-3 text-[14px] font-semibold text-white disabled:opacity-40">
        {slot ? `Pay RM ${price.toFixed(2)} and book ${slot.time}` : "Choose a slot"}
      </button>
      <p className="text-[11px] text-slate-400">Payment runs through a mock gateway in this demo: nothing is charged.</p>
    </div>
  );
}

function SelfCheck({ plate, onDone }: { plate: string; onDone: () => void }) {
  const script = useFetch<any>("/api/owner/self-check/script");
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [tint, setTint] = useState(38);
  const [lampL, setLampL] = useState("not working");
  const run = async (attempt: any) => {
    setBusy(true);
    try {
      const r = await api.post("/api/owner/self-check", { plate, ...attempt });
      setRes(r);
      onDone();
      refreshUseCase();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  const base = script.data?.first_attempt;
  return (
    <div className="flex flex-col gap-3 p-4 text-slate-900">
      <p className="text-[13px] text-slate-600">Take photos of the tint, both headlamps and all 4 tyres, and record 20 seconds of engine sound. The app tells you what to fix before you book.</p>
      {base && (
        <div className="rounded-xl border border-slate-200 p-3 text-[13px]">
          <label className="flex items-center justify-between gap-2">Tint reading (VLT) <b>{tint}%</b></label>
          <input aria-label="Tint VLT" type="range" min={20} max={85} value={tint} onChange={(e) => setTint(+e.target.value)} className="w-full" />
          <label className="mt-2 flex items-center justify-between">Left headlamp
            <select aria-label="Left headlamp" className="rounded-lg border border-slate-300 px-2 py-1" value={lampL} onChange={(e) => setLampL(e.target.value)}>
              <option value="ok">working</option><option value="not working">not working</option>
            </select>
          </label>
          <div className="mt-2 flex gap-1.5">
            {base.tyre_images.map((t: string) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={t} src={`/media/data/${t}`} alt="tyre photo" className="h-12 w-12 rounded-lg object-cover" />
            ))}
            <span className="self-center text-[11.5px] text-slate-500">+ engine clip (20 s)</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button disabled={busy} className="rounded-xl bg-sky-600 px-3 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40" onClick={() => run({ ...base, tint_vlt_pct: tint, headlamp_left: lampL })}>{busy ? "Checking…" : "Run self-check"}</button>
            <button disabled={busy} className="rounded-xl border border-slate-300 px-3 py-2.5 text-[13px] font-semibold" onClick={() => { setTint(71); setLampL("ok"); run(script.data.second_attempt); }}>Run again after fixing</button>
          </div>
        </div>
      )}
      {res && (
        <div className="flex flex-col gap-2" role="status">
          <div className={`rounded-xl px-4 py-3 ${VERDICT_TONE[res.verdict] || "bg-slate-100 text-slate-700"}`}>
            <div className="text-[15px] font-bold">{res.verdict}</div>
            <div className="text-[12.5px] font-normal">{VERDICT_TEXT[res.verdict]}</div>
          </div>
          {res.items.map((it: any, i: number) => (
            <div key={i} className="flex items-start gap-2 rounded-xl border border-slate-200 p-2.5 text-[12.5px]">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${it.ok ? "bg-emerald-500" : "bg-rose-500"}`}>{it.ok ? "✓" : "!"}</span>
              <div><b>{it.item}</b> · {it.value}{it.advice && <div className="text-slate-500">{it.advice}</div>}</div>
            </div>
          ))}
          {res.verdict === "Ready for inspection" && <p className="text-[12px] text-slate-500">Next: book an inspection in the Book tab.</p>}
        </div>
      )}
    </div>
  );
}

function Chat() {
  const script = useFetch<any>("/api/owner/self-check/script");
  const [conv] = useState(() => "c" + Math.random().toString(36).slice(2, 9));
  const [msgs, setMsgs] = useState<any[]>([{ role: "assistant", text: "Hai! Saya pembantu VehicleSense. Tanya dalam BM, English atau 中文.", source: "" }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  // block body: newer browsers return a Promise from scrollIntoView, which React would call as the effect cleanup
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);
  const send = async (t: string) => {
    if (!t.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setText("");
    setBusy(true);
    try {
      const r = await api.post("/api/owner/assistant", { conversation: conv, text: t });
      setMsgs((m) => [...m, { role: "assistant", text: r.answer, source: r.source, tool: r.tool, kb: r.kb_item, lang: r.lang }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", text: "Sorry, I can't answer right now. Please try again in a moment.", source: "" }]);
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  const quick = [...(script.data?.assistant_script || []).map((s: any) => s.user_bm), "What is the window tint limit?", "电动车怎么检验？"];
  return (
    <div className="flex h-full flex-col bg-[#ECE5DD]">
      <div className="flex-1 space-y-2 overflow-auto p-3">
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] shadow-sm ${m.role === "user" ? "ml-auto bg-[#DCF8C6] text-slate-900" : "bg-white text-slate-900"}`}>
            <div className="whitespace-pre-wrap">{m.text.replace(/\*\*/g, "")}</div>
            {m.tool?.slots?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">{m.tool.slots.map((s: string) => <span key={s} className="rounded-md border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[11px]">{s} Express</span>)}</div>
            )}
          </div>
        ))}
        {busy && <div className="w-16 rounded-xl bg-white px-3 py-2 text-[13px] text-slate-400">…</div>}
        <div ref={end} />
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-2 pb-1">
        {quick.map((q: string) => <button key={q} className="shrink-0 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11.5px] text-slate-700" onClick={() => send(q)}>{q}</button>)}
      </div>
      <form className="flex gap-2 bg-[#F0F0F0] p-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input aria-label="Message" className="flex-1 rounded-full border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900" value={text} onChange={(e) => setText(e.target.value)} placeholder="Tanya apa-apa…" />
        <button disabled={busy} className="rounded-full bg-[#128C7E] px-4 text-[13px] font-semibold text-white disabled:opacity-50">Send</button>
      </form>
    </div>
  );
}

const STEPS: { tab: Tab; title: string; sub: string }[] = [
  { tab: "check", title: "Run the self-check", sub: "Tint and a headlamp fail first; fix them and run it again" },
  { tab: "book", title: "Book and pay", sub: "Pick an inspection, a hub and a slot; pay (mock); get the check-in code" },
  { tab: "passport", title: "See the passport", sub: "After the inspection, the certificate and the timeline update" },
  { tab: "chat", title: "Ask the assistant", sub: "In BM, English or Chinese: which inspection do I need? Any slots tomorrow?" },
  { tab: "sale", title: "Shop for a used vehicle", sub: "Cars and bikes for sale, each with its whole inspection record" },
];
const VERDICT_TONE: Record<string, string> = {
  "Ready for inspection": "bg-emerald-50 text-emerald-700", "Fix these first": "bg-amber-50 text-amber-800", "Needs a professional check": "bg-rose-50 text-rose-700",
};
const VERDICT_TEXT: Record<string, string> = {
  "Ready for inspection": "Nothing the phone can check stops this car passing. You can book now.",
  "Fix these first": "These are quick fixes you can do yourself before booking.",
  "Needs a professional check": "Have a workshop look at the items below before the inspection.",
};

function OwnerApp() {
  const sp = useSearchParams();
  const router = useRouter();
  const user = useUser();
  const plate = (user?.role === "owner" && user.plate) || sp.get("plate") || "DMO 9006";  // an owner sees their own vehicle
  const [tab, setTabState] = useState<Tab>((sp.get("tab") as Tab) || "passport");
  const [listing, setListingState] = useState<string | null>(sp.get("listing"));
  const [k, setK] = useState(0);
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    screen.current?.scrollTo(0, 0);  // a new screen starts at the top
  }, [tab, listing]);
  const setTab = (t: Tab, open: string | null = null) => {
    setTabState(t);
    setListingState(open);
    router.replace(`/owner?plate=${encodeURIComponent(plate)}&tab=${t}${open ? `&listing=${open}` : ""}`, { scroll: false });
  };
  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-center gap-8">
        <div className="w-full max-w-[380px] lg:pt-4">
          <h1 className="font-display text-[24px] font-semibold">Owner app</h1>
          <p className="mt-1 text-[13.5px] text-fg-3">What a vehicle owner sees on their phone, for {plate}. The self-check, the booking and the passport follow one journey:</p>
          <ol className="mt-4 flex flex-col gap-2">
            {STEPS.map((st, i) => (
              <li key={st.tab}>
                <button onClick={() => setTab(st.tab)} aria-pressed={tab === st.tab}
                  className={`flex w-full gap-3 rounded-xl border p-3 text-left transition hover:border-cyan/60 ${tab === st.tab ? "border-cyan bg-cyan/10" : "border-ink-600 bg-ink-850"}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${tab === st.tab ? "bg-cyan text-ink-900" : "bg-ink-600 text-fg-3"}`}>{i + 1}</span>
                  <span><span className="block text-[13.5px] font-semibold">{st.title}</span><span className="block text-[12px] text-fg-3">{st.sub}</span></span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex h-[780px] max-h-[calc(100vh-7rem)] min-h-[600px] w-full max-w-[390px] flex-col overflow-hidden rounded-[36px] border-[10px] border-[#1A2233] bg-[#F5F7FA] shadow-2xl"
          style={{ colorScheme: "light" }}>
          <div className="flex items-center justify-between bg-white px-5 py-3 text-slate-900">
            <span className="font-display text-[15px] font-bold">VehicleSense</span>
            <span className="text-[12px] text-slate-500">{plate}</span>
          </div>
          <div ref={screen} className="min-h-0 flex-1 overflow-auto">
            {tab === "passport" && <Passport plate={plate} refreshKey={k} />}
            {tab === "book" && <Book plate={plate} onBooked={() => setK((x) => x + 1)} />}
            {tab === "check" && <SelfCheck plate={plate} onDone={() => setK((x) => x + 1)} />}
            {tab === "chat" && <Chat />}
            {tab === "sale" && <Sale listing={listing} onOpen={(id) => setTab("sale", id)} />}
          </div>
          <nav className="grid grid-cols-5 border-t border-slate-200 bg-white" aria-label="Owner app tabs">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${tab === t.id ? "text-sky-700" : "text-slate-500"}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d={t.d} /></svg>{t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </Shell>
  );
}

export default function Page() {
  return <Suspense><OwnerApp /></Suspense>;
}
