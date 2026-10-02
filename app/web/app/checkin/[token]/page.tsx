"use client";
/* Public check-in page (mobile app screen, no login): opened by the lane's QR scanner, or by the owner, from the
   booking's QR code. It follows the booking live: paid, checked in at the lane, or cancelled. */
import { Suspense, use, useEffect } from "react";
import { StatusPill, Tone } from "@/components/glass";
import { Icon } from "@/components/icons";
import { MobileShell } from "@/components/MobileShell";
import { BTN2, MCard, MSkeleton, MTitle, OwnerSource, Plate, dayLabel } from "@/components/mobileKit";
import { BOOKING_STATUS } from "@/components/mobileData";
import { useFetch } from "@/lib/live";

// the status card: white on the deeper colours, dark ink on amber (white on amber cannot be read)
const LIGHT = { ink: "text-white", sub: "text-white/90", iconCol: "#fff", tile: "bg-white/20 ring-white/40" };
const STATE: Record<string, { head: string; text: string; tone: Tone; icon: string; bg: string; ink: string; sub: string; iconCol: string; tile: string }> = {
  checked_in: { head: "Checked in at the lane", text: "The plate camera matched the booking. Follow the lane signs.", tone: "green", icon: "check", bg: "from-emerald-600 to-emerald-700", ...LIGHT },
  confirmed: { head: "Ready for check-in", text: "Paid · ready for check-in (the plate camera confirms your plate at the lane)", tone: "blue", icon: "qr", bg: "from-[#2563EB] to-[#1D4ED8]", ...LIGHT },
  pending_payment: { head: "Payment pending", text: "Finish the payment in the app before you come to the lane.", tone: "amber", icon: "clock", bg: "from-amber-300 to-amber-400",
    ink: "text-amber-950", sub: "text-amber-900", iconCol: "#78350F", tile: "bg-white/50 ring-amber-900/15" },
  cancelled: { head: "Booking cancelled", text: "This booking was cancelled and its code no longer checks in.", tone: "gray", icon: "close", bg: "from-slate-500 to-slate-600", ...LIGHT },
};

function CheckIn({ token }: { token: string }) {
  const { data: b, error, reload } = useFetch<any>(`/api/owner/checkin/${token}`);
  useEffect(() => {
    const t = setInterval(reload, 6000);  // the status changes when the lane checks the car in
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const st = b ? STATE[b.status] || STATE.confirmed : null;
  return (
    <MobileShell public title="QR check-in">
      {error && !b ? (
        <MCard className="mt-2 text-center" label="Check-in">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-200"><Icon name="warn" size={26} color="#DC2626" /></span>
          <h2 className="mt-3 text-[18px] font-bold text-rose-700">Unknown check-in code</h2>
          <p className="mt-1 text-[13px] text-slate-500">Scan the whole QR code on the booking ticket again, or open the ticket in the app.</p>
          <a className={`${BTN2} mt-4 w-full`} href="/mobile/book?view=bookings">Open VehicleSense<Icon name="arrow" size={15} /></a>
        </MCard>
      ) : !b ? <MSkeleton rows={3} h={110} label="Looking up the booking…" /> : (
        <div className="flex flex-col gap-3">
          <section className={`m-pop rounded-[26px] bg-gradient-to-br ${st!.bg} ${st!.ink} p-5 shadow-lg`} role="status">
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ${st!.tile}`}><Icon name={st!.icon} size={26} color={st!.iconCol} width={2.2} /></span>
            <div className="mt-3 text-[22px] font-extrabold leading-tight">{st!.head}</div>
            <div className={`mt-1 text-[13.5px] ${st!.sub}`}>{st!.text}</div>
          </section>
          <MCard label="Booking">
            <div className="flex items-center justify-between gap-2"><Plate plate={b.plate} size="lg" /><StatusPill tone={st!.tone} dot>{BOOKING_STATUS[b.status]?.label || b.status}</StatusPill></div>
            <div className="mt-3 text-[16px] font-bold">{b.type_label}{b.gear ? " · Express slot" : ""}</div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
              <dt className="text-slate-500">Date</dt><dd className="text-right font-semibold">{dayLabel(b.date, true)}</dd>
              <dt className="text-slate-500">Time</dt><dd className="text-right font-semibold">{b.slot}</dd>
              <dt className="text-slate-500">Hub</dt><dd className="text-right font-semibold">{b.branch_name || b.branch_id}</dd>
              <dt className="text-slate-500">Check-in code</dt><dd className="text-right font-mono font-bold tracking-wider">{b.checkin_token.slice(0, 8).toUpperCase()}</dd>
            </dl>
            <div className="mt-3 border-t border-slate-100 pt-2 text-[12px] text-slate-500">Booking {b.booking_id} · {b.payment_ref ? `payment ${b.payment_ref}` : "not paid yet"}</div>
          </MCard>
          {(b.status === "confirmed" || b.status === "pending_payment") && (
            <>
              <MTitle>At the lane</MTitle>
              <MCard pad={false} className="divide-y divide-slate-100">
                {[["car", "Drive up to the lane entry", "Stop at the line, engine running"], ["cam", "The plate camera reads the plate", "It finds this booking by the plate"], ["qr", "Show this page if asked", "The examiner scans the QR code"]].map(([ic, t, s], i) => (
                  <div key={t} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[13px] font-bold text-[#1D4ED8]">{i + 1}</span>
                    <span className="min-w-0 flex-1 leading-snug"><b className="block text-[14px]">{t}</b><span className="text-[12.5px] text-slate-500">{s}</span></span>
                    <Icon name={ic} size={19} color="#94A3B8" />
                  </div>
                ))}
              </MCard>
            </>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5"><OwnerSource kind="mock" text="Payment" /><OwnerSource kind="live_logic" text="Booking status, live" /></div>
          <p className="text-center text-[11.5px] text-slate-400">VehicleSense concept demo · fictional vehicle and owner.</p>
        </div>
      )}
    </MobileShell>
  );
}

/** Opened by the lane's QR scanner (or the owner) from the booking QR code. */
export default function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <Suspense><CheckIn token={token} /></Suspense>;
}
