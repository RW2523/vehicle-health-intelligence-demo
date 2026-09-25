"use client";
import { use } from "react";
import { Logo } from "@/components/Shell";
import { dmy } from "@/lib/format";
import { useFetch } from "@/lib/live";

/** Opened by the lane's QR scanner (or the owner) from the booking QR code. */
export default function CheckIn({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data: b, error } = useFetch<any>(`/api/owner/checkin/${token}`);
  return (
    <div className="mx-auto flex min-h-screen max-w-[440px] flex-col gap-4 px-4 py-6">
      <div className="flex items-center gap-2"><Logo /><span className="font-display text-[17px] font-bold">VehicleSense <span className="text-cyan">AI</span></span><span className="ml-auto text-[12px] text-fg-3">QR check-in</span></div>
      {error && <div className="card card-pad text-bad">Unknown check-in code.</div>}
      {b && (
        <div className="card card-pad flex flex-col gap-2">
          <div className="font-display text-[26px] font-bold">{b.plate}</div>
          <div className="text-[14px]">{b.type_label}{b.gear ? " · GEAR" : ""}</div>
          <div className="text-[13px] text-fg-3">{dmy(b.date)} · {b.slot} · branch {b.branch_id}</div>
          <div className={`mt-2 rounded-xl px-3 py-2 text-[14px] font-semibold ${b.status === "checked_in" ? "bg-ok/15 text-ok" : b.status === "confirmed" ? "bg-cyan/15 text-cyan" : "bg-warn/15 text-warn"}`}>
            {b.status === "checked_in" ? "Checked in at the lane" : b.status === "confirmed" ? "Paid · ready for check-in (ANPR confirms the plate at the lane)" : "Payment pending"}
          </div>
          <div className="text-[12px] text-fg-4">Booking {b.booking_id} · payment {b.payment_ref || "–"}</div>
        </div>
      )}
    </div>
  );
}
