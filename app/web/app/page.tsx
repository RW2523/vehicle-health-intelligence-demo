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
};

function LaneCard({ ln }: { ln: any }) {
  const st = LANE_STATE[ln.state];
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
  const href = ln.live ? `/inspection/${v.inspection_id}` : `/vehicles/${encodeURIComponent(v.plate)}`;
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/70 shadow-glass">
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-b from-[#F1F5FB] to-[#DEE6F2]">
        <VehicleImage plate={v.plate} vtype={v.vtype} photo={v.photo} className="h-full w-full" />
        <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
          <b className="whitespace-nowrap rounded-full bg-white/90 px-2.5 py-0.5 text-[13px] shadow-sm backdrop-blur">Lane {ln.lane}{ln.live && <span className="ml-1 text-[10.5px] font-bold uppercase tracking-wider text-[#6D28D9]">· live</span>}</b>
          <StatusPill tone={st.tone} className="shadow-sm">{st.label}</StatusPill>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="text-[18px] font-bold tracking-tight">{v.plate}</div>
        <div className="truncate text-[13px] text-fg-2">{v.make} {v.model}</div>
        <div className="truncate text-[12.5px] text-fg-3">{v.inspection_type}</div>
        <div className="mt-auto pt-3">
          {ln.state === "operation" ? (
            <div className="flex items-center gap-2"><ProgressBar value={ln.progress} /><span className="w-10 text-right text-[12.5px] font-semibold text-fg-2">{ln.progress}%</span></div>
          ) : <ProgressBar value={2} tone="gray" />}
          <div className="mt-1.5 text-[12.5px] text-fg-3">{ln.note}</div>
          <Link href={href} className="mt-3 flex items-center justify-center gap-1 rounded-xl bg-blue-50 py-2 text-[13px] font-semibold text-[#1D4ED8] ring-1 ring-blue-100 transition hover:bg-blue-100">
            View Details<Icon name="chev" size={15} />
          </Link>
        </div>
      </div>
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
                {D.lanes.map((ln: any) => <LaneCard key={ln.lane} ln={ln} />)}
              </div>
            </Panel>
          </div>
          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
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
                {!D.queue.length ? <p className="text-[13.5px] text-fg-3">No one is waiting: every arrival is on a lane.</p> : (
                  <ol className="flex flex-col">
                    {queue.map((q: any, i: number) => (
                      <li key={q.no} className="flex items-center gap-3 border-b border-ink-600/60 py-2.5 text-[14px] last:border-0">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[12px] font-bold ring-1 ring-ink-600">{i + 1}</span>
                        <Link href={`/vehicles/${encodeURIComponent(q.plate)}`} className="w-[86px] shrink-0 font-bold hover:text-cyan">{q.plate}</Link>
                        <span className="min-w-0 flex-1 truncate text-fg-2">{q.make} {q.model}</span>
                        {i === 0 && <StatusPill tone="blue">Next</StatusPill>}
                        <span className="w-[64px] shrink-0 text-right text-[13px] text-fg-3">~ {q.wait_min} min</span>
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
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Panel title="Upcoming Vehicles" href="/inspection?tab=schedule" actionLabel={`View all (${D.upcoming.length})`} pad={false}>
              {!D.upcoming.length ? <p className="px-5 pb-5 text-[13.5px] text-fg-3">No more vehicles expected today.</p> : (
                <div className="overflow-x-auto px-2 pb-3">
                  <table className="w-full min-w-[720px] text-left text-[13.5px]">
                    <thead className="text-[12.5px] text-fg-3"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium"><th>#</th><th>Vehicle No.</th><th>Vehicle Type</th><th>Owner</th><th>Inspection Type</th><th>Scheduled</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {D.upcoming.slice(0, 10).map((x: any, i: number) => (
                        <tr key={x.no} className="border-t border-ink-600/60 [&>td]:px-3 [&>td]:py-2.5">
                          <td><span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[12px] font-bold ring-1 ring-ink-600">{i + 1}</span></td>
                          <td className="whitespace-nowrap"><Link href={`/vehicles/${encodeURIComponent(x.plate)}`} className="flex items-center gap-2.5 font-bold hover:text-cyan"><VehicleImage plate={x.plate} vtype={x.vtype} photo={x.photo} size="480" className="h-9 w-14 shrink-0 rounded-lg" />{x.plate}</Link></td>
                          <td className="whitespace-nowrap text-fg-2">{x.make} {x.model}</td>
                          <td className="max-w-[160px] truncate text-fg-2">{x.owner}</td>
                          <td className="max-w-[200px] truncate text-fg-2">{x.inspection_type}{x.source === "booking" && <span className="ml-1.5 text-[11px] font-semibold text-cyan">booked</span>}</td>
                          <td className="whitespace-nowrap text-fg-2">{x.arrival_at}</td>
                          <td><StatusPill tone={STATUS[x.status]?.tone || "gray"}>{STATUS[x.status]?.label || x.status}</StatusPill></td>
                          <td><Link href={`/vehicles/${encodeURIComponent(x.plate)}`} aria-label={`Open ${x.plate}`} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white"><Icon name="dots" size={18} width={3} /></Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel title="Recent Activity" href="/inspection?tab=schedule&status=completed">
              <ul className="flex flex-col gap-1">
                {D.activity.slice(0, 10).map((a: any, i: number) => (
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
