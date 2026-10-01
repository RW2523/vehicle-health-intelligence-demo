"use client";
/* The owner's data in the mobile app: the passport, the vehicle profile, the bookings, and the updates feed built from
   them (reminders, bookings, reports, self-checks), plus a few sample news items. */
import { useFetch } from "@/lib/live";
import { Tone } from "./glass";
import { dayLabel, inDays } from "./mobileKit";

export type Booking = {
  booking_id: string; plate: string; branch_id: string; branch_name: string; date: string; slot: string; inspection_type: string;
  type_label: string; gear: boolean; price_rm: number; status: string; payment_ref: string | null; checkin_token: string; checkin_url: string;
};

export const usePassport = (plate: string | null, deps: any[] = []) => useFetch<any>(plate ? `/api/owner/passport/${encodeURIComponent(plate)}` : null, undefined, deps);
export const useProfile = (plate: string | null, deps: any[] = []) => useFetch<any>(plate ? `/api/vehicles/${encodeURIComponent(plate)}/profile` : null, undefined, deps);
export const useBookings = (plate: string | null, deps: any[] = []) => useFetch<Booking[]>(plate ? "/api/owner/bookings" : null, { plate: plate || undefined }, deps);

/** Bookings still to come (not checked in, not cancelled), soonest first. */
export const openBookings = (bs?: Booking[] | null) =>
  (bs || []).filter((b) => b.status === "confirmed" || b.status === "pending_payment").sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));

export const BOOKING_STATUS: Record<string, { label: string; tone: Tone }> = {
  confirmed: { label: "Confirmed", tone: "green" }, pending_payment: { label: "Payment pending", tone: "amber" },
  checked_in: { label: "Checked in", tone: "blue" }, cancelled: { label: "Cancelled", tone: "gray" },
};

/** The short check-in code printed on the ticket. */
export const checkinCode = (b: { checkin_token: string }) => b.checkin_token.slice(0, 8).toUpperCase();

/** The newest self-check in the passport's events (they are sorted by day, newest day first, oldest first within a day). */
export function latestCheck(events?: any[] | null) {
  const checks = (events || []).filter((e) => e.kind === "self_check");
  if (!checks.length) return null;
  return checks.filter((e) => e.date === checks[0].date).pop();
}

export type Update = { id: string; icon: string; tone: Tone; title: string; sub: string; href?: string; kind: "reminder" | "booking" | "report" | "check" | "news" };

/** The owner's updates, most pressing first. */
export function ownerUpdates(p: any, profile: any, bookings: Booking[] | null | undefined, href: (path: string, q?: Record<string, string>) => string): Update[] {
  const out: Update[] = [];
  if (!p) return out;
  for (const r of p.reminders || []) {
    if (r.kind !== "road_tax") continue;
    out.push({ id: "roadtax", kind: "reminder", icon: "receipt", tone: r.days < 0 ? "red" : r.days <= 30 ? "amber" : "gray",
      title: r.days < 0 ? "Road tax expired" : `Road tax expires ${inDays(r.days)}`, sub: `Renew by ${dayLabel(r.date, true)}. Renewing needs a valid insurance cover note.`,
      href: href("/mobile/vehicle", { tab: "documents" }) });
  }
  const next = openBookings(bookings)[0];
  if (next)
    out.push({ id: "bk" + next.booking_id, kind: "booking", icon: "calendar", tone: next.status === "pending_payment" ? "amber" : "blue",
      title: next.status === "pending_payment" ? "Finish paying for your booking" : "Inspection booked",
      sub: `${next.type_label} · ${dayLabel(next.date)} ${next.slot} · ${next.branch_name}`, href: href("/mobile/book", { ticket: next.booking_id }) });
  const due = p.next_due;
  if (due && !due.booked && due.days <= 45)
    out.push({ id: "due", kind: "reminder", icon: "clock", tone: due.days < 0 ? "red" : "amber",
      title: due.days < 0 ? "Inspection overdue" : `Inspection due ${inDays(due.days)}`, sub: due.basis, href: href("/mobile/book") });
  const rep = profile?.reports?.[0];
  if (rep)
    out.push({ id: "rep" + rep.report_id, kind: "report", icon: "doc", tone: rep.verdict === "FAIL" ? "red" : rep.verdict === "PASS" ? "green" : "amber",
      title: `Report issued · ${rep.verdict}`, sub: `${rep.kind} · ${dayLabel(rep.created_at, true)}`, href: `/verify/${rep.verify_token}` });
  const sc = latestCheck(p.events);
  if (sc)
    out.push({ id: "sc" + sc.date, kind: "check", icon: "camera", tone: /Ready/.test(sc.title) ? "green" : "amber",
      title: sc.title.replace(/^Self-check: /, "Self-check · "), sub: `Phone self-check on ${dayLabel(sc.date, true)}`, href: href("/mobile/check") });
  return out;
}

/** News for owners (sample content, labelled as such where shown). */
export const NEWS: Update[] = [
  { id: "n1", kind: "news", icon: "bolt", tone: "purple", title: "Express next-day slots", sub: "Four slots a day at every hub are held back for next-day bookings (RM 30 more).", href: "/mobile/book" },
  { id: "n2", kind: "news", icon: "batt", tone: "green", title: "EV Health Check", sub: "Battery state of health, high-voltage insulation and charging, with a certificate buyers can verify." },
  { id: "n3", kind: "news", icon: "flood", tone: "sky", title: "After a flood", sub: "If your car stood in flood water, have it inspected before driving far: corrosion and wet electrics show up later." },
];
