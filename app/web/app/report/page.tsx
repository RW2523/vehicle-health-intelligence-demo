"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { Card, Empty, Pill, ScoreRing, Source } from "@/components/ui";
import { dmy, fmtN, llmLabel, pct, scoreColor } from "@/lib/format";
import { useFetch } from "@/lib/live";

const VCOL: Record<string, string> = { PASS: "#34D399", FAIL: "#F87171", CONDITIONAL: "#FBBF24", REFERRED: "#60A5FA" };

function ReportView() {
  const sp = useSearchParams();
  const id = sp.get("id");
  const list = useFetch<any[]>("/api/reports", { limit: 30 });
  const rid = id || list.data?.[0]?.report_id || null;
  const rep = useFetch<any>(rid ? `/api/reports/${rid}` : null);
  const chain = useFetch<any>("/api/evidence/verify", undefined, [rid]);
  const r = rep.data;
  const d = r?.data || {};
  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[24px] font-semibold">Inspection report</h1>
        <div className="flex flex-wrap gap-2">
          {(list.data || []).slice(0, 8).map((x) => (
            <Link key={x.report_id} href={`/report?id=${x.report_id}`} className={`chip ${x.report_id === rid ? "border-cyan text-fg" : "border-ink-500 text-fg-3"}`}>
              {x.plate} · <span style={{ color: VCOL[x.verdict] }}>{x.verdict}</span>
            </Link>
          ))}
        </div>
      </div>
      {!r ? (
        <Empty>No reports yet. Decide the alerts in the examiner console and press “Issue report”.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-4">
            <Card className="relative overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="label">{r.kind}</div>
                  <h2 className="mt-1 font-display text-[26px] font-bold">{r.plate} · {d.vehicle?.make} {d.vehicle?.model} {d.vehicle?.year || ""}</h2>
                  <p className="text-[13px] text-fg-3">{d.branch} · {d.lane} · issued {dmy(d.issued_at)} by {d.examiner?.name} ({d.examiner?.id}{d.examiner?.senior ? ", senior" : ""})</p>
                </div>
                <div className="rounded-2xl border-2 px-5 py-3 text-center" style={{ borderColor: VCOL[r.verdict], color: VCOL[r.verdict] }}>
                  <div className="font-display text-[26px] font-bold">{r.verdict}</div>
                  <div className="text-[11px]">{r.verdict === "CONDITIONAL" ? "EV Health Certificate" : "Result"}</div>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-ink-600 bg-ink-850 p-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="label">In plain words</span>
                  <Source kind={llmLabel(r.summary_source) ? "llm" : "template"} text={llmLabel(r.summary_source) ? `Local LLM (${llmLabel(r.summary_source)})` : "Template engine"} />
                </div>
                <p className="text-[14.5px] leading-relaxed">{r.summary}</p>
              </div>
            </Card>
            <Card title="Findings and examiner decisions">
              <table className="w-full text-left text-[13px]">
                <thead className="text-[12px] text-fg-3"><tr><th className="pb-2">Finding</th><th>System</th><th>Source</th><th>AI conf.</th><th>Decision</th></tr></thead>
                <tbody>
                  {d.findings?.map((f: any, i: number) => (
                    <tr key={i} className="border-t border-ink-600 align-top">
                      <td className="py-2 pr-3"><div className="font-semibold">{f.title}{f.fail_item && <span className="ml-2 text-[11px] text-bad">FAIL ITEM</span>}</div></td>
                      <td className="pr-3 text-fg-3">{f.system}</td>
                      <td className="pr-3"><Source kind={f.source} /></td>
                      <td className="pr-3">{Math.round(f.confidence * 100)}%</td>
                      <td style={{ color: f.status === "confirmed" ? "#34D399" : "#9AA8BF" }}>{f.status}{f.reason ? ` · “${f.reason}”` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            {d.ev && (
              <Card title="EV battery" right={<Source kind="live_model" text="SOH + NASA fade model" />}>
                <div className="grid grid-cols-2 gap-3 text-[13px] md:grid-cols-4">
                  <div><div className="text-fg-3">State of health</div><div className="font-display text-[22px]">{d.ev.pack_soh_pct}%</div></div>
                  <div><div className="text-fg-3">Expected for age</div><div className="font-display text-[22px]">{d.ev.expected_for_age_pct}%</div></div>
                  <div><div className="text-fg-3">{d.ev.km_to_70 ? "Distance to 70%" : "Distance to 60%"}</div><div className="font-display text-[22px]">{fmtN(d.ev.km_to_70 || d.ev.km_to_60)} km</div></div>
                  <div><div className="text-fg-3">HV isolation</div><div className="font-display text-[22px]">{d.measurements?.hv_isolation_mohm ?? "–"} MΩ</div></div>
                </div>
              </Card>
            )}
          </div>
          <div className="flex flex-col gap-4">
            <Card title="Verify this report" right={<Source kind="live_logic" text="Hash chain" />}>
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/reports/${r.report_id}/qr.svg`} alt="QR code to verify this report" className="h-48 w-48 rounded-xl bg-white p-2" />
                <Link href={`/verify/${r.verify_token}`} className="btn btn-primary w-full">What the buyer sees →</Link>
                <p className="break-all text-center font-mono text-[11px] text-fg-3">{r.verify_url}</p>
              </div>
            </Card>
            <Card title="Health">
              <div className="flex items-center gap-4">
                <ScoreRing value={d.health?.score} />
                <div className="flex flex-1 flex-col gap-1 text-[12.5px]">
                  {Object.entries(d.health?.subscores || {}).map(([k, v]: any) => (
                    <div key={k} className="flex justify-between"><span className="text-fg-3">{k}</span><b style={{ color: scoreColor(v) }}>{v}</b></div>
                  ))}
                </div>
              </div>
              {d.next_fail && <p className="mt-3 text-[13px]">Next-inspection fail risk <b>{pct(d.next_fail.p_fail_next)}</b> if nothing is repaired.</p>}
              {d.flood && <p className="text-[13px]">Flood probability <b>{pct(d.flood.p)}</b>.</p>}
            </Card>
            <Card title="Evidence chain">
              <div className="flex flex-col gap-1 text-[12.5px]">
                <div className="flex items-center gap-2">
                  <Pill color={chain.data?.intact ? "#34D399" : "#F87171"}>{chain.data?.intact ? "Chain intact" : "Chain broken"}</Pill>
                  <span className="text-fg-3">{fmtN(chain.data?.checked)} entries re-verified</span>
                </div>
                <div className="mt-1 text-fg-3">Report anchor (SHA-256)</div>
                <div className="break-all font-mono text-[11px]">{r.chain_hash}</div>
                <Link href={`/hq#audit`} className="mt-2 text-[12.5px] text-cyan">Open the audit log →</Link>
              </div>
            </Card>
          </div>
        </div>
      )}
    </Shell>
  );
}

export default function Page() {
  return <Suspense><ReportView /></Suspense>;
}
