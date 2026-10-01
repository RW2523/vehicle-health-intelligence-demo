"use client";
/* The inspection in context, on every screen of the inspection journey: which vehicle, which inspection, where and by
   whom, the workflow state, the outcome once the rules produce one, the use-case step and the one next action. */
import { ReactNode } from "react";
import { STATUS_LABEL, laneLabel, scoreColor } from "@/lib/format";
import { VERDICT, WORKFLOW, scoreSeverity, SEVERITY, workflowOf } from "@/lib/present";
import { JourneyStepper, NextAction, UseCase } from "./Demo";

const time = (iso?: string | null) =>
  iso ? new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z").toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" }) : "–";

function Field({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-fg-3">{k}</div>
      <div className="text-[13px] font-semibold leading-snug [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

export function InspectionContextBar({ insp, alerts = [], uc, here, cta, step }: {
  insp: any; alerts?: any[]; uc?: UseCase | null; here?: string; cta?: ReactNode; step?: ReactNode;
}) {
  // the running use case, when this is its inspection (or its inspection has not started yet)
  const sid = insp?.session_id || insp?.session;
  const mine = uc && uc.session && (!insp || sid === uc.session) && (!uc.inspection || !insp || uc.inspection.inspection_id === insp.inspection_id) ? uc : null;
  const wf = WORKFLOW[workflowOf(insp, alerts, !!mine?.complete)];
  const v = insp?.vehicle || {};
  const sev = scoreSeverity(insp?.health_score);
  const verdict = insp?.report?.verdict || insp?.verdict;
  // with a running use case the band under the fields shows its steps and the next action; otherwise the action sits
  // in the head row, beside the vehicle
  const band = !!mine || !!step;
  return (
    <section className="card mb-4 overflow-hidden" aria-label="Inspection in context">
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-[1_1_260px]">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-[22px] font-bold leading-tight">{insp?.plate || uc?.plate || "–"}</span>
              <span className="text-[12.5px] text-fg-3">{[v.make, v.model, v.year].filter(Boolean).join(" ") || uc?.vehicle}</span>
            </div>
            <div className="text-[12px] text-fg-3">{insp?.inspection_type || "No inspection yet"}{insp ? ` · ${insp.inspection_id}` : ""}</div>
          </div>
          {!band && cta && <div className="flex shrink-0 flex-wrap items-center gap-2">{cta}</div>}
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-ink-600/70 pt-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.7fr)_auto_auto]">
          <Field k="Hub · lane">{insp ? <>{insp.branch_name || insp.branch_id}<span className="whitespace-nowrap"> · {laneLabel(insp.lane_id)}</span></> : "–"}</Field>
          <Field k="Examiner">{insp?.examiner?.name ? `${insp.examiner.name}${insp.examiner.senior ? " (senior)" : ""}` : "–"}</Field>
          <Field k="Started">{time(insp?.started_at)}</Field>
          <div className="min-w-0">
            <div className="text-[11px] text-fg-3">Status</div>
            <span className="chip mt-0.5" style={{ borderColor: wf.color + "80", color: wf.color }} title={insp ? STATUS_LABEL[insp.status] || insp.status : ""}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: wf.color }} aria-hidden />{wf.label}
            </span>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-fg-3">Outcome</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {insp?.health_score != null && sev && (
                <span className="chip" style={{ borderColor: scoreColor(insp.health_score) + "80", color: scoreColor(insp.health_score) }} title="Vehicle Health / Risk Score (application estimate)">
                  Health {Math.round(insp.health_score)} · {SEVERITY[sev].label}
                </span>
              )}
              {verdict && <span className="chip font-bold" style={{ borderColor: VERDICT[verdict]?.color, color: VERDICT[verdict]?.color }} title={VERDICT[verdict]?.help}>{verdict}</span>}
              {insp?.health_score == null && !verdict && <span className="text-[12.5px] text-fg-4">After the lane</span>}
            </div>
          </div>
        </div>
      </div>
      {band && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-600 bg-ink-850/60 px-4 py-2.5">
          <div className="min-w-0 flex-1 basis-full md:basis-0">
            {mine ? (
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[11.5px] text-fg-3"><b className="text-cyan">{mine.id}</b> · {mine.title}{!mine.complete && mine.next ? <> · now: <b className="text-fg">{mine.next.label}</b></> : " · complete"}</span>
                <div className="overflow-x-auto"><JourneyStepper steps={mine.steps} compact /></div>
              </div>
            ) : step}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2"><NextAction uc={mine} here={here}>{cta}</NextAction></div>
        </div>
      )}
    </section>
  );
}
