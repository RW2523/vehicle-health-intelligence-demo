"use client";
/* Mobile app · Book: choose the inspection, the hub (nearest first) and a slot, pay through the mock gateway (FPX or
   card), and get the ticket with the check-in QR code. My bookings lists every booking; a ticket can be rescheduled or
   cancelled (refunded through the mock gateway) until the vehicle checks in at the lane. */
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { refreshUseCase } from "@/components/Demo";
import { StatusPill } from "@/components/glass";
import { Icon } from "@/components/icons";
import { MobileSheet, MobileShell, useMobileHref, useMobilePlate } from "@/components/MobileShell";
import { BTN, BTN2, MCard, MEmpty, MError, MList, MSkeleton, MTitle, OwnerSource, Plate, Segmented, Switch, dayLabel } from "@/components/mobileKit";
import { Booking, BOOKING_STATUS, checkinCode, openBookings, useBookings } from "@/components/mobileData";
import { toast } from "@/components/ui";
import { api } from "@/lib/api";
import { useFetch } from "@/lib/live";

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

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Fourteen days to pick from, from the first bookable day. Sundays are closed. */
function DayStrip({ start, value, onChange }: { start: string; value: string; onChange: (d: string) => void }) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));
  return (
    <div className="m-noscroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Day">
      {days.map((d) => {
        const dt = new Date(d + "T00:00:00");
        const closed = dt.getDay() === 0;
        const on = d === value;
        return (
          <button key={d} disabled={closed} onClick={() => onChange(d)} aria-pressed={on} aria-label={`${dayLabel(d, true)}${closed ? ", closed" : ""}`}
            className={`flex w-[58px] shrink-0 flex-col items-center rounded-2xl py-2 transition ${on ? "bg-[#2563EB] text-white shadow-[0_10px_20px_-10px_rgba(37,99,235,0.9)]" : closed ? "bg-slate-100 text-slate-300" : "bg-white text-slate-800 ring-1 ring-slate-200"}`}>
            <span className={`text-[11px] font-semibold uppercase ${on ? "text-blue-100" : "text-slate-400"}`}>{dt.toLocaleDateString("en-GB", { weekday: "short" })}</span>
            <span className="text-[19px] font-extrabold leading-tight">{dt.getDate()}</span>
            <span className={`text-[10.5px] ${on ? "text-blue-100" : "text-slate-400"}`}>{closed ? "Closed" : dt.toLocaleDateString("en-GB", { month: "short" })}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The slot grid: free, Express (next day) and full times. */
function Slots({ slots, picked, wanted, onPick, onFull, only }: {
  slots: any[]; picked?: string | null; wanted?: string | null; onPick: (s: any) => void; onFull?: (t: string) => void; only?: "express" | "normal";
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {slots.map((s: any) => {
        const usable = s.available && (!only || (only === "express") === !!s.gear);
        return (
          <button key={s.time} onClick={() => (usable ? onPick(s) : onFull?.(s.time))} aria-label={usable ? s.time : `${s.time} full`}
            className={`rounded-xl border px-1 py-2 text-[13px] font-semibold transition ${picked === s.time ? "border-[#2563EB] bg-[#2563EB] text-white shadow-[0_8px_16px_-8px_rgba(37,99,235,0.9)]"
              : !usable ? (wanted === s.time ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-300")
              : s.gear ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-800"}`}>
            {s.time}{s.gear && usable && <span className="block text-[9px] font-bold tracking-wide">EXPRESS</span>}{!usable && <span className="block text-[9.5px] font-medium">Full</span>}
          </button>
        );
      })}
    </div>
  );
}

function icsFor(b: Booking, minutes = 40) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const start = `${b.date.replace(/-/g, "")}T${b.slot.replace(":", "")}00`;
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//VehicleSense//Mobile//EN", "BEGIN:VEVENT", `UID:${b.booking_id}@vehiclesense.demo`, `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Asia/Kuala_Lumpur:${start}`, `DURATION:PT${minutes}M`, `SUMMARY:${b.type_label} · ${b.plate}`, `LOCATION:${b.branch_name}`,
    `DESCRIPTION:Check-in code ${checkinCode(b)}. Show the QR code at the lane entry.`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

/* ---------------------------------------------------------------- the ticket */

function Reschedule({ b, open, onClose, onDone }: { b: Booking; open: boolean; onClose: () => void; onDone: (nb: Booking) => void }) {
  const branches = useFetch<any[]>(open ? "/api/branches" : null);
  const gear = useFetch<any>(open ? "/api/owner/gear" : null, { branch_id: b.branch_id });
  const [branch, setBranch] = useState(b.branch_id);
  const [date, setDate] = useState(b.date);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slots = useFetch<any>(open ? "/api/owner/slots" : null, { branch_id: branch, date });
  useEffect(() => setSlot(null), [branch, date]);
  const save = async () => {
    setBusy(true);
    try {
      const nb = await api.post(`/api/owner/bookings/${b.booking_id}/reschedule`, { branch_id: branch, date, slot });
      toast(`Moved to ${dayLabel(nb.date)} ${nb.slot} at ${nb.branch_name}`, "ok");
      onDone(nb);
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  const list = (slots.data?.slots || []).filter((s: any) => !(branch === b.branch_id && date === b.date && s.time === b.slot));
  return (
    <MobileSheet open={open} onClose={onClose} title="Reschedule">
      <p className="text-[13px] text-slate-500">Now: {dayLabel(b.date)} {b.slot} at {b.branch_name}. Same inspection and price; {b.gear ? "an Express booking moves to another Express slot." : "pick any free time."}</p>
      <label className="mt-3 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">Hub
        <select aria-label="Hub for the new time" className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-[14.5px] font-medium normal-case tracking-normal text-slate-900" value={branch} onChange={(e) => setBranch(e.target.value)}>
          {(branches.data || []).map((x) => <option key={x.branch_id} value={x.branch_id}>{x.name}</option>)}
        </select>
      </label>
      <div className="mb-2 mt-3 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Day</div>
      {gear.data && <DayStrip start={b.gear ? gear.data.date : gear.data.date} value={date} onChange={setDate} />}
      <div className="mb-2 mt-3 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Time</div>
      {slots.error && !slots.data ? <MError onRetry={slots.reload}>The free times could not load. {slots.error}</MError> : !slots.data ? <MSkeleton rows={1} h={90} label="Finding free times…" /> : <Slots slots={list} picked={slot} onPick={(s) => setSlot(s.time)} only={b.gear ? "express" : "normal"} />}
      <button disabled={!slot || busy} className={`${BTN} mt-4 w-full`} onClick={save}>{slot ? `Move to ${dayLabel(date)} ${slot}` : "Choose a new time"}</button>
    </MobileSheet>
  );
}

function TicketView({ b, fresh, onChange, href, readOnly = false }: {
  b: Booking; fresh: boolean; onChange: (nb: Booking | null) => void; href: (p: string, q?: Record<string, string | null>) => string; readOnly?: boolean;
}) {
  const [sheet, setSheet] = useState<"" | "move" | "cancel">("");
  const [busy, setBusy] = useState(false);
  const [refund, setRefund] = useState<any>(null);
  const st = BOOKING_STATUS[b.status] || { label: b.status, tone: "gray" as const };
  const changeable = !readOnly && (b.status === "confirmed" || b.status === "pending_payment");
  const pay = async () => {
    setBusy(true);
    try {
      const p = await api.post(`/api/owner/bookings/${b.booking_id}/pay`, { method: "FPX" });
      toast(`Paid (mock payment ${p.payment_ref})`, "ok");
      onChange(p);
      refreshUseCase();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      const c = await api.post(`/api/owner/bookings/${b.booking_id}/cancel`);
      setRefund(c.refund);
      toast(c.refund ? `Cancelled · RM ${c.refund.amount_rm.toFixed(2)} refunded (${c.refund.ref}, mock)` : "Booking cancelled", "ok");
      setSheet("");
      onChange(c);
      refreshUseCase();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([icsFor(b)], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `inspection-${b.booking_id}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const head = b.status === "confirmed" ? "Booking confirmed" : b.status === "pending_payment" ? "Payment pending" : b.status === "checked_in" ? "Checked in at the lane" : "Booking cancelled";
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span className={`m-pop mt-1 flex h-16 w-16 items-center justify-center rounded-full ${b.status === "cancelled" ? "bg-slate-200" : b.status === "pending_payment" ? "bg-amber-100" : "bg-emerald-100"}`}>
        <span className={`flex h-11 w-11 items-center justify-center rounded-full ${b.status === "cancelled" ? "bg-slate-400" : b.status === "pending_payment" ? "bg-amber-500" : "bg-emerald-500"}`}>
          <Icon name={b.status === "cancelled" ? "close" : b.status === "pending_payment" ? "clock" : "check"} size={24} color="#fff" width={3} />
        </span>
      </span>
      <div>
        <h2 className="text-[21px] font-extrabold tracking-tight">{head}</h2>
        <div className="text-[14px] text-slate-600">{b.type_label}</div>
      </div>
      <section aria-label="Ticket" className={`relative w-full overflow-hidden rounded-[24px] bg-white text-left shadow-[0_20px_40px_-26px_rgba(15,23,42,0.6)] ring-1 ring-slate-100 ${b.status === "cancelled" ? "opacity-70" : ""}`}>
        <div className="bg-gradient-to-br from-[#1E3A8A] to-[#2563EB] px-4 py-3 text-white">
          <div className="flex items-center justify-between gap-2"><Plate plate={b.plate} /><StatusPill tone={st.tone} className="!py-0.5 !text-[11px]">{st.label}</StatusPill></div>
          <div className="mt-2 text-[22px] font-extrabold leading-tight">{dayLabel(b.date)} · {b.slot}</div>
          <div className="text-[12.5px] text-blue-100">{b.branch_name}{b.gear ? " · Express slot" : ""}</div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-4 py-3 text-[13px]">
          <dt className="text-slate-500">Hub</dt><dd className="min-w-0 text-right font-semibold">{b.branch_name}</dd>
          <dt className="text-slate-500">Date</dt><dd className="min-w-0 text-right font-semibold">{dayLabel(b.date, true)} · {b.slot}{b.gear ? " (Express)" : ""}</dd>
          <dt className="text-slate-500">Payment</dt>
          <dd className="min-w-0 text-right font-semibold">RM {b.price_rm.toFixed(2)} · {b.payment_ref ? (b.status === "cancelled" ? "refunded" : "paid") : "not paid"} <span className="ml-0.5 whitespace-nowrap rounded bg-slate-100 px-1 align-[1px] text-[10.5px] font-bold text-slate-600">MOCK</span></dd>
          <dt className="text-slate-500">Check-in code</dt><dd className="text-right font-mono text-[14px] font-bold tracking-wider">{checkinCode(b)}</dd>
        </dl>
        <div className="relative border-t-2 border-dashed border-slate-200">
          <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-[#EEF3FA]" aria-hidden />
          <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-[#EEF3FA]" aria-hidden />
        </div>
        <div className="flex flex-col items-center gap-2 px-4 pb-4 pt-4">
          {b.status !== "cancelled" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/owner/bookings/${b.booking_id}/qr.svg`} alt="Check-in QR code" className="h-44 w-44" />
          ) : <div className="flex h-24 items-center text-[13px] text-slate-500">This ticket is no longer valid.</div>}
          <div className="text-center text-[12px] leading-snug text-slate-500">
            Show this code at the lane entry: the plate camera and the code check you in.{b.payment_ref ? ` The payment ran through a mock gateway (${b.payment_ref}); nothing was charged.` : ""}
          </div>
          {refund && <div className="rounded-xl bg-emerald-50 px-3 py-1.5 text-[12.5px] font-semibold text-emerald-800">Refund {refund.ref}: RM {refund.amount_rm.toFixed(2)} (mock)</div>}
        </div>
      </section>
      {b.status === "pending_payment" && !readOnly && <button disabled={busy} className={`${BTN} w-full`} onClick={pay}>Pay RM {b.price_rm.toFixed(2)} with FPX</button>}
      <div className="grid w-full grid-cols-2 gap-2 [&>*:last-child:nth-child(odd)]:col-span-2">
        {b.status !== "cancelled" && <button className={`${BTN2} whitespace-nowrap !px-3`} onClick={download} aria-label="Add to calendar"><Icon name="calendar" size={16} />Calendar</button>}
        <a className={`${BTN2} whitespace-nowrap !px-3`} href={`/checkin/${b.checkin_token}`} aria-label="Open the check-in page"><Icon name="qr" size={16} />Check-in page</a>
        {changeable && <button className={`${BTN2} whitespace-nowrap !px-3`} onClick={() => setSheet("move")}><Icon name="clock" size={16} />Reschedule</button>}
        {changeable && <button className={`${BTN2} whitespace-nowrap !px-3 !text-rose-700`} onClick={() => setSheet("cancel")} aria-label="Cancel booking"><Icon name="xc" size={16} color="#BE123C" />Cancel</button>}
      </div>
      <a className="px-3 py-2.5 text-[14px] font-semibold text-[#2563EB]" href={href("/mobile/book", { ticket: null, view: null })}>Make another booking</a>
      {fresh && <p className="text-[12px] text-slate-400">The ticket is also under My bookings.</p>}
      <Reschedule b={b} open={sheet === "move"} onClose={() => setSheet("")} onDone={(nb) => { setSheet(""); onChange(nb); }} />
      <MobileSheet open={sheet === "cancel"} onClose={() => setSheet("")} title="Cancel this booking?">
        <p className="text-[14px] leading-relaxed text-slate-600">
          {b.type_label} on {dayLabel(b.date, true)} at {b.slot}. {b.payment_ref && b.status === "confirmed" ? `RM ${b.price_rm.toFixed(2)} goes back to you through the mock gateway.` : "Nothing was paid yet."} The slot is released to others.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className={BTN2} onClick={() => setSheet("")}>Keep it</button>
          <button disabled={busy} className="inline-flex items-center justify-center rounded-2xl bg-rose-600 px-4 py-3 text-[14px] font-semibold text-white active:scale-[.985] disabled:opacity-50" onClick={cancel}>{busy ? "Cancelling…" : "Cancel booking"}</button>
        </div>
      </MobileSheet>
    </div>
  );
}

/* ---------------------------------------------------------------- my bookings */

function MyBookings({ list, href }: { list: Booking[]; href: (p: string, q?: Record<string, string | null>) => string }) {
  const open = openBookings(list);
  const past = list.filter((b) => !open.includes(b));
  const Row = ({ b }: { b: Booking }) => {
    const st = BOOKING_STATUS[b.status] || { label: b.status, tone: "gray" as const };
    const d = new Date(b.date + "T00:00:00");
    return (
      <a href={href("/mobile/book", { ticket: b.booking_id, view: null })} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
        <span className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl ${b.status === "cancelled" ? "bg-slate-100 text-slate-400" : "bg-blue-50 text-[#1D4ED8]"}`}>
          <span className="text-[17px] font-extrabold leading-none">{d.getDate()}</span>
          <span className="text-[10px] font-semibold uppercase">{d.toLocaleDateString("en-GB", { month: "short" })}</span>
        </span>
        <span className="min-w-0 flex-1 leading-snug">
          <span className="line-clamp-2 break-words text-[14px] font-semibold">{b.type_label}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-slate-500">
            <StatusPill tone={st.tone} className="!px-2 !py-0.5 !text-[10.5px]">{st.label}</StatusPill>
            <span>{b.slot} · {b.branch_name}</span>
          </span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.2" strokeLinecap="round" className="shrink-0" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
      </a>
    );
  };
  if (!list.length) return <div className="mt-4"><MEmpty icon="calendar" title="No bookings yet" action={<a className="inline-block px-3 py-2.5 text-[14px] font-semibold text-[#2563EB]" href={href("/mobile/book", { view: null })}>Book an inspection</a>}>Your bookings and their check-in codes appear here.</MEmpty></div>;
  return (
    <>
      <MTitle>Upcoming</MTitle>
      {open.length ? <MList label="Upcoming bookings">{open.map((b) => <Row key={b.booking_id} b={b} />)}</MList> : <MCard><p className="text-[13.5px] text-slate-600">Nothing booked.</p></MCard>}
      {past.length > 0 && (
        <>
          <MTitle>Past and cancelled</MTitle>
          <MList label="Past and cancelled bookings">{past.map((b) => <Row key={b.booking_id} b={b} />)}</MList>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- new booking */

function BookScreen() {
  const sp = useSearchParams();
  const router = useRouter();
  const href = useMobileHref();
  const { user, plate } = useMobilePlate();
  const readOnly = user?.role === "viewer";  // the read-only viewer browses slots but cannot book
  const ticket = sp.get("ticket");
  const view = sp.get("view") === "bookings" ? "bookings" : "new";
  const askedType = sp.get("type");
  const [k, setK] = useState(0);
  const books = useBookings(plate, [k]);
  const [fresh, setFresh] = useState<Booking | null>(null);

  const [selling, setSelling] = useState(true);
  const [loan, setLoan] = useState(askedType !== "TRANSFER");
  const types = useFetch<any>("/api/owner/inspection-types", { selling, buyer_loan: loan });
  const branches = useFetch<any[]>("/api/branches");
  const [itype, setItype] = useState("");
  const [branch, setBranch] = useState("BR00");
  const gear = useFetch<any>("/api/owner/gear", { branch_id: branch });
  const [date, setDate] = useState("");
  const slots = useFetch<any>(date ? "/api/owner/slots" : null, { branch_id: branch, date });
  const [slot, setSlot] = useState<any>(null);
  const [wanted, setWanted] = useState<string | null>(null);  // a full time: look for it at nearby branches
  const [pending, setPending] = useState<{ branch: string; time: string } | null>(null);  // pick once that branch's slots load
  const [method, setMethod] = useState<"FPX" | "CARD">("FPX");
  const [paying, setPaying] = useState<"" | "busy" | "ok">("");
  const where = useHere();
  const dayFull = !!slots.data && !slots.data.slots.some((s: any) => s.available);
  const near = useFetch<any>(where && date && (wanted || dayFull) ? "/api/owner/nearby-slots" : null,
    { date, time: wanted || undefined, lat: where?.lat, lon: where?.lon, exclude: branch });
  const [firstType, setFirstType] = useState(true);
  useEffect(() => {
    if (pending && slots.data?.branch_id === pending.branch) {
      setSlot(slots.data.slots.find((s: any) => s.time === pending.time && s.available) || null);
      setPending(null);
    }
  }, [slots.data, pending]);
  useEffect(() => {
    if (!types.data) return;
    if (firstType && askedType && types.data.types.some((t: any) => t.code === askedType)) setItype(askedType);
    else setItype(types.data.recommended[0]);
    setFirstType(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types.data]);
  useEffect(() => { if (gear.data && !date) setDate(gear.data.date); }, [gear.data, date]);
  const moveTo = (b: any, time: string) => {
    setBranch(b.branch_id);
    setSlot(null);
    setWanted(null);
    setPending({ branch: b.branch_id, time });
  };
  const hubs = useMemo(() => (branches.data || []).map((b) => ({ ...b, km: where && b.lat != null ? km(where, b) : null }))
    .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9)), [branches.data, where]);
  const hub = hubs.find((b) => b.branch_id === branch);
  const branchName = hub?.name;
  const t = types.data?.types.find((x: any) => x.code === itype);
  const surcharge = slot?.gear ? types.data?.gear_surcharge_rm || 0 : 0;
  const price = (t?.price || 0) + surcharge;

  const confirm = async () => {
    setPaying("busy");
    try {
      const b = await api.post("/api/owner/bookings", { plate, branch_id: branch, date, slot: slot.time, inspection_type: itype, gear: !!slot.gear });
      const [paid] = await Promise.all([api.post(`/api/owner/bookings/${b.booking_id}/pay`, { method }), new Promise((ok) => setTimeout(ok, 700))]);
      setPaying("ok");
      await new Promise((ok) => setTimeout(ok, 450));
      setFresh(paid);
      setPaying("");
      setSlot(null);
      toast(`Booked and paid (mock payment ${paid.payment_ref})`, "ok");
      refreshUseCase();
      setK((x) => x + 1);
      router.replace(href("/mobile/book", { ticket: paid.booking_id }), { scroll: false });
    } catch (e: any) {
      setPaying("");
      toast(e.message, "err");
    }
  };

  const shown = ticket ? (fresh?.booking_id === ticket ? fresh : (books.data || []).find((b) => b.booking_id === ticket)) : null;
  const count = openBookings(books.data).length;

  if (ticket)
    return (
      <MobileShell tab="book" badges={{ book: count }} title="Your ticket" back={href("/mobile/book", { ticket: null, view: "bookings" })} backLabel="Bookings" scrollKey={ticket}>
        {shown ? <TicketView b={shown} fresh={fresh?.booking_id === ticket} href={href} readOnly={readOnly} onChange={(nb) => { if (nb) setFresh(nb); setK((x) => x + 1); }} />
          : books.error ? <MError onRetry={books.reload}>{books.error}</MError>
          : !books.data ? <MSkeleton rows={2} h={160} label="Loading your ticket…" /> : <MEmpty icon="calendar" title="No such booking" action={<a className="inline-block px-3 py-2.5 text-[14px] font-semibold text-[#2563EB]" href={href("/mobile/book", { ticket: null, view: "bookings" })}>See my bookings</a>}>It may belong to another vehicle.</MEmpty>}
      </MobileShell>
    );

  return (
    <MobileShell tab="book" badges={{ book: count }} title="Book an inspection" scrollKey={view}
      footer={view === "new" ? (
        <div className="border-t border-slate-200/70 bg-white/90 px-4 pb-2 pt-2.5 backdrop-blur-xl">
          {slot && t && (
            <div className="mb-2 text-[12.5px] leading-snug">
              <div className="truncate font-semibold text-slate-800">{dayLabel(date)} · {slot.time} · {branchName}</div>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-slate-500">{t.label}{slot.gear ? " · Express slot" : ""}</span>
                <b className="shrink-0 text-slate-800">RM {price.toFixed(2)}</b>
              </div>
            </div>
          )}
          <button disabled={!slot || !itype || paying !== "" || readOnly} onClick={confirm} className={`${BTN} w-full`}>
            {readOnly ? "Read-only account: booking is off" : slot ? `Pay RM ${price.toFixed(2)} and book ${slot.time}` : "Choose a slot"}
          </button>
        </div>
      ) : undefined}>
      <Segmented label="Bookings" value={view} onChange={(v) => router.replace(href("/mobile/book", { view: v === "bookings" ? "bookings" : null }), { scroll: false })}
        items={[{ id: "new", label: "New booking" }, { id: "bookings", label: `My bookings${count ? ` · ${count}` : ""}` }]} />

      {view === "bookings" ? (books.error ? <MError onRetry={books.reload}>Your bookings could not load. {books.error}</MError> : !books.data ? <div className="mt-4"><MSkeleton rows={3} label="Loading your bookings…" /></div> : <MyBookings list={books.data} href={href} />) : (
        <>
          <MTitle>1 · What is it for?</MTitle>
          <MList label="What the inspection is for">
            <Switch checked={selling} onChange={setSelling} label="Selling the car" sub="The buyer needs an ownership transfer inspection" />
            <Switch checked={loan} onChange={setLoan} label="Buyer takes a bank loan" sub="The bank asks for a financing inspection" />
          </MList>
          <div className="mt-2.5 flex flex-col gap-2">
            {types.error && !types.data ? <MError onRetry={types.reload}>The inspection types could not load. {types.error}</MError> : !types.data ? <MSkeleton rows={3} h={56} label="Loading the inspection types…" /> : types.data.types.map((x: any) => {
              const on = itype === x.code;
              const rec = types.data.recommended.includes(x.code);
              return (
                <button key={x.code} onClick={() => setItype(x.code)} aria-pressed={on}
                  className={`flex items-center gap-3 rounded-[18px] border bg-white px-3.5 py-3 text-left transition ${on ? "border-[#2563EB] ring-2 ring-blue-100" : "border-slate-200"}`}>
                  <span className="min-w-0 flex-1 leading-snug">
                    <span className="block text-[14px] font-semibold">{x.label}</span>
                    <span className="block text-[12px] text-slate-500">RM {x.price} · about {x.minutes} min{rec ? "" : ""}</span>
                  </span>
                  {rec && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">Recommended</span>}
                  <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-[#2563EB] bg-[#2563EB]" : "border-slate-300"}`} aria-hidden>
                    {on && <Icon name="check" size={12} color="#fff" width={3.4} />}
                  </span>
                </button>
              );
            })}
          </div>

          <MTitle>2 · Where?</MTitle>
          <MCard className="relative flex items-center gap-3 !py-3 focus-within:ring-2 focus-within:ring-blue-300">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-blue-50"><Icon name="pin" size={19} color="#2563EB" /></span>
            <span className="min-w-0 flex-1 leading-snug" aria-hidden>
              <span className="block truncate text-[15px] font-semibold">{hub?.name || "Choose a hub"}</span>
              <span className="block text-[12px] text-slate-500">{hub?.km != null ? `${hub.km.toFixed(1)} km from ${where?.label}` : "Finding the nearest hubs…"}{hub ? ` · ${hub.lanes} lanes` : ""}</span>
            </span>
            <Icon name="down" size={18} color="#2563EB" />
            <select aria-label="Branch" className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-[22px] opacity-0" value={branch}
              onChange={(e) => { setBranch(e.target.value); setSlot(null); setWanted(null); }}>
              {hubs.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.name}{b.km != null ? ` · ${b.km.toFixed(1)} km` : ""}</option>)}
            </select>
          </MCard>

          <MTitle>3 · When?</MTitle>
          {gear.data && <DayStrip start={gear.data.date} value={date} onChange={(d) => { setDate(d); setSlot(null); setWanted(null); }} />}
          {gear.data && date === gear.data.date && (
            <div className="mt-2.5 flex items-center gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 ring-1 ring-amber-200">
              <Icon name="bolt" size={16} color="#D97706" />
              <span className="min-w-0 text-balance">{`Express next\u2011day slots on ${dayLabel(gear.data.date)}`} <span className="whitespace-nowrap">(+RM {gear.data.surcharge_rm})</span></span>
            </div>
          )}
          <div className="mt-2.5">{slots.error && !slots.data ? <MError onRetry={slots.reload}>The free times could not load. {slots.error}</MError> : !slots.data ? <MSkeleton rows={1} h={120} label="Finding free times…" /> : (
            <Slots slots={slots.data.slots} picked={slot?.time} wanted={wanted} onPick={(s) => { setSlot(s); setWanted(null); }} onFull={(tm) => { setSlot(null); setWanted(tm); }} />
          )}</div>
          {(wanted || dayFull) && (
            <div className="m-pop mt-3 rounded-[20px] border border-amber-300 bg-amber-50 p-3.5 text-[13px] text-amber-900">
              <b>{wanted ? `${wanted} is full at ${branchName}.` : `${branchName} is full on this day.`}</b>{" "}
              Nearest branches {wanted ? `with ${wanted} free` : "with free slots"}, from {where?.label}:
              <div className="mt-2 flex flex-col gap-1.5">
                {near.loading && <span className="text-amber-700">Looking…</span>}
                {near.data?.branches?.map((b: any) => (
                  <button key={b.branch_id} onClick={() => moveTo(b, b.time_free ? wanted! : b.other_times[0])}
                    className="flex items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-white px-3 py-2.5 text-left text-slate-900 active:scale-[.99]">
                    <span className="min-w-0"><b className="block truncate">{b.name}</b><span className="text-[12px] text-slate-500">{b.km} km</span></span>
                    <span className="shrink-0 text-[12px] font-semibold text-emerald-700">{b.time_free ? `${wanted} free` : `free ${b.other_times.join(", ")}`}</span>
                  </button>
                ))}
                {near.data && !near.data.branches.length && <span>No nearby branch has a free slot then. Try another day.</span>}
              </div>
            </div>
          )}

          <MTitle action={<OwnerSource kind="mock" text="Payment" />}>4 · Payment</MTitle>
          <Segmented label="Payment method" value={method} onChange={setMethod} items={[{ id: "FPX", label: "FPX online banking" }, { id: "CARD", label: "Debit or credit card" }]} />
          <MCard className="mt-2.5">
            {method === "FPX" ? (
              <div className="flex items-center gap-3 text-[13px]"><span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-blue-50"><Icon name="wallet" size={19} color="#2563EB" /></span>
                <span className="leading-snug text-slate-600">You pick your bank on the gateway&apos;s page and approve there. In this demo the gateway approves straight away.</span></div>
            ) : (
              <div className="flex items-center gap-3 text-[13px]"><span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-blue-50"><Icon name="card" size={19} color="#2563EB" /></span>
                <span className="leading-snug"><b className="block">Test card •••• 4242</b><span className="text-slate-500">Saved on this phone · expires 12/29</span></span></div>
            )}
            <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 border-t border-slate-100 pt-3 text-[13px]">
              <dt className="text-slate-500">{t?.label || "Inspection"}</dt><dd className="text-right">RM {(t?.price || 0).toFixed(2)}</dd>
              {surcharge > 0 && <><dt className="text-slate-500">Express next-day slot</dt><dd className="text-right">RM {surcharge.toFixed(2)}</dd></>}
              <dt className="font-bold">Total</dt><dd className="text-right font-bold">RM {price.toFixed(2)}</dd>
            </dl>
          </MCard>
          <p className="mt-2 px-1 text-[11.5px] text-slate-400">Payment runs through a mock gateway in this demo: nothing is charged.</p>
        </>
      )}
      <MobileSheet open={paying !== ""} onClose={() => {}} dismissable={false} title={paying === "ok" ? "Payment approved" : `Paying RM ${price.toFixed(2)}`}>
        <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
          {paying === "ok" ? (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500"><Icon name="check" size={28} color="#fff" width={3} /></span>
          ) : <span className="m-spin h-12 w-12 rounded-full border-4 border-blue-100 border-t-[#2563EB]" aria-hidden />}
          <p className="text-[14px] text-slate-600">{paying === "ok" ? "Your slot is held. Opening the ticket…" : `Connecting to ${method === "FPX" ? "FPX" : "the card network"} through the mock gateway…`}</p>
        </div>
      </MobileSheet>
    </MobileShell>
  );
}

export default function Page() {
  return <Suspense><BookScreen /></Suspense>;
}
