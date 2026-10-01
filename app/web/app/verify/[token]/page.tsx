"use client";
import { use, useEffect } from "react";
import { visitStep } from "@/components/Demo";
import { Logo } from "@/components/Shell";
import { LoadingState, Source } from "@/components/ui";
import { dmy, fmtN, pct } from "@/lib/format";
import { useFetch } from "@/lib/live";
import { VERDICT } from "@/lib/present";

/** Public page opened from the QR code on a report (phone layout, no login). */
export default function Verify({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data: v, error } = useFetch<any>(`/api/verify/${token}`);
  // a presenter running the buyer use case: this is its last step (a buyer's phone has no session: nothing happens)
  useEffect(() => {
    if (v) visitStep(`/verify/${token}`);
  }, [v, token]);
  return (
    <div className="mx-auto flex min-h-screen max-w-[440px] flex-col gap-4 px-4 py-6">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="font-display text-[17px] font-bold">VehicleSense <span className="text-cyan">AI</span></span>
        <span className="ml-auto text-[12px] text-fg-3">Report verification</span>
      </div>
      {error && (
        <div className="card card-pad" role="alert">
          <div className="font-display text-[18px] font-semibold text-bad">No report matches this code</div>
          <p className="mt-1 text-[13px] text-fg-3">Check that the whole QR code was scanned. A code that was edited or copied wrongly does not verify.</p>
        </div>
      )}
      {!v && !error && <div className="card card-pad"><LoadingState label="Checking the report and its evidence chain…" rows={3} /></div>}
      {v && (
        <>
          <div className="card card-pad" style={{ borderColor: v.valid ? "#34D39988" : "#F8717188" }} role="status">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[20px] font-bold text-ink-900" style={{ background: v.valid ? "#34D399" : "#F87171" }} aria-hidden>{v.valid ? "✓" : "!"}</span>
              <div>
                <div className="font-display text-[18px] font-semibold">{v.valid ? "Genuine, unaltered report" : "Could not verify this report"}</div>
                <div className="text-[12.5px] text-fg-3">
                  {v.valid ? `${fmtN(v.chain.entries_checked)} evidence records re-checked just now` : "The evidence record behind this report does not match: it may have been altered."} · anchor {v.chain.report_anchor.slice(0, 12)}…
                </div>
              </div>
            </div>
          </div>
          <div className="card card-pad">
            <div className="flex flex-wrap items-center gap-2"><span className="label">{v.kind}</span>{v.synthetic && <Source kind="synthetic" text="Seeded demo record" />}</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="font-display text-[24px] font-bold">{v.plate}</span>
              <span className="rounded-xl border-2 px-3 py-1 font-display text-[18px] font-bold" style={{ borderColor: VERDICT[v.verdict]?.color, color: VERDICT[v.verdict]?.color }}>{v.verdict}</span>
            </div>
            <div className="text-[12.5px] text-fg-3">{[v.vehicle?.make, v.vehicle?.model, v.vehicle?.year].filter(Boolean).join(" ")}</div>
            <div className="text-[12.5px] text-fg-3">{v.branch} · {dmy(v.issued_at)}{v.examiner?.name ? ` · examiner ${v.examiner.name}${v.examiner.senior ? " (senior)" : ""}` : ""}</div>
            <p className="mt-3 text-[14px] leading-relaxed">{v.summary}</p>
          </div>
          <div className="card card-pad grid grid-cols-2 gap-3 text-[13px]">
            {v.odometer_km != null && <div><div className="text-fg-3">Odometer at inspection</div><div className="font-display text-[22px]">{fmtN(v.odometer_km)} km</div></div>}
            <div><div className="text-fg-3">Health score</div><div className="font-display text-[22px]">{v.health_score ?? "–"}</div>{v.health_score == null && <div className="text-[11px] text-fg-4">not scored for this record</div>}</div>
            {v.flood_probability != null && <div><div className="text-fg-3">Flood likelihood</div><div className="font-display text-[22px]">{pct(v.flood_probability)}</div></div>}
            {v.ev && <div><div className="text-fg-3">Battery health</div><div className="font-display text-[22px]">{v.ev.pack_soh_pct}%</div></div>}
            {v.ev && <div><div className="text-fg-3">Km to 70%</div><div className="font-display text-[22px]">{fmtN(v.ev.km_to_70)}</div></div>}
          </div>
          <div className="card card-pad">
            <div className="label mb-2">Confirmed by the examiner</div>
            {v.findings?.length > 0
              ? <ul className="flex list-disc flex-col gap-1 pl-5 text-[13.5px]">{v.findings.map((f: any, i: number) => <li key={i}>{f.title}</li>)}</ul>
              : <p className="text-[13.5px] text-fg-3">No findings were confirmed.</p>}
          </div>
          <p className="text-center text-[11.5px] text-fg-4">VehicleSense AI concept demo · fictional vehicle · the evidence log is SHA-256 hash-chained, so any later change to the record is detected.</p>
        </>
      )}
    </div>
  );
}
