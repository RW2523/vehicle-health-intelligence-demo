"use client";
import { use } from "react";
import { Logo } from "@/components/Shell";
import { dmy, fmtN, pct } from "@/lib/format";
import { useFetch } from "@/lib/live";

const VCOL: Record<string, string> = { PASS: "#34D399", FAIL: "#F87171", CONDITIONAL: "#FBBF24", REFERRED: "#60A5FA" };

/** Public page opened from the QR code on a report (phone layout). */
export default function Verify({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data: v, error } = useFetch<any>(`/api/verify/${token}`);
  return (
    <div className="mx-auto flex min-h-screen max-w-[440px] flex-col gap-4 px-4 py-6">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="font-display text-[17px] font-bold">VehicleSense <span className="text-cyan">AI</span></span>
        <span className="ml-auto text-[12px] text-fg-3">Report verification</span>
      </div>
      {error && <div className="card card-pad text-bad">This code does not match any report.</div>}
      {v && (
        <>
          <div className="card card-pad" style={{ borderColor: v.valid ? "#34D39988" : "#F8717188" }}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full text-[20px] font-bold text-ink-900" style={{ background: v.valid ? "#34D399" : "#F87171" }}>{v.valid ? "✓" : "!"}</span>
              <div>
                <div className="font-display text-[18px] font-semibold">{v.valid ? "Genuine, unaltered report" : "Could not verify this report"}</div>
                <div className="text-[12.5px] text-fg-3">{v.chain.entries_checked} evidence records re-checked · anchor {v.chain.report_anchor.slice(0, 12)}…</div>
              </div>
            </div>
          </div>
          <div className="card card-pad">
            <div className="label">{v.kind}</div>
            <div className="mt-1 flex items-center justify-between">
              <span className="font-display text-[24px] font-bold">{v.plate}</span>
              <span className="rounded-xl border-2 px-3 py-1 font-display text-[18px] font-bold" style={{ borderColor: VCOL[v.verdict], color: VCOL[v.verdict] }}>{v.verdict}</span>
            </div>
            <div className="text-[12.5px] text-fg-3">{v.branch} · {dmy(v.issued_at)}</div>
            <p className="mt-3 text-[14px] leading-relaxed">{v.summary}</p>
          </div>
          <div className="card card-pad grid grid-cols-2 gap-3 text-[13px]">
            <div><div className="text-fg-3">Health score</div><div className="font-display text-[22px]">{v.health_score ?? "–"}</div></div>
            {v.flood_probability != null && <div><div className="text-fg-3">Flood likelihood</div><div className="font-display text-[22px]">{pct(v.flood_probability)}</div></div>}
            {v.ev && <div><div className="text-fg-3">Battery health</div><div className="font-display text-[22px]">{v.ev.pack_soh_pct}%</div></div>}
            {v.ev && <div><div className="text-fg-3">Km to 70%</div><div className="font-display text-[22px]">{fmtN(v.ev.km_to_70)}</div></div>}
          </div>
          {v.findings?.length > 0 && (
            <div className="card card-pad">
              <div className="label mb-2">Confirmed by the examiner</div>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-[13.5px]">{v.findings.map((f: any, i: number) => <li key={i}>{f.title}</li>)}</ul>
            </div>
          )}
          <p className="text-center text-[11.5px] text-fg-4">Concept demo · fictional vehicle · the evidence log is SHA-256 hash-chained, so any later change to the record is detected.</p>
        </>
      )}
    </div>
  );
}
