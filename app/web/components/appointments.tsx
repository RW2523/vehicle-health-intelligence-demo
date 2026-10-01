"use client";
/* Appointments (the inspection app): the calendar pieces (week strip, mini month, day agenda, table), the
   appointment's detail with its timeline, QR and actions, the slot grid and the New appointment / reschedule / cancel
   dialogs. The page (app/appointments/page.tsx) puts them together. */
import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { StatusPill, TONE, Tone } from "./glass";
import { Icon } from "./icons";
import { ErrorState, LoadingState, Modal, Source, toast } from "./ui";
import { Photo, VehiclePhoto, VehiclePhotos } from "./Photo";
import { VehicleArt } from "./VehicleArt";
import { api } from "@/lib/api";

// ---- types
export type Step = { key: string; label: string; done: boolean; at: string | null; detail: string };
export type Appt = {
  booking_id: string; plate: string; branch_id: string; branch_name: string; date: string; slot: string; end: string; minutes: number;
  inspection_type: string; type_label: string; gear: boolean; gear_slot: boolean; price_rm: number; status: string; stage: string;
  payment_ref: string | null; payment: { state: string; label: string; method: string | null; ref: string | null; at: string | null };
  awaiting_payment: boolean; checkin_token: string; checkin_url: string; qr_url: string; source: string; source_label: string;
  fleet_id: string | null; created_at: string | null; note: string | null; cancel_reason: string | null;
  vehicle: { plate: string; make?: string; model?: string; year?: number; vtype?: string; fuel?: string; usage?: string; owner_name?: string; heavy?: boolean; fleet_name?: string | null };
  inspection_id: string | null; inspection: any; report: any; timeline: Step[];
  events: { kind: string; at: string; by: string; detail: string }[];
  can: { checkin: boolean; reschedule: boolean; cancel: boolean; pay: boolean };
};
export type Listing = {
  today: string; now: string; from: string; to: string; items: Appt[]; counts: Record<string, number>; days: Record<string, number>;
  stats: { today: number; week: number; awaiting_payment: number; awaiting_payment_rm: number; checked_in_today: number; cancelled: number; week_from: string; week_to: string };
};
export type Vehicle = Appt["vehicle"] & { suggested_type: string };
export type Options = {
  today: string; now: string; vehicles: Vehicle[]; types: { code: string; label: string; price: number; minutes: number }[];
  branches: { branch_id: string; name: string; state: string; heavy_capable: boolean; lanes: number }[]; default_branch: string;
  gear_times: string[]; methods: { code: string; label: string }[];
};
export type Slot = { time: string; free: number; capacity: number; taken: number; gear: boolean; express: boolean; available: boolean; reason: string | null; reason_text: string | null; booked: { booking_id: string; plate: string }[] };
export type SlotView = { branch: { name: string; heavy_capable: boolean; lanes: number }; date: string; weekday: string; closed: boolean; past: boolean; vehicle: { plate: string; heavy: boolean } | null; vehicle_same_day: { slot: string; branch_name: string } | null; gear_times: string[]; slots: Slot[]; available: number };

// ---- labels
export const STAGE: Record<string, { label: string; tone: Tone }> = {
  confirmed: { label: "Confirmed", tone: "blue" }, pending_payment: { label: "Payment pending", tone: "amber" },
  checked_in: { label: "Checked in", tone: "sky" }, in_lane: { label: "On the lane", tone: "purple" },
  inspected: { label: "Inspected", tone: "purple" }, reported: { label: "Report issued", tone: "green" },
  cancelled: { label: "Cancelled", tone: "red" }, no_show: { label: "No-show", tone: "gray" },
};
const PAY_TONE: Record<string, Tone> = { paid: "green", refunded: "gray", account: "gray", online_pending: "amber", counter: "amber", none: "gray" };
export const STATUS_FILTERS = [
  ["", "All statuses"], ["confirmed", "Confirmed"], ["awaiting_payment", "Awaiting payment"], ["pending_payment", "Online payment pending"],
  ["checked_in", "Checked in"], ["cancelled", "Cancelled"], ["no_show", "No-show"],
] as const;
const SHORT: Record<string, string> = { full: "full", past: "past", closed: "closed", gear_only: "light only", gear_reserved: "heavy only", no_heavy_lane: "no lane", current: "now" };
const CANCEL_REASONS = ["Owner asked to cancel", "Vehicle off the road", "Booked by mistake", "Fleet will rebook"];

export function StagePill({ stage, className = "" }: { stage: string; className?: string }) {
  const s = STAGE[stage] || { label: stage, tone: "gray" as Tone };
  return <StatusPill tone={s.tone} dot className={className}>{s.label}</StatusPill>;
}

export function PayChip({ a }: { a: Appt }) {
  const t = TONE[PAY_TONE[a.payment.state] || "gray"];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ color: t.fg, background: t.bg }}>
      <Icon name={a.payment.state === "paid" ? "checkc" : "wallet"} size={12} />{a.payment.label}
    </span>
  );
}

// ---- dates (ISO day strings, computed in UTC so the browser's zone never shifts a day)
const D = (iso: string) => new Date(iso + "T00:00:00Z");
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => { const d = D(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
export const weekStart = (iso: string) => addDays(iso, -((D(iso).getUTCDay() + 6) % 7));
export const isSunday = (iso: string) => D(iso).getUTCDay() === 0;
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => D(iso).toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
export const dayShort = (iso: string) => fmt(iso, { weekday: "short", day: "numeric", month: "short" });
export const dayMonth = (iso: string) => fmt(iso, { day: "numeric", month: "short" });
export const dayLong = (iso: string) => fmt(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const monthOf = (iso: string) => iso.slice(0, 7) + "-01";
export const addMonths = (first: string, n: number) => { const d = D(first); d.setUTCMonth(d.getUTCMonth() + n); return isoOf(d); };
export const monthGrid = (first: string) => { const s = weekStart(first); return Array.from({ length: 42 }, (_, i) => addDays(s, i)); };
export const mytToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
export const atTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const rm = (n: number) => `RM ${n.toFixed(2)}`;
const code = (t: string) => (t || "").toUpperCase().replace(/(.{4})(?=.)/g, "$1 ");

// ---- vehicle photos (the image library's hero photo when there is one, else the vehicle's illustration)
const photoCache = new Map<string, { at: number; p: Promise<Photo | null> }>();
function photoOf(plate: string): Promise<Photo | null> {
  const hit = photoCache.get(plate);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.p;  // one request per vehicle for every card on the page
  const p = api.get(`/api/images/vehicle/${encodeURIComponent(plate)}`).then((r: VehiclePhotos) => r?.hero || r?.gallery?.[0] || null).catch(() => null);
  photoCache.set(plate, { at: Date.now(), p });
  return p;
}
export function useVehiclePhoto(plate?: string | null) {
  const [p, setP] = useState<Photo | null>(null);
  useEffect(() => {
    let alive = true;
    setP(null);
    if (plate) photoOf(plate).then((x) => alive && setP(x));
    return () => { alive = false; };
  }, [plate]);
  return p;
}
/** A vehicle's photo filling its box (cover), or its illustration on a soft backdrop. */
export function ApptPhoto({ plate, vtype, className = "", size = "480", credit = false }: { plate: string; vtype?: string; className?: string; size?: "480" | "960"; credit?: boolean }) {
  const p = useVehiclePhoto(plate);
  if (p) return <VehiclePhoto plate={plate} vtype={vtype} photo={p} size={size} credit={credit} className={className} />;
  return (
    <span className={`relative block overflow-hidden bg-gradient-to-b from-[#EEF3FA] to-[#DCE5F1] ${className}`}>
      <VehicleArt vtype={vtype || "Sedan"} seed={plate} className="absolute inset-[8%] h-[84%] w-[84%]" title={plate} />
    </span>
  );
}

// ---- small pieces
export function Seg<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: readonly (readonly [T, ReactNode])[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-xl border border-white/80 bg-white/60 p-1 shadow-glass">
      {items.map(([k, l]) => (
        <button key={k} role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${value === k ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow-sm" : "text-fg-2 hover:bg-white"}`}>{l}</button>
      ))}
    </div>
  );
}

/** The selected week: prev / next, each day with its number of appointments. */
export function WeekStrip({ selected, today, days, onSelect }: { selected: string; today: string; days: Record<string, number>; onSelect: (d: string) => void }) {
  const ws = weekStart(selected);
  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-2">
      {Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((d) => {
        const sel = d === selected, n = days[d] || 0, sun = isSunday(d);
        return (
          <button key={d} onClick={() => onSelect(d)} aria-pressed={sel} aria-label={`${dayLong(d)}: ${sun ? "closed" : `${n} appointment${n === 1 ? "" : "s"}`}`}
            className={`flex min-w-0 flex-col items-center rounded-2xl px-0.5 py-2 transition sm:py-2.5 ${sel ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,0.7)]" : "bg-white/70 ring-1 ring-ink-600 hover:bg-white"}`}>
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${sel ? "text-white/80" : "text-fg-3"}`}>{fmt(d, { weekday: "short" })}</span>
            <span className={`text-[19px] font-bold leading-tight sm:text-[22px] ${!sel && d === today ? "text-cyan" : ""}`}>{fmt(d, { day: "numeric" })}</span>
            <span className={`mt-0.5 h-[18px] text-[11px] font-semibold ${sel ? "text-white" : sun ? "text-fg-4" : n ? "text-cyan" : "text-fg-4"}`}>
              {sun ? "Closed" : n ? <><span className="sm:hidden">{n}</span><span className="hidden sm:inline">{n} appt{n === 1 ? "" : "s"}</span></> : "–"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A month at a glance: a dot on every day with appointments. */
export function MiniMonth({ month, selected, today, days, onSelect, onMonth }: {
  month: string; selected: string; today: string; days: Record<string, number>; onSelect: (d: string) => void; onMonth: (m: string) => void;
}) {
  const grid = monthGrid(month);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <b className="text-[15px]">{fmt(month, { month: "long", year: "numeric" })}</b>
        <span className="flex gap-1">
          <button className="btn btn-sm px-2" aria-label="Previous month" onClick={() => onMonth(addMonths(month, -1))}><Icon name="back" size={14} /></button>
          <button className="btn btn-sm px-2" aria-label="Next month" onClick={() => onMonth(addMonths(month, 1))}><Icon name="chev" size={14} /></button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase text-fg-4">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((w) => <span key={w} className="py-1">{w}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {grid.map((d) => {
          const inMonth = d.slice(0, 7) === month.slice(0, 7), sel = d === selected, n = days[d] || 0;
          return (
            <button key={d} onClick={() => onSelect(d)} aria-label={`${dayLong(d)}${n ? `, ${n} appointments` : ""}`} aria-pressed={sel}
              className={`relative mx-auto flex h-9 w-9 flex-col items-center justify-center rounded-full text-[13px] transition ${sel ? "bg-cyan font-bold text-white" : d === today ? "font-bold text-cyan ring-1 ring-blue-200" : inMonth ? "text-fg-2 hover:bg-white" : "text-fg-4/70 hover:bg-white"}`}>
              {Number(d.slice(8))}
              {n > 0 && <span className={`absolute bottom-1 h-1 w-1 rounded-full ${sel ? "bg-white" : "bg-cyan"}`} aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One appointment in the agenda. */
function ApptCard({ a, selected, onOpen }: { a: Appt; selected: boolean; onOpen: () => void }) {
  return (
    <button onClick={onOpen} aria-pressed={selected}
      className={`group flex w-full min-w-0 items-center gap-3 rounded-2xl border bg-white/75 p-2.5 text-left shadow-glass transition hover:-translate-y-0.5 hover:bg-white ${selected ? "border-cyan ring-2 ring-blue-200" : "border-white/80"} ${a.status === "cancelled" ? "opacity-70" : ""}`}>
      <ApptPhoto plate={a.plate} vtype={a.vehicle.vtype} className="h-[52px] w-[74px] shrink-0 rounded-xl sm:h-[64px] sm:w-[96px]" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <b className={`text-[15.5px] tracking-tight ${a.status === "cancelled" ? "line-through decoration-1" : ""}`}>{a.plate}</b>
          <span className="truncate text-[12.5px] text-fg-3">{a.vehicle.make} {a.vehicle.model}</span>
        </span>
        <span className="block truncate text-[13px] text-fg-2">{a.type_label}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <StagePill stage={a.stage} />
          {a.status !== "cancelled" && <PayChip a={a} />}
          <span className="inline-flex items-center gap-1 text-[11.5px] text-fg-3"><Icon name="pin" size={12} />{a.branch_name.replace(" Inspection Hub", "")}</span>
          {a.gear_slot && <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#B45309]"><Icon name="wrench" size={12} />Gear slot</span>}
        </span>
      </span>
      <span className="hidden sm:block"><Icon name="chev" size={16} color="#94A3B8" /></span>
    </button>
  );
}

function TimeRows({ items, selectedId, onOpen, nowLine }: { items: Appt[]; selectedId?: string | null; onOpen: (a: Appt) => void; nowLine?: string | null }) {
  const groups = useMemo(() => {
    const m = new Map<string, Appt[]>();
    for (const a of items) m.set(a.slot, [...(m.get(a.slot) || []), a]);
    return [...m.entries()].sort(([x], [y]) => x.localeCompare(y));
  }, [items]);
  const nowAt = nowLine ? groups.findIndex(([t]) => t > nowLine) : -1;
  return (
    <ol className="flex flex-col">
      {groups.map(([t, as], i) => (
        <li key={t}>
          {i === nowAt && <NowLine time={nowLine!} />}
          <div className="flex flex-col gap-2 border-t border-ink-600/60 py-3 first:border-0 sm:flex-row sm:gap-4">
            <div className="flex items-baseline gap-1.5 sm:block sm:w-[56px] sm:shrink-0 sm:pt-1">
              <div className="text-[15px] font-bold leading-none">{t}</div>
              <div className="text-[11.5px] text-fg-4 sm:mt-1"><span className="sm:hidden">to </span>{as[0].end}</div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {as.map((a) => <ApptCard key={a.booking_id} a={a} selected={a.booking_id === selectedId} onOpen={() => onOpen(a)} />)}
            </div>
          </div>
        </li>
      ))}
      {nowLine && groups.length > 0 && nowAt === -1 && <li><NowLine time={nowLine} /></li>}
    </ol>
  );
}

function NowLine({ time }: { time: string }) {
  return (
    <div className="flex items-center gap-2 py-1" aria-label={`Now, ${time}`}>
      <span className="w-[48px] shrink-0 text-[11.5px] font-bold text-bad sm:w-[56px]">{time}</span>
      <span className="h-2 w-2 rounded-full bg-bad" aria-hidden /><span className="h-px flex-1 bg-bad/60" aria-hidden />
    </div>
  );
}

/** The day (or the week, day by day) grouped by time. */
export function Agenda({ mode, selected, today, now, items, selectedId, onOpen, onBook }: {
  mode: "day" | "week"; selected: string; today: string; now: string; items: Appt[]; selectedId?: string | null; onOpen: (a: Appt) => void; onBook: (day: string) => void;
}) {
  const days = mode === "day" ? [selected] : Array.from({ length: 7 }, (_, i) => addDays(weekStart(selected), i));
  return (
    <div className="flex flex-col gap-4">
      {days.map((d) => {
        const its = items.filter((a) => a.date === d);
        const open = its.filter((a) => a.status !== "cancelled").length;
        return (
          <section key={d} aria-label={dayLong(d)}>
            {mode === "week" && (
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 pb-2">
                <h3 className="text-[15px] font-bold">{dayShort(d)}{d === today && <span className="ml-2 align-middle"><StatusPill tone="blue">Today</StatusPill></span>}</h3>
                <span className="text-[12.5px] text-fg-3">{isSunday(d) ? "Closed" : `${open} appointment${open === 1 ? "" : "s"}`}</span>
              </div>
            )}
            {its.length ? (
              <TimeRows items={its} selectedId={selectedId} onOpen={onOpen} nowLine={d === today ? now : null} />
            ) : isSunday(d) ? (
              <p className="py-3 text-[13px] text-fg-4">The hubs are closed on Sundays.</p>
            ) : mode === "week" ? (
              <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-[13px] text-fg-4">
                No appointments{d >= today && <button className="btn btn-sm" onClick={() => onBook(d)}><Icon name="plus" size={13} />Book</button>}
              </div>
            ) : (
              <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-500 bg-white/40 px-6 py-10 text-center">
                <Icon name="calendar" size={34} width={1.4} color="#94A3B8" />
                <b className="text-[16px]">No appointments on {dayShort(d)}</b>
                <span className="max-w-[360px] text-[13px] text-fg-3">{d < today ? "Nothing was booked for this day." : "Nothing booked yet for this day (with these filters)."}</span>
                {d >= today && <button className="btn btn-primary mt-1" onClick={() => onBook(d)}><Icon name="plus" size={15} />New appointment</button>}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Every appointment of the range in rows. */
export function ApptTable({ items, selectedId, onOpen }: { items: Appt[]; selectedId?: string | null; onOpen: (a: Appt) => void }) {
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[540px] text-left text-[13.5px]">
        <thead className="text-[12.5px] text-fg-3">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium"><th>When</th><th>Vehicle</th><th>Inspection</th><th>Status</th></tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.booking_id} onClick={() => onOpen(a)} className={`cursor-pointer border-t border-ink-600/60 align-top transition hover:bg-white/70 [&>td]:px-3 [&>td]:py-2.5 ${a.booking_id === selectedId ? "bg-blue-50/70" : ""}`}>
              <td className="whitespace-nowrap"><b className="block">{dayShort(a.date)}</b><span className="block text-[12px] text-fg-3">{a.slot}–{a.end}</span><span className="block text-[12px] text-fg-3">{a.branch_name.replace(" Inspection Hub", "")}</span></td>
              <td>
                <span className="flex items-start gap-2.5">
                  <ApptPhoto plate={a.plate} vtype={a.vehicle.vtype} className="mt-0.5 h-9 w-14 shrink-0 rounded-lg" />
                  <span className="min-w-0"><button className={`block whitespace-nowrap font-bold hover:text-cyan ${a.status === "cancelled" ? "line-through decoration-1" : ""}`} onClick={(e) => { e.stopPropagation(); onOpen(a); }} aria-label={`Open ${a.plate}, ${dayShort(a.date)} ${a.slot}`}>{a.plate}</button>
                    <span className="block whitespace-nowrap text-[12px] text-fg-3">{a.vehicle.make} {a.vehicle.model}</span>
                    <span className="block max-w-[150px] truncate text-[12px] text-fg-4">{a.vehicle.owner_name}</span></span>
                </span>
              </td>
              <td className="max-w-[190px]"><span className="block truncate text-fg-2" title={a.type_label}>{a.type_label}</span><span className="text-[12px] text-fg-4">{a.source_label}</span></td>
              <td><span className="flex flex-col items-start gap-1"><StagePill stage={a.stage} />{a.status !== "cancelled" && <PayChip a={a} />}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- the detail
function Timeline({ steps, cancelled }: { steps: Step[]; cancelled: boolean }) {
  const cur = steps.findIndex((s) => !s.done);
  return (
    <ol className="relative flex flex-col">
      {steps.map((s, i) => {
        const bad = s.key === "cancelled", now = i === cur && !cancelled;
        const color = bad ? "#EF4444" : s.done ? "#10B981" : now ? "#2563EB" : "#CBD5E1";
        return (
          <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-22px)] w-0.5 rounded" style={{ background: s.done ? "#A7F3D0" : "#E2E8F0" }} aria-hidden />}
            <span className="relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: s.done || bad ? color : "#fff", boxShadow: `inset 0 0 0 2px ${color}` }}>
              {bad ? <Icon name="close" size={14} color="#fff" width={2.4} /> : s.done ? <Icon name="check" size={14} color="#fff" width={2.6} /> : <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
            </span>
            <span className="min-w-0 pt-0.5 leading-snug">
              <b className={`block text-[14px] ${!s.done && !now ? "text-fg-3" : ""}`}>{s.label}{now && <span className="ml-2 text-[11.5px] font-semibold text-cyan">next</span>}</b>
              {s.at && <span className="block text-[12px] text-fg-3">{atTime(s.at)}</span>}
              {s.detail && <span className="block break-words text-[12.5px] text-fg-2">{s.detail}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Fact({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-cyan ring-1 ring-blue-100"><Icon name={icon} size={15} /></span>
      <span className="min-w-0 leading-snug"><span className="block text-[11.5px] font-medium text-fg-3">{label}</span><span className="block break-words text-[13.5px] font-semibold">{children}</span></span>
    </div>
  );
}

/** An appointment: the vehicle, when and where, its timeline, the check-in QR and what staff can do with it. */
export function ApptDetail({ a, today, options, canWrite, onChanged, onClose }: {
  a: Appt; today: string; options: Options | null; canWrite: boolean; onChanged: (a: Appt) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  useEffect(() => { setPayOpen(false); }, [a.booking_id]);
  const act = async (key: string, path: string, body: any, ok: string) => {
    setBusy(key);
    try {
      const r = await api.post(`/api/appointments/${a.booking_id}/${path}`, body);
      onChanged(r);
      toast(ok, "ok");
      return true;
    } catch (e: any) {
      toast(e.message, "err");
      return false;
    } finally {
      setBusy(null);
    }
  };
  const v = a.vehicle;
  const live = a.status !== "cancelled";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow">Appointment</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2"><span className="font-mono text-[13px] text-fg-3">{a.booking_id}</span><StagePill stage={a.stage} /></div>
        </div>
        <button className="btn btn-sm px-2" onClick={onClose} aria-label="Close the appointment"><Icon name="close" size={16} /></button>
      </div>

      <div className="relative">
        <ApptPhoto plate={a.plate} vtype={v.vtype} size="960" credit className="aspect-[16/9] w-full rounded-2xl" />
        <span className="absolute bottom-3 left-3 rounded-lg bg-white/90 px-2.5 py-1 font-mono text-[14px] font-bold tracking-wider shadow-sm ring-1 ring-ink-600">{a.plate}</span>
        {v.heavy && <span className="absolute right-3 top-3"><StatusPill tone="amber">Heavy vehicle</StatusPill></span>}
      </div>
      <div>
        <h2 className="text-[22px] font-bold leading-tight tracking-tight">{v.make} {v.model}</h2>
        <p className="text-[13.5px] text-fg-3">{[v.year, v.vtype, v.fuel].filter(Boolean).join(" · ")} · {v.owner_name}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fact icon="calendar" label="Date">{dayLong(a.date)}</Fact>
        <Fact icon="clock" label="Time">{a.slot}–{a.end}<span className="block text-[12px] font-medium text-fg-3">{a.minutes} min{a.gear_slot ? " · gear slot" : ""}</span></Fact>
        <Fact icon="pin" label="Hub">{a.branch_name}</Fact>
        <Fact icon="clipboard" label="Inspection">{a.type_label}</Fact>
        <Fact icon="receipt" label="Price">{rm(a.price_rm)} · <span className="font-medium text-fg-3">{a.payment.label}</span></Fact>
        <Fact icon="user" label="Booked via">{a.source_label}</Fact>
      </div>
      {a.note && <div className="rounded-xl bg-blue-50/70 px-3.5 py-2.5 text-[13px] text-fg-2 ring-1 ring-blue-100"><b className="mr-1 text-fg">Note:</b>{a.note}</div>}
      {a.cancel_reason && <div className="rounded-xl bg-red-50 px-3.5 py-2.5 text-[13px] text-[#B91C1C] ring-1 ring-red-100"><b className="mr-1">Cancelled:</b>{a.cancel_reason}</div>}

      {canWrite && (a.can.checkin || a.can.pay || a.can.reschedule || a.can.cancel) && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {a.can.checkin && <button className="btn btn-primary" disabled={!!busy} onClick={() => act("checkin", "checkin", {}, `${a.plate} checked in`)}><Icon name="checkc" size={16} />{busy === "checkin" ? "Checking in…" : "Check in"}</button>}
            {a.can.pay && <button className="btn" disabled={!!busy} aria-expanded={payOpen} onClick={() => setPayOpen((x) => !x)}><Icon name="wallet" size={16} />Mark paid</button>}
            {a.can.reschedule && <button className="btn" disabled={!!busy} onClick={() => setMoveOpen(true)}><Icon name="calendar" size={16} />Reschedule</button>}
            {a.can.cancel && <button className="btn btn-danger" disabled={!!busy} onClick={() => setCancelOpen(true)}><Icon name="xc" size={16} />Cancel</button>}
          </div>
          {!a.can.checkin && live && a.status !== "checked_in" && a.date !== today && (
            <p className="text-[12px] text-fg-4">{a.date > today ? "Check-in opens on the day of the appointment." : "This day has passed: reschedule it to check the vehicle in."}</p>
          )}
          {payOpen && (
            <div className="rounded-2xl bg-white/80 p-3 ring-1 ring-ink-600">
              <div className="mb-2 text-[12.5px] font-semibold text-fg-2">Take {rm(a.price_rm)} with (mock gateway, always approved)</div>
              <div className="flex flex-wrap gap-2">
                {(options?.methods || [{ code: "CASH", label: "Cash" }, { code: "CARD", label: "Card" }]).map((m) => (
                  <button key={m.code} className="btn btn-sm" disabled={!!busy}
                    onClick={async () => { if (await act("pay", "payment", { method: m.code }, `Paid by ${m.label.toLowerCase()} · ${rm(a.price_rm)}`)) setPayOpen(false); }}>
                    {busy === "pay" ? "…" : m.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <section aria-label="Progress">
        <h3 className="mb-2.5 text-[15px] font-bold">Progress</h3>
        <Timeline steps={a.timeline} cancelled={!live} />
      </section>

      {live && (
        <section aria-label="Check-in code" className="flex flex-wrap items-center gap-4 rounded-2xl bg-white/80 p-3.5 ring-1 ring-ink-600">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.qr_url} alt={`Check-in QR code for ${a.plate}`} width={112} height={112} className="h-[112px] w-[112px] shrink-0 rounded-xl bg-white p-1 ring-1 ring-ink-600" />
          <div className="min-w-0 flex-1">
            <div className="label">Check-in code</div>
            <div className="mt-0.5 break-all font-mono text-[17px] font-bold tracking-wider">{code(a.checkin_token)}</div>
            <div className="mt-0.5 text-[12px] text-fg-3">The lane reads the plate; the owner can also show this QR at the counter.</div>
            <a className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-cyan hover:underline" href={a.checkin_url} target="_blank" rel="noreferrer">Open the check-in page<Icon name="link" size={13} /></a>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Link className="btn btn-sm" href={`/vehicles/${encodeURIComponent(a.plate)}`}><Icon name="car" size={14} />Vehicle record</Link>
        {a.inspection_id && <Link className="btn btn-sm btn-primary" href={`/inspection/${a.inspection_id}`}><Icon name="clipboard" size={14} />Open the inspection</Link>}
        {a.report?.verify_token && <Link className="btn btn-sm" href={`/verify/${a.report.verify_token}`}><Icon name="shield" size={14} />Verify the report</Link>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Source kind="live_logic" text="Booking rules and state" />
        <Source kind="mock" text="Payment gateway" />
      </div>

      <RescheduleDialog open={moveOpen} a={a} options={options} today={today} onClose={() => setMoveOpen(false)}
        onDone={(r) => { setMoveOpen(false); onChanged(r); toast(`${a.plate} moved to ${dayShort(r.date)} ${r.slot}`, "ok"); }} />
      <CancelDialog open={cancelOpen} a={a} onClose={() => setCancelOpen(false)}
        onDone={(r) => { setCancelOpen(false); onChanged(r); toast(`Appointment cancelled${r.payment.state === "refunded" ? " · refunded (mock)" : ""}`, "ok"); }} />
    </div>
  );
}

/** The detail on a phone or tablet: a bottom sheet (phones) or a side drawer. */
export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fade-in absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-[28px] border border-white/80 bg-[#F7F9FC] p-4 shadow-float md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[460px] md:rounded-none md:rounded-l-[28px] md:p-5">
        <span className="mx-auto mb-3 block h-1.5 w-12 rounded-full bg-ink-500 md:hidden" aria-hidden />
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---- slots and dialogs
/** The hub's slots for a day: free ones to pick, the others with the reason. */
export function SlotGrid({ view, value, onPick, loading, error }: { view: SlotView | null; value: string | null; onPick: (t: string) => void; loading?: boolean; error?: string | null }) {
  if (error) return <ErrorState title="The slots could not load">{error}</ErrorState>;
  if (!view || loading) return <LoadingState label="Loading the slots…" rows={3} />;
  if (view.closed) return <p className="rounded-xl bg-ink-850 px-3 py-3 text-[13px] text-fg-3 ring-1 ring-ink-600">The hubs are closed on Sundays: pick another day.</p>;
  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-9">
        {view.slots.map((s) => {
          const sel = s.time === value;
          return (
            <button key={s.time} type="button" disabled={!s.available} onClick={() => onPick(s.time)} aria-pressed={sel}
              title={s.available ? `${s.free} of ${s.capacity} free${s.gear ? " · gear slot" : ""}` : s.reason_text || ""}
              className={`flex flex-col items-center rounded-xl px-1 py-1.5 text-[13px] font-semibold transition ${sel ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow" : s.available ? (s.gear ? "bg-amber-50 text-[#92400E] ring-1 ring-amber-200 hover:bg-amber-100" : "bg-white text-fg ring-1 ring-ink-500 hover:ring-cyan") : "cursor-not-allowed bg-ink-850 text-fg-4 line-through decoration-1 ring-1 ring-ink-600"}`}>
              <span className="flex items-center gap-0.5">{s.gear && <Icon name="wrench" size={11} />}{s.time}</span>
              <span className={`text-[10.5px] font-medium no-underline ${sel ? "text-white/85" : "text-fg-4"}`}>{s.available ? `${s.free} free` : SHORT[s.reason || ""] || "–"}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-fg-3">
        <span>{view.available} slot{view.available === 1 ? "" : "s"} open at {view.branch.name}</span>
        <span className="inline-flex items-center gap-1 text-[#B45309]"><Icon name="wrench" size={12} />Gear slots ({view.gear_times.join(", ")}): heavy vehicles</span>
      </div>
    </div>
  );
}

function useSlots(branch: string | null, date: string | null, plate: string | null, exclude?: string) {
  const [view, setView] = useState<SlotView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!branch || !date) return;
    let alive = true;
    setLoading(true);
    api.get("/api/appointments/slots", { branch_id: branch, date, plate: plate || undefined, exclude })
      .then((v) => alive && (setView(v), setError(null)))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [branch, date, plate, exclude, tick]);
  return { view, error, loading, reload: () => setTick((t) => t + 1) };
}

/** Fourteen working days to pick from, plus any other date. */
function DayPicker({ today, value, onChange }: { today: string; value: string; onChange: (d: string) => void }) {
  const days = useMemo(() => Array.from({ length: 16 }, (_, i) => addDays(today, i)).filter((d) => !isSunday(d)).slice(0, 12), [today]);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {days.map((d) => (
          <button key={d} type="button" onClick={() => onChange(d)} aria-pressed={d === value}
            className={`flex flex-col items-center rounded-xl py-1.5 text-[12px] font-semibold transition ${d === value ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow" : "bg-white ring-1 ring-ink-500 hover:ring-cyan"}`}>
            <span className={d === value ? "text-white/85" : "text-fg-3"}>{d === today ? "Today" : fmt(d, { weekday: "short" })}</span>
            <span className="text-[15px] font-bold leading-tight">{fmt(d, { day: "numeric", month: "short" })}</span>
          </button>
        ))}
      </div>
      <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-3">Another date
        <input type="date" className="input py-1.5" min={today} value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
      </label>
    </div>
  );
}

function Field({ label, error, children, hint }: { label: string; error?: string | null; children: ReactNode; hint?: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 flex flex-wrap items-baseline gap-x-2"><span className="text-[13.5px] font-bold">{label}</span>{hint && <span className="text-[12px] text-fg-3">{hint}</span>}</legend>
      {children}
      {error && <p role="alert" className="mt-1.5 flex items-center gap-1 text-[12.5px] font-medium text-bad"><Icon name="warn" size={13} />{error}</p>}
    </fieldset>
  );
}

/** Book one of the ten vehicles: type, hub, day and a free slot, a note and how it is paid. */
export function NewAppointment({ open, onClose, options, today, initialDate, initialPlate, onCreated }: {
  open: boolean; onClose: () => void; options: Options | null; today: string; initialDate?: string | null; initialPlate?: string | null; onCreated: (a: Appt) => void;
}) {
  const [plate, setPlate] = useState<string | null>(null);
  const [itype, setItype] = useState<string | null>(null);
  const [branch, setBranch] = useState<string>("BR00");
  const [date, setDate] = useState<string>(today);
  const [slot, setSlot] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [paid, setPaid] = useState(false);
  const [method, setMethod] = useState("CARD");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const d = initialDate && initialDate >= today && !isSunday(initialDate) ? initialDate : isSunday(today) ? addDays(today, 1) : today;
    setPlate(initialPlate || null); setItype(null); setBranch(options?.default_branch || "BR00"); setDate(d); setSlot(null);
    setNote(""); setPaid(false); setMethod("CARD"); setErrs({});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const veh = options?.vehicles.find((v) => v.plate === plate) || null;
  useEffect(() => { if (veh) setItype((t) => t || veh.suggested_type); }, [veh]);
  const hub = options?.branches.find((b) => b.branch_id === branch);
  useEffect(() => {  // a heavy vehicle needs a hub with a heavy-vehicle lane
    if (veh?.heavy && hub && !hub.heavy_capable) setBranch(options?.branches.find((b) => b.heavy_capable)?.branch_id || branch);
  }, [veh, hub]); // eslint-disable-line react-hooks/exhaustive-deps
  const slots = useSlots(open ? branch : null, open ? date : null, plate);
  useEffect(() => setSlot(null), [branch, date, plate]);
  const type = options?.types.find((t) => t.code === itype);
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!plate) e.plate = "Pick the vehicle.";
    if (!itype) e.itype = "Pick the inspection.";
    if (!slot) e.slot = "Pick a free slot.";
    if (note.length > 500) e.note = "Keep the note under 500 characters.";
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await api.post("/api/appointments", { plate, branch_id: branch, date, slot, inspection_type: itype, note: note || null, paid, method: paid ? method : null });
      toast(`${r.plate} booked for ${dayShort(r.date)} at ${r.slot}`, "ok");
      onCreated(r);
    } catch (err: any) {
      const m = err.message || "Could not book";
      setErrs({ form: m, ...(/slot|full|time|Sunday|day has passed|gear|heavy/i.test(m) ? { slot: m } : {}) });
      slots.reload();
    } finally {
      setBusy(false);
    }
  };
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="New appointment">
      <div className="flex w-[min(860px,calc(100vw-5rem))] flex-col gap-5">
        {!options ? <LoadingState label="Loading the vehicles and hubs…" rows={4} /> : (
          <>
            <Field label="Vehicle" error={errs.plate} hint="the ten vehicles of the hub's work">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {options.vehicles.map((v) => (
                  <button key={v.plate} type="button" onClick={() => { setPlate(v.plate); setItype(v.suggested_type); }} aria-pressed={plate === v.plate}
                    className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-white/80 text-left transition hover:-translate-y-0.5 ${plate === v.plate ? "border-cyan ring-2 ring-blue-200" : "border-white/80 shadow-glass"}`}>
                    <ApptPhoto plate={v.plate} vtype={v.vtype} className="aspect-[4/3] w-full" />
                    <span className="min-w-0 px-2.5 py-2 leading-tight">
                      <b className="flex items-center gap-1 text-[14px]">{v.plate}{plate === v.plate && <Icon name="checkc" size={14} color="#2563EB" />}</b>
                      <span className="block truncate text-[12px] text-fg-3">{v.make} {v.model}</span>
                      {v.heavy && <span className="mt-1 inline-block rounded-full bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-bold text-[#B45309] ring-1 ring-amber-200">Heavy · gear slots</span>}
                    </span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Inspection" error={errs.itype}>
              <div className="flex flex-wrap gap-2">
                {options.types.map((t) => (
                  <button key={t.code} type="button" onClick={() => setItype(t.code)} aria-pressed={itype === t.code}
                    className={`rounded-xl px-3 py-2 text-left text-[12.5px] transition ${itype === t.code ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow" : "bg-white ring-1 ring-ink-500 hover:ring-cyan"}`}>
                    <b className="block text-[13px]">{t.label.replace(" (sale with a bank loan)", "")}</b>
                    <span className={itype === t.code ? "text-white/85" : "text-fg-3"}>{rm(t.price)} · {t.minutes} min{veh?.suggested_type === t.code ? " · suggested" : ""}</span>
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
              <Field label="Hub">
                <select className="input w-full" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Hub">
                  {options.branches.map((b) => (
                    <option key={b.branch_id} value={b.branch_id} disabled={!!veh?.heavy && !b.heavy_capable}>
                      {b.name}{veh?.heavy && !b.heavy_capable ? " (no heavy lane)" : ""}
                    </option>
                  ))}
                </select>
                {hub && <p className="mt-1.5 text-[12px] text-fg-3">{hub.state} · {hub.lanes} lanes{hub.heavy_capable ? " · heavy-vehicle lane" : ""}</p>}
              </Field>
              <Field label="Day"><DayPicker today={today} value={date} onChange={setDate} /></Field>
            </div>
            <Field label="Slot" error={errs.slot} hint={veh?.heavy ? "a heavy vehicle takes a gear slot" : "20-minute slots, 08:00–16:40"}>
              {slots.view?.vehicle_same_day && (
                <p className="mb-2 flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-[#92400E] ring-1 ring-amber-200">
                  <Icon name="warn" size={14} />{plate} already has an appointment that day ({slots.view.vehicle_same_day.slot} at {slots.view.vehicle_same_day.branch_name}).
                </p>
              )}
              <SlotGrid view={slots.view} value={slot} onPick={setSlot} loading={slots.loading && !slots.view} error={slots.error} />
            </Field>
            <Field label="Note" error={errs.note} hint="optional · for the examiner and the counter">
              <textarea className="input min-h-[72px] w-full" maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Customer reports a brake noise" aria-label="Note" />
              <div className={`mt-1 text-right text-[11.5px] ${note.length > 500 ? "text-bad" : "text-fg-4"}`}>{note.length}/500</div>
            </Field>
            <Field label="Payment">
              <div className="flex flex-wrap items-center gap-2">
                <Seg label="Payment" value={paid ? "paid" : "counter"} onChange={(v) => setPaid(v === "paid")} items={[["counter", "Pay at counter"], ["paid", "Paid now"]] as const} />
                {paid && options.methods.map((m) => (
                  <button key={m.code} type="button" onClick={() => setMethod(m.code)} aria-pressed={method === m.code}
                    className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 transition ${method === m.code ? "bg-blue-50 text-[#1D4ED8] ring-blue-200" : "bg-white text-fg-2 ring-ink-500"}`}>{m.label}</button>
                ))}
              </div>
            </Field>
            <div className="sticky -bottom-4 z-[2] -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-600 bg-white/95 px-4 pb-4 pt-3 backdrop-blur">
              <span className="min-w-0 text-[13px] text-fg-2">
                {plate ? <b>{plate}</b> : "No vehicle yet"}{slot ? ` · ${dayShort(date)} ${slot}` : ""}{type ? ` · ${rm(type.price)}` : ""}
                {errs.form && <span role="alert" className="mt-0.5 flex items-start gap-1 font-medium text-bad"><Icon name="warn" size={13} />Not booked: {errs.form}</span>}
              </span>
              <span className="flex gap-2">
                <button className="btn" onClick={onClose}>Close</button>
                <button className="btn btn-primary" disabled={busy} onClick={submit}><Icon name="plus" size={15} />{busy ? "Booking…" : "Book appointment"}</button>
              </span>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function RescheduleDialog({ open, a, options, today, onClose, onDone }: { open: boolean; a: Appt; options: Options | null; today: string; onClose: () => void; onDone: (a: Appt) => void }) {
  const [date, setDate] = useState(a.date);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setDate(a.date >= today ? a.date : isSunday(today) ? addDays(today, 1) : today); setSlot(null); setErr(null); } }, [open, a.booking_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const slots = useSlots(open ? a.branch_id : null, open ? date : null, a.plate, a.booking_id);
  useEffect(() => setSlot(null), [date]);
  const view = slots.view && { ...slots.view, slots: slots.view.slots.map((s) => (s.time === a.slot && date === a.date ? { ...s, available: false, reason: "current", reason_text: "The appointment's current time" } : s)) };
  const go = async () => {
    if (!slot) return setErr("Pick a free slot.");
    setBusy(true);
    try {
      onDone(await api.post(`/api/appointments/${a.booking_id}/reschedule`, { date, slot }));
    } catch (e: any) {
      setErr(e.message);
      slots.reload();
    } finally {
      setBusy(false);
    }
  };
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Reschedule ${a.plate}`}>
      <div className="flex w-[min(760px,calc(100vw-5rem))] flex-col gap-4">
        <p className="text-[13.5px] text-fg-2">Now <b>{dayShort(a.date)} {a.slot}</b> at {a.branch_name}. Same inspection and price; the check-in code stays.</p>
        <Field label="Day"><DayPicker today={today} value={date} onChange={setDate} /></Field>
        <Field label="Slot" error={err}>
          {slots.view?.vehicle_same_day && <p className="mb-2 text-[12.5px] text-[#92400E]">{a.plate} already has another appointment that day ({slots.view.vehicle_same_day.slot}).</p>}
          <SlotGrid view={view} value={slot} onPick={(t) => { setSlot(t); setErr(null); }} loading={slots.loading && !slots.view} error={slots.error} />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn" onClick={onClose}>Keep the time</button>
          <button className="btn btn-primary" disabled={busy || !slot} onClick={go}><Icon name="calendar" size={15} />{busy ? "Moving…" : slot ? `Move to ${dayShort(date)} ${slot}` : "Move"}</button>
        </div>
        {options == null && null}
      </div>
    </Modal>
  );
}

function CancelDialog({ open, a, onClose, onDone }: { open: boolean; a: Appt; onClose: () => void; onDone: (a: Appt) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setReason(""); setErr(null); } }, [open]);
  const go = async () => {
    if (reason.trim().length < 3) return setErr("Give the reason for the cancellation.");
    setBusy(true);
    try {
      onDone(await api.post(`/api/appointments/${a.booking_id}/cancel`, { reason: reason.trim() }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Cancel ${a.plate} · ${dayShort(a.date)} ${a.slot}`}>
      <div className="flex w-[min(560px,calc(100vw-5rem))] flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {CANCEL_REASONS.map((r) => <button key={r} type="button" className={`chip ${reason === r ? "border-cyan bg-blue-50 text-[#1D4ED8]" : "border-ink-500 bg-white text-fg-2"}`} onClick={() => { setReason(r); setErr(null); }}>{r}</button>)}
        </div>
        <Field label="Reason" error={err}>
          <textarea className="input min-h-[84px] w-full" maxLength={300} value={reason} onChange={(e) => { setReason(e.target.value); setErr(null); }} placeholder="Why is it cancelled?" aria-label="Reason for the cancellation" />
        </Field>
        {a.payment.state === "paid" && <p className="text-[12.5px] text-fg-3">The {rm(a.price_rm)} paid ({a.payment.ref}) is refunded through the mock gateway.</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn" onClick={onClose}>Keep it</button>
          <button className="btn btn-danger" disabled={busy} onClick={go}><Icon name="xc" size={15} />{busy ? "Cancelling…" : "Cancel the appointment"}</button>
        </div>
      </div>
    </Modal>
  );
}
