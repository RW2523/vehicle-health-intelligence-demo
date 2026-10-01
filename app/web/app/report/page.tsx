"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { NextAction, refreshUseCase, useActiveUseCase } from "@/components/Demo";
import { Icon } from "@/components/icons";
import { Shell } from "@/components/Shell";
import { Card, Empty, ErrorState, LoadingState, PageHeader, Pill, ScoreRing, SeverityBadge, Source, toast } from "@/components/ui";
import { fmtN, laneLabel, llmLabel, nextFailNote, pct, scoreColor } from "@/lib/format";
import { useFetch, useLive } from "@/lib/live";
import { DECISION, PROVENANCE, VERDICT, alertSeverity, hasModelConfidence, provenance, scoreSeverity } from "@/lib/present";

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";

function ReportView() {
  const sp = useSearchParams();
  const id = sp.get("id");
  const list = useFetch<any[]>("/api/reports", { limit: 30 });
  const rid = id || list.data?.[0]?.report_id || null;
  const rep = useFetch<any>(rid ? `/api/reports/${rid}` : null);
  const chain = useFetch<any>("/api/evidence/verify", undefined, [rid]);
  const { active: uc } = useActiveUseCase();
  useLive(["inspections"], (m) => {
    if (m.type !== "reported") return;
    list.reload();
    refreshUseCase();
    toast(`New report issued: ${m.data.verdict}${id ? " (see the list above)" : ""}`, "ok");
  });
  const r = rep.data;
  const d = r?.data || {};
  const loading = (!list.data && !list.error) || (!!rid && !r && !rep.error);
  const mine = uc && r && uc.inspection?.inspection_id === r.inspection_id ? uc : null;
  const findings: any[] = d.findings || [];
  const confirmed = findings.filter((f) => f.status === "confirmed");
  const kinds = Array.from(new Set(findings.map((f) => provenance(f.source).kind)));
  const nMeasures = Object.keys(d.measurements || {}).length;
  const hs = d.health?.score;
  return (
    <Shell>
      <PageHeader title="Inspection report" sub="The decision in plain words, every finding with the examiner's decision, the evidence behind it, and the QR code anyone can scan to check it."
        actions={r && !d.synthetic && r.inspection ? <Link className="btn" href={`/examiner?id=${r.inspection_id}`}>Open in the examiner workspace</Link> : null}>
        {(list.data || []).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Issued reports">
            {(list.data || []).slice(0, 10).map((x) => (
              <Link key={x.report_id} href={`/report?id=${x.report_id}`} aria-current={x.report_id === rid ? "page" : undefined}
                className={`chip ${x.report_id === rid ? "border-cyan bg-cyan/10 text-fg" : "border-ink-500 text-fg-3 hover:border-cyan/60"}`}>
                {x.plate} · <span style={{ color: VERDICT[x.verdict]?.color }}>{x.verdict}</span>{x.data?.synthetic ? " · synthetic" : ""}
              </Link>
            ))}
          </div>
        )}
      </PageHeader>
      {loading ? <div className="card card-pad"><LoadingState label="Loading the report…" rows={5} /></div>
        : rep.error ? <ErrorState title="This report could not be loaded" onRetry={rep.reload}>{rep.error}</ErrorState>
        : !r ? (
          <Empty title="No reports yet" actions={<><Link className="btn btn-primary" href="/#usecases">Start a use case<Icon name="arrow" size={15} /></Link><Link className="btn" href="/examiner">Examiner workspace</Link></>}>
            A report is issued from the examiner workspace once the lane has finished and every critical finding has a decision.
          </Empty>
        ) : (
          <>
            {(mine || r) && (
              <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ok/50 bg-ok/5 px-4 py-3" aria-label="Completion">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold text-ok"><Icon name="check" size={16} width={2.4} />{d.synthetic ? "Synthetic report on record" : "Inspection complete: report issued"}</div>
                  <p className="text-[13px] text-fg-3">
                    {d.synthetic ? "Seeded for the demo from the synthetic inspection history; its evidence entry is in the hash chain like any other."
                      : `The result is on the ${r.history_label?.toLowerCase() || "vehicle history"} and can be verified by anyone with the QR code.`}
                    {mine && !mine.complete && mine.next ? <> <b className="text-fg">{mine.id} next:</b> {mine.next.label}.</> : null}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <NextAction uc={mine} here="/report">{!mine ? <Link className="btn btn-primary" href={`/verify/${r.verify_token}`}>Open public verification<Icon name="arrow" size={15} /></Link> : undefined}</NextAction>
                  {r.history_href && mine?.next?.href !== r.history_href && <Link className="btn" href={r.history_href}>{r.history_label}</Link>}
                  {mine && <Link className="btn" href={`/verify/${r.verify_token}`}>Public verification</Link>}
                  <button className="btn" onClick={() => window.print()}>Print / save as PDF</button>
                </div>
              </section>
            )}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="flex min-w-0 flex-col gap-4">
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="label">{r.kind}</span>{d.synthetic && <Source kind="synthetic" text="Seeded demo record" />}</div>
                      <h2 className="mt-1 font-display text-[24px] font-bold leading-tight">{r.plate} · {[d.vehicle?.make, d.vehicle?.model, d.vehicle?.year].filter(Boolean).join(" ")}</h2>
                      <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-[13px] sm:grid-cols-3">
                        <div><dt className="text-[11.5px] text-fg-3">Inspection</dt><dd className="font-semibold">{d.inspection_type || r.kind}</dd></div>
                        <div><dt className="text-[11.5px] text-fg-3">Inspection ID</dt><dd className="font-mono text-[12.5px]">{r.inspection_id}</dd></div>
                        <div><dt className="text-[11.5px] text-fg-3">Hub · lane</dt><dd className="font-semibold">{d.branch}{d.lane ? ` · ${laneLabel(d.lane)}` : ""}</dd></div>
                        <div><dt className="text-[11.5px] text-fg-3">Issued</dt><dd className="font-semibold">{when(d.issued_at)}</dd></div>
                        <div><dt className="text-[11.5px] text-fg-3">Examiner</dt><dd className="font-semibold">{d.examiner?.name}{d.examiner?.senior ? " (Senior Examiner)" : ""}</dd></div>
                        {d.odometer_km != null && <div><dt className="text-[11.5px] text-fg-3">Odometer</dt><dd className="font-semibold">{fmtN(d.odometer_km)} km</dd></div>}
                      </dl>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {hs != null && <ScoreRing value={hs} size={84} />}
                      <div className="rounded-2xl border-2 px-5 py-3 text-center" style={{ borderColor: VERDICT[r.verdict]?.color, color: VERDICT[r.verdict]?.color }} title={VERDICT[r.verdict]?.help}>
                        <div className="font-display text-[26px] font-bold">{r.verdict}</div>
                        <div className="text-[11px]">{r.verdict === "CONDITIONAL" ? "EV Health Certificate" : "Outcome"}</div>
                      </div>
                    </div>
                  </div>
                  {d.verdict_reasons?.length > 0 && (
                    <p className="mt-3 text-[13px] text-fg-2"><b>Why {r.verdict}:</b> {d.verdict_reasons.slice(0, 4).join("; ")}.</p>
                  )}
                  <div className="mt-4 rounded-xl border border-ink-600 bg-ink-850 p-4">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="label">In plain words</span>
                      <Source kind={llmLabel(r.summary_source) ? "llm" : "template"} text={llmLabel(r.summary_source) ? `Local LLM · ${llmLabel(r.summary_source)}` : "Template"} />
                    </div>
                    <p className="text-[14.5px] leading-relaxed">{r.summary}</p>
                  </div>
                </Card>
                <Card title={`Decision summary · ${confirmed.length} of ${findings.length} finding${findings.length === 1 ? "" : "s"} confirmed`}>
                  {!findings.length ? <p className="text-[13px] text-ok">No anomalies were found: nothing needed a decision.</p> : (
                    <ul className="flex flex-col divide-y divide-ink-600">
                      {findings.map((f, i) => (
                        <li key={i} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2"><b className="text-[13.5px]">{f.title}</b>{f.fail_item && <Pill color="#F87171">Fail item</Pill>}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-3">
                              <SeverityBadge s={alertSeverity(f)} /><Source kind={f.source} />
                              <span>{f.system}{hasModelConfidence(f) ? ` · model confidence ${Math.round(f.confidence * 100)}%` : ""}</span>
                            </div>
                          </div>
                          <div className="max-w-full text-right text-[12.5px] sm:max-w-[45%]">
                            <b style={{ color: DECISION[f.status]?.color }}>{DECISION[f.status]?.label || f.status}</b>
                            {f.decided_by && <span className="text-fg-3"> by {f.decided_by}</span>}
                            {f.reason && <div className="text-fg-3">“{f.reason}”</div>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card title="Evidence summary">
                  <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
                    <div><div className="text-[11.5px] text-fg-3">Measurements</div><div className="font-display text-[20px]">{nMeasures}</div></div>
                    <div><div className="text-[11.5px] text-fg-3">Findings</div><div className="font-display text-[20px]">{findings.length}</div></div>
                    <div><div className="text-[11.5px] text-fg-3">From AI models</div><div className="font-display text-[20px]">{findings.filter((f) => f.source === "live_model").length}</div></div>
                    <div><div className="text-[11.5px] text-fg-3">From rules / instruments</div><div className="font-display text-[20px]">{findings.filter((f) => f.source !== "live_model").length}</div></div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-3">
                    Sources: {(kinds.length ? kinds : d.synthetic ? ["synthetic"] : ["simulated"]).map((k) => <Source key={k} kind={k} />)}
                    {!d.synthetic && <span>· lane instruments are {PROVENANCE.simulated.label.toLowerCase()} in this demo</span>}
                  </div>
                  {d.ev && (
                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-ink-600 pt-3 text-[13px] md:grid-cols-4">
                      <div><div className="text-fg-3">Battery state of health</div><div className="font-display text-[20px]">{d.ev.pack_soh_pct}%</div></div>
                      <div><div className="text-fg-3">Expected for age</div><div className="font-display text-[20px]">{d.ev.expected_for_age_pct}%</div></div>
                      <div><div className="text-fg-3">{d.ev.km_to_70 ? "Distance to 70%" : "Distance to 60%"}</div><div className="font-display text-[20px]">{fmtN(d.ev.km_to_70 || d.ev.km_to_60)} km</div></div>
                      <div><div className="text-fg-3">HV isolation</div><div className="font-display text-[20px]">{d.measurements?.hv_isolation_mohm ?? "–"} MΩ</div></div>
                    </div>
                  )}
                </Card>
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <Card title="Verify this report" right={<Source kind="live_logic" text="Hash chain" />}>
                  <div className="flex flex-col items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/reports/${r.report_id}/qr.svg`} alt="QR code to verify this report" className="h-44 w-44 rounded-xl bg-white p-2" />
                    <Link href={`/verify/${r.verify_token}`} className="btn w-full">Open public verification (no login)</Link>
                    <p className="break-all text-center font-mono text-[11px] text-fg-3">{r.verify_url}</p>
                  </div>
                </Card>
                <Card title="Integrity">
                  <div className="flex flex-col gap-1.5 text-[12.5px]">
                    <div className="flex flex-wrap items-center gap-2">
                      {chain.data ? <Pill color={chain.data.intact ? "#34D399" : "#F87171"}>{chain.data.intact ? "Evidence chain intact" : "Evidence chain broken"}</Pill> : <span className="text-fg-3">Checking the chain…</span>}
                      {chain.data && <span className="text-fg-3">{fmtN(chain.data.checked)} entries re-verified now</span>}
                    </div>
                    <div className="mt-1 text-fg-3">Report anchor (SHA-256)</div>
                    <div className="break-all font-mono text-[11px]">{r.chain_hash}</div>
                    <Link href="/hq#audit" className="mt-1 text-cyan hover:underline">Open the audit log →</Link>
                  </div>
                </Card>
                {hs != null && (
                  <Card title="Health">
                    <div className="flex flex-col gap-1 text-[12.5px]">
                      <div>Vehicle Health / Risk Score <b style={{ color: scoreColor(hs) }}>{hs}</b> · {scoreSeverity(hs) === "normal" ? "Normal" : scoreSeverity(hs) === "attention" ? "Attention" : "Critical"}</div>
                      {Object.entries(d.health?.subscores || {}).filter(([k]) => d.vehicle?.fuel === "ev" || !k.startsWith("EV")).map(([k, v]: any) => (
                        <div key={k} className="flex justify-between"><span className="text-fg-3">{k}</span><b style={{ color: scoreColor(v) }}>{v}</b></div>
                      ))}
                      {d.next_fail && <p className="mt-2 text-[13px]">Next-inspection fail risk <b>{pct(d.next_fail.p_fail_next)}</b>.{nextFailNote(d.next_fail) && <span className="block text-[12px] text-fg-3">Compare: {nextFailNote(d.next_fail)}.</span>}</p>}
                      {d.flood && <p className="text-[13px]">Flood likelihood <b>{pct(d.flood.p)}</b>.</p>}
                    </div>
                  </Card>
                )}
                <p className="text-[11.5px] text-fg-4">Issued {when(d.issued_at)} · fictional vehicle · VehicleSense AI concept demo.</p>
              </div>
            </div>
          </>
        )}
    </Shell>
  );
}

export default function Page() {
  return <Suspense><ReportView /></Suspense>;
}
