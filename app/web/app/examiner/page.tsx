"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyboardEvent, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { refreshUseCase, useActiveUseCase } from "@/components/Demo";
import { VehicleHealthSummary } from "@/components/Health";
import { InspectionContextBar } from "@/components/InspectionContextBar";
import { Icon } from "@/components/icons";
import { BrakeChart, ENoseChart, PNChart } from "@/components/lanebits";
import { PlayerControls, useSessions } from "@/components/Player";
import { Shell } from "@/components/Shell";
import { Card, Empty, LoadingState, PageHeader, Pill, SeverityBadge, Source, Tabs, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { LANE_SESSIONS, fmtN, laneOf, llmLabel, pct } from "@/lib/format";
import { useInspection } from "@/lib/inspection";
import { DECISION, SEVERITY, alertSeverity, hasModelConfidence, isRequired } from "@/lib/present";

const SESSIONS = LANE_SESSIONS.map((l) => ({ id: l.session, label: `${l.label} · ${l.plate}` }));

function Spectrogram({ img, hl }: { img: number[][]; hl?: number[] }) {
  if (!img?.length) return null;
  const rows = img.length, cols = img[0].length;
  return (
    <svg viewBox={`0 0 ${cols} ${rows}`} className="h-32 w-full rounded-lg bg-ink-950" preserveAspectRatio="none" role="img" aria-label="Spectrogram of the recording">
      {img.map((row, y) => row.map((v, x) => <rect key={`${x}-${y}`} x={x} y={rows - 1 - y} width="1.05" height="1.05" fill={`rgba(34,211,238,${0.08 + 0.92 * v})`} />))}
      {hl && <rect x={(hl[0] / 5) * cols} y="0" width={((hl[1] - hl[0]) / 5) * cols} height={rows} fill="none" stroke="#F87171" strokeWidth="0.6" />}
    </svg>
  );
}

/** The measured value against its limit, when the finding is a measurement with one (never invented). */
function measureOf(a: any, L: any): { observed: string; limit: string; delta?: string } | null {
  const ev = a.evidence || {};
  const r = L.results || {};
  const code: string = a.code || "";
  const num = (v: any) => typeof v === "number" && Number.isFinite(v);
  const fmt = (v: number, unit: string, d = 1) => `${fmtN(v, Math.abs(v) < 10 ? Math.min(2, d + 1) : d)}${unit}`;
  const over = (v: number, lim: number, unit: string, d = 1) => ({ observed: fmt(v, unit, d), limit: `at most ${fmt(lim, unit, d)}`, delta: `${fmt(v - lim, unit, d)} over` });
  const under = (v: number, lim: number, unit: string, d = 1) => ({ observed: fmt(v, unit, d), limit: `at least ${fmt(lim, unit, d)}`, delta: `${fmt(lim - v, unit, d)} under` });
  if (code === "pn:high" && ev.pn) {
    const lim = ev.pn.verdict === "fail" ? ev.pn.limit_tamper : ev.pn.limit_advisory;
    return { observed: `${(ev.pn.median_per_cm3 / 1e6).toFixed(2)} M/cm³`, limit: `${ev.pn.verdict === "fail" ? "tamper level" : "advisory level"} ${(lim / 1e6).toFixed(2)} M/cm³`, delta: `${(ev.pn.median_per_cm3 / lim).toFixed(1)}× the level` };
  }
  if (code === "brake:efficiency" && ev.brakes) return under(ev.brakes.efficiency_pct, ev.brakes.limit_efficiency_pct, "%", 0);
  if (code === "brake:imbalance" && ev.brakes) {
    const imb = Math.max(0, ...Object.values(ev.brakes.imbalance_by_axle || {}).map(Number));
    return { ...over(imb, ev.brakes.limit_imbalance_pct, "%", 0), limit: `at most ${ev.brakes.limit_imbalance_pct}% (advisory above 20%)` };
  }
  if (code.startsWith("emissions:")) {
    const f = code.split(":")[1];
    const ins = r.instruments?.[f];
    const v = ev[f];
    if (f === "lambda" && num(v)) return { observed: Number(v).toFixed(2), limit: `between ${ins?.limit || "0.97-1.03"}`, delta: v < 0.97 ? "rich mixture" : "lean mixture" };
    if (num(v) && num(ins?.limit)) return over(v, ins.limit, f === "co_pct" ? "%" : " ppm", f === "co_pct" ? 1 : 0);
  }
  if (code === "ev:hv_isolation" && num(ev.hv_isolation_mohm)) return under(ev.hv_isolation_mohm, 2, " MΩ");
  if (code === "suspension" && ev.values) return under(Math.min(...ev.values), 40, "%", 0);
  if (code === "headlamp" && num(ev.value)) return over(Math.abs(ev.value), 2, "%");
  if (code === "tint" && num(ev.value)) return under(ev.value, 50, "%", 0);
  if (code.startsWith("thermal:") && ev.hubs) {
    const k = code.split(":")[1];
    if (num(ev.hubs[k])) return over(ev.hubs[k], 100, " °C", 0);
  }
  if (code.startsWith("corrosion:") && ev.image) return { observed: `${ev.image.corrosion_score}/10`, limit: "flagged from 4/10", delta: ev.image.level };
  if (code === "identity:odometer" && ev.odometer?.max_recorded_km) return { observed: `${fmtN(ev.odometer.reading_km)} km`, limit: `at least ${fmtN(ev.odometer.max_recorded_km)} km (highest on record)`, delta: `${fmtN(ev.odometer.rollback_km)} km lower` };
  if (code === "identity:engine" && ev.fingerprint) return { observed: `similarity ${ev.fingerprint.similarity}`, limit: `at least ${ev.fingerprint.threshold} to match`, delta: `${(ev.fingerprint.threshold - ev.fingerprint.similarity).toFixed(2)} under` };
  if (code === "flood" && ev.flood) return { observed: pct(ev.flood.p), limit: "flagged from 50%" };
  return null;
}

/** The health-score deduction this finding caused, when the rule layer names it. */
function ruleFor(a: any, h: any): any | null {
  const rules: any[] = h?.rules || [];
  const code: string = a.code || "";
  if (code.startsWith("thermal:")) return rules.find((r) => r.rule.includes(`hub ${code.split(":")[1]}`)) || null;
  if (code.startsWith("tyre:")) return rules.find((r) => r.rule.startsWith("Tyre AI")) || null;
  if (code.startsWith("body:")) return rules.find((r) => r.rule.startsWith("Above-carriage AI")) || null;
  if (code === "flood") return rules.find((r) => r.rule.startsWith("Flood probability")) || null;
  if (code.startsWith("acoustic:")) return rules.find((r) => r.rule.startsWith("Acoustic")) || null;
  return rules.find((r) => r.rule === a.title) || null;
}

const SOURCE_KIND: Record<string, string> = {
  simulated: "Lane instrument reading (simulated sensor)", live_model: "AI model result on this inspection's data", live_logic: "Rule applied to this inspection's data",
};

function Evidence({ a, L }: { a: any; L: any }) {
  const ev = a.evidence || {};
  const r = L.results;
  const img = ev.image;
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img.annotated} alt={`Evidence frame: ${a.title}`} className="max-h-[300px] w-full rounded-xl bg-ink-950 object-contain" />
      )}
      {ev.acoustic && (
        <div className="flex flex-col gap-2">
          <audio controls src={ev.acoustic.clip} className="w-full" aria-label="Recording" />
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
          <p className="mt-2 text-[12px] text-fg-3">Threshold {ev.fingerprint.threshold} (calibrated at the equal-error rate) · {ev.fingerprint.n_refs} earlier recording(s).</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div><div className="label mb-1">Today</div><audio controls src={(r.acoustic || []).find((x: any) => x.fingerprint)?.clip} className="w-full" aria-label="Today's engine sound" /></div>
            <div><div className="label mb-1">Earlier visit</div><audio controls src={ev.fingerprint.reference_clips?.[0]} className="w-full" aria-label="Earlier engine sound" /></div>
          </div>
        </div>
      )}
      {ev.event && <ENoseChart enose={L.enose} events={[ev.event]} height={170} />}
      {ev.pn && <PNChart pn={L.pn} height={150} />}
      {ev.brakes && <BrakeChart brake={L.brake} height={160} />}
      {ev.hubs && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(ev.hubs).map(([k, v]: any) => (
            <div key={k} className="rounded-lg border px-3 py-2 text-center" style={{ borderColor: v > 100 ? "#F87171" : "#1F2B44" }}>
              <div className="text-[11px] text-fg-3">{k}</div><div className="font-display text-[18px]" style={{ color: v > 100 ? "#F87171" : undefined }}>{v} °C</div>
            </div>
          ))}
        </div>
      )}
      {ev.dtc && <div className="rounded-lg border border-ink-600 bg-ink-850 p-3"><b>{ev.dtc.code}</b> · {ev.dtc.description} <span className="text-fg-3">({ev.source || ev.dtc.source})</span></div>}
      {ev.flood && (
        <div className="rounded-xl border border-ink-600 bg-ink-850 p-3">
          <div className="mb-1">Flood likelihood <b>{pct(ev.flood.p)}</b> <span className="text-fg-3">(physical-evidence model {pct(ev.flood.p_model)}, then the claim and cabin rules)</span></div>
          <ul className="list-disc pl-5 text-fg-2">{ev.flood.signals.map((s: string) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      {ev.ev && <div className="rounded-lg border border-ink-600 bg-ink-850 p-3">Pack state of health <b>{ev.ev.pack_soh_pct}%</b> (modules {ev.ev.band_pct?.join("–")}%), weakest module {ev.ev.weakest_module}</div>}
      {ev.flags && <div className="rounded-lg border border-bad/50 bg-bad/10 p-3">Identity checks that disagree: {ev.flags.map((f: string) => f.split(":")[1]).join(", ")}</div>}
    </div>
  );
}

/** The one finding in focus: why it was flagged, the value against its limit, the source, history, and the decision. */
function FindingDetail({ a, L, fusion, readOnly, busy, onDecide, keepOpen, setKeepOpen }: {
  a: any; L: any; fusion: any; readOnly: boolean; busy: boolean; onDecide: (a: any, action: string, reason: string) => Promise<boolean>;
  keepOpen: boolean; setKeepOpen: (v: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [need, setNeed] = useState(false);
  useEffect(() => { setReason(""); setNeed(false); }, [a.alert_id]);
  const s = alertSeverity(a);
  const m = measureOf(a, L);
  const rule = ruleFor(a, fusion?.health);
  const odo = a.evidence?.odometer;
  const act = async (action: string) => {
    if (action !== "confirm" && reason.trim().length < 3) {
      setNeed(true);
      return;
    }
    if (await onDecide(a, action, reason)) setReason("");
  };
  const row = (k: string, v: ReactNode) => <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3"><span className="w-40 shrink-0 text-fg-3">{k}</span><span className="min-w-0">{v}</span></div>;
  return (
    <div className="fade-in flex flex-col gap-4" key={a.alert_id}>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge s={s} />
          {a.fail_item && <Pill color="#F87171">Fail item</Pill>}
          {isRequired(a) && <span className="text-[11.5px] text-fg-3">Decision required before the report</span>}
          <span className="ml-auto"><Source kind={a.source} /></span>
        </div>
        <h2 className="mt-2 font-display text-[19px] font-semibold leading-snug">{a.title}</h2>
      </div>
      <section aria-label="Why was this flagged?" className="rounded-xl border border-ink-600 bg-ink-850 p-3">
        <div className="label mb-1">Why was this flagged?</div>
        <p className="text-[14px] leading-relaxed">{a.detail}</p>
      </section>
      <div className="flex flex-col gap-1.5 text-[13px]">
        {m && row("Measured", <span><b>{m.observed}</b> · limit {m.limit}{m.delta ? <span className="text-bad"> · {m.delta}</span> : null}</span>)}
        {row("Evidence source", `${a.system} · ${SOURCE_KIND[a.source] || a.source}`)}
        {hasModelConfidence(a) ? row("Model confidence", `${Math.round(a.confidence * 100)}% (the model's own probability)`) : row("Model confidence", <span className="text-fg-3">Not applicable: a measurement or rule, not a model prediction</span>)}
        {rule && row("Health score", <span><b className="text-bad">−{rule.points} points</b> <span className="text-fg-3">({rule.rule})</span></span>)}
        {a.status !== "open" && row("Decision", <span style={{ color: DECISION[a.status]?.color }}>{DECISION[a.status]?.label} by {a.decided_by}{a.reason ? ` · “${a.reason}”` : ""}</span>)}
      </div>
      {odo?.history?.length > 0 && (
        <section aria-label="Historical comparison">
          <div className="label mb-1">Previous inspections</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] text-left text-[12.5px]">
              <thead className="text-fg-3"><tr><th className="py-1">Date</th><th>Inspection</th><th className="text-right">Odometer</th></tr></thead>
              <tbody>
                {odo.history.map((h: any, i: number) => <tr key={i} className="border-t border-ink-600"><td className="py-1">{h.date}</td><td>{h.inspection_type}</td><td className="text-right">{fmtN(h.odometer_km)} km</td></tr>)}
                <tr className="border-t border-ink-600 text-bad"><td className="py-1">Today</td><td>This inspection</td><td className="text-right">{fmtN(odo.reading_km)} km</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
      {!readOnly && a.status === "open" && (
        <section aria-label="Decision" className="rounded-xl border border-ink-500 bg-ink-750 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => act("confirm")}><Icon name="check" size={15} />Confirm finding</button>
            <input className="input min-w-[160px] flex-1 py-1.5" placeholder="Reason (needed to dismiss or defer)" value={reason}
              onChange={(e) => { setReason(e.target.value); setNeed(false); }} aria-label={`Reason for ${a.title}`} aria-invalid={need} />
            <button className="btn btn-danger" disabled={busy} onClick={() => act("dismiss")}>Dismiss</button>
            <button className="btn" disabled={busy} onClick={() => act("defer")}>Defer</button>
          </div>
          {need && <p className="mt-1.5 text-[12px] text-bad" role="alert">Add a short reason (at least 3 characters) to dismiss or defer.</p>}
          <label className="mt-2 flex items-center gap-2 text-[12px] text-fg-3">
            <input type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} /> Stay on this finding after deciding (otherwise the next open one opens)
          </label>
        </section>
      )}
      <Evidence a={a} L={L} />
    </div>
  );
}

/** Context-aware assistant, scoped to this inspection: retrieved facts, then the explanation. */
function InspectionAssistant({ iid, alertId }: { iid: string; alertId?: string }) {
  const [res, setRes] = useState<any>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const QUICK = ["Why was this vehicle flagged?", "Summarise the unresolved findings", "Show the previous inspection trend", "What evidence supports this finding?", "What should the examiner verify next?"];
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    try {
      setRes(await api.post(`/api/inspections/${iid}/ask`, { question, alert_id: alertId }));
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => setRes(null), [iid]);
  const llm = res && llmLabel(res.source);
  return (
    <Card title="Ask about this inspection" right={res ? <Source kind={llm ? "llm" : "template"} text={llm ? `Local LLM · ${llm}` : "Template (no LLM)"} /> : null}>
      <div className="flex flex-wrap gap-1.5">
        {QUICK.map((x) => <button key={x} className="btn btn-sm" disabled={busy} onClick={() => { setQ(x); ask(x); }}>{x}</button>)}
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input className="input flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this vehicle or inspection" aria-label="Question about this inspection" />
        <button className="btn" disabled={busy || !q.trim()}>{busy ? "Asking…" : "Ask"}</button>
      </form>
      {busy && !res && <LoadingState label="Looking up the inspection…" rows={2} className="mt-3" />}
      {res && (
        <div className="mt-3 flex flex-col gap-3 text-[13px]">
          <div>
            <div className="label mb-1">From the inspection record</div>
            {res.facts.length ? (
              <ol className="flex flex-col gap-1">
                {res.facts.map((f: any) => (
                  <li key={f.n} className="flex gap-2"><span className="shrink-0 font-mono text-[11.5px] text-cyan">[{f.n}]</span><span className="text-fg-2">{f.text}</span></li>
                ))}
              </ol>
            ) : <p className="text-fg-3">Nothing on record answers this.</p>}
            {res.missing.map((m: string) => <p key={m} className="mt-1 text-fg-3">{m}</p>)}
          </div>
          <div className="rounded-xl border border-ink-600 bg-ink-850 p-3">
            <div className="label mb-1">Explanation {llm ? "(generated from the facts above)" : "(assembled from the facts above)"}</div>
            <p className="leading-relaxed">{res.answer}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

function ExaminerWorkspace() {
  const sp = useSearchParams();
  const router = useRouter();
  const id = sp.get("id") || undefined;
  const session = sp.get("session") || (id ? undefined : "S1");
  const L = useInspection({ session, id });
  const { sessions, setPlayer } = useSessions();
  const { active: uc } = useActiveUseCase();
  const user = useUser();
  const [picked, setExaminer] = useState("VE011");
  const examiner = user?.examiner_id || picked;  // an examiner account acts as itself; the presenter can act as either
  const isSenior = user?.examiner_id ? !!user.senior : examiner === "VE001";
  const readOnly = user?.role === "viewer" || user?.role === "hq";
  const canRun = user?.role === "presenter" || user?.role === "examiner";
  const [sel, setSel] = useState<string | null>(null);
  const [system, setSystem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [keepOpen, setKeepOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const insp = L.insp;
  const fusion = L.fusion;
  const tab = insp?.session_id || session || "S1";
  const sess = sessions.find((x) => x.session_id === tab);
  useEffect(() => { setSel(null); setSystem(null); }, [insp?.inspection_id]);

  const ordered = useMemo(() => [...L.alerts].sort((x, y) =>
    Number(x.status !== "open") - Number(y.status !== "open") || SEVERITY[alertSeverity(x)].rank - SEVERITY[alertSeverity(y)].rank
    || Number(y.fail_item) - Number(x.fail_item) || (x.rank || 99) - (y.rank || 99)), [L.alerts]);
  const shown = system ? ordered.filter((a) => a.system === system) : ordered;
  const selected = ordered.find((a) => a.alert_id === sel) || shown.find((a) => a.status === "open") || shown[0] || null;
  const required = L.alerts.filter(isRequired);
  const reqDone = required.filter((a) => a.status !== "open").length;
  const open = L.alerts.filter((a) => a.status === "open");
  const decided = L.alerts.length - open.length;
  const inLane = !insp || insp.status === "in_lane" || !fusion;
  const locked = insp?.status === "reported";
  const routed = insp?.examiner?.id === "VE001" || insp?.examiner_id === "VE001";
  const needSenior = insp?.route === "senior" && !locked;

  const nextOpen = (after: string) => {
    const rest = ordered.filter((a) => a.status === "open" && a.alert_id !== after && (!system || a.system === system));
    return (rest.find(isRequired) || rest[0])?.alert_id || null;
  };
  const decide = async (a: any, action: string, reason: string, quiet = false) => {
    setBusy(action);
    try {
      const d = await api.post(`/api/inspections/alerts/${a.alert_id}/decision`, { action, reason, examiner_id: examiner });
      L.setAlerts((xs) => xs.map((x) => (x.alert_id === d.alert_id ? { ...x, ...d } : x)));
      if (!quiet) toast(`${DECISION[d.status]?.label || action}: ${a.title}`, "ok");
      if (!keepOpen && !quiet) setSel(nextOpen(a.alert_id) || a.alert_id);
      refreshUseCase();
      return true;
    } catch (e: any) {
      toast(e.message, "err");
      return false;
    } finally {
      setBusy(null);
    }
  };
  const confirmRest = async () => {
    setBusy("all");
    let n = 0;
    for (const a of open) if (await decide(a, "confirm", "", true)) n++;
    setBusy(null);
    if (n) toast(`Confirmed ${n} finding${n === 1 ? "" : "s"}`, "ok");
  };
  const issue = async () => {
    setBusy("issue");
    try {
      const rep = await api.post(`/api/inspections/${insp.inspection_id}/report`, { examiner_id: examiner, senior_signed: isSenior });
      toast(`Report issued: ${rep.verdict}`, "ok");
      refreshUseCase();
      router.push(`/report?id=${rep.report_id}`);
    } catch (e: any) {
      toast(e.message, "err");
      setBusy(null);
    }
  };
  const route = async () => {
    setBusy("route");
    try {
      await api.post(`/api/inspections/${insp.inspection_id}/route-senior`, { examiner_id: examiner, senior_id: "VE001", note: "Identity checks disagree" });
      if (user?.examiner_id) toast("Referred to the senior examiner, Priya Hassan: she signs it off from her own account", "ok");
      else {
        setExaminer("VE001");
        toast("Referred to the senior examiner (now acting as Priya Hassan, VE001)", "ok");
      }
      L.reload();
      refreshUseCase();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = shown.findIndex((a) => a.alert_id === selected?.alert_id);
    const n = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (n) {
      setSel(n.alert_id);
      (listRef.current?.querySelector(`[data-id="${n.alert_id}"]`) as HTMLElement | null)?.focus();
    }
  };

  let cta: ReactNode;
  if (readOnly) cta = insp?.report ? <Link className="btn btn-primary" href={`/report?id=${insp.report.report_id}`}>View the report ({insp.report.verdict})<Icon name="arrow" size={15} /></Link> : <span className="chip border-ink-500 text-fg-3">Read only</span>;
  else if (insp?.report) cta = <Link className="btn btn-primary" href={`/report?id=${insp.report.report_id}`}>View the report ({insp.report.verdict})<Icon name="arrow" size={15} /></Link>;
  else if (inLane) cta = <button className="btn btn-primary" disabled title="The report can be issued once the lane has finished and the health score is computed">Issue report (after the lane)</button>;
  else if (required.length - reqDone > 0) cta = <button className="btn btn-primary" disabled title="Every critical finding needs a decision first">Decide {required.length - reqDone} critical finding{required.length - reqDone > 1 ? "s" : ""} first</button>;
  else if (needSenior && !isSenior && !routed) cta = <button className="btn btn-primary" disabled={!!busy} onClick={route}>Refer to the senior examiner<Icon name="arrow" size={15} /></button>;
  else if (needSenior && !isSenior && routed) cta = <button className="btn btn-primary" disabled title="The senior examiner signs this report off">Waiting for the senior examiner</button>;
  else cta = <button className="btn btn-primary" disabled={busy === "issue"} onClick={issue}>{busy === "issue" ? "Issuing…" : needSenior ? "Sign off and issue the report" : "Issue report"}<Icon name="arrow" size={15} /></button>;

  return (
    <Shell>
      <PageHeader title="Examiner workspace" sub="Review every AI finding with its evidence, decide it, then issue the report. Critical findings come first."
        actions={
          user?.role === "presenter" ? (
            <label className="flex items-center gap-2 text-[12.5px] text-fg-3">Acting as
              <select aria-label="Examiner" className="input w-auto py-1.5" value={examiner} onChange={(e) => setExaminer(e.target.value)}>
                <option value="VE011">Arjun Ismail · Examiner</option><option value="VE001">Priya Hassan · Senior Examiner</option>
              </select>
            </label>
          ) : user?.examiner_id ? (
            <span className="text-[12.5px] text-fg-3">Signed in as <b className="text-fg">{user.name}{user.senior ? " · Senior Examiner" : " · Examiner"}</b></span>
          ) : readOnly ? <span className="chip border-ink-500 text-fg-3">Read only</span> : null
        }>
        <div className="mt-3 max-w-full overflow-x-auto"><Tabs value={tab} onChange={(v) => router.replace(`/examiner?session=${v}`)} items={SESSIONS} /></div>
      </PageHeader>
      {!insp && !L.notFound ? (
        <div className="card card-pad"><LoadingState label="Loading the inspection…" rows={4} /></div>
      ) : !insp ? (
        <Empty title="This inspection has not started yet" actions={sess && canRun ? <PlayerControls s={sess} onState={setPlayer} compact onFastDone={L.reload} /> : null}>
          Start it and watch it on the <Link className="text-cyan hover:underline" href={`/lane?lane=${laneOf(tab)}`}>lane console</Link>, or fast-forward to the finished lane.
          The findings then arrive here, critical first, each with its evidence.
        </Empty>
      ) : (
        <>
          <InspectionContextBar insp={insp} alerts={L.alerts} uc={uc} here="/examiner" cta={cta} />
          {needSenior && (
            <div className="mb-4 rounded-xl border border-info/50 bg-info/10 px-4 py-3 text-[13px]" role="status">
              <b className="text-info">Senior review required.</b>{" "}
              <span className="text-fg-2">
                Identity checks disagree ({L.alerts.filter((a) => a.code?.startsWith("identity:")).map((a) => a.title.split(":")[0].toLowerCase()).join(", ") || "identity"}), so only a senior examiner can sign this report off.
                {isSenior ? " You are acting as the senior examiner." : routed ? " It has been referred: the senior examiner signs it off." : " Refer it to the senior examiner; a report issued without the senior's sign-off says REFERRED."}
              </span>
            </div>
          )}
          <section className="card card-pad mb-4" aria-label="Decision progress">
            <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
              <div className="min-w-0">
                <b>{inLane ? "The lane is still running" : `${reqDone} of ${required.length} critical finding${required.length === 1 ? "" : "s"} reviewed`}</b>
                <span className="text-fg-3"> · {decided} of {L.alerts.length} finding{L.alerts.length === 1 ? "" : "s"} decided{!inLane && !L.alerts.length ? " · no anomalies: nothing to decide" : ""}</span>
              </div>
              {open.length > 1 && !locked && !readOnly && !inLane && <button className="btn btn-sm" disabled={!!busy} onClick={confirmRest}>{busy === "all" ? "Confirming…" : `Confirm all ${open.length} remaining`}</button>}
            </div>
            <div className="mt-2 h-1.5 rounded bg-ink-600"><div className="h-1.5 rounded bg-ok transition-all" style={{ width: `${L.alerts.length ? (100 * decided) / L.alerts.length : inLane ? 0 : 100}%` }} /></div>
          </section>
          {!L.alerts.length ? (
            <div className="mb-4 rounded-2xl border border-ok/40 bg-ok/5 px-5 py-6 text-center">
              <div className="font-display text-[18px] font-semibold text-ok">{inLane ? "No findings so far" : "No anomalies detected in this inspection"}</div>
              <p className="mt-1 text-[13.5px] text-fg-3">{inLane ? "Findings appear here as the lane raises them." : "Every measurement is within its limit and the AI modules found nothing. The report can be issued."}</p>
            </div>
          ) : (
            <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
              <Card title={`Findings (${shown.length}${system ? ` · ${system}` : ""})`} right={system ? <button className="text-[12px] text-cyan hover:underline" onClick={() => setSystem(null)}>Show all</button> : <span className="text-[11.5px] text-fg-3">↑ ↓ to move</span>}>
                <div ref={listRef} className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1" role="listbox" aria-label="Findings" onKeyDown={onKey}>
                  {shown.map((a) => {
                    const s = alertSeverity(a);
                    const on = selected?.alert_id === a.alert_id;
                    return (
                      <button key={a.alert_id} data-id={a.alert_id} role="option" aria-selected={on} onClick={() => setSel(a.alert_id)}
                        className={`rounded-xl border p-3 text-left transition focus-visible:ring-2 focus-visible:ring-cyan ${on ? "border-cyan bg-ink-750" : "border-ink-600 bg-ink-850 hover:border-ink-500"} ${a.status !== "open" ? "opacity-75" : ""}`}
                        style={{ borderLeft: `3px solid ${SEVERITY[s].color}` }}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[13.5px] font-semibold leading-snug">{a.title}</span>
                          <span className="shrink-0 text-[11.5px] font-semibold" style={{ color: DECISION[a.status]?.color }}>{a.status === "open" && isRequired(a) ? "Required" : DECISION[a.status]?.label}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[12px] text-fg-3">{a.detail}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><SeverityBadge s={s} />{a.fail_item && <Pill color="#F87171">Fail item</Pill>}<Source kind={a.source} /></div>
                      </button>
                    );
                  })}
                  {!shown.length && <p className="text-[13px] text-fg-3">No findings in {system}. <button className="text-cyan hover:underline" onClick={() => setSystem(null)}>Show all</button></p>}
                </div>
              </Card>
              <Card>
                {selected ? (
                  <FindingDetail a={selected} L={L} fusion={fusion} readOnly={readOnly || locked} busy={!!busy} onDecide={(a, action, reason) => decide(a, action, reason)}
                    keepOpen={keepOpen} setKeepOpen={setKeepOpen} />
                ) : <p className="text-[13px] text-fg-3">Select a finding to see its evidence.</p>}
              </Card>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {fusion?.health ? (
              <Card title="Vehicle health" right={<Source kind="live_model" text="Fusion model + rules" />}>
                <VehicleHealthSummary fusion={fusion} fuel={insp.vehicle?.fuel} active={system}
                  onPick={L.alerts.length ? (k) => { setSystem(k); setSel(null); } : undefined} />
              </Card>
            ) : (
              <Card title="Vehicle health"><p className="text-[13px] text-fg-3">The health score is computed when the lane reaches examiner review.</p></Card>
            )}
            <InspectionAssistant iid={insp.inspection_id} alertId={selected?.alert_id} />
          </div>
          {L.results?.adas && (
            <div className="mt-4 rounded-xl border border-ink-600 bg-ink-850 p-3 text-[12.5px]">
              <div className="mb-1 flex items-center justify-between"><b>ADAS self-test</b><Source kind="mock" /></div>
              Status: {L.results.adas.status}. {L.results.adas.note}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

export default function Page() {
  return <Suspense><ExaminerWorkspace /></Suspense>;
}
