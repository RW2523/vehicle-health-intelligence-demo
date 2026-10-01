"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { IconTile, Panel, ProgressBar, SegmentRing, StatCard, StatusPill, Tone } from "@/components/glass";
import { Icon } from "@/components/icons";
import { Shell } from "@/components/Shell";
import { ErrorState, LoadingState, Source } from "@/components/ui";
import { VehicleImage } from "@/components/VehicleImage";
import { useUser } from "@/lib/auth";
import { useFetch } from "@/lib/live";

const LANE_STATE: Record<string, { label: string; tone: Tone }> = {
  operation: { label: "In Operation", tone: "green" }, preparing: { label: "Preparing", tone: "amber" }, idle: { label: "Idle", tone: "gray" },
};
const STATUS: Record<string, { label: string; tone: Tone }> = {
  in_queue: { label: "In Queue", tone: "blue" }, scheduled: { label: "Scheduled", tone: "gray" }, in_progress: { label: "In Lane", tone: "amber" },
  completed: { label: "Completed", tone: "green" },
};
const ACT: Record<string, { icon: string; tone: Tone }> = {
  completed: { icon: "checkc", tone: "green" }, started: { icon: "clock", tone: "amber" }, queued: { icon: "doc", tone: "blue" },
  live: { icon: "bolt", tone: "purple" },
};
const greeting = (h: number) => (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
const today = () => new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Kuala_Lumpur", weekday: "short", day: "numeric", month: "short", year: "numeric" });

const RESULT: Record<string, { label: string; tone: Tone }> = {
  PASS: { label: "Passed", tone: "green" }, PASS_ADVISORY: { label: "Passed · advisory", tone: "amber" }, FAIL: { label: "Failed", tone: "red" },
  CONDITIONAL: { label: "Conditional", tone: "amber" }, REFERRED: { label: "Referred", tone: "blue" },
};

function LaneCard({ ln, canRun }: { ln: any; canRun: boolean }) {
  const v = ln.vehicle;
  if (!v) {
    const other = ln.next || ln.last;
    return (
      <div className="flex h-full min-h-[320px] flex-col rounded-2xl border border-dashed border-ink-500 bg-white/40 p-4">
        <div className="flex items-center justify-between"><b className="text-[15px]">Lane {ln.lane}</b><StatusPill tone="gray">Idle</StatusPill></div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-fg-4">
          <Icon name="car" size={40} width={1.2} color="#94A3B8" />
          <span className="text-[14px] font-medium text-fg-3">Lane available</span>
        </div>
        {other && (
          <Link href={`/vehicles/${encodeURIComponent(other.plate)}`} className="flex items-center gap-3 rounded-xl bg-white/80 p-2.5 ring-1 ring-ink-600/60 transition hover:ring-blue-200">
            <VehicleImage plate={other.plate} vtype={other.vtype} photo={other.photo} size="480" className="h-11 w-16 shrink-0 rounded-lg" />
            <span className="min-w-0 leading-tight">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-fg-4">{ln.next ? `Next · ${ln.next.start_at}` : `Last · ${ln.last.end_at}`}</span>
              <b className="block truncate text-[13.5px]">{other.plate}</b>
              <span className="block truncate text-[12px] text-fg-3">{ln.next ? `${other.make} ${other.model}` : RESULT[ln.last.result]?.label}</span>
            </span>
          </Link>
        )}
      </div>
    );
  }
  // a lane-replay vehicle on its lane, waiting for its replay to be started
  const ready = ln.state === "preparing" && !!ln.replay;
  const st = ready ? { label: "Ready", tone: "amber" as Tone } : LANE_STATE[ln.state] || LANE_STATE.idle;
  const start = ready && canRun;
  const href = ln.live ? `/inspection/${v.inspection_id}` : start ? `/inspection/${ln.replay}` : `/vehicles/${encodeURIComponent(v.plate)}`;
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/70 shadow-glass">
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-b from-[#F1F5FB] to-[#DEE6F2]">
        <VehicleImage plate={v.plate} vtype={v.vtype} photo={v.photo} className="h-full w-full" />
        <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
          <b className="whitespace-nowrap rounded-full bg-white/90 px-2.5 py-0.5 text-[13px] shadow-sm backdrop-blur">Lane {ln.lane}{ln.live && <span className="ml-1 text-[10.5px] font-bold uppercase tracking-wider text-[#6D28D9]">· live</span>}</b>
          <StatusPill tone={st.tone} dot={ready} className="shadow-sm">{st.label}</StatusPill>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="text-[18px] font-bold tracking-tight">{v.plate}</div>
        <div className="truncate text-[13px] text-fg-2">{v.make} {v.model}</div>
        <div className="truncate text-[12.5px] text-fg-3">{v.inspection_type}</div>
        <div className="mt-auto pt-3">
          {ln.state === "operation" ? (
            <div className="flex items-center gap-2"><ProgressBar value={ln.progress} /><span className="w-10 text-right text-[12.5px] font-semibold text-fg-2">{ln.progress}%</span></div>
          ) : <ProgressBar value={2} tone={ready ? "amber" : "gray"} />}
          <div className="mt-1.5 text-[12.5px] text-fg-3">{ln.note}</div>
          <Link href={href} className={`mt-3 flex items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-semibold ring-1 transition ${start ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white ring-transparent hover:brightness-105" : "bg-blue-50 text-[#1D4ED8] ring-blue-100 hover:bg-blue-100"}`}>
            {start ? <><Icon name="play" size={14} />Start the replay</> : <>View Details<Icon name="chev" size={15} /></>}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** One vehicle of the day in the lower-left panel: still to come (status) or finished (result). One row per screen
 *  size: a compact card on a phone, table-like columns from md (the owner only on the widest screens). */
const UP_COLS = "md:grid md:grid-cols-[minmax(0,1.25fr)_minmax(0,1.35fr)_52px_104px_28px] 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_52px_104px_28px]";
const DONE_COLS = "md:grid md:grid-cols-[minmax(0,1.25fr)_minmax(0,1.35fr)_68px_132px] 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_68px_132px]";

function VehicleCell({ x, href }: { x: any; href: string }) {
  return (
    <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5 hover:text-cyan">
      <VehicleImage plate={x.plate} vtype={x.vtype} photo={x.photo} size="480" className="h-9 w-14 shrink-0 rounded-lg" />
      <span className="min-w-0 leading-tight"><b className="block whitespace-nowrap text-[13.5px]">{x.plate}</b><span className="block truncate text-[12px] text-fg-3">{x.make} {x.model}</span></span>
    </Link>
  );
}

function TypeCell({ x }: { x: any }) {
  return (
    <span className="hidden min-w-0 items-center gap-1.5 text-fg-2 md:flex" title={x.inspection_type}>
      {x.source === "booking" && <span className="shrink-0 rounded-full bg-blue-50 px-1.5 text-[10.5px] font-semibold text-cyan ring-1 ring-blue-100">booked</span>}
      <span className="truncate">{x.inspection_type}</span>
    </span>
  );
}

function UpcomingRow({ x }: { x: any }) {
  return (
    <li className={`flex items-center gap-3 border-t border-ink-600/60 px-3 py-2.5 text-[13.5px] md:gap-x-4 ${UP_COLS} md:items-center`}>
      <span className="min-w-0 flex-1">
        <VehicleCell x={x} href={`/vehicles/${encodeURIComponent(x.plate)}`} />
        <span className="mt-1 block truncate pl-[66px] text-[12px] text-fg-3 md:hidden">{x.arrival_at} · {x.source === "booking" ? "booked · " : ""}{x.inspection_type}</span>
      </span>
      <span className="hidden truncate text-fg-2 2xl:block">{x.owner}</span>
      <TypeCell x={x} />
      <span className="hidden whitespace-nowrap text-fg-2 md:block">{x.arrival_at}</span>
      <span className="shrink-0"><StatusPill tone={STATUS[x.status]?.tone || "gray"}>{STATUS[x.status]?.label || x.status}</StatusPill></span>
      <Link href={`/vehicles/${encodeURIComponent(x.plate)}`} aria-label={`Open ${x.plate}`} className="hidden h-8 w-8 items-center justify-center rounded-lg hover:bg-white md:flex"><Icon name="dots" size={18} width={3} /></Link>
    </li>
  );
}

function DoneRow({ x }: { x: any }) {
  const r = RESULT[x.result] || { label: x.result || "–", tone: "gray" as Tone };
  return (
    <li className={`flex items-center gap-3 border-t border-ink-600/60 px-3 py-2.5 text-[13.5px] md:gap-x-4 ${DONE_COLS} md:items-center`}>
      <span className="min-w-0 flex-1">
        <VehicleCell x={x} href={x.inspection_id ? `/inspection/${x.inspection_id}/review` : `/vehicles/${encodeURIComponent(x.plate)}`} />
        <span className="mt-1 block truncate pl-[66px] text-[12px] text-fg-3 md:hidden">{x.end_at} · {x.inspection_type}</span>
      </span>
      <span className="hidden truncate text-fg-2 2xl:block">{x.owner}</span>
      <TypeCell x={x} />
      <span className="hidden whitespace-nowrap leading-tight text-fg-2 md:block">{x.end_at}<span className="block text-[11.5px] text-fg-4">on lane {x.lane}</span></span>
      <span className="shrink-0"><StatusPill tone={r.tone}>{r.label}</StatusPill></span>
    </li>
  );
}

function RowsHead({ cols, labels }: { cols: string; labels: [string, string][] }) {
  return (
    <div className={`hidden gap-x-4 px-3 pb-2 text-[12.5px] font-medium text-fg-3 ${cols}`} aria-hidden>
      {labels.map(([l, c], i) => <span key={i} className={c}>{l}</span>)}
    </div>
  );
}

export default function Dashboard() {
  const user = useUser();
  const hub = "BR00";  // the demo hub: the ten main vehicles (other hubs are in oversight)
  const [tick, setTick] = useState(0);
  const [moreQueue, setMoreQueue] = useState(false);
  const d = useFetch<any>(user ? "/api/hub/today" : null, { branch_id: hub }, [tick]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 20000);
    return () => clearInterval(t);
  }, []);
  const D = d.data;
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", hour12: false }));
  const k = D?.kpis;
  const deltaPct = k && k.total_prev ? Math.round((100 * (k.total - k.total_prev)) / k.total_prev) : null;
  const queue = useMemo(() => (D?.queue || []).slice(0, moreQueue ? 50 : 5), [D, moreQueue]);
  // few vehicles still to come: the panel goes on with the latest finished ones, so the day reads in one place
  const earlier = D?.upcoming?.length ? (D.done || []).slice(0, Math.max(0, 6 - D.upcoming.length)) : [];
  const canRun = user?.role === "presenter" || user?.role === "examiner";
  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow mb-1.5">{user ? `${greeting(hour)}, ${user.name.split(" ")[0]}` : "Welcome back"}</div>
          <h1 className="text-[30px] font-extrabold leading-[1.08] tracking-tight sm:text-[40px] xl:text-[46px]">Inspector Dashboard</h1>
          <p className="mt-2 text-[15px] text-fg-2 sm:text-[17px]">Here&apos;s today&apos;s overview of inspection lanes, queue and activity.</p>
        </div>
        <div className="card flex max-w-full items-center gap-3 px-4 py-3">
          <Icon name="calendar" size={24} color="#475569" />
          <div className="min-w-0 leading-tight">
            <div className="text-[15px] font-semibold">{today()} {D && <span className="font-normal text-fg-3">· {D.clock.time}</span>}</div>
            <div className="text-[12.5px] text-fg-2">{D ? `${D.branch.name}, ${D.branch.state} · ${D.branch.lanes} lanes` : "…"}</div>
          </div>
        </div>
      </div>

      {d.error && !D ? <ErrorState title="Today's overview could not load" onRetry={d.reload}>{d.error}</ErrorState> : !D ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="card p-5"><LoadingState label="" rows={2} /></div>)}
          <div className="card col-span-2 p-5 lg:col-span-5"><LoadingState label="Loading today at the hub…" rows={5} /></div>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-fg-3">
            {D.clock.demo && <span className="pill bg-amber-50 text-amber-800 ring-1 ring-amber-200"><Icon name="clock" size={14} />{D.clock.note}</span>}
            <Source kind="synthetic" text="Today's plan: the ten main vehicles" />
            {D.live.length > 0 && <Source kind="live_model" text={`${D.live.length} live lane inspection${D.live.length === 1 ? "" : "s"} today`} />}
          </div>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5 [&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1">
            <StatCard icon="car" tone="blue" label="Total Vehicles Today" value={k.total} delta={deltaPct != null ? `${deltaPct >= 0 ? "↑ +" : "↓ "}${deltaPct}%` : undefined}
              deltaTone={deltaPct != null && deltaPct < 0 ? "red" : "green"} sub={deltaPct != null ? "vs. previous day" : "on today's plan"} href="/inspection?tab=schedule" />
            <StatCard icon="checkc" tone="green" label="Completed" value={k.completed} delta={k.total ? `${Math.round((100 * k.completed) / k.total)}%` : undefined} sub="Today" href="/inspection?tab=schedule&status=completed" />
            <StatCard icon="clock" tone="amber" label="In Progress" value={k.in_progress} sub="Live now" href="/inspection" />
            <StatCard icon="clock" tone="gray" label="In Queue" value={k.in_queue} sub="Waiting" href="/inspection?tab=schedule&status=in_queue" />
            <StatCard icon="warn" tone="red" label="Issues Found" value={k.issues} delta={k.issue_rate != null ? `${(k.issue_rate * 100).toFixed(1)}%` : undefined} deltaTone="red"
              sub={`of inspected · ${k.fails} failed`} href="/inspection?tab=reports" />
          </div>

          <div className="mb-5">
            <Panel title="Inspection Lanes" href="/lane" actionLabel="Live lane console">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {D.lanes.map((ln: any) => <LaneCard key={ln.lane} ln={ln} canRun={canRun} />)}
              </div>
            </Panel>
          </div>
          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
              <Panel title="Lane Utilization" action={<span className="pill bg-white text-fg-2 ring-1 ring-ink-600">Now</span>}>
                <div className="flex flex-wrap items-center gap-5">
                  <SegmentRing size={150} stroke={16} parts={[{ value: D.utilization.operation, color: "#10B981" }, { value: D.utilization.preparing, color: "#F59E0B" }, { value: D.utilization.idle, color: "#CBD5E1" }]}>
                    <span className="text-[30px] font-bold">{D.utilization.pct}%</span><span className="text-[12.5px] text-fg-3">Utilization</span>
                  </SegmentRing>
                  <ul className="min-w-[150px] flex-1 space-y-2.5 text-[14px]">
                    {[["In Operation", D.utilization.operation, "#10B981"], ["Preparing", D.utilization.preparing, "#F59E0B"], ["Idle", D.utilization.idle, "#94A3B8"]].map(([l, n, c]) => (
                      <li key={l as string} className="flex items-center justify-between gap-3"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c as string }} />{l}</span><b>{n}</b></li>
                    ))}
                    <li className="flex items-center justify-between gap-3 border-t border-ink-600 pt-2 text-fg-2"><span>Total Lanes</span><b>{D.branch.lanes}</b></li>
                  </ul>
                </div>
              </Panel>
              <Panel title={`Current Queue (${D.queue.length})`} href="/inspection?tab=schedule&status=in_queue" actionLabel="View Queue">
                {!D.queue.length ? (
                  <div className="flex items-center gap-3 rounded-2xl bg-white/60 px-4 py-4 text-[13.5px] text-fg-3 ring-1 ring-ink-600/60">
                    <Icon name="checkc" size={22} color="#10B981" />No one is waiting: every arrival is on a lane.
                  </div>
                ) : (
                  <ol className="flex flex-col">
                    {queue.map((q: any, i: number) => (
                      <li key={q.no} className="flex items-center gap-3 border-b border-ink-600/60 py-2.5 text-[14px] last:border-0">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[12px] font-bold ring-1 ring-ink-600">{i + 1}</span>
                        <Link href={`/vehicles/${encodeURIComponent(q.plate)}`} className="flex min-w-0 flex-1 items-center gap-2.5 hover:text-cyan">
                          <VehicleImage plate={q.plate} vtype={q.vtype} photo={q.photo} size="480" className="hidden h-9 w-14 shrink-0 rounded-lg sm:block" />
                          <span className="min-w-0 leading-tight"><b className="block whitespace-nowrap">{q.plate}</b><span className="block truncate text-[12.5px] text-fg-3">{q.make} {q.model}</span></span>
                        </Link>
                        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2.5">
                          {i === 0 && <StatusPill tone="blue">Next</StatusPill>}
                          <span className="whitespace-nowrap text-right text-[12.5px] text-fg-3">{q.behind_replay ? `after ${q.behind_replay}'s replay` : `~ ${q.wait_min} min`}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {D.queue.length > 5 && (
                  <button className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl bg-blue-50 py-2 text-[13px] font-semibold text-[#1D4ED8] ring-1 ring-blue-100 hover:bg-blue-100" onClick={() => setMoreQueue((m) => !m)}>
                    <Icon name={moreQueue ? "down" : "chev"} size={15} />{moreQueue ? "Show fewer" : `Show ${D.queue.length - 5} more vehicles`}
                  </button>
                )}
              </Panel>
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
            {!D.upcoming.length ? (
              <Panel title="Today's Inspections" href="/inspection?tab=schedule" actionLabel={`View all (${D.done.length})`} pad={false}
                sub="No more vehicles expected today: here is how the day went.">
                {!D.done.length ? <p className="px-5 pb-5 text-[13.5px] text-fg-3">Nothing inspected yet today.</p> : (
                  <div className="px-1 pb-3 lg:px-2">
                    <RowsHead cols={DONE_COLS} labels={[["Vehicle", ""], ["Owner", "hidden 2xl:block"], ["Inspection Type", ""], ["Finished", ""], ["Result", ""]]} />
                    <ul>{D.done.slice(0, 10).map((x: any) => <DoneRow key={x.no} x={x} />)}</ul>
                  </div>
                )}
              </Panel>
            ) : (
            <Panel title="Upcoming Vehicles" href="/inspection?tab=schedule" actionLabel={`View all (${D.upcoming.length})`} pad={false}>
              <div className="px-1 pb-3 lg:px-2">
                <RowsHead cols={UP_COLS} labels={[["Vehicle", ""], ["Owner", "hidden 2xl:block"], ["Inspection Type", ""], ["Arrival", ""], ["Status", ""], ["", ""]]} />
                <ul>{D.upcoming.slice(0, 10).map((x: any) => <UpcomingRow key={x.no} x={x} />)}</ul>
                {earlier.length > 0 && (
                  <>
                    <div className="mt-3 px-3 pb-1 text-[12px] font-semibold uppercase tracking-wide text-fg-4">Earlier today</div>
                    <ul>{earlier.map((x: any) => <DoneRow key={x.no} x={x} />)}</ul>
                  </>
                )}
              </div>
            </Panel>
            )}
            <Panel title="Recent Activity" href="/inspection?tab=schedule&status=completed">
              <ul className="flex flex-col gap-1">
                {D.activity.slice(0, D.upcoming.length ? 8 : 10).map((a: any, i: number) => (
                  <li key={i}>
                    <Link href={a.inspection_id ? `/inspection/${a.inspection_id}` : `/vehicles/${encodeURIComponent(a.plate)}`} className="flex items-center gap-3 rounded-xl px-1 py-1.5 hover:bg-white/70">
                      <IconTile icon={ACT[a.kind]?.icon || "clock"} tone={a.kind === "completed" && a.result === "FAIL" ? "red" : ACT[a.kind]?.tone || "blue"} size={36} />
                      <span className="min-w-0 flex-1"><b className="block truncate text-[13.5px]">{a.title}</b><span className="block truncate text-[12.5px] text-fg-3">{a.sub}</span></span>
                      <span className="shrink-0 text-[12.5px] text-fg-3">{a.time}</span>
                    </Link>
                  </li>
                ))}
                {!D.activity.length && <p className="text-[13.5px] text-fg-3">Nothing yet today.</p>}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </Shell>
  );
}
