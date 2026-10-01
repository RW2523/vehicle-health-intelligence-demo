"use client";
/* Public report verification (mobile app screen, no login): opened from the QR code on a report. It re-checks the
   hash-chained evidence log behind the report and shows the result a buyer needs. */
import { Suspense, use, useEffect } from "react";
import { visitStep } from "@/components/Demo";
import { Icon } from "@/components/icons";
import { MobileShell } from "@/components/MobileShell";
import { BTN2, MCard, MSkeleton, Plate, Verdict } from "@/components/mobileKit";
import { Source } from "@/components/ui";
import { dmy, fmtN, pct } from "@/lib/format";
import { useFetch } from "@/lib/live";

function Metric({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className="text-[21px] font-extrabold tracking-tight">{value}</div>
      {note && <div className="text-[11px] text-slate-400">{note}</div>}
    </div>
  );
}

function Verify({ token }: { token: string }) {
  const { data: v, error } = useFetch<any>(`/api/verify/${token}`);
  // a presenter running the buyer use case: this is its last step (a buyer's phone has no session: nothing happens)
  useEffect(() => {
    if (v) visitStep(`/verify/${token}`);
  }, [v, token]);
  return (
    <MobileShell public title="Report verification">
      {error && (
        <MCard className="mt-2 text-center" label="Verification">
          <div role="alert">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-200"><Icon name="warn" size={26} color="#DC2626" /></span>
            <h2 className="mt-3 text-[18px] font-bold text-rose-700">No report matches this code</h2>
            <p className="mt-1 text-[13px] text-slate-500">Check that the whole QR code was scanned. A code that was edited or copied wrongly does not verify.</p>
            <a className={`${BTN2} mt-4 w-full`} href="/mobile">Open VehicleSense<Icon name="arrow" size={15} /></a>
          </div>
        </MCard>
      )}
      {!v && !error && (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <MCard className="flex items-center gap-3">
            <span className="m-spin h-8 w-8 shrink-0 rounded-full border-[3px] border-blue-100 border-t-[#2563EB]" aria-hidden />
            <span className="text-[14px] text-slate-600">Checking the report and its evidence chain…</span>
          </MCard>
          <MSkeleton rows={2} h={120} />
        </div>
      )}
      {v && (
        <div className="flex flex-col gap-3">
          <section role="status" className={`m-pop rounded-[26px] bg-gradient-to-br p-5 text-white shadow-lg ${v.valid ? "from-emerald-600 to-emerald-700" : "from-rose-600 to-rose-700"}`}>
            <div className="flex items-center gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/40" aria-hidden>
                <Icon name={v.valid ? "shield" : "warn"} size={30} color="#fff" width={2} />
              </span>
              <div className="min-w-0">
                <div className="text-[19px] font-extrabold leading-tight">{v.valid ? "Genuine, unaltered report" : "Could not verify this report"}</div>
                <div className="mt-0.5 text-[12.5px] text-white/90">
                  {v.valid ? `${fmtN(v.chain.entries_checked)} evidence records re-checked just now` : "The evidence record behind this report does not match: it may have been altered."}
                </div>
              </div>
            </div>
            <div className="mt-3 truncate rounded-xl bg-black/15 px-3 py-1.5 font-mono text-[11.5px] text-white/90">anchor {v.chain.report_anchor.slice(0, 12)}…</div>
          </section>
          <MCard label="Report">
            <div className="flex flex-wrap items-center gap-2"><span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{v.kind}</span>{v.synthetic && <Source kind="synthetic" text="Seeded demo record" />}</div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Plate plate={v.plate} size="lg" />
              <Verdict v={v.verdict} className="!px-3 !py-1.5 !text-[14px]" />
            </div>
            <div className="mt-2 text-[14px] font-semibold">{[v.vehicle?.make, v.vehicle?.model, v.vehicle?.year].filter(Boolean).join(" ")}</div>
            <div className="text-[12.5px] text-slate-500">{v.branch} · {dmy(v.issued_at)}{v.examiner?.name ? ` · examiner ${v.examiner.name}${v.examiner.senior ? " (senior)" : ""}` : ""}</div>
            <p className="mt-3 text-[14px] leading-relaxed text-slate-700">{v.summary}</p>
          </MCard>
          <div className="grid grid-cols-2 gap-2">
            {v.odometer_km != null && <Metric label="Odometer at inspection" value={`${fmtN(v.odometer_km)} km`} />}
            {v.health_score != null && <Metric label="Health score" value={v.health_score} />}
            {v.flood_probability != null && <Metric label="Flood likelihood" value={pct(v.flood_probability)} />}
            {v.ev && <Metric label="Battery health" value={`${v.ev.pack_soh_pct}%`} />}
            {v.ev && <Metric label="Km to 70%" value={fmtN(v.ev.km_to_70)} />}
          </div>
          <MCard label="Findings">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Confirmed by the examiner</div>
            {v.findings?.length > 0
              ? <ul className="flex flex-col gap-1.5">{v.findings.map((f: any, i: number) => <li key={i} className="flex items-start gap-2 text-[13.5px] leading-snug"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />{f.title}</li>)}</ul>
              : <p className="text-[13.5px] text-slate-500">No findings were confirmed.</p>}
          </MCard>
          <p className="px-2 text-center text-[11.5px] leading-relaxed text-slate-400">VehicleSense AI concept demo · fictional vehicle · the evidence log is SHA-256 hash-chained, so any later change to the record is detected.</p>
        </div>
      )}
    </MobileShell>
  );
}

/** Public page opened from the QR code on a report (phone layout, no login). */
export default function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <Suspense><Verify token={token} /></Suspense>;
}
