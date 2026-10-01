"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Panel, ProgressBar, StatusPill, Tone } from "@/components/glass";
import { Icon } from "@/components/icons";
import { PlayerControls, useSessions } from "@/components/Player";
import { Shell } from "@/components/Shell";
import { Empty, LoadingState, PageHeader, Source } from "@/components/ui";
import { VehicleArt } from "@/components/VehicleArt";
import { VehicleImage } from "@/components/VehicleImage";
import { useUser } from "@/lib/auth";
import { LANE_SESSIONS, STATUS_LABEL, STEP_LABEL, laneLabel } from "@/lib/format";
import { useFetch, useLive } from "@/lib/live";

const SCHED: Record<string, { label: string; tone: Tone }> = {
  completed: { label: "Completed", tone: "green" }, in_progress: { label: "In Lane", tone: "amber" }, in_queue: { label: "In Queue", tone: "blue" },
  scheduled: { label: "Scheduled", tone: "gray" },
};
const RESULT: Record<string, { label: string; tone: Tone }> = { PASS: { label: "Pass", tone: "green" }, FAIL: { label: "Fail", tone: "red" }, PASS_ADVISORY: { label: "Pass · advisory", tone: "amber" } };
const LIVE: Record<string, Tone> = { in_lane: "amber", review: "purple", decided: "purple", reported: "green" };
const STEPS = ["check_in_anpr", "identity_ocr", "emission_idle_rev", "brake_roller", "suspension", "side_slip", "headlamp_tint", "undercarriage_ai", "above_carriage_ai", "examiner_review", "report"];

function LiveInspections() {
  const user = useUser();
  const list = useFetch<any[]>("/api/inspections", { limit: 40 });
  const { sessions, setPlayer } = useSessions();
  useLive(["inspections"], () => list.reload());
  useEffect(() => {
    const t = setInterval(list.reload, 5000);
    return () => clearInterval(t);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  const canRun = user?.role === "presenter" || user?.role === "examiner";
  const latest: Record<string, any> = {};
  for (const i of list.data || []) if (!latest[i.lane_id]) latest[i.lane_id] = i;
  return (
    <>
      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {LANE_SESSIONS.map((l) => {
          const i = latest[l.lane];
          const s = sessions.find((x) => x.session_id === l.session);
          const step = i && i.status === "in_lane" ? Math.max(0, STEPS.indexOf(i.step)) + 1 : STEPS.length;
          return (
            <div key={l.lane} className="card flex flex-col p-4">
              <div className="flex items-center justify-between gap-2">
                <b className="text-[15px]">{laneLabel(l.lane)} · Central Inspection Hub</b>
                {i ? <StatusPill tone={LIVE[i.status] || "gray"} dot>{i.report || i.status === "reported" ? `Reported · ${i.verdict}` : STATUS_LABEL[i.status] || i.status}</StatusPill> : <StatusPill tone="gray">Idle</StatusPill>}
              </div>
              <VehicleArt vtype={l.session === "S1" ? "Prime mover" : l.session === "S2" ? "SUV" : l.session === "S7" ? "Hatchback" : "Sedan"} seed={l.plate} className="mx-auto my-2 h-[84px] w-full max-w-[210px]" />
              <div className="text-[18px] font-bold">{l.plate}</div>
              <div className="text-[13px] text-fg-2">{l.car}</div>
              <div className="truncate text-[12.5px] text-fg-3">{i ? i.inspection_type : s?.title?.split(" · ")[1] || "Lane replay"}</div>
              {i && i.status === "in_lane" && <div className="mt-2 flex items-center gap-2"><ProgressBar value={(100 * step) / STEPS.length} /><span className="w-24 truncate text-right text-[12px] text-fg-3">{STEP_LABEL[i.step] || "starting"}</span></div>}
              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                {i ? <Link className="btn btn-primary btn-sm" href={`/inspection/${i.inspection_id}`}>Open inspection<Icon name="chev" size={14} /></Link> : null}
                {s && canRun && <PlayerControls s={s} onState={setPlayer} compact quiet={!!i} />}
              </div>
            </div>
          );
        })}
      </div>
      <Panel title="Recent inspections" sub="Every live inspection, newest first." pad={false} action={<Source kind="live_model" text="Live analysis · simulated sensors" />}>
        {!list.data ? <div className="px-5 pb-5"><LoadingState rows={4} /></div> : !list.data.length ? (
          <div className="px-5 pb-5"><Empty title="No inspection has run yet">Start a lane replay above, or a use case from the demo control.</Empty></div>
        ) : (
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full min-w-[760px] text-left text-[13.5px]">
              <thead className="text-[12.5px] text-fg-3"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium"><th>Inspection</th><th>Vehicle</th><th>Type</th><th>Lane</th><th>Started</th><th>Health</th><th>Status</th><th /></tr></thead>
              <tbody>
                {list.data.map((i) => (
                  <tr key={i.inspection_id} className="border-t border-ink-600/60 [&>td]:px-3 [&>td]:py-2.5">
                    <td className="font-mono text-[12.5px]">{i.inspection_id}</td>
                    <td><b>{i.plate}</b></td>
                    <td className="max-w-[220px] truncate text-fg-2">{i.inspection_type}</td>
                    <td className="text-fg-2">{laneLabel(i.lane_id)}</td>
                    <td className="whitespace-nowrap text-fg-2">{new Date(i.started_at + "Z").toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td>{i.health_score != null ? Math.round(i.health_score) : "–"}</td>
                    <td><StatusPill tone={i.verdict ? (i.verdict === "PASS" ? "green" : i.verdict === "FAIL" ? "red" : "amber") : LIVE[i.status] || "gray"}>{i.verdict || STATUS_LABEL[i.status] || i.status}</StatusPill></td>
                    <td><Link className="btn btn-sm" href={`/inspection/${i.inspection_id}`}>Open<Icon name="chev" size={14} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

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
        <input className="input ml-auto w-full max-w-[260px]" placeholder="Plate, owner or inspection no." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search today's schedule" />
      </div>
      {!D ? <div className="px-5 pb-5"><LoadingState rows={5} /></div> : !D.items.length ? (
        <div className="px-5 pb-5"><Empty title="No vehicle matches" actions={<button className="btn" onClick={() => { setQ(""); set(""); }}>Clear filters</button>}>Nothing in today&apos;s schedule matches these filters.</Empty></div>
      ) : (
        <>
          <div className="overflow-x-auto px-2">
            <table className="w-full min-w-[900px] text-left text-[13.5px]">
              <thead className="text-[12.5px] text-fg-3"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium"><th>Inspection No.</th><th>Vehicle</th><th>Owner</th><th>Inspection Type</th><th>Arrival</th><th>Lane</th><th>Status</th><th>Result</th></tr></thead>
              <tbody>
                {D.items.map((x: any) => (
                  <tr key={x.no} className="border-t border-ink-600/60 [&>td]:px-3 [&>td]:py-2.5">
                    <td className="font-mono text-[12.5px]">{x.no}</td>
                    <td><Link href={`/vehicles/${encodeURIComponent(x.plate)}`} className="flex items-center gap-2"><VehicleImage plate={x.plate} vtype={x.vtype} photo={x.photo} size="480" className="h-8 w-12 rounded-md" /><span><b className="block hover:text-cyan">{x.plate}</b><span className="text-[12px] text-fg-3">{x.make} {x.model}</span></span></Link></td>
                    <td className="max-w-[170px] truncate text-fg-2">{x.owner}</td>
                    <td className="max-w-[220px] truncate text-fg-2">{x.inspection_type}{x.source === "booking" && <span className="ml-1.5 text-[11px] font-semibold text-cyan">booked</span>}</td>
                    <td className="text-fg-2">{x.arrival_at}</td>
                    <td className="text-fg-2">Lane {x.lane}{x.status === "in_progress" ? ` · ${x.progress}%` : x.status === "in_queue" ? ` · ~${x.wait_min} min` : ""}</td>
                    <td><StatusPill tone={SCHED[x.status].tone}>{SCHED[x.status].label}</StatusPill></td>
                    <td>{x.status === "completed" ? <span title={x.issues.join("; ")}><StatusPill tone={RESULT[x.result].tone}>{RESULT[x.result].label}</StatusPill></span> : <span className="text-fg-4">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-5 py-3 text-[13px] text-fg-3">
            <span>Page {D.page} of {D.pages} · {D.total} vehicles</span>
            <span className="flex gap-2"><button className="btn btn-sm" disabled={D.page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Previous</button><button className="btn btn-sm" disabled={D.page >= D.pages} onClick={() => setPage((p) => p + 1)}>Next ›</button></span>
          </div>
        </>
      )}
    </Panel>
  );
}

const VERDICT_TONE: Record<string, Tone> = { PASS: "green", FAIL: "red", CONDITIONAL: "amber", REFERRED: "blue" };

/** Every issued report: the verdict, the vehicle, when, and the public QR check. */
function Reports() {
  const d = useFetch<any[]>("/api/reports", { limit: 60 });
  const [q, setQ] = useState("");
  const rows = (d.data || []).filter((r) => !q || `${r.plate} ${r.kind} ${r.verdict} ${r.report_id}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Panel title={`Issued reports${d.data ? ` (${d.data.length})` : ""}`} action={<><Source kind="live_logic" text="Hash-chained · QR verified" /></>}>
      <label className="mb-3 flex w-full items-center gap-2 rounded-full border border-white/80 bg-white/80 px-4 py-2 shadow-glass sm:w-[320px]">
        <Icon name="search" size={16} color="#64748B" />
        <input className="w-full bg-transparent text-[13.5px] focus:outline-none" placeholder="Plate, verdict or report no." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter the reports" />
      </label>
      {!d.data ? <LoadingState label="Loading the reports…" rows={4} /> : !rows.length ? (
        <Empty title={q ? "No report matches" : "No reports issued yet"}>{q ? "Try another search." : "A report is issued from the final review once every critical finding has a decision."}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13.5px]">
            <thead className="text-[12px] uppercase tracking-wide text-fg-4"><tr><th className="pb-2 font-semibold">Vehicle</th><th className="font-semibold">Inspection</th><th className="font-semibold">Verdict</th><th className="font-semibold">Health</th><th className="font-semibold">Issued</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.report_id} className="border-t border-ink-600/50">
                  <td className="py-3"><Link className="font-bold hover:text-cyan" href={`/vehicles/${encodeURIComponent(r.plate)}`}>{r.plate}</Link><div className="text-[12px] text-fg-3">{r.report_id}</div></td>
                  <td>{r.kind}{r.data?.synthetic ? <span className="ml-2 text-[11.5px] text-fg-4">synthetic</span> : null}</td>
                  <td><StatusPill tone={VERDICT_TONE[r.verdict] || "gray"}>{r.verdict}</StatusPill></td>
                  <td>{r.data?.health?.score ?? "–"}</td>
                  <td className="text-fg-3">{r.created_at ? new Date(r.created_at + (r.created_at.endsWith("Z") ? "" : "Z")).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "–"}</td>
                  <td className="text-right"><span className="inline-flex gap-2"><Link className="btn btn-sm" href={`/report?id=${r.report_id}`}>Report</Link><Link className="btn btn-sm" href={`/verify/${r.verify_token}`}>Verify</Link></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Inspections() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = sp.get("tab") || "live";
  return (
    <Shell>
      <PageHeader eyebrow="Inspection Management" title="Inspection Management" sub="The lanes running now and every live inspection, today's schedule at the hub, and every issued report." />
      <div role="tablist" aria-label="Inspection views" className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-white/80 bg-white/60 p-1 shadow-glass">
        {[["live", "Live lanes"], ["schedule", "Today's schedule"], ["reports", "Reports"]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => router.replace(`/inspection?tab=${k}`, { scroll: false })}
            className={`rounded-xl px-4 py-2 text-[14px] font-semibold transition ${tab === k ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow" : "text-fg-2 hover:bg-white"}`}>{l}</button>
        ))}
      </div>
      {tab === "schedule" ? <Schedule /> : tab === "reports" ? <Reports /> : <LiveInspections />}
    </Shell>
  );
}

export default function Page() {
  return <Suspense><Inspections /></Suspense>;
}
