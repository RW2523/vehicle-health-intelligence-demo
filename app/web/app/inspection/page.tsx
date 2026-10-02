"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyboardEvent, Suspense, useEffect, useState } from "react";
import { Panel, StatusPill, Tone } from "@/components/glass";
import { Icon } from "@/components/icons";
import { LiveLaneStrip } from "@/components/LiveLaneView";
import { PlayerControls, useSessions } from "@/components/Player";
import { Shell } from "@/components/Shell";
import { Empty, ErrorState, LoadingState, PageHeader, Source } from "@/components/ui";
import { VehicleImage } from "@/components/VehicleImage";
import { useUser } from "@/lib/auth";
import { LANE_SESSIONS, STATUS_LABEL, STEP_LABEL, laneLabel } from "@/lib/format";
import { useFetch, useLive } from "@/lib/live";

const SCHED: Record<string, { label: string; tone: Tone }> = {
  completed: { label: "Completed", tone: "green" }, in_progress: { label: "In Lane", tone: "amber" }, in_queue: { label: "In Queue", tone: "blue" },
  scheduled: { label: "Scheduled", tone: "gray" },
};

/** A report's verdict, worded like the results elsewhere in the app. */
const VERDICT_PILL: Record<string, { label: string; tone: Tone }> = {
  PASS: { label: "Pass", tone: "green" }, FAIL: { label: "Fail", tone: "red" }, CONDITIONAL: { label: "Conditional", tone: "amber" }, REFERRED: { label: "Referred", tone: "blue" },
  PASS_ADVISORY: { label: "Pass · advisory", tone: "amber" },
};
/** A schedule result (planned or live), worded like the results elsewhere; an unknown one shows as it is. */
const resultPill = (r?: string | null) => VERDICT_PILL[r || ""] || { label: r || "–", tone: "gray" as Tone };
const schedPill = (st?: string | null) => SCHED[st || ""] || { label: st || "–", tone: "gray" as Tone };
const started = (iso: string) => new Date(iso + (/Z|[+-]\d\d:\d\d$/.test(iso) ? "" : "Z")).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const issued = (iso?: string | null) => iso ? new Date(iso + (iso.endsWith("Z") ? "" : "Z")).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";
/** "INS-20261001-0007" → "#0007": the day is the schedule's own. */
const shortNo = (no: string) => `#${String(no).split("-").pop()}`;

function LiveStatus({ i }: { i: any }) {
  const v = (i.report_verdict || i.verdict) && VERDICT_PILL[i.report_verdict || i.verdict];
  return v && (i.report_id || i.status === "reported") ? <StatusPill tone={v.tone}>{v.label}</StatusPill> : <StatusPill tone={LIVE[i.status] || "gray"}>{STATUS_LABEL[i.status] || i.status}</StatusPill>;
}
const LIVE: Record<string, Tone> = { in_lane: "amber", review: "purple", decided: "purple", reported: "green" };

/* ---------------------------------------------------------------- the live inspections, by where each one stands */

type Bucket = "progress" | "examiner" | "senior" | "completed" | "failed";
const BUCKETS: { k: Bucket; label: string; empty: [string, string] }[] = [
  { k: "progress", label: "In Progress", empty: ["No vehicle is in a lane", "A lane replay or a use case puts a vehicle through the lane; it shows here while the stations run."] },
  { k: "examiner", label: "Awaiting Examiner", empty: ["Nothing waits for an examiner", "An inspection lands here when its lane has finished, until its report is issued."] },
  { k: "senior", label: "Awaiting Senior Review", empty: ["Nothing waits for a senior examiner", "When identity checks disagree, the inspection is routed here for a senior examiner to sign off."] },
  { k: "completed", label: "Completed", empty: ["No passed or conditional report yet", "Inspections whose report was issued with a PASS or CONDITIONAL result show here."] },
  { k: "failed", label: "Failed / Reinspection", empty: ["No failed or referred inspection", "Inspections whose report was issued with a FAIL or REFERRED result show here, for a re-inspection."] },
];
const DEFAULT_ORDER: Bucket[] = ["examiner", "progress", "senior", "completed", "failed"];

/** Where an inspection stands, from what the API returns (status, route, report and its verdict). */
function bucketOf(i: any): Bucket | null {
  if (i.report_id || i.status === "reported") {
    const v = i.report_verdict || i.verdict;
    return v === "FAIL" || v === "REFERRED" ? "failed" : "completed";
  }
  if (i.status === "in_lane") return "progress";
  if (i.route === "senior") return "senior";
  if (i.status === "review" || i.status === "decided") return "examiner";
  return null;
}

/** An older run left "in the lane" when the same lane started again (the newer run is the live one). */
const isSuperseded = (i: any, all: any[]) => i.status === "in_lane" && all.some((j) => j.lane_id === i.lane_id && j.started_at > i.started_at);

/** The one thing to do next with an inspection, by where it stands. */
function actionOf(i: any, b: Bucket): { label: string; href: string; icon: string } {
  const f = i.findings || {};
  const id = i.inspection_id;
  if (b === "progress") return { label: "Continue", href: `/inspection/${id}`, icon: "eye" };
  if (b === "completed" || b === "failed") return i.report_id ? { label: "View Report", href: `/report?id=${i.report_id}`, icon: "doc" } : { label: "Final review", href: `/inspection/${id}/review`, icon: "doc" };
  // every finding decided: the next step is the final review
  const next = (f.open || 0) > 0 ? `/inspection/${id}/findings` : `/inspection/${id}/review`;
  if (b === "senior") return { label: "Senior review", href: next, icon: "user" };
  return (f.open || 0) > 0 ? { label: "Review findings", href: next, icon: "warn" } : { label: "Final review", href: next, icon: "checkc" };
}

const SEV: Record<string, { label: string; tone: Tone }> = { high: { label: "Critical", tone: "red" }, medium: { label: "Attention", tone: "amber" }, low: { label: "Minor", tone: "gray" } };

/** The ten vehicles' photos (one request), by plate. */
function usePhotoIndex() {
  const g = useFetch<any[]>("/api/images/groups");
  const by: Record<string, any> = {};
  for (const x of g.data || []) if (x.plate) by[x.plate] = x;
  return by;
}

/** One inspection in the queue: the vehicle, the type, how far the decisions are, the top finding, the time and the
 *  one next step. */
function QueueRow({ i, b, g, superseded }: { i: any; b: Bucket; g?: any; superseded: boolean }) {
  const f = i.findings || { findings: 0, open: 0, open_required: 0, decided: 0, top: null };
  const a = actionOf(i, b);
  const top = f.top;
  const sev = top ? SEV[top.severity] || SEV.low : null;
  const reported = b === "completed" || b === "failed";
  const pctDone = f.findings ? (100 * f.decided) / f.findings : 0;
  return (
    <li className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 border-b border-ink-600/60 px-4 py-3.5 last:border-0 md:grid-cols-[96px_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.25fr)_152px] md:gap-x-5 lg:px-5">
      <VehicleImage plate={i.plate} vtype={g?.vtype} photo={g?.hero} size="480" className="h-12 w-[72px] shrink-0 rounded-xl md:h-16 md:w-24" />
      <div className="min-w-0 leading-tight">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><b className="whitespace-nowrap text-[15.5px]">{i.plate}</b>{(reported || i.status === "decided") && <LiveStatus i={i} />}</div>
        <div className="mt-1 truncate text-[13px] text-fg-2" title={i.inspection_type}>{i.inspection_type}</div>
        <div className="mt-0.5 truncate text-[12px] text-fg-3">
          {started(i.started_at)} · {laneLabel(i.lane_id)}{b === "progress" && i.step ? ` · ${STEP_LABEL[i.step] || i.step}` : ""}
          <span className="hidden font-mono text-[11px] text-fg-4 xl:inline"> · {i.inspection_id}</span>
        </div>
        {superseded && <div className="mt-0.5 text-[11.5px] text-[#B45309]">A newer run started on this lane</div>}
      </div>
      {/* how far the decisions are */}
      <div className="col-span-2 min-w-0 md:col-span-1">
        {f.findings ? (
          <>
            <div className="flex items-baseline justify-between gap-2 text-[13px]"><span><b>{f.decided} of {f.findings}</b> <span className="text-fg-3">findings decided</span></span></div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#E8EEF7]" aria-hidden><div className="h-1.5 rounded-full" style={{ width: `${Math.max(pctDone, 2)}%`, background: pctDone >= 100 ? "#10B981" : "#2563EB" }} /></div>
            <div className="mt-1 text-[12px]">{!reported && f.open_required > 0 ? <span className="font-semibold text-[#B91C1C]">{f.open_required} critical left</span> : <span className="text-fg-3">{f.open ? `${f.open} still open` : "All decided"}</span>}</div>
          </>
        ) : <span className="text-[13px] text-fg-3">{b === "progress" ? "No findings so far" : "No findings: nothing to decide"}</span>}
      </div>
      {/* the top finding */}
      <div className={`col-span-2 min-w-0 md:col-span-1 ${top ? "" : "hidden md:block"}`}>
        {top ? (
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-4">Top finding</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-2">
              {sev && <StatusPill tone={sev.tone}>{sev.label}</StatusPill>}
              <span className="truncate text-[13px] font-medium" title={top.title}>{top.title}</span>
            </div>
            {!top.open && <div className="mt-0.5 text-[11.5px] text-fg-3">{top.fail_item ? "Decided · fail item" : "Decided"}</div>}
          </div>
        ) : <span className="text-[12.5px] text-fg-4">–</span>}
      </div>
      <div className="col-span-2 md:col-span-1">
        <Link className="btn btn-primary btn-sm w-full whitespace-nowrap" href={a.href}><Icon name={a.icon} size={14} />{a.label}<Icon name="chev" size={14} /></Link>
      </div>
    </li>
  );
}

function Queue({ list, tab, setTab }: { list: { data: any[] | null; error: string | null; reload: () => void }; tab: Bucket; setTab: (k: string) => void }) {
  const photos = usePhotoIndex();
  const all = list.data || [];
  const inTab = all.filter((i) => bucketOf(i) === tab);
  // runs left "in the lane" when the same lane started again: listed apart, folded away
  const stale = inTab.filter((i) => isSuperseded(i, all));
  const rows = inTab.filter((i) => !isSuperseded(i, all));
  const meta = BUCKETS.find((x) => x.k === tab)!;
  return (
    <Panel pad={false} title={<div><h2 className="text-[18px] font-bold">{meta.label}{list.data ? ` (${rows.length})` : ""}</h2><p className="text-[13px] text-fg-3">Newest first · updates live</p></div>}
      action={<Source kind="live_model" text="Live analysis · simulated sensors" />}>
      {!list.data ? (list.error ? <div className="px-5 pb-5"><ErrorState title="The inspections could not load" onRetry={list.reload}>{list.error}</ErrorState></div>
        : <div className="px-5 pb-5"><LoadingState label="Loading the live inspections…" rows={4} /></div>)
        : (
          <>
            {!rows.length ? (
              <div className="px-4 pb-4 lg:px-5 lg:pb-5">
                <Empty title={meta.empty[0]} actions={tab === "progress" ? <a className="btn" href="#lane-replays">Lane replays<Icon name="chev" size={14} /></a>
                  : tab === "examiner" ? <button className="btn" onClick={() => setTab("progress")}>See what is in the lanes</button> : undefined}>{meta.empty[1]}</Empty>
              </div>
            ) : <ul className="border-t border-ink-600/60">{rows.map((i) => <QueueRow key={i.inspection_id} i={i} b={tab} g={photos[i.plate]} superseded={false} />)}</ul>}
            {stale.length > 0 && (
              <details className="border-t border-ink-600/60">
                <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold text-fg-3 hover:text-fg-2 lg:px-5">{stale.length} earlier run{stale.length === 1 ? "" : "s"} left unfinished when {stale.length === 1 ? "its" : "their"} lane started again</summary>
                <ul className="border-t border-ink-600/60 opacity-80">{stale.map((i) => <QueueRow key={i.inspection_id} i={i} b={tab} g={photos[i.plate]} superseded />)}</ul>
              </details>
            )}
          </>
        )}
    </Panel>
  );
}

/** The four lane replays, compact: where the presenter starts a run (it then shows under In Progress). */
function LaneReplays({ list }: { list: any[] | null }) {
  const user = useUser();
  const { sessions, setPlayer } = useSessions();
  const canRun = user?.role === "presenter" || user?.role === "examiner";
  const latest: Record<string, any> = {};
  for (const i of list || []) if (!latest[i.lane_id]) latest[i.lane_id] = i;
  return (
    <section id="lane-replays" className="mt-6 scroll-mt-24" aria-label="Lane replays">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0"><h2 className="text-[16px] font-bold">Lane replays</h2><p className="text-[13px] text-fg-3">Scripted runs of the four lanes at the Central Inspection Hub{canRun ? ": start one and it appears under In Progress" : ""}.</p></div>
        <Source kind="simulated" text="Replayed lane sensors" />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
        {LANE_SESSIONS.map((l) => {
          const i = latest[l.lane];
          const s = sessions.find((x) => x.session_id === l.session);
          return (
            <div key={l.lane} className="card flex min-w-0 flex-col p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[13.5px]"><b>{laneLabel(l.lane)}</b> · {l.plate} <span className="text-fg-3">· {l.car}</span></span>
                {i ? <StatusPill tone={LIVE[i.status] || "gray"} dot>{i.report_id || i.status === "reported" ? `Reported · ${i.report_verdict || i.verdict}` : STATUS_LABEL[i.status] || i.status}</StatusPill> : <StatusPill tone="gray">Idle</StatusPill>}
              </div>
              {/* the vehicle through the lane's stations, live */}
              <div className="mt-2"><LiveLaneStrip lane={l.lane} seed={i ? { inspection_id: i.inspection_id, step: i.step, status: i.status, verdict: i.report_verdict || i.verdict } : null} /></div>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-2.5">
                {s && canRun && <PlayerControls s={s} onState={setPlayer} compact quiet />}
                {i && <Link className="ml-auto text-[13px] font-semibold text-cyan hover:underline" href={`/inspection/${i.inspection_id}`}>Open the inspection</Link>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const laneNote = (x: any) => `Lane ${x.lane}${x.status === "in_progress" ? ` · ${x.progress}%` : x.status === "in_queue" ? (x.behind_replay ? ` · after ${x.behind_replay}` : ` · ~${x.wait_min} min`) : ""}`;

function Schedule() {
  const sp = useSearchParams();
  const router = useRouter();
  const status = sp.get("status") || "";
  const [q, setQ] = useState(sp.get("q") || "");
  const [page, setPage] = useState(1);
  const d = useFetch<any>("/api/hub/schedule", { status, q, page, page_size: 25 });
  useEffect(() => setPage(1), [status, q]);
  const set = (s: string) => router.replace(`/inspection?tab=schedule${s ? `&status=${s}` : ""}`, { scroll: false });
  const D = d.data;
  return (
    <Panel pad={false} title={<div><h2 className="text-[18px] font-bold">Today at the Central Inspection Hub</h2><p className="text-[13px] text-fg-3">{D ? `${D.total} vehicles · as at ${D.clock.time}${D.clock.demo ? " (demo moment)" : ""}` : "…"}</p></div>}
      action={<Source kind="synthetic" text="Day schedule from the registered vehicles" />}>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 lg:px-5">
        {[["", "All"], ["in_queue", "In Queue"], ["in_progress", "In Lane"], ["scheduled", "Scheduled"], ["completed", "Completed"]].map(([k, l]) => (
          <button key={k} onClick={() => set(k)} aria-pressed={status === k}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ring-1 transition ${status === k ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white ring-transparent" : "bg-white/70 text-fg-2 ring-ink-600 hover:bg-white"}`}>
            {l}{D?.counts && k ? ` · ${D.counts[k]}` : ""}
          </button>
        ))}
        <input className="input w-full sm:ml-auto sm:max-w-[260px]" placeholder="Plate, owner or inspection no." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search today's schedule" />
      </div>
      {!D ? <div className="px-5 pb-5"><LoadingState rows={5} /></div> : !D.items.length ? (
        <div className="px-5 pb-5"><Empty title="No vehicle matches" actions={<button className="btn" onClick={() => { setQ(""); set(""); }}>Clear filters</button>}>Nothing in today&apos;s schedule matches these filters.</Empty></div>
      ) : (
        <>
          <div className="hidden overflow-x-auto px-2 md:block">
            <table className="w-full min-w-[900px] text-left text-[13.5px]">
              <thead className="text-[12.5px] text-fg-3"><tr className="[&>th]:whitespace-nowrap [&>th]:px-2.5 [&>th]:py-2 [&>th]:font-medium"><th>No.</th><th>Vehicle</th><th className="hidden 2xl:table-cell">Owner</th><th>Inspection Type</th><th>Arrival</th><th>Lane</th><th>Status</th><th>Result</th></tr></thead>
              <tbody>
                {D.items.map((x: any) => (
                  <tr key={x.no} className="border-t border-ink-600/60 [&>td]:px-2.5 [&>td]:py-2.5">
                    <td className="whitespace-nowrap font-mono text-[12.5px]" title={x.no}>{shortNo(x.no)}</td>
                    <td><Link href={`/vehicles/${encodeURIComponent(x.plate)}`} className="flex items-center gap-2.5 hover:text-cyan"><VehicleImage plate={x.plate} vtype={x.vtype} photo={x.photo} size="480" className="h-8 w-12 shrink-0 rounded-md" /><span className="min-w-0 leading-tight"><b className="block whitespace-nowrap">{x.plate}</b><span className="block max-w-[150px] truncate text-[12px] text-fg-3">{x.make} {x.model}</span><span className="block max-w-[150px] truncate text-[11.5px] text-fg-4 2xl:hidden">{x.owner}</span></span></Link></td>
                    <td className="hidden max-w-[160px] truncate text-fg-2 2xl:table-cell" title={x.owner}>{x.owner}</td>
                    <td className="max-w-[210px] text-fg-2" title={x.inspection_type}><span className="flex min-w-0 items-center gap-1.5">{x.source === "booking" && <span className="shrink-0 rounded-full bg-blue-50 px-1.5 text-[10.5px] font-semibold text-cyan ring-1 ring-blue-100">booked</span>}<span className="truncate">{x.inspection_type}</span></span></td>
                    <td className="whitespace-nowrap text-fg-2">{x.arrival_at}</td>
                    <td className="whitespace-nowrap text-fg-2">{laneNote(x)}</td>
                    <td><StatusPill tone={schedPill(x.status).tone}>{schedPill(x.status).label}</StatusPill></td>
                    <td>{x.status === "completed" ? <span title={(x.issues || []).join("; ")}><StatusPill tone={resultPill(x.result).tone}>{resultPill(x.result).label}</StatusPill></span> : <span className="text-fg-4">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 px-4 md:hidden">
            {D.items.map((x: any) => (
              <li key={x.no}>
                <Link href={`/vehicles/${encodeURIComponent(x.plate)}`} className="flex items-center gap-3 rounded-2xl bg-white/70 p-2.5 ring-1 ring-ink-600/60 transition hover:bg-white">
                  <VehicleImage plate={x.plate} vtype={x.vtype} photo={x.photo} size="480" className="h-12 w-[72px] shrink-0 rounded-xl" />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="flex items-center justify-between gap-2"><b className="text-[14px]">{x.plate}</b>
                      {x.status === "completed" ? <StatusPill tone={resultPill(x.result).tone}>{resultPill(x.result).label}</StatusPill> : <StatusPill tone={schedPill(x.status).tone}>{schedPill(x.status).label}</StatusPill>}</span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-fg-2">{x.source === "booking" && <span className="shrink-0 rounded-full bg-blue-50 px-1.5 text-[10.5px] font-semibold text-cyan ring-1 ring-blue-100">booked</span>}<span className="truncate">{x.inspection_type}</span></span>
                    <span className="mt-0.5 block truncate text-[12px] text-fg-3">{shortNo(x.no)} · {x.arrival_at} · {laneNote(x)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between px-5 py-3 text-[13px] text-fg-3">
            <span>Page {D.page} of {D.pages} · {D.total} vehicles</span>
            <span className="flex gap-2"><button className="btn btn-sm" disabled={D.page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Previous</button><button className="btn btn-sm" disabled={D.page >= D.pages} onClick={() => setPage((p) => p + 1)}>Next ›</button></span>
          </div>
        </>
      )}
    </Panel>
  );
}

/** Every issued report: the verdict, the vehicle, when, and the public QR check. */
function Reports() {
  const d = useFetch<any[]>("/api/reports", { limit: 60 });
  const [q, setQ] = useState("");
  const rows = (d.data || []).filter((r) => !q || `${r.plate} ${r.kind} ${r.verdict} ${r.report_id}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Panel title={`Issued reports${d.data ? ` (${d.data.length})` : ""}`} action={<><Source kind="live_logic" text="Hash-chained · QR verified" /></>}
      sub="Reports issued from the lane inspections in the app. The day's planned inspections on the dashboard are synthetic and have no report.">
      <label className="mb-3 flex w-full items-center gap-2 rounded-full border border-white/80 bg-white/80 px-4 py-2 shadow-glass sm:w-[320px]">
        <Icon name="search" size={16} color="#64748B" />
        <input className="w-full bg-transparent text-[13.5px] focus:outline-none" placeholder="Plate, verdict or report no." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter the reports" />
      </label>
      {!d.data ? <LoadingState label="Loading the reports…" rows={4} /> : !rows.length ? (
        <Empty title={q ? "No report matches" : "No reports issued yet"}>{q ? "Try another search." : "A report is issued from the final review once every critical finding has a decision."}</Empty>
      ) : (
        <>
          <div className="-mx-2 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-left text-[13.5px]">
              <thead className="text-[12.5px] text-fg-3"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium"><th>Vehicle</th><th>Inspection</th><th>Verdict</th><th>Health</th><th>Issued</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.report_id} className="border-t border-ink-600/50 [&>td]:px-3 [&>td]:py-2.5">
                    <td className="whitespace-nowrap"><Link className="font-bold hover:text-cyan" href={`/vehicles/${encodeURIComponent(r.plate)}`}>{r.plate}</Link><div className="font-mono text-[11.5px] text-fg-3">{r.report_id}</div></td>
                    <td>{r.kind}{r.data?.synthetic ? <span className="ml-2 text-[11.5px] text-fg-4">synthetic</span> : null}</td>
                    <td><ReportVerdict v={r.verdict} /></td>
                    <td>{r.data?.health?.score ?? <span className="text-[12px] text-fg-4">Not scored</span>}</td>
                    <td className="whitespace-nowrap text-fg-3">{issued(r.created_at)}</td>
                    <td className="text-right"><span className="inline-flex gap-2"><Link className="btn btn-sm" href={`/report?id=${r.report_id}`}>Report</Link><Link className="btn btn-sm" href={`/verify/${r.verify_token}`}>Verify</Link></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((r) => (
              <li key={r.report_id} className="rounded-2xl bg-white/70 p-3 ring-1 ring-ink-600/60">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 leading-tight"><Link className="text-[14.5px] font-bold hover:text-cyan" href={`/vehicles/${encodeURIComponent(r.plate)}`}>{r.plate}</Link>
                    <span className="block truncate text-[12.5px] text-fg-2">{r.kind}{r.data?.synthetic ? " · synthetic" : ""}</span></span>
                  <ReportVerdict v={r.verdict} />
                </div>
                <div className="mt-1 text-[12px] text-fg-3">{issued(r.created_at)} · {r.data?.health?.score != null ? `health ${r.data.health.score}` : "not scored"} · <span className="font-mono">{r.report_id}</span></div>
                <div className="mt-2 flex gap-2"><Link className="btn btn-sm flex-1" href={`/report?id=${r.report_id}`}>Report</Link><Link className="btn btn-sm flex-1" href={`/verify/${r.verify_token}`}>Verify</Link></div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function ReportVerdict({ v }: { v: string }) {
  const x = VERDICT_PILL[v] || { label: v, tone: "gray" as Tone };
  return <StatusPill tone={x.tone}>{x.label}</StatusPill>;
}

const SECONDARY: [string, string][] = [["schedule", "Today's schedule"], ["reports", "Reports"]];

function Inspections() {
  const sp = useSearchParams();
  const router = useRouter();
  const list = useFetch<any[]>("/api/inspections", { limit: 100 });
  useLive(["inspections"], () => list.reload());
  useEffect(() => {
    const t = setInterval(list.reload, 5000);
    return () => clearInterval(t);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  const counts = {} as Record<Bucket, number>;
  for (const b of BUCKETS) counts[b.k] = 0;
  for (const i of list.data || []) {
    const b = bucketOf(i);
    if (b && !isSuperseded(i, list.data || [])) counts[b]++;
  }
  const asked = sp.get("tab");
  // no tab asked for: the most relevant one that has something in it
  const fallback: Bucket = DEFAULT_ORDER.find((k) => counts[k] > 0) || "examiner";
  const tab = asked && (BUCKETS.some((b) => b.k === asked) || SECONDARY.some(([k]) => k === asked)) ? asked : fallback;
  const go = (k: string) => router.replace(`/inspection?tab=${k}`, { scroll: false });
  const all = [...BUCKETS.map((b) => b.k as string), ...SECONDARY.map(([k]) => k)];
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const at = all.indexOf(tab);
    const next = all[(at + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
    go(next);
    (e.currentTarget.querySelector(`[data-tab='${next}']`) as HTMLElement | null)?.focus();
  };
  const tabCls = (on: boolean) => `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2 text-[13px] font-semibold transition sm:px-3 ${on ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow" : "text-fg-2 hover:bg-white"}`;
  return (
    <Shell>
      <PageHeader eyebrow="Inspection Management" title="Inspection Management" sub="Every live inspection by where it stands, today's schedule at the hub, and every issued report." />
      <div role="tablist" aria-label="Inspection views" onKeyDown={onKey} className="mb-5 flex max-w-full flex-wrap items-center gap-1 rounded-2xl border border-white/80 bg-white/60 p-1 shadow-glass">
        {BUCKETS.map((b) => {
          const on = tab === b.k;
          const n = counts[b.k];
          return (
            <button key={b.k} data-tab={b.k} role="tab" aria-selected={on} onClick={() => go(b.k)} className={tabCls(on)}>
              {b.label}
              <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${on ? "bg-white/25 text-white" : n ? (b.k === "examiner" || b.k === "senior" ? "bg-red-100 text-red-700" : "bg-ink-700 text-fg-2") : "bg-ink-700/60 text-fg-4"}`}>{list.data ? n : "·"}</span>
            </button>
          );
        })}
        <span className="mx-0.5 hidden h-6 w-px bg-ink-500/70 sm:block" aria-hidden />
        {SECONDARY.map(([k, l]) => (
          <button key={k} data-tab={k} role="tab" aria-selected={tab === k} onClick={() => go(k)} className={`${tabCls(tab === k)} ${tab === k ? "" : "font-medium text-fg-3"}`}>{l}</button>
        ))}
      </div>
      {tab === "schedule" ? <Schedule /> : tab === "reports" ? <Reports /> : (
        <>
          <Queue list={list} tab={tab as Bucket} setTab={go} />
          <LaneReplays list={list.data} />
        </>
      )}
    </Shell>
  );
}

export default function Page() {
  return <Suspense><Inspections /></Suspense>;
}
