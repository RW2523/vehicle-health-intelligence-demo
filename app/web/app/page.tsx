"use client";
/* The inspector dashboard: today at the hub in a few seconds. The day's numbers on top, the running guided demo and its
   vehicle when there is one, the four lanes (each with its vehicle, where it is, the most serious finding so far and the
   one thing to do), then the queue, the vehicles still to come and what just happened. */
import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { ApptPhoto } from "@/components/appointments";
import { UseCase, useActiveUseCase } from "@/components/Demo";
import { IconTile, ProgressBar, SegmentRing, TONE, Tone } from "@/components/glass";
import { Icon } from "@/components/icons";
import { LiveLaneStrip } from "@/components/LiveLaneView";
import { Shell } from "@/components/Shell";
import { ErrorState, LoadingState, Source } from "@/components/ui";
import { VehicleImage } from "@/components/VehicleImage";
import { useUser } from "@/lib/auth";
import { laneOf } from "@/lib/format";
import { useFetch, useLive } from "@/lib/live";
import { SEVERITY, alertSeverity } from "@/lib/present";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  in_queue: { label: "In queue", tone: "blue" }, scheduled: { label: "Scheduled", tone: "gray" }, in_progress: { label: "In lane", tone: "amber" },
  completed: { label: "Completed", tone: "green" },
};
const ACT: Record<string, { icon: string; tone: Tone }> = {
  completed: { icon: "checkc", tone: "green" }, started: { icon: "clock", tone: "amber" }, queued: { icon: "doc", tone: "blue" },
  live: { icon: "bolt", tone: "purple" },
};
const RESULT: Record<string, { label: string; tone: Tone }> = {
  PASS: { label: "Passed", tone: "green" }, PASS_ADVISORY: { label: "Passed · advisory", tone: "amber" }, FAIL: { label: "Failed", tone: "red" },
  CONDITIONAL: { label: "Conditional", tone: "amber" }, REFERRED: { label: "Referred", tone: "blue" },
};
/** A live inspection's state, in the words of the inspection screens. */
const LIVE_STATUS: Record<string, { label: string; tone: Tone }> = {
  in_lane: { label: "In the lane", tone: "purple" }, review: { label: "Awaiting the examiner", tone: "amber" },
  decided: { label: "Decisions made", tone: "blue" }, reported: { label: "Report issued", tone: "green" },
};
const greeting = (h: number) => (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
const today = () => new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Kuala_Lumpur", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const vehicleHref = (plate: string) => `/vehicles/${encodeURIComponent(plate)}`;

/** A state in coloured text with a dot: quieter than a pill, never colour alone. */
function Dot({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  const t = TONE[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold ${className}`} style={{ color: t.fg }}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.solid }} aria-hidden />{children}
    </span>
  );
}

/** One of the day's five numbers: compact, and a link to the list behind it. */
function Kpi({ icon, tone, label, value, delta, deltaTone = "green", sub, href, className = "" }: {
  icon: string; tone: Tone; label: string; value: ReactNode; delta?: string; deltaTone?: Tone; sub?: string; href: string; className?: string;
}) {
  return (
    <Link href={href} className={`card flex min-w-0 flex-col ${className} px-3.5 py-2.5 transition hover:-translate-y-0.5 hover:shadow-lg sm:px-4 sm:py-3`}>
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-fg-3">
        <Icon name={icon} size={14} width={2.2} color={TONE[tone].solid} /><span className="truncate">{label}</span>
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <b className="text-[26px] font-bold leading-tight tracking-tight">{value}</b>
        {delta && <span className="whitespace-nowrap text-[12.5px] font-semibold" style={{ color: TONE[deltaTone].fg }}>{delta}</span>}
      </span>
      {sub && <span className="truncate text-[12px] text-fg-4">{sub}</span>}
    </Link>
  );
}

/** The running guided demo: the scenario, its vehicle, where it is and the one next step. */
function DemoNow({ uc, veh }: { uc: UseCase; veh: any }) {
  const total = uc.steps.length;
  const at = Math.min(uc.done + 1, total);
  const n = uc.next;
  const href = uc.complete || !n ? "/demo#usecases" : n.href;
  return (
    <section aria-label="Guided demo" className="card mb-4 flex flex-col gap-3 border-blue-100 bg-gradient-to-r from-blue-50/95 via-white/85 to-white/70 p-3 sm:flex-row sm:items-center sm:gap-5 sm:p-4">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        {uc.plate && (
          <span className="relative shrink-0">
            {veh?.photo ? <VehicleImage plate={uc.plate} vtype={veh.vtype} photo={veh.photo} size="480" className="h-[68px] w-[104px] rounded-xl sm:h-[84px] sm:w-[132px]" />
              : <ApptPhoto plate={uc.plate} vtype={veh?.vtype} className="h-[68px] w-[104px] rounded-xl sm:h-[84px] sm:w-[132px]" />}
            <span className="absolute bottom-1.5 left-1.5 rounded-md bg-[#0F172A]/85 px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wider text-white">{uc.plate}</span>
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[#1D4ED8]">Guided demo · {uc.id}</div>
          <h2 className="text-[17px] font-bold leading-snug tracking-tight sm:text-[19px]">{uc.title}</h2>
          <div className="truncate text-[13px] text-fg-3">{uc.plate ? `${uc.plate} · ` : ""}{uc.vehicle}</div>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="flex shrink-0 gap-1" aria-hidden>
              {uc.steps.map((s) => <span key={s.id} className={`h-1.5 w-4 rounded-full ${s.done ? "bg-ok" : s.current ? "bg-cyan" : "bg-ink-600"}`} />)}
            </span>
            <span className="min-w-0 text-[13px] font-semibold leading-snug text-fg-2 sm:truncate">
              {uc.complete ? `All ${total} steps done` : `Step ${at} of ${total}${n ? ` · ${n.label}` : ""}`}
            </span>
          </div>
        </div>
      </div>
      <Link className="btn btn-primary btn-lg w-full shrink-0 sm:w-auto" href={href}>
        {uc.complete ? "Back to the scenarios" : n?.cta || "Continue"}<Icon name="arrow" size={15} color="#fff" />
      </Link>
    </section>
  );
}

/** The most serious finding of a live inspection so far (open first), as the API reports it. */
function TopFinding({ f, status }: { f: any; status: string }) {
  if (!f || !f.findings) {
    return <p className="truncate text-[12.5px] text-fg-3">{status === "in_lane" ? "No findings so far" : "No findings"}</p>;
  }
  if (!f.top?.open) {
    return <p className="flex items-center gap-1.5 truncate text-[12.5px] text-fg-2"><Icon name="checkc" size={14} color="#059669" />All {f.findings} finding{f.findings === 1 ? "" : "s"} decided</p>;
  }
  const s = SEVERITY[alertSeverity(f.top)];
  return (
    <div className="min-w-0 rounded-lg px-2 py-1 leading-tight" style={{ background: s.color + "10" }} title={f.top.title}>
      <span className="flex items-center gap-1.5 text-[12px]">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
        <b style={{ color: s.color }}>{s.label}</b>
        <span className="text-fg-3">· {f.open} open finding{f.open === 1 ? "" : "s"}</span>
      </span>
      <span className="block truncate text-[13px] font-semibold text-fg">{f.top.title}</span>
    </div>
  );
}

const CTA = "flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-50 py-2 text-[13px] font-semibold text-[#1D4ED8] ring-1 ring-blue-100 transition hover:bg-blue-100";

function LaneCard({ ln, canRun, demo }: { ln: any; canRun: boolean; demo: boolean }) {
  const v = ln.vehicle;
  if (!v) {
    const other = ln.next || ln.last;
    return (
      <div className="flex h-full flex-col rounded-2xl border border-dashed border-ink-500 bg-white/40 p-3.5">
        <div className="flex items-center justify-between gap-2"><b className="text-[14.5px]">Lane {ln.lane}</b><Dot tone="gray">Idle</Dot></div>
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-6 text-center">
          <Icon name="car" size={34} width={1.2} color="#94A3B8" />
          <span className="text-[13.5px] font-medium text-fg-3">Waiting for vehicle…</span>
        </div>
        {other && (
          <Link href={vehicleHref(other.plate)} className="flex items-center gap-2.5 rounded-xl bg-white/80 p-2 ring-1 ring-ink-600/60 transition hover:ring-blue-200">
            <VehicleImage plate={other.plate} vtype={other.vtype} photo={other.photo} size="480" className="h-10 w-14 shrink-0 rounded-lg" />
            <span className="min-w-0 leading-tight">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-fg-4">{ln.next ? `Next · ${ln.next.start_at}` : `Last · ${ln.last.end_at}`}</span>
              <b className="block truncate text-[13px]">{other.plate}</b>
              <span className="block truncate text-[12px] text-fg-3">{ln.next ? `${other.make} ${other.model}` : RESULT[ln.last.result]?.label}</span>
            </span>
          </Link>
        )}
      </div>
    );
  }
  const live = !!ln.live;
  // a lane-replay vehicle on its lane, waiting for its replay to be started
  const ready = !live && ln.state === "preparing" && !!ln.replay;
  const st = live ? LIVE_STATUS[v.status] || { label: v.status, tone: "gray" as Tone }
    : ready ? { label: "Ready for the replay", tone: "amber" as Tone }
    : ln.state === "operation" ? { label: "In operation", tone: "green" as Tone } : { label: "Preparing", tone: "amber" as Tone };
  const verdict = live && v.verdict ? RESULT[v.verdict] : null;
  const cta = live ? { href: `/inspection/${v.inspection_id}`, label: "Open Inspection", icon: "clipboard" }
    : ready && canRun ? { href: `/inspection/${ln.replay}`, label: "Start the replay", icon: "play" }
    : { href: vehicleHref(v.plate), label: "Open vehicle", icon: "car" };
  // a replay lane follows its vehicle through the stations live (the hub is BR00: "BR00-L3")
  const laneId = live || ready ? laneOf(live ? v.session_id : ln.replay) || `BR00-L${ln.lane}` : null;
  const showPct = live || ln.state === "operation";
  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-2xl border bg-white/75 shadow-glass ${demo ? "border-blue-300 ring-2 ring-blue-200/70" : "border-white/80"}`}>
      {/* a phone: the photo as a thumbnail beside the plate; wider: the photo on top */}
      <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-3 p-3 pb-2 sm:grid-cols-1 sm:p-0">
        <div className="relative h-[68px] overflow-hidden rounded-xl bg-gradient-to-b from-[#F1F5FB] to-[#DEE6F2] sm:aspect-[16/9] sm:h-auto sm:rounded-none">
          <VehicleImage plate={v.plate} vtype={v.vtype} photo={v.photo} className="h-full w-full" />
          <b className="absolute left-1.5 top-1.5 whitespace-nowrap rounded-full bg-white/90 px-2 py-0.5 text-[11.5px] shadow-sm backdrop-blur sm:left-2.5 sm:top-2.5 sm:px-2.5 sm:text-[12.5px]">Lane {ln.lane}{live && <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-[#6D28D9]">· live</span>}</b>
        </div>
        <div className="min-w-0 sm:px-3.5 sm:pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <b className="truncate text-[18px] font-bold tracking-tight">{v.plate}</b>
            {showPct && <span className="shrink-0 text-[15px] font-bold text-fg-2" aria-label={`${ln.progress}% done`}>{ln.progress}%</span>}
          </div>
          <span className="block truncate text-[13px] leading-tight text-fg-2">{v.make} {v.model}</span>
          <span className="block truncate text-[12px] leading-tight text-fg-3" title={v.inspection_type}>{v.inspection_type}</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-3 pb-3 sm:px-3.5 sm:pb-3.5 sm:pt-1">
        <div>
          {laneId ? <LiveLaneStrip lane={laneId} seed={live ? { inspection_id: v.inspection_id, step: v.step, status: v.status } : null} />
            : <ProgressBar value={ln.state === "operation" ? ln.progress : 2} tone={ln.state === "operation" ? "blue" : "gray"} />}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <Dot tone={st.tone}>{st.label}</Dot>
          {verdict && <Dot tone={verdict.tone}>{verdict.label}</Dot>}
          {!live && !ready && <span className="truncate text-[12px] text-fg-3">{ln.note}</span>}
        </div>
        <div className="flex min-h-[40px] flex-col justify-center">
          {live ? <TopFinding f={v.findings} status={v.status} />
            : ready ? <p className="truncate text-[12.5px] text-fg-3">No findings yet</p>
            : <p className="truncate text-[12.5px] text-fg-3">Planned vehicle · no live readings</p>}
        </div>
        <div className="mt-auto pt-1.5"><Link href={cta.href} className={CTA}><Icon name={cta.icon} size={14} />{cta.label}</Link></div>
      </div>
    </div>
  );
}

/** A vehicle of the day in the lower panels: photo, plate, what and when, and its state. */
function DayRow({ x, href, when, sub, state }: { x: any; href: string; when: string; sub?: string; state: ReactNode }) {
  return (
    <li className="border-t border-ink-600/50 first:border-0">
      <Link href={href} className="flex items-center gap-3 rounded-xl px-1 py-2 transition hover:bg-white/70">
        <VehicleImage plate={x.plate} vtype={x.vtype} photo={x.photo} size="480" className="h-9 w-[52px] shrink-0 rounded-lg" />
        <span className="min-w-0 flex-1 leading-tight">
          <b className="block whitespace-nowrap text-[13.5px]">{x.plate}</b>
          <span className="block truncate text-[12px] text-fg-3" title={x.inspection_type}>{x.make} {x.model} · {x.inspection_type}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 leading-tight">
          <span className="text-[12.5px] font-semibold text-fg-2">{when}{sub && <span className="font-normal text-fg-4"> · {sub}</span>}</span>
          {state}
        </span>
      </Link>
    </li>
  );
}

export default function Dashboard() {
  const user = useUser();
  const hub = "BR00";  // the demo hub: the ten main vehicles (other hubs are in oversight)
  const [tick, setTick] = useState(0);
  const [moreQueue, setMoreQueue] = useState(false);
  const d = useFetch<any>(user ? "/api/hub/today" : null, { branch_id: hub }, [tick]);
  const D = d.data;
  const anyLive = !!D?.lanes?.some((l: any) => l.live);
  // live lanes move: refresh their progress and findings often; the synthetic day only every 20 s
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), anyLive ? 5000 : 20000);
    return () => clearInterval(t);
  }, [anyLive]);
  useLive(["inspections"], () => setTick((x) => x + 1), !!user);
  const { active: uc } = useActiveUseCase();
  const guided = user?.role === "presenter" || user?.role === "viewer";
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", hour12: false }));
  const k = D?.kpis;
  const deltaPct = k && k.total_prev ? Math.round((100 * (k.total - k.total_prev)) / k.total_prev) : null;
  const queue = useMemo(() => (D?.queue || []).slice(0, moreQueue ? 50 : 4), [D, moreQueue]);
  // few vehicles still to come: the panel goes on with the latest finished ones, so the day reads in one place
  const earlier = D?.upcoming?.length ? (D.done || []).slice(0, Math.max(0, 6 - D.upcoming.length)) : [];
  const canRun = user?.role === "presenter" || user?.role === "examiner";
  const demoPlate = guided && uc && !uc.complete ? uc.plate : null;
  const ucVeh = uc?.plate && D
    ? [...D.lanes.map((l: any) => l.vehicle).filter(Boolean), ...D.queue, ...D.upcoming, ...D.done].find((x: any) => x.plate === uc.plate) : null;
  const u = D?.utilization;
  const lanes: any[] = D?.lanes || [];
  const laneSummary = lanes.some((l) => l.vehicle) ? [
    [lanes.filter((l) => l.live).length, "live"],
    [lanes.filter((l) => !l.live && l.state === "preparing" && l.replay).length, "ready for the replay"],
    [lanes.filter((l) => !l.live && l.vehicle && !(l.state === "preparing" && l.replay)).length, "planned"],
    [lanes.filter((l) => !l.vehicle).length, "idle"],
  ].filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(" · ") : "No active inspections.";
  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="eyebrow mb-1">{user ? `${greeting(hour)}, ${user.name.split(" ")[0]}` : "Welcome back"}</div>
          <h1 className="text-[28px] font-extrabold leading-[1.1] tracking-tight sm:text-[34px]">Inspector Dashboard</h1>
        </div>
        <div className="flex min-w-0 max-w-full items-center gap-2 text-[13px] text-fg-2">
          <Icon name="calendar" size={18} color="#475569" />
          <span className="min-w-0 leading-tight"><b className="text-fg">{today()}</b>{D && <> · {D.clock.time}<span className="block truncate text-[12px] text-fg-3 sm:inline"><span className="hidden sm:inline"> · </span>{D.branch.name}, {D.branch.state}</span></>}</span>
        </div>
      </div>

      {guided && uc && <DemoNow uc={uc} veh={ucVeh} />}

      {d.error && !D ? <ErrorState title="Today's overview could not load" onRetry={d.reload}>{d.error}</ErrorState> : !D ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="card px-4 py-3"><LoadingState label="" rows={2} /></div>)}
          </div>
          <div className="card p-5"><LoadingState label="Loading lane data…" rows={5} /></div>
        </>
      ) : (
        <>
          <div className="mb-2.5 flex flex-wrap items-center gap-2 text-[12.5px] text-fg-3">
            {D.clock.demo && <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-amber-800"><Icon name="clock" size={14} />{D.clock.note}</span>}
            <Source kind="synthetic" text="Today's plan: the ten main vehicles" />
            {D.live.length > 0 && <Source kind="live_model" text={`${D.live.length} live lane inspection${D.live.length === 1 ? "" : "s"} today`} />}
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-6 sm:gap-3 xl:grid-cols-5">
            <Kpi className="sm:col-span-2 xl:col-span-1" icon="car" tone="blue" label="Total Vehicles Today" value={k.total} delta={deltaPct != null ? `${deltaPct >= 0 ? "↑ +" : "↓ "}${deltaPct}%` : undefined}
              deltaTone={deltaPct != null && deltaPct < 0 ? "red" : "green"} sub={deltaPct != null ? "vs. previous day" : "on today's plan"} href="/inspection?tab=schedule" />
            <Kpi className="sm:col-span-2 xl:col-span-1" icon="checkc" tone="green" label="Completed" value={k.completed} delta={k.total ? `${Math.round((100 * k.completed) / k.total)}%` : undefined} sub="today" href="/inspection?tab=schedule&status=completed" />
            <Kpi className="sm:col-span-2 xl:col-span-1" icon="clock" tone="amber" label="In Progress" value={k.in_progress} sub="on a lane now" href="/inspection?tab=progress" />
            <Kpi className="sm:col-span-3 xl:col-span-1" icon="list" tone="gray" label="In Queue" value={k.in_queue} sub="waiting" href="/inspection?tab=schedule&status=in_queue" />
            <Kpi className="col-span-2 sm:col-span-3 xl:col-span-1" icon="warn" tone="red" label="Issues Found" value={k.issues} delta={k.issue_rate != null ? `${(k.issue_rate * 100).toFixed(1)}%` : undefined} deltaTone="red"
              sub={`of inspected · ${k.fails} failed`} href="/inspection?tab=reports" />
          </div>

          <section className="card mb-4 p-3.5 lg:p-4" aria-label="Inspection lanes">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h2 className="text-[18px] font-bold tracking-tight">Inspection Lanes</h2>
                <p className="text-[12.5px] text-fg-3">{laneSummary}</p>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex min-w-0 items-center gap-2.5" title="Lanes in operation, preparing and idle right now">
                  <SegmentRing size={42} stroke={6} parts={[{ value: u.operation, color: "#10B981" }, { value: u.preparing, color: "#F59E0B" }, { value: u.idle, color: "#CBD5E1" }]}>
                    <span className="text-[10.5px] font-bold">{u.pct}%</span>
                  </SegmentRing>
                  <span className="min-w-0 leading-tight">
                    <span className="block text-[13px] font-semibold">Lane Utilization</span>
                    <span className="block truncate text-[12px] text-fg-3">{u.operation} in operation · {u.preparing} preparing · {u.idle} idle</span>
                  </span>
                </div>
                <Link className="text-[13px] font-semibold text-cyan hover:underline" href="/lane">Live lane console</Link>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {D.lanes.map((ln: any) => <LaneCard key={ln.lane} ln={ln} canRun={canRun} demo={!!demoPlate && ln.vehicle?.plate === demoPlate} />)}
            </div>
          </section>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <section className="card p-3.5 lg:col-start-2 lg:row-start-1 lg:p-4" aria-label="Queue">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
                <h2 className="text-[16px] font-bold tracking-tight">{`Current Queue (${D.queue.length})`}</h2>
                <Link className="text-[13px] font-semibold text-cyan hover:underline" href="/inspection?tab=schedule&status=in_queue">View Queue</Link>
              </div>
              {!D.queue.length ? (
                <p className="flex items-center gap-2 py-2 text-[13px] text-fg-3"><Icon name="checkc" size={18} color="#10B981" />No vehicles waiting: every arrival is on a lane.</p>
              ) : (
                <ol className="flex flex-col">
                  {queue.map((q: any, i: number) => (
                    <li key={q.no} className="border-t border-ink-600/50 first:border-0">
                      <Link href={vehicleHref(q.plate)} className="flex items-center gap-3 rounded-xl px-1 py-2 transition hover:bg-white/70">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[12px] font-bold ring-1 ring-ink-600">{i + 1}</span>
                        <VehicleImage plate={q.plate} vtype={q.vtype} photo={q.photo} size="480" className="hidden h-9 w-[52px] shrink-0 rounded-lg sm:block" />
                        <span className="min-w-0 flex-1 leading-tight"><b className="block whitespace-nowrap text-[13.5px]">{q.plate}</b><span className="block truncate text-[12px] text-fg-3">{q.make} {q.model}</span></span>
                        <span className="shrink-0 text-right leading-tight">
                          {i === 0 && <span className="block text-[11.5px] font-bold uppercase tracking-wide text-[#1D4ED8]">Next</span>}
                          <span className="block whitespace-nowrap text-[12.5px] text-fg-3">{q.behind_replay ? `after ${q.behind_replay}'s replay` : `~ ${q.wait_min} min`}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
              {D.queue.length > 4 && (
                <button className="mt-1 flex w-full items-center justify-center gap-1 rounded-xl py-1.5 text-[12.5px] font-semibold text-[#1D4ED8] hover:bg-blue-50" onClick={() => setMoreQueue((m) => !m)}>
                  <Icon name={moreQueue ? "down" : "chev"} size={14} />{moreQueue ? "Show fewer" : `Show ${D.queue.length - 4} more`}
                </button>
              )}
            </section>

            <section className="card p-3.5 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:p-4" aria-label="Vehicles of the day">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
                <div className="min-w-0">
                  <h2 className="text-[16px] font-bold tracking-tight">{D.upcoming.length ? "Upcoming Vehicles" : "Today's Inspections"}</h2>
                  {!D.upcoming.length && <p className="text-[12.5px] text-fg-3">No more vehicles expected today: here is how the day went.</p>}
                </div>
                <Link className="text-[13px] font-semibold text-cyan hover:underline" href="/inspection?tab=schedule">{`View all (${D.upcoming.length || D.done.length})`}</Link>
              </div>
              {D.upcoming.length ? (
                <>
                  <ul>
                    {D.upcoming.slice(0, 6).map((x: any) => (
                      <DayRow key={x.no} x={x} href={vehicleHref(x.plate)} when={x.arrival_at} sub={x.source === "booking" ? "booked" : undefined}
                        state={<Dot tone={STATUS[x.status]?.tone || "gray"}>{STATUS[x.status]?.label || x.status}</Dot>} />
                    ))}
                  </ul>
                  {earlier.length > 0 && (
                    <>
                      <div className="mt-2 px-1 pb-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-fg-4">Earlier today</div>
                      <ul>
                        {earlier.map((x: any) => {
                          const r = RESULT[x.result] || { label: x.result || "–", tone: "gray" as Tone };
                          return <DayRow key={x.no} x={x} href={x.inspection_id ? `/inspection/${x.inspection_id}/review` : vehicleHref(x.plate)} when={x.end_at} sub={`lane ${x.lane}`} state={<Dot tone={r.tone}>{r.label}</Dot>} />;
                        })}
                      </ul>
                    </>
                  )}
                </>
              ) : !D.done.length ? <p className="py-2 text-[13px] text-fg-3">No inspections yet today.</p> : (
                <ul>
                  {D.done.slice(0, 8).map((x: any) => {
                    const r = RESULT[x.result] || { label: x.result || "–", tone: "gray" as Tone };
                    return <DayRow key={x.no} x={x} href={x.inspection_id ? `/inspection/${x.inspection_id}/review` : vehicleHref(x.plate)} when={x.end_at} sub={`lane ${x.lane}`} state={<Dot tone={r.tone}>{r.label}</Dot>} />;
                  })}
                </ul>
              )}
            </section>

            <section className="card p-3.5 lg:col-start-2 lg:row-start-2 lg:p-4" aria-label="Activity">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
                <h2 className="text-[16px] font-bold tracking-tight">Recent Activity</h2>
                <Link className="text-[13px] font-semibold text-cyan hover:underline" href="/inspection?tab=schedule&status=completed">View all</Link>
              </div>
              {!D.activity.length ? <p className="py-2 text-[13px] text-fg-3">No activity yet today.</p> : (
                <ul className="flex flex-col">
                  {D.activity.slice(0, 6).map((a: any, i: number) => (
                    <li key={i}>
                      <Link href={a.inspection_id ? `/inspection/${a.inspection_id}` : vehicleHref(a.plate)} className="flex items-center gap-2.5 rounded-xl px-1 py-1.5 hover:bg-white/70">
                        <IconTile icon={ACT[a.kind]?.icon || "clock"} tone={a.kind === "completed" && a.result === "FAIL" ? "red" : ACT[a.kind]?.tone || "blue"} size={30} />
                        <span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-[13px]">{a.title}</b><span className="block truncate text-[12px] text-fg-3">{a.sub}</span></span>
                        <span className="shrink-0 text-[12px] text-fg-3">{a.time}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </Shell>
  );
}
