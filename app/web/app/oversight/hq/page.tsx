"use client";
/* Oversight > HQ operations: exceptions first, then every hub's lanes (table and map), examiner integrity, demand
   against capacity, lane equipment and the evidence audit. */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Bars, LineChart, Scatter } from "@/components/charts";
import { refreshUseCase } from "@/components/Demo";
import { Panel, StatusPill, Tone } from "@/components/glass";
import { Icon } from "@/components/icons";
import { LiveMap, MapPoint, keyOf } from "@/components/LiveMap";
import { OV_TABS, OversightShell, ovHref } from "@/components/OversightShell";
import { ErrorState, LoadingState, PageHeader, SeverityBadge, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { canOpen, useUser } from "@/lib/auth";
import { STATUS_LABEL, dmy, fmtN, pct, typeLabel } from "@/lib/format";
import { useFetch, useLive } from "@/lib/live";
import { OvStat, THEAD, TROW, TableBox } from "../parts";

const STATE: Record<string, { label: string; tone: Tone; color: string }> = {
  open: { label: "Open", tone: "red", color: "#DC2626" },
  acknowledged: { label: "Acknowledged", tone: "amber", color: "#D97706" },
  actioned: { label: "Action recorded", tone: "green", color: "#059669" },
};
const LANE_TONE: Record<string, Tone> = { in_lane: "amber", review: "purple", reported: "green" };
const LANE_STATUS: Record<string, string> = { in_lane: "In the lane", review: "Examiner review", reported: "Report issued", decided: "Decisions made" };
const VERDICT_TONE: Record<string, Tone> = { PASS: "green", FAIL: "red", CONDITIONAL: "amber", REFERRED: "blue" };
const KIND_ICON: Record<string, string> = { integrity: "examiner", equipment: "wrench", capacity: "calendar", audit: "shield" };

/** One exception: why it was raised, the evidence, where to look, and the actions HQ can record. */
function ExceptionCard({ x, canAct, onDone, first }: { x: any; canAct: boolean; onDone: (x: any) => void; first: boolean }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const st = STATE[x.state.status] || STATE.open;
  const open = x.state.status === "open";
  const accent = open ? (x.severity === "critical" ? "#DC2626" : "#D97706") : "#059669";
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
    <article className="relative overflow-hidden rounded-2xl border border-white/80 bg-white/75 p-4 pl-5 shadow-glass">
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: accent }} aria-hidden />
      <div className="flex flex-wrap items-start gap-3">
        <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl sm:flex" style={{ background: accent + "14", boxShadow: `inset 0 0 0 1px ${accent}33` }}>
          <Icon name={KIND_ICON[x.kind] || "flag"} size={20} color={accent} width={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge s={x.severity} />
            <StatusPill tone={st.tone} dot>{st.label}</StatusPill>
            <span className="text-[12px] text-fg-3">{x.where}</span>
          </div>
          <h3 className="mt-1.5 text-[15.5px] font-bold leading-snug tracking-tight">{x.title}</h3>
          <p className="mt-1 text-[13.5px] text-fg-2">{x.reason}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">{x.provenance.map(([k, t]: string[]) => <Source key={k + t} kind={k} text={t} />)}</div>
      </div>
      {x.evidence?.length > 0 && (
        <ul className="mt-3 flex flex-col gap-0.5 rounded-xl bg-[#F4F7FB] px-3 py-2 font-mono text-[11.5px] text-fg-3 sm:ml-14">
          {x.evidence.map((e: string) => <li key={e} className="break-words">{e}</li>)}
          {x.evidence_count > x.evidence.length && <li className="font-sans">… {x.evidence_count - x.evidence.length} more</li>}
        </ul>
      )}
      {!open && (
        <p className="mt-2 text-[12.5px] sm:ml-14" style={{ color: st.color }}>
          {x.state.label} by {x.state.by} · {new Date(x.state.at).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          {x.state.note ? <span className="text-fg-3"> · “{x.state.note}”</span> : null}
          <span className="text-fg-4"> · evidence entry #{x.state.chain_seq}{x.state.mock ? " · mock: nothing was sent" : ""}</span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 sm:ml-14">
        <Link className="btn btn-sm" href={ovHref(x.href)} scroll={false}>Show the evidence<Icon name="arrow" size={13} /></Link>
        {canAct && open && (
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

/** A time this server recorded (UTC), as 24-hour Malaysia time. */
const hhmm = (iso: string) => new Date(iso + (/Z|[+-]\d\d:\d\d$/.test(iso) ? "" : "Z")).toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function HQ() {
  const router = useRouter();
  const sp = useSearchParams();
  const user = useUser();
  // only an account that may open HQ asks for its data (the shell tells the others it is not theirs)
  const ok = !!user && canOpen(user.role, OV_TABS.find((t) => t.href === "/oversight/hq")!.roles);
  const hq = (path: string) => (ok ? path : null);
  const exc = useFetch<any>(hq("/api/hq/exceptions"));
  const integ = useFetch<any>(hq("/api/hq/integrity"));
  const eq = useFetch<any>(hq("/api/hq/equipment"));
  const [branch, setBranch] = useState("BR00");
  const dem = useFetch<any>(hq("/api/hq/demand"), { branch_id: branch });
  const audit = useFetch<any>(hq("/api/hq/audit"));
  const ops = useFetch<any>(hq("/api/hq/ops"));
  const branches = useFetch<any[]>(hq("/api/branches"));
  const [devIdx, setDevIdx] = useState(0);
  const [tamper, setTamper] = useState<any>(null);
  const [examinerSel, setExaminerSel] = useState<string | null>(null);
  const [hub, setHub] = useState<string | null>(null);
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
    router.replace("/oversight/hq#exceptions", { scroll: false });
  };
  const X = exc.data;
  const openN = X ? X.items.filter((i: any) => i.state.status === "open").length : 0;
  // decisions and reports made on other screens add evidence entries: keep the audit and the counts current
  useLive(["inspections"], () => {
    if (!ok) return;
    audit.reload();
    ops.reload();
  });
  useEffect(() => {
    if (!ok) return;
    const t = setInterval(() => {
      audit.reload();
      ops.reload();
    }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok]);

  const I = integ.data;
  const light = (I?.examiners || []).filter((e: any) => e.vehicle_class === "heavy");
  const flagged = new Set(I?.flagged || []);
  const dev = eq.data?.devices?.[devIdx];
  const D = dem.data;
  const lanes: any[] = ops.data?.lanes || [];
  const running = lanes.filter((l) => l.status === "in_lane").length;
  const liveTotal = ops.data ? (Object.values(ops.data.inspections_by_status) as number[]).reduce((a, b) => a + b, 0) : null;
  const shownLanes = hub ? lanes.filter((l) => l.branch_id === hub) : lanes;
  const eqLow = eq.data ? eq.data.devices.filter((d: any) => d.health < 50).length : 0;

  // the hubs on the map: size by lanes, colour by what their lanes are doing now
  const hubPoints = useMemo<MapPoint[]>(() => (branches.data || []).filter((b: any) => b.lat != null).map((b: any) => {
    const mine = lanes.filter((l) => l.branch_id === b.branch_id);
    const inLane = mine.filter((l) => l.status === "in_lane").length;
    const review = mine.filter((l) => l.status === "review").length;
    const color = inLane ? "#D97706" : review ? "#7C3AED" : mine.length ? "#059669" : "#64748B";
    return {
      id: b.branch_id, layer: "hubs", lat: b.lat, lon: b.lon, color, shape: inLane ? "pulse" : "hub", radius: 5 + Math.min(4, b.lanes / 2),
      title: b.name, label: b.branch_id === hub ? b.name : undefined,
      lines: [`${b.state} · ${b.lanes} lanes${b.heavy_capable ? " · heavy vehicles" : ""}`,
        mine.length ? `Today: ${inLane} in lane · ${review} in review · ${mine.length - inLane - review} reported` : "No lane inspection today"],
    } as MapPoint;
  }), [branches.data, lanes, hub]);

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
    <OversightShell>
      <PageHeader eyebrow="Oversight · HQ operations" title="HQ operations"
        sub="Exceptions first: what needs an operations decision across every hub. Below them: lanes, examiner integrity, demand, equipment and the audit log."
        actions={<><Source kind="synthetic" text="History: 80 examiners, 20 hubs" /><a className="btn" href="#lanes"><Icon name="map" size={16} />Lanes and hubs</a></>} />

      {/* one row of six from xl; every tile names how its number is produced (the panels below carry the detail) */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <OvStat icon="flag" tone={openN ? "red" : "green"} alert={!!openN} label="Open exceptions" value={X ? openN : "…"} sub={X ? `of ${X.items.length} raised` : "Checking every hub"}
          source={<Source kind="live_logic" />} href="#exceptions" />
        <OvStat icon="lane" tone="amber" label="Lanes running" value={ops.data ? running : "…"} sub={ops.data ? `${lanes.length} lanes with an inspection today` : ""}
          source={<Source kind="live_logic" />} href="#lanes" />
        <OvStat icon="examiner" tone={I?.flagged.length ? "red" : "green"} alert={!!I?.flagged.length} label="Flagged examiners" value={I ? I.flagged.length : "…"} sub={I ? I.flagged.join(", ") || "none" : ""}
          source={<Source kind="live_model" />} href="#integrity" />
        <OvStat icon="wrench" tone={eqLow ? "red" : "green"} alert={!!eqLow} label="Equipment below 50% health" value={eq.data ? eqLow : "…"} sub="of all lane devices"
          source={<Source kind="live_model" />} href="#equipment" />
        <OvStat icon="calendar" tone={D?.summary.days_over_capacity ? "amber" : "green"} alert={!!D?.summary.days_over_capacity} label="Days over capacity" value={D ? D.summary.days_over_capacity : "…"}
          sub={D ? `${D.branch} · ${D.summary.extra_slots_needed} extra slots in 14 days` : ""} source={<Source kind="live_model" />} href="#demand" />
        <OvStat icon="shield" tone={audit.data && !audit.data.verify.intact ? "red" : "green"} alert label="Evidence chain" value={audit.data ? (audit.data.verify.intact ? "Intact" : "Broken") : "…"}
          sub={audit.data ? `${fmtN(audit.data.verify.checked)} entries re-verified` : ""} source={<Source kind="live_logic" />} href="#audit" />
      </div>

      <section id="exceptions" className="mb-5 scroll-mt-24" aria-label="Exceptions">
        <Panel title={<h2 className="text-[20px] font-bold tracking-tight">Exceptions {X ? <span className="text-[15px] font-medium text-fg-3">· {openN} open of {X.items.length}</span> : null}</h2>}
          action={<span className="text-[12px] text-fg-3">{X?.note}</span>}>
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
        </Panel>
      </section>

      <div id="lanes" className="mb-5 grid scroll-mt-24 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Lanes across hubs" sub={`${liveTotal ?? "…"} live inspections${ops.data ? ` · ${Object.entries(ops.data.inspections_by_status).map(([k, v]) => `${v} ${STATUS_LABEL[k]?.toLowerCase() || k}`).join(" · ")}` : ""}`}
          action={<>{hub && <button className="chip border-cyan/50 text-cyan" onClick={() => setHub(null)}>{names[hub] || hub} ✕</button>}<Source kind="live_logic" text="Live inspections" /></>}>
          {!ops.data ? <LoadingState label="Loading the lanes…" rows={3} /> : !shownLanes.length ? <p className="text-[13px] text-fg-3">No lane has run yet today. Start a use case from the demo control to see one here.</p> : (
            <TableBox className="max-h-[420px]">
              <table className="w-full min-w-[600px] whitespace-nowrap text-[13px]">
                <thead className={THEAD}><tr><th>Hub and lane</th><th>Vehicle · started</th><th>Status</th><th className="!text-right">Health</th><th>Result</th><th></th></tr></thead>
                <tbody>
                  {shownLanes.map((l: any) => (
                    <tr key={l.lane_id} className={TROW}>
                      <td><button className="block text-left font-medium hover:text-cyan" onClick={() => setHub(l.branch_id)} title="Show this hub only">{l.branch}</button><span className="text-[11.5px] text-fg-3">Lane {l.lane_id.split("-L")[1]}</span></td>
                      <td><b>{l.plate}</b><span className="block text-[11.5px] tabular-nums text-fg-3">{hhmm(l.started_at)}</span></td>
                      <td><StatusPill tone={LANE_TONE[l.status] || "gray"} dot>{LANE_STATUS[l.status] || STATUS_LABEL[l.status] || l.status}</StatusPill></td>
                      <td className="text-right tabular-nums">{l.health ?? "–"}</td>
                      <td>{l.verdict ? <StatusPill tone={VERDICT_TONE[l.verdict] || "gray"}>{l.verdict}</StatusPill> : <span className="text-fg-4">–</span>}</td>
                      <td><span className="flex gap-1.5"><Link className="btn btn-sm" href={`/lane?lane=${l.lane_id}`}>Lane</Link><Link className="btn btn-sm" href={`/inspection/${l.inspection_id}`}>Inspection</Link></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableBox>
          )}
          <p className="mt-2 text-[11.5px] text-fg-4">The latest inspection on each lane. A hub&apos;s own examiners see only their hub; HQ sees them all.</p>
        </Panel>
        <Panel title="Hubs on the map" sub="Click a hub to list its lanes" action={<><Source kind="synthetic" text="Hub locations: fictional" /><Source kind="live_logic" text="Lane status" /></>}>
          <LiveMap label="Inspection hubs and what their lanes are doing" points={hubPoints} className="h-[340px] xl:h-[380px] 2xl:h-[420px]"
            views={[{ id: "kv", label: "Klang Valley", bounds: [[2.85, 101.35], [3.4, 101.85]] }, { id: "my", label: "Malaysia", bounds: [[0.85, 99.6], [7.45, 119.3]] }]}
            selected={hub ? keyOf({ layer: "hubs", id: hub }) : null} onSelect={(p) => setHub((h) => (h === p.id ? null : p.id))}
            legend={[{ label: "Lane in use", color: "#D97706", shape: "pulse" }, { label: "In review", color: "#7C3AED", shape: "hub" }, { label: "Reported", color: "#059669", shape: "hub" }, { label: "No inspection today", color: "#64748B", shape: "hub" }]} />
        </Panel>
      </div>

      {/* the two panels differ in height: each keeps its own, no stretched blank card */}
      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
        <Panel className="scroll-mt-24" title={<h2 id="integrity" className="scroll-mt-24 text-[18px] font-bold tracking-tight">Examiner integrity · heavy vehicles</h2>} action={<Source kind="live_model" text="z-score + Isolation Forest" />}>
          {!I ? <LoadingState label="Comparing every examiner with their peers…" rows={4} /> : (
            <>
              <Scatter height={260} xLabel="Pass rate (heavy vehicles)" yLabel="Passes that conflict with the sensor evidence"
                xFmt={(v) => pct(v)} yFmt={(v) => pct(v)}
                points={light.map((e: any) => ({ x: e.pass_rate, y: e.conflict_rate, color: flagged.has(e.examiner_id) ? "#DC2626" : "#3B82F6", r: flagged.has(e.examiner_id) ? 7 : 4.5, label: flagged.has(e.examiner_id) ? e.examiner_id : undefined, title: `${e.examiner_id} ${e.name}: pass ${pct(e.pass_rate)}, z ${e.z_pass}` }))} />
              <TableBox className="mt-3 max-h-[300px]">
                <table className="w-full whitespace-nowrap text-[13px]">
                  <thead className={THEAD}><tr><th>Examiner</th><th>Class</th><th className="!text-right">Inspections</th><th className="!text-right">Pass rate</th><th className="!text-right">z</th><th className="!text-right">Conflicts</th><th></th></tr></thead>
                  <tbody>
                    {I.examiners.filter((e: any) => e.outlier).map((e: any, i: number) => (
                      <tr key={i} className={`${TROW} ${examinerSel === e.examiner_id ? "bg-blue-50/70" : ""}`}>
                        <td><b>{e.examiner_id}</b> {e.name}</td><td>{e.vehicle_class}</td><td className="text-right tabular-nums">{e.n}</td><td className="text-right tabular-nums">{pct(e.pass_rate)}</td>
                        <td className="text-right font-semibold tabular-nums text-bad">{e.z_pass.toFixed(1)}σ</td><td className="text-right tabular-nums">{pct(e.conflict_rate, 1)}</td>
                        <td><button className="btn btn-sm" onClick={() => setExaminerSel(e.examiner_id)}>Evidence</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableBox>
              {examinerSel && (
                <div className="fade-in mt-3 max-h-56 overflow-auto rounded-xl border border-red-100 bg-red-50/40 p-3 text-[12.5px]">
                  <div className="mb-1.5 font-semibold">Passes by {examinerSel} that breach a fail threshold</div>
                  {I.evidence.filter((x: any) => x.examiner_id === examinerSel).map((x: any) => (
                    <div key={x.inspection_id} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-t border-red-100 py-1.5"><span>{x.date} · {x.inspection_id} · {typeLabel(x.inspection_type)}</span><span className="text-fg-3">brake {x.brake_efficiency_pct ?? "–"}% · tread {x.tyre_tread_min_mm ?? "–"} mm · smoke {x.smoke_opacity_pct ?? "–"}%</span></div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11.5px] text-fg-4">{I.method}</p>
            </>
          )}
        </Panel>
        <Panel title={<h2 className="scroll-mt-24 text-[18px] font-bold tracking-tight" id="demand">Demand vs lane capacity · next 14 days</h2>} action={
          <select aria-label="Branch" className="input max-w-full py-1.5" value={branch} onChange={(e) => setBranch(e.target.value)}>
            {(branches.data || []).map((b) => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
          </select>}>
          {!D ? <LoadingState label="Forecasting demand…" rows={4} /> : (
            <>
              <Bars height={200} values={[...D.recent.slice(-14).map((r: any) => r.demand), ...D.forecast.map((f: any) => f.demand)]}
                secondary={[...D.recent.slice(-14).map((r: any) => r.capacity), ...D.forecast.map((f: any) => f.capacity)]}
                labels={[...D.recent.slice(-14).map((r: any) => r.date.slice(8)), ...D.forecast.map((f: any) => f.date.slice(8))]}
                color="#3B82F6" />
              <div className="mt-1 flex flex-wrap items-center gap-3 text-[11.5px] text-fg-3">
                <span>Bars: booking requests (last 14 days actual, next 14 forecast)</span><span className="text-bad">Red line: lane capacity</span>
                <Source kind="live_model" text="LightGBM forecast" />
              </div>
              <div className="mt-3 rounded-xl bg-[#F4F7FB] p-3 text-[13px]">
                {D.summary.roster.length ? (
                  <>
                    <b>Roster suggestion:</b> {D.summary.roster.map((r: any) => `${dmy(r.date)} +${r.extra_lane_shifts} lane shift(s) (${r.extra_slots} slots)`).join(" · ")}
                  </>
                ) : "Forecast demand fits within capacity for the next 14 days."}
              </div>
            </>
          )}
        </Panel>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Panel title={<h2 className="scroll-mt-24 text-[18px] font-bold tracking-tight" id="equipment">Lane equipment health</h2>} action={<Source kind="live_model" text="Isolation Forest + trend" />}>
          {!eq.data && <LoadingState label="Checking lane devices…" rows={4} />}
          <div className="flex max-h-[360px] flex-col gap-1.5 overflow-auto pr-1">
            {(eq.data?.devices || []).slice(0, 14).map((d: any, i: number) => {
              const c = d.health < 50 ? "#DC2626" : d.health < 75 ? "#D97706" : "#059669";
              return (
                <button key={i} onClick={() => setDevIdx(i)} aria-pressed={devIdx === i}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[12.5px] transition ${devIdx === i ? "bg-white shadow-glass ring-1 ring-blue-200" : "bg-white/50 ring-1 ring-ink-600/70 hover:bg-white"}`}>
                  <span className="min-w-0 flex-1"><b className="block sm:truncate">{names[d.branch_id] || d.branch_id} · lane {d.lane}</b><span className="block text-fg-3 sm:truncate">{d.device.replaceAll("_", " ")}</span></span>
                  <span className="h-1.5 w-14 overflow-hidden rounded-full bg-[#E8EEF7]" aria-hidden><span className="block h-1.5 rounded-full" style={{ width: `${d.health}%`, background: c }} /></span>
                  <span style={{ color: c }} className="w-7 text-right font-bold">{d.health}</span>
                </button>
              );
            })}
          </div>
        </Panel>
        <Panel title={dev ? `${names[dev.branch_id] || dev.branch_id} lane ${dev.lane} · ${dev.device.replaceAll("_", " ")} · vibration (g RMS)` : "Equipment"} action={<Source kind="simulated" text="Telemetry: simulated" />}>
          {dev && (
            <>
              <LineChart height={240} yFmt={(v) => v.toFixed(2)}
                hlines={[{ y: dev.vibration_limit_g, color: "#DC2626", label: `limit ${dev.vibration_limit_g} g` }]}
                xLabels={dev.series.filter((_: any, i: number) => i % 10 === 0).map((p: any) => ({ x: dev.series.indexOf(p), label: p.date.slice(5) }))}
                series={[{ color: "#2563EB", dots: false, points: dev.series.map((p: any, i: number) => ({ x: i, y: p.vibration })) }]} />
              <p className="mt-2 text-[13px]">
                Health <b>{dev.health}</b> · trend {dev.trend_g_per_day > 0 ? "+" : ""}{dev.trend_g_per_day} g/day ·{" "}
                {dev.service_by ? (dev.days_to_limit <= 0
                  ? <b className="text-bad">already over the limit · service now and re-check the lane&apos;s recent results</b>
                  : <b className="text-warn">service by {dmy(dev.service_by)} ({dev.days_to_limit} days to the limit)</b>) : "no service needed on the current trend"}
              </p>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Evidence audit" action={<><Source kind="live_logic" text="SHA-256 hash chain" /><button className="btn btn-sm btn-primary" disabled={busy} onClick={runTamper}>{busy ? "Testing…" : "Run tamper test"}</button></>}>
        <div id="audit" className="mb-3 flex scroll-mt-24 flex-wrap items-center gap-3 text-[13px]">
          <StatusPill tone={audit.data?.verify.intact ? "green" : "red"} dot>{audit.data?.verify.intact ? "All records intact" : "Chain broken"}</StatusPill>
          <span className="break-all text-fg-3">{fmtN(audit.data?.verify.checked)} entries · head <span className="font-mono">{audit.data?.verify.head?.slice(0, 16)}…</span></span>
          {tamper && (
            <span className={tamper.detected ? "text-ok" : "text-bad"}>
              Test: edited entry #{tamper.edited_seq} directly in the database → verification {tamper.detected ? `failed at #${tamper.verify_after_edit.broken_at_seq} (${tamper.verify_after_edit.reason})` : "did not notice"}; restored → {tamper.verify_after_restore.intact ? "intact again" : "still broken"}.
            </span>
          )}
        </div>
        <TableBox className="max-h-80">
          <table className="w-full whitespace-nowrap text-[12.5px]">
            <thead className={THEAD}><tr><th className="!text-right">#</th><th>Time (UTC)</th><th>Kind</th><th>Inspection</th><th>Actor</th><th>Hash</th></tr></thead>
            <tbody>
              {(audit.data?.recent || []).slice().reverse().map((e: any) => (
                <tr key={e.seq} className={`${TROW} [&>td]:py-1.5`}><td className="text-right font-semibold tabular-nums">{e.seq}</td><td className="tabular-nums">{e.ts.slice(0, 19).replace("T", " ")}</td><td>{e.kind}</td><td>{e.inspection_id || "–"}</td><td>{e.actor}</td><td className="font-mono text-fg-3">{e.hash.slice(0, 16)}…</td></tr>
              ))}
            </tbody>
          </table>
        </TableBox>
      </Panel>
    </OversightShell>
  );
}

export default function Page() {
  return <Suspense><HQ /></Suspense>;
}
