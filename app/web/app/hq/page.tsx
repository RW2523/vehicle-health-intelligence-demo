"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Bars, LineChart, Scatter } from "@/components/charts";
import { refreshUseCase } from "@/components/Demo";
import { Icon } from "@/components/icons";
import { Shell } from "@/components/Shell";
import { Card, ErrorState, Kpi, LoadingState, PageHeader, Pill, SeverityBadge, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { STATUS_LABEL, dmy, fmtN, pct, typeLabel } from "@/lib/format";
import { useFetch, useLive } from "@/lib/live";

const STATE: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: "#F87171" }, acknowledged: { label: "Acknowledged", color: "#FBBF24" }, actioned: { label: "Action recorded", color: "#34D399" },
};

/** One exception: why it was raised, the evidence, where to look, and the actions HQ can record. */
function ExceptionCard({ x, canAct, onDone, first }: { x: any; canAct: boolean; onDone: (x: any) => void; first: boolean }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const st = STATE[x.state.status] || STATE.open;
  const act = async (action: string) => {
    setBusy(action);
    try {
      const r = await api.post("/api/hq/exceptions/action", { key: x.key, action, note });
      toast(`${r.state.label}: ${x.title}`, "ok");
      setNote("");
      onDone(r);
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  };
  return (
    <article className="rounded-xl border border-ink-600 bg-ink-850 p-3.5" style={{ borderLeft: `3px solid ${x.state.status === "open" ? (x.severity === "critical" ? "#F87171" : "#FBBF24") : "#34D399"}` }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge s={x.severity} />
            <span className="chip" style={{ borderColor: st.color + "80", color: st.color }}>{st.label}</span>
            <span className="text-[11.5px] text-fg-3">{x.where}</span>
          </div>
          <h3 className="mt-1.5 text-[14.5px] font-semibold leading-snug">{x.title}</h3>
          <p className="mt-1 text-[13px] text-fg-2">{x.reason}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">{x.provenance.map(([k, t]: string[]) => <Source key={k + t} kind={k} text={t} />)}</div>
      </div>
      {x.evidence?.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 border-l-2 border-ink-600 pl-3 text-[12px] text-fg-3">
          {x.evidence.map((e: string) => <li key={e}>{e}</li>)}
          {x.evidence_count > x.evidence.length && <li>… {x.evidence_count - x.evidence.length} more</li>}
        </ul>
      )}
      {x.state.status !== "open" && (
        <p className="mt-2 text-[12.5px]" style={{ color: st.color }}>
          {x.state.label} by {x.state.by} · {new Date(x.state.at).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          {x.state.note ? <span className="text-fg-3"> · “{x.state.note}”</span> : null}
          <span className="text-fg-4"> · evidence entry #{x.state.chain_seq}{x.state.mock ? " · mock: nothing was sent" : ""}</span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link className="btn btn-sm" href={x.href} scroll={false}>Show the evidence<Icon name="arrow" size={13} /></Link>
        {canAct && x.state.status === "open" && (
          <>
            <input className="input min-w-[160px] flex-1 py-1.5" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Note for ${x.title}`} />
            {x.actions.map((a: any, i: number) => (
              <button key={a.id} className={`btn btn-sm ${i === 0 && first ? "btn-primary" : ""}`} disabled={!!busy} onClick={() => act(a.id)}
                title={a.mock ? "Mock: recorded only, nothing is sent" : undefined}>
                {busy === a.id ? "Recording…" : a.label}{a.mock ? " (mock)" : ""}
              </button>
            ))}
          </>
        )}
      </div>
    </article>
  );
}

function HQ() {
  const router = useRouter();
  const sp = useSearchParams();
  const user = useUser();
  const exc = useFetch<any>("/api/hq/exceptions");
  const integ = useFetch<any>("/api/hq/integrity");
  const eq = useFetch<any>("/api/hq/equipment");
  const [branch, setBranch] = useState("BR00");
  const dem = useFetch<any>("/api/hq/demand", { branch_id: branch });
  const audit = useFetch<any>("/api/hq/audit");
  const ops = useFetch<any>("/api/hq/ops");
  const branches = useFetch<any[]>("/api/branches");
  const [devIdx, setDevIdx] = useState(0);
  const [tamper, setTamper] = useState<any>(null);
  const [examinerSel, setExaminerSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canAct = user?.role === "presenter" || user?.role === "hq";
  const names: Record<string, string> = Object.fromEntries((branches.data || []).map((b: any) => [b.branch_id, b.name]));
  // drill-through from an exception: select what it points at and scroll there
  const focusEx = sp.get("examiner"), focusDev = sp.get("device"), focusBranch = sp.get("branch");
  useEffect(() => {
    if (focusEx) setExaminerSel(focusEx);
    if (focusBranch) setBranch(focusBranch);
    const target = focusEx ? "integrity" : focusDev ? "equipment" : focusBranch ? "demand" : null;
    if (target) setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  }, [focusEx, focusDev, focusBranch]);
  useEffect(() => {
    if (!focusDev || !eq.data) return;
    const [b, lane, ...dv] = focusDev.split("-");
    const i = eq.data.devices.findIndex((d: any) => d.branch_id === b && String(d.lane) === lane && d.device === dv.join("-"));
    if (i >= 0) setDevIdx(i);
  }, [focusDev, eq.data]);
  const done = () => {
    exc.reload();
    audit.reload();
    refreshUseCase();
    router.replace("/hq#exceptions", { scroll: false });
  };
  const X = exc.data;
  const openN = X ? X.items.filter((i: any) => i.state.status === "open").length : 0;
  // decisions and reports made on other screens add evidence entries: keep the audit and the counts current
  useLive(["inspections"], () => {
    audit.reload();
    ops.reload();
  });
  useEffect(() => {
    const t = setInterval(() => {
      audit.reload();
      ops.reload();
    }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const I = integ.data;
  const light = (I?.examiners || []).filter((e: any) => e.vehicle_class === "heavy");
  const flagged = new Set(I?.flagged || []);
  const dev = eq.data?.devices?.[devIdx];
  const D = dem.data;
  const runTamper = async () => {
    setBusy(true);
    try {
      const t = await api.post("/api/evidence/tamper-test");
      if (!t.ran) {
        toast("The evidence log is empty: run a lane session first (Demo control), then try again.", "err");
        return;
      }
      setTamper(t);
      toast(t.detected ? `Tamper detected at entry #${t.edited_seq}; record restored` : "The edit was not detected", t.detected ? "ok" : "err");
      audit.reload();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <PageHeader title="HQ operations" sub="Exceptions first: what needs an operations decision across every hub. Below them: lanes, examiner integrity, demand, equipment and the audit log."
        actions={<Source kind="synthetic" text="History: 80 examiners, 20 hubs" />} />
      <section id="exceptions" className="card card-pad mb-4 scroll-mt-20" aria-label="Exceptions">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="h-title">Exceptions {X ? <span className="font-normal text-fg-3">· {openN} open of {X.items.length}</span> : null}</h2>
          <span className="text-[12px] text-fg-3">{X?.note}</span>
        </div>
        {exc.error && !X ? <ErrorState title="Exceptions could not be computed" onRetry={exc.reload}>{exc.error}</ErrorState>
          : !X ? <LoadingState label="Checking every hub for exceptions…" rows={3} />
          : !X.items.length ? (
            <div className="rounded-xl border border-ok/40 bg-ok/5 px-4 py-3 text-[13.5px]"><b className="text-ok">No exceptions.</b> <span className="text-fg-3">Examiner integrity, lane equipment, capacity and the evidence chain are all within their limits.</span></div>
          ) : (
            <div className="flex flex-col gap-3">
              {openN === 0 && <div className="rounded-xl border border-ok/40 bg-ok/5 px-4 py-2.5 text-[13px]"><b className="text-ok">Every exception has been handled.</b> <span className="text-fg-3">The records below show who did what, and when.</span></div>}
              {X.items.map((x: any) => <ExceptionCard key={x.key} x={x} canAct={canAct} onDone={done} first={x.key === X.items.find((i: any) => i.state.status === "open")?.key} />)}
            </div>
          )}
      </section>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Flagged examiners" value={I ? I.flagged.length : "…"} sub={I ? I.flagged.join(", ") : ""} color="#F87171" />
        <Kpi label="Equipment below 50% health" value={eq.data ? eq.data.devices.filter((d: any) => d.health < 50).length : "–"} sub="of all lane devices" color="#FBBF24" />
        <Kpi label={`Days over capacity (${D?.branch || ""})`} value={D ? D.summary.days_over_capacity : "–"} sub={D ? `${D.summary.extra_slots_needed} extra slots in 14 days` : ""} />
        <Kpi label="Evidence chain" value={audit.data ? (audit.data.verify.intact ? "Intact" : "Broken") : "–"} sub={audit.data ? `${fmtN(audit.data.verify.checked)} entries re-verified` : ""} color={audit.data?.verify.intact ? "#34D399" : "#F87171"} />
        <Kpi label="Live inspections" value={ops.data ? Object.values(ops.data.inspections_by_status).reduce((a: number, b: any) => a + b, 0) as number : "–"} sub={ops.data ? Object.entries(ops.data.inspections_by_status).map(([k, v]) => `${v} ${k}`).join(" · ") : ""} />
      </div>
      <Card title="Lanes across hubs" className="mb-4" right={<Source kind="live_logic" text="Live inspections" />}>
        {!ops.data ? <LoadingState label="Loading the lanes…" rows={3} /> : !ops.data.lanes?.length ? <p className="text-[13px] text-fg-3">No lane has run yet today. Start a use case from the demo control to see one here.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] whitespace-nowrap text-left text-[12.5px] [&_td]:pr-3 [&_th]:pr-3">
              <thead className="text-fg-3"><tr><th>Hub</th><th>Lane</th><th>Vehicle</th><th>Status</th><th>Health</th><th>Result</th><th>Started</th><th></th></tr></thead>
              <tbody>
                {ops.data.lanes.map((l: any) => (
                  <tr key={l.lane_id} className="border-t border-ink-600">
                    <td className="py-1.5">{l.branch}</td><td>Lane {l.lane_id.split("-L")[1]}</td><td><b>{l.plate}</b></td>
                    <td>{STATUS_LABEL[l.status] || l.status}</td><td>{l.health ?? "–"}</td><td>{l.verdict || "–"}</td>
                    <td className="text-fg-3">{new Date(l.started_at + "Z").toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="flex gap-2 py-1"><Link className="btn btn-sm" href={`/lane?lane=${l.lane_id}`}>Lane</Link><Link className="btn btn-sm" href={`/examiner?id=${l.inspection_id}`}>Inspection</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11.5px] text-fg-4">The latest inspection on each lane. A hub's own examiners see only their hub; HQ sees them all.</p>
      </Card>
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Examiner integrity · heavy vehicles" className="scroll-mt-20" right={<Source kind="live_model" text="z-score + Isolation Forest" />}>
          <span id="integrity" className="block scroll-mt-24" />
          {!I ? <LoadingState label="Comparing every examiner with their peers…" rows={4} /> : (
            <>
              <Scatter height={260} xLabel="Pass rate (heavy vehicles)" yLabel="Passes that conflict with the sensor evidence"
                xFmt={(v) => pct(v)} yFmt={(v) => pct(v)}
                points={light.map((e: any) => ({ x: e.pass_rate, y: e.conflict_rate, color: flagged.has(e.examiner_id) ? "#F87171" : "#60A5FA", r: flagged.has(e.examiner_id) ? 7 : 4.5, label: flagged.has(e.examiner_id) ? e.examiner_id : undefined, title: `${e.examiner_id} ${e.name}: pass ${pct(e.pass_rate)}, z ${e.z_pass}` }))} />
              {/* seven columns do not fit a phone: the table scrolls inside the card, not the page */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full whitespace-nowrap text-left text-[12.5px] [&_td]:pr-3 [&_th]:pr-3">
                  <thead className="text-fg-3"><tr><th>Examiner</th><th>Class</th><th>Inspections</th><th>Pass rate</th><th>z</th><th>Conflicts</th><th></th></tr></thead>
                  <tbody>
                    {I.examiners.filter((e: any) => e.outlier).map((e: any, i: number) => (
                      <tr key={i} className="border-t border-ink-600">
                        <td className="py-1.5"><b>{e.examiner_id}</b> {e.name}</td><td>{e.vehicle_class}</td><td>{e.n}</td><td>{pct(e.pass_rate)}</td>
                        <td className="text-bad">{e.z_pass.toFixed(1)}σ</td><td>{pct(e.conflict_rate, 1)}</td>
                        <td><button className="btn btn-sm" onClick={() => setExaminerSel(e.examiner_id)}>Evidence</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {examinerSel && (
                <div className="mt-3 max-h-48 overflow-auto rounded-lg border border-ink-600 p-2 text-[12px]">
                  <div className="mb-1 font-semibold">Passes by {examinerSel} that breach a fail threshold</div>
                  {I.evidence.filter((x: any) => x.examiner_id === examinerSel).map((x: any) => (
                    <div key={x.inspection_id} className="flex justify-between gap-2 border-t border-ink-600 py-1"><span>{x.date} · {x.inspection_id} · {typeLabel(x.inspection_type)}</span><span className="text-fg-3">brake {x.brake_efficiency_pct ?? "–"}% · tread {x.tyre_tread_min_mm ?? "–"} mm · smoke {x.smoke_opacity_pct ?? "–"}%</span></div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11.5px] text-fg-4">{I.method}</p>
            </>
          )}
        </Card>
        <Card title={<h2 className="h-title" id="demand" style={{ scrollMarginTop: 96 }}>Demand vs lane capacity · next 14 days</h2>} right={
          <select aria-label="Branch" className="input py-1.5" value={branch} onChange={(e) => setBranch(e.target.value)}>
            {(branches.data || []).map((b) => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
          </select>}>
          {!D ? <LoadingState label="Forecasting demand…" rows={4} /> : (
            <>
              <Bars height={200} values={[...D.recent.slice(-14).map((r: any) => r.demand), ...D.forecast.map((f: any) => f.demand)]}
                secondary={[...D.recent.slice(-14).map((r: any) => r.capacity), ...D.forecast.map((f: any) => f.capacity)]}
                labels={[...D.recent.slice(-14).map((r: any) => r.date.slice(8)), ...D.forecast.map((f: any) => f.date.slice(8))]}
                color="#3B82F6" />
              <div className="mt-1 flex flex-wrap gap-3 text-[11.5px] text-fg-3">
                <span>Bars: booking requests (last 14 days actual, next 14 forecast)</span><span className="text-bad">Red line: lane capacity</span>
                <Source kind="live_model" text="LightGBM forecast" />
              </div>
              <div className="mt-3 rounded-lg border border-ink-600 bg-ink-850 p-3 text-[12.5px]">
                {D.summary.roster.length ? (
                  <>
                    <b>Roster suggestion:</b> {D.summary.roster.map((r: any) => `${dmy(r.date)} +${r.extra_lane_shifts} lane shift(s) (${r.extra_slots} slots)`).join(" · ")}
                  </>
                ) : "Forecast demand fits within capacity for the next 14 days."}
              </div>
            </>
          )}
        </Card>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card title={<h2 className="h-title" id="equipment" style={{ scrollMarginTop: 96 }}>Lane equipment health</h2>} right={<Source kind="live_model" text="Isolation Forest + trend" />}>
          {!eq.data && <LoadingState label="Checking lane devices…" rows={4} />}
          <div className="flex max-h-[340px] flex-col gap-1.5 overflow-auto">
            {(eq.data?.devices || []).slice(0, 14).map((d: any, i: number) => (
              <button key={i} onClick={() => setDevIdx(i)} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-[12.5px] ${devIdx === i ? "border-cyan bg-ink-750" : "border-ink-600 bg-ink-850"}`}>
                <span><b>{names[d.branch_id] || d.branch_id} · lane {d.lane}</b> <span className="text-fg-3">{d.device.replaceAll("_", " ")}</span></span>
                <span style={{ color: d.health < 50 ? "#F87171" : d.health < 75 ? "#FBBF24" : "#34D399" }} className="font-bold">{d.health}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card title={dev ? `${names[dev.branch_id] || dev.branch_id} lane ${dev.lane} · ${dev.device.replaceAll("_", " ")} · vibration (g RMS)` : "Equipment"} right={<Source kind="simulated" text="Telemetry: simulated" />}>
          {dev && (
            <>
              <LineChart height={240} yFmt={(v) => v.toFixed(2)}
                hlines={[{ y: dev.vibration_limit_g, color: "#EF4444", label: `limit ${dev.vibration_limit_g} g` }]}
                xLabels={dev.series.filter((_: any, i: number) => i % 10 === 0).map((p: any) => ({ x: dev.series.indexOf(p), label: p.date.slice(5) }))}
                series={[{ color: "#22D3EE", dots: false, points: dev.series.map((p: any, i: number) => ({ x: i, y: p.vibration })) }]} />
              <p className="mt-2 text-[13px]">
                Health <b>{dev.health}</b> · trend {dev.trend_g_per_day > 0 ? "+" : ""}{dev.trend_g_per_day} g/day ·{" "}
                {dev.service_by ? (dev.days_to_limit <= 0
                  ? <b className="text-bad">already over the limit · service now and re-check the lane's recent results</b>
                  : <b className="text-warn">service by {dmy(dev.service_by)} ({dev.days_to_limit} days to the limit)</b>) : "no service needed on the current trend"}
              </p>
            </>
          )}
        </Card>
      </div>
      <Card title="Evidence audit" right={<><Source kind="live_logic" text="SHA-256 hash chain" /><button className="btn btn-sm btn-primary" disabled={busy} onClick={runTamper}>{busy ? "Testing…" : "Run tamper test"}</button></>}>
        <div id="audit" className="mb-3 flex scroll-mt-24 flex-wrap items-center gap-3 text-[13px]">
          <Pill color={audit.data?.verify.intact ? "#34D399" : "#F87171"}>{audit.data?.verify.intact ? "All records intact" : "Chain broken"}</Pill>
          <span className="text-fg-3">{fmtN(audit.data?.verify.checked)} entries · head {audit.data?.verify.head?.slice(0, 16)}…</span>
          {tamper && (
            <span className={tamper.detected ? "text-ok" : "text-bad"}>
              Test: edited entry #{tamper.edited_seq} directly in the database → verification {tamper.detected ? `failed at #${tamper.verify_after_edit.broken_at_seq} (${tamper.verify_after_edit.reason})` : "did not notice"}; restored → {tamper.verify_after_restore.intact ? "intact again" : "still broken"}.
            </span>
          )}
        </div>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="text-fg-3"><tr><th>#</th><th>Time (UTC)</th><th>Kind</th><th>Inspection</th><th>Actor</th><th>Hash</th></tr></thead>
            <tbody>
              {(audit.data?.recent || []).slice().reverse().map((e: any) => (
                <tr key={e.seq} className="border-t border-ink-600"><td className="py-1">{e.seq}</td><td>{e.ts.slice(0, 19).replace("T", " ")}</td><td>{e.kind}</td><td>{e.inspection_id || "–"}</td><td>{e.actor}</td><td className="font-mono text-fg-3">{e.hash.slice(0, 16)}…</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Shell>
  );
}

export default function Page() {
  return <Suspense><HQ /></Suspense>;
}
