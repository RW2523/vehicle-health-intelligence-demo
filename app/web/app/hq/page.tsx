"use client";
import { useEffect, useState } from "react";
import { Bars, LineChart, Scatter } from "@/components/charts";
import { Shell } from "@/components/Shell";
import { Card, Kpi, PageHeader, Pill, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { dmy, fmtN, pct } from "@/lib/format";
import { useFetch, useLive } from "@/lib/live";

export default function HQ() {
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
      <PageHeader title="HQ operations" sub="Examiner integrity, lane demand, equipment health and the tamper-evident evidence log, across all branches (sessions S4 and S5)."
        actions={<Source kind="synthetic" text="History: synthetic (80 examiners, 20 branches)" />} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Flagged examiners" value={I ? I.flagged.length : "–"} sub={I ? I.flagged.join(", ") : ""} color="#F87171" />
        <Kpi label="Equipment below 50% health" value={eq.data ? eq.data.devices.filter((d: any) => d.health < 50).length : "–"} sub="of all lane devices" color="#FBBF24" />
        <Kpi label={`Days over capacity (${D?.branch || ""})`} value={D ? D.summary.days_over_capacity : "–"} sub={D ? `${D.summary.extra_slots_needed} extra slots in 14 days` : ""} />
        <Kpi label="Evidence chain" value={audit.data ? (audit.data.verify.intact ? "Intact" : "Broken") : "–"} sub={audit.data ? `${fmtN(audit.data.verify.checked)} entries re-verified` : ""} color={audit.data?.verify.intact ? "#34D399" : "#F87171"} />
        <Kpi label="Live inspections" value={ops.data ? Object.values(ops.data.inspections_by_status).reduce((a: number, b: any) => a + b, 0) as number : "–"} sub={ops.data ? Object.entries(ops.data.inspections_by_status).map(([k, v]) => `${v} ${k}`).join(" · ") : ""} />
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Examiner integrity · heavy vehicles" right={<Source kind="live_model" text="z-score + Isolation Forest" />}>
          {I && (
            <>
              <Scatter height={260} xLabel="Pass rate (heavy vehicles)" yLabel="Passes that conflict with the sensor evidence"
                xFmt={(v) => pct(v)} yFmt={(v) => pct(v)}
                points={light.map((e: any) => ({ x: e.pass_rate, y: e.conflict_rate, color: flagged.has(e.examiner_id) ? "#F87171" : "#60A5FA", r: flagged.has(e.examiner_id) ? 7 : 4.5, label: flagged.has(e.examiner_id) ? e.examiner_id : undefined, title: `${e.examiner_id} ${e.name}: pass ${pct(e.pass_rate)}, z ${e.z_pass}` }))} />
              <table className="mt-3 w-full text-left text-[12.5px]">
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
              {examinerSel && (
                <div className="mt-3 max-h-48 overflow-auto rounded-lg border border-ink-600 p-2 text-[12px]">
                  <div className="mb-1 font-semibold">Passes by {examinerSel} that breach a fail threshold</div>
                  {I.evidence.filter((x: any) => x.examiner_id === examinerSel).map((x: any) => (
                    <div key={x.inspection_id} className="flex justify-between border-t border-ink-600 py-1"><span>{x.date} · {x.inspection_id} · {x.inspection_type}</span><span className="text-fg-3">brake {x.brake_efficiency_pct ?? "–"}% · tread {x.tyre_tread_min_mm ?? "–"} mm · smoke {x.smoke_opacity_pct ?? "–"}%</span></div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11.5px] text-fg-4">{I.method}</p>
            </>
          )}
        </Card>
        <Card title="Demand vs lane capacity · next 14 days" right={
          <select aria-label="Branch" className="input py-1.5" value={branch} onChange={(e) => setBranch(e.target.value)}>
            {(branches.data || []).map((b) => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
          </select>}>
          {D && (
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
        <Card title="Lane equipment health" right={<Source kind="live_model" text="Isolation Forest + trend" />}>
          <div className="flex max-h-[340px] flex-col gap-1.5 overflow-auto">
            {(eq.data?.devices || []).slice(0, 14).map((d: any, i: number) => (
              <button key={i} onClick={() => setDevIdx(i)} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-[12.5px] ${devIdx === i ? "border-cyan bg-ink-750" : "border-ink-600 bg-ink-850"}`}>
                <span><b>{d.branch_id} · lane {d.lane}</b> <span className="text-fg-3">{d.device.replaceAll("_", " ")}</span></span>
                <span style={{ color: d.health < 50 ? "#F87171" : d.health < 75 ? "#FBBF24" : "#34D399" }} className="font-bold">{d.health}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card title={dev ? `${dev.branch_id} lane ${dev.lane} · ${dev.device.replaceAll("_", " ")} · vibration (g RMS)` : "Equipment"} right={<Source kind="simulated" text="Telemetry: simulated" />}>
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
