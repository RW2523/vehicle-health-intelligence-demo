"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { BrakeChart, ENoseChart, PNChart } from "@/components/lanebits";
import { Bar, Card, Empty, Pill, ScoreRing, Source, Tabs, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtN, pct, scoreColor, sevColor } from "@/lib/format";
import { useInspection } from "@/lib/inspection";

const SESSIONS = [{ id: "S1", label: "S1 · DMO 9001" }, { id: "S2", label: "S2 · DMO 9002" }, { id: "S3", label: "S3 · DMO 9003" }];

function Spectrogram({ img, hl }: { img: number[][]; hl?: number[] }) {
  if (!img?.length) return null;
  const rows = img.length, cols = img[0].length;
  return (
    <svg viewBox={`0 0 ${cols} ${rows}`} className="h-32 w-full rounded-lg bg-ink-950" preserveAspectRatio="none" role="img" aria-label="Spectrogram">
      {img.map((row, y) => row.map((v, x) => <rect key={`${x}-${y}`} x={x} y={rows - 1 - y} width="1.05" height="1.05" fill={`rgba(34,211,238,${0.08 + 0.92 * v})`} />))}
      {hl && <rect x={(hl[0] / 5) * cols} y="0" width={((hl[1] - hl[0]) / 5) * cols} height={rows} fill="none" stroke="#F87171" strokeWidth="0.6" />}
    </svg>
  );
}

function Evidence({ a, L }: { a: any; L: any }) {
  const ev = a.evidence || {};
  const r = L.results;
  const img = ev.image;
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-[17px] font-semibold">{a.title}</h3>
          <Source kind={a.source} />
          {a.fail_item && <Pill color="#F87171">fail item</Pill>}
        </div>
        <p className="mt-1 text-fg-2">{a.detail}</p>
        <p className="mt-1 text-[12px] text-fg-3">{a.system} · model confidence {Math.round(a.confidence * 100)}% · rank {a.rank || "–"}</p>
      </div>
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img.annotated} alt="evidence frame" className="max-h-[320px] w-full rounded-xl object-contain bg-ink-950" />
      )}
      {ev.acoustic && (
        <div className="flex flex-col gap-2">
          <audio controls src={ev.acoustic.clip} className="w-full" />
          <Spectrogram img={ev.acoustic.spectrogram} hl={ev.acoustic.highlight_s} />
          <div className="flex flex-wrap gap-2">{ev.acoustic.ranked.map((x: any) => <Pill key={x.class} color="#22D3EE">{x.label} {Math.round(x.p * 100)}%</Pill>)}</div>
        </div>
      )}
      {ev.fingerprint && (
        <div className="rounded-xl border border-ink-600 bg-ink-850 p-3">
          <div className="mb-2 flex justify-between"><span>Engine sound match with earlier visits</span><b>{ev.fingerprint.similarity}</b></div>
          <div className="relative h-3 rounded bg-ink-600">
            <div className="h-3 rounded bg-bad" style={{ width: `${ev.fingerprint.similarity * 100}%` }} />
            <div className="absolute top-[-4px] h-5 w-0.5 bg-ok" style={{ left: `${ev.fingerprint.threshold * 100}%` }} title="threshold" />
          </div>
          <p className="mt-2 text-[12px] text-fg-3">Threshold {ev.fingerprint.threshold} (calibrated at the equal-error rate). {ev.fingerprint.n_refs} reference recording(s).</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div><div className="label mb-1">Today</div><audio controls src={(r.acoustic || []).find((x: any) => x.fingerprint)?.clip} className="w-full" /></div>
            <div><div className="label mb-1">Earlier visit</div><audio controls src={ev.fingerprint.reference_clips?.[0]} className="w-full" /></div>
          </div>
        </div>
      )}
      {ev.event && <ENoseChart enose={L.enose} events={[ev.event]} height={170} />}
      {ev.event?.ranked && (
        <div className="flex flex-wrap gap-2">
          {ev.event.ranked.map((x: any) => <Pill key={x.condition} color="#FBBF24">{x.condition.replaceAll("_", " ")} {Math.round(x.p * 100)}% (model)</Pill>)}
          {ev.event.fused_with && <span className="text-[12px] text-fg-3">Resolved with: {ev.event.fused_with}.</span>}
        </div>
      )}
      {ev.pn && <PNChart pn={L.pn} height={150} />}
      {ev.brakes && <BrakeChart brake={L.brake} height={160} />}
      {ev.hubs && (
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(ev.hubs).map(([k, v]: any) => (
            <div key={k} className="rounded-lg border px-3 py-2 text-center" style={{ borderColor: v > 100 ? "#F87171" : "#1F2B44" }}>
              <div className="text-[11px] text-fg-3">{k}</div><div className="font-display text-[18px]" style={{ color: v > 100 ? "#F87171" : undefined }}>{v} °C</div>
            </div>
          ))}
        </div>
      )}
      {ev.dtc && <div className="rounded-lg border border-ink-600 bg-ink-850 p-3"><b>{ev.dtc.code}</b> · {ev.dtc.description} <span className="text-fg-3">({ev.dtc.source})</span></div>}
      {ev.odometer && (
        <table className="w-full text-left text-[12.5px]">
          <thead className="text-fg-3"><tr><th>Date</th><th>Inspection</th><th className="text-right">Odometer</th></tr></thead>
          <tbody>
            {ev.odometer.history.map((h: any, i: number) => <tr key={i} className="border-t border-ink-600"><td className="py-1">{h.date}</td><td>{h.inspection_type}</td><td className="text-right">{fmtN(h.odometer_km)} km</td></tr>)}
            <tr className="border-t border-ink-600 text-bad"><td className="py-1">Today</td><td>This inspection</td><td className="text-right">{fmtN(ev.odometer.reading_km)} km</td></tr>
          </tbody>
        </table>
      )}
      {ev.flood && (
        <div className="rounded-xl border border-ink-600 bg-ink-850 p-3">
          <div className="mb-1">Flood probability <b>{pct(ev.flood.p)}</b> <span className="text-fg-3">(physical-evidence model {pct(ev.flood.p_model)}, then rules)</span></div>
          <ul className="list-disc pl-5 text-fg-2">{ev.flood.signals.map((s: string) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      {ev.ev && <div className="rounded-lg border border-ink-600 bg-ink-850 p-3">Pack SOH <b>{ev.ev.pack_soh_pct}%</b> (band {ev.ev.band_pct?.join("–")}%), weakest module {ev.ev.weakest_module}</div>}
      {ev.flags && <div className="rounded-lg border border-bad/50 bg-bad/10 p-3">Identity flags: {ev.flags.join(", ")}</div>}
    </div>
  );
}

function ExaminerConsole() {
  const sp = useSearchParams();
  const router = useRouter();
  const session = sp.get("session") || (sp.get("id") ? undefined : "S1");
  const id = sp.get("id") || undefined;
  const L = useInspection({ session, id });
  const [sel, setSel] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [examiner, setExaminer] = useState("VE012");
  const [busy, setBusy] = useState(false);
  const insp = L.insp;
  const fusion = L.fusion;
  const h = fusion?.health;
  const selected = useMemo(() => L.alerts.find((a) => a.alert_id === sel) || L.alerts[0], [L.alerts, sel]);
  useEffect(() => setSel(null), [insp?.inspection_id]);

  const decide = async (a: any, action: string) => {
    const reason = reasons[a.alert_id] || "";
    if (action !== "confirm" && reason.trim().length < 3) {
      toast("Add a short reason to dismiss or defer.");
      return;
    }
    try {
      const d = await api.post(`/api/inspections/alerts/${a.alert_id}/decision`, { action, reason, examiner_id: examiner });
      L.setAlerts((xs) => xs.map((x) => (x.alert_id === d.alert_id ? { ...x, ...d } : x)));
      toast(`${action === "confirm" ? "Confirmed" : action === "dismiss" ? "Dismissed" : "Deferred"}: ${a.title}`);
    } catch (e: any) {
      toast(e.message);
    }
  };
  const openHigh = L.alerts.filter((a) => a.status === "open" && a.severity === "high").length;
  const issue = async () => {
    setBusy(true);
    try {
      const rep = await api.post(`/api/inspections/${insp.inspection_id}/report`, { examiner_id: examiner, senior_signed: examiner === "VE001" });
      toast(`Report issued: ${rep.verdict}`);
      router.push(`/report?id=${rep.report_id}`);
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  const route = async () => {
    await api.post(`/api/inspections/${insp.inspection_id}/route-senior`, { examiner_id: examiner, senior_id: "VE001", note: "Identity checks disagree" });
    setExaminer("VE001");
    toast("Routed to senior examiner VE001 (now signed in as VE001)");
  };

  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-[24px] font-semibold">Examiner console</h1>
          <Tabs value={session || ""} onChange={(v) => router.replace(`/examiner?session=${v}`)} items={SESSIONS} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[12.5px] text-fg-3">Signed in as
            <select aria-label="Examiner" className="input w-auto py-1.5" value={examiner} onChange={(e) => setExaminer(e.target.value)}>
              <option value="VE012">Suresh Chandran · VE012</option><option value="VE020">Chong Raj · VE020</option><option value="VE001">Priya Hassan · VE001 (senior)</option>
            </select>
          </label>
        {insp && (
          <div className="flex items-center gap-2">
            {insp.route === "senior" && <button className="btn" onClick={route}>Route to senior examiner</button>}
            {insp.report ? (
              <Link className="btn btn-primary" href={`/report?id=${insp.report.report_id}`}>View report ({insp.report.verdict}) →</Link>
            ) : (
              <button className="btn btn-primary" disabled={busy || !fusion || openHigh > 0} onClick={issue} title={openHigh ? "Decide every high-severity alert first" : ""}>
                {openHigh ? `Decide ${openHigh} high alert${openHigh > 1 ? "s" : ""} to issue` : "Issue report →"}
              </button>
            )}
          </div>
        )}
        </div>
      </div>
      {!insp ? (
        <Empty>No inspection for {session} yet. Start it from Demo control (or press Fast-forward).</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[330px_minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col gap-4">
            <Card title={`${insp.plate} · ${insp.vehicle?.make || ""} ${insp.vehicle?.model || ""}`}>
              <div className="text-[12.5px] text-fg-3">{insp.inspection_type} · {insp.lane_id} · status <b className="text-fg">{insp.status}</b></div>
              {insp.route === "senior" && <div className="mt-2 rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-[12.5px] text-bad">Identity flags: a senior examiner must sign off.</div>}
            </Card>
            <Card title="Vehicle Health Score" right={<Source kind="live_model" text="Fusion model" />}>
              {!h ? <p className="text-[13px] text-fg-3">Computed when the lane reaches examiner review ({L.step || "waiting"}).</p> : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-4">
                    <ScoreRing value={h.score} />
                    <div className="text-[12.5px] text-fg-2">
                      <div>Model score {h.model_score} − rules {h.rules.reduce((x: number, r: any) => x + r.points, 0)}</div>
                      {fusion.next_fail && <div className="mt-1">Next-inspection fail risk <b>{pct(fusion.next_fail.p_fail_next)}</b></div>}
                      {fusion.next_fail && <div>Median time to a failed test ~{fusion.next_fail.months_to_failure_median} months</div>}
                      {fusion.flood && <div className="mt-1">Flood probability <b>{pct(fusion.flood.p)}</b></div>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    {Object.entries(h.subscores).map(([k, v]: any) => (
                      <div key={k}>
                        <div className="flex justify-between text-[12.5px]"><span>{k}</span><b style={{ color: scoreColor(v) }}>{v}</b></div>
                        <Bar value={v} color={scoreColor(v)} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
            {h && (
              <Card title="Why this score">
                <div className="label mb-1">Top model factors (SHAP)</div>
                <ul className="mb-3 flex flex-col gap-1 text-[12.5px]">
                  {h.factors.map((f: any) => (
                    <li key={f.feature} className="flex justify-between gap-2"><span>{f.label}{f.value != null ? ` (${typeof f.value === "number" ? +f.value.toFixed(2) : f.value})` : ""}</span><span style={{ color: f.shap > 0 ? "#F87171" : "#34D399" }}>{f.shap > 0 ? "+" : ""}{f.shap}</span></li>
                  ))}
                </ul>
                <div className="label mb-1">Rule layer (signals the history model cannot see)</div>
                <ul className="flex flex-col gap-1 text-[12.5px]">
                  {h.rules.length ? h.rules.map((r: any, i: number) => <li key={i} className="flex justify-between gap-2"><span>{r.rule}</span><span className="text-bad">−{r.points}</span></li>) : <li className="text-fg-3">none</li>}
                </ul>
                {h.not_measured?.length > 0 && <p className="mt-2 text-[11.5px] text-fg-4">Not measured in this lane (filled with typical values): {h.not_measured.join(", ")}.</p>}
              </Card>
            )}
          </div>
          <Card title={`Ranked alerts (${L.alerts.length})`} right={<span className="text-[12px] text-fg-3">{L.alerts.filter((a) => a.status !== "open").length} decided</span>}>
            <div className="flex flex-col gap-2">
              {L.alerts.map((a) => (
                <div key={a.alert_id} onClick={() => setSel(a.alert_id)}
                  className={`cursor-pointer rounded-xl border p-3 ${selected?.alert_id === a.alert_id ? "border-cyan bg-ink-750" : "border-ink-600 bg-ink-850"}`}>
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-ink-900" style={{ background: sevColor(a.severity) }}>{a.rank || "·"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold">{a.title}</span>
                        {a.fail_item && <Pill color="#F87171">fail</Pill>}
                      </div>
                      <div className="text-[11.5px] text-fg-3">{a.system} · {Math.round(a.confidence * 100)}% · {a.source.replace("_", " ")}</div>
                    </div>
                  </div>
                  {a.status === "open" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-sm btn-primary" onClick={() => decide(a, "confirm")}>Confirm</button>
                      <input className="input min-w-[140px] flex-1 py-1.5" placeholder="Reason (to dismiss / defer)" value={reasons[a.alert_id] || ""}
                        onChange={(e) => setReasons((r) => ({ ...r, [a.alert_id]: e.target.value }))} aria-label={`Reason for ${a.title}`} />
                      <button className="btn btn-sm" onClick={() => decide(a, "dismiss")}>Dismiss</button>
                      <button className="btn btn-sm" onClick={() => decide(a, "defer")}>Defer</button>
                    </div>
                  ) : (
                    <div className="mt-2 text-[12px]" style={{ color: a.status === "confirmed" ? "#34D399" : "#9AA8BF" }}>
                      {a.status[0].toUpperCase() + a.status.slice(1)} by {a.decided_by}{a.reason ? ` · “${a.reason}”` : ""}
                    </div>
                  )}
                </div>
              ))}
              {!L.alerts.length && <p className="text-[13px] text-fg-3">No alerts yet.</p>}
            </div>
          </Card>
          <Card title="Evidence">
            {selected ? <Evidence a={selected} L={L} /> : <p className="text-[13px] text-fg-3">Select an alert to see its evidence.</p>}
            {r2(L)}
          </Card>
        </div>
      )}
    </Shell>
  );
}

function r2(L: any) {
  const adas = L.results?.adas;
  if (!adas) return null;
  return (
    <div className="mt-4 rounded-xl border border-ink-600 bg-ink-850 p-3 text-[12.5px]">
      <div className="mb-1 flex items-center justify-between"><b>ADAS self-test</b><Source kind="mock" /></div>
      Status: {adas.status}. {adas.note}
    </div>
  );
}

export default function Page() {
  return <Suspense><ExaminerConsole /></Suspense>;
}
