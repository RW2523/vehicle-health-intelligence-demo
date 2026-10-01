"use client";
/* Vehicle Health / Risk Score: the status and the main reason first, the systems that apply to this vehicle (click one
   to see its findings), then how the score is built - model factors kept apart from rule deductions. */
import { ReactNode } from "react";
import { nextFailNote, pct, scoreColor } from "@/lib/format";
import { SEVERITY, scoreSeverity } from "@/lib/present";
import { Bar, ScoreRing, SeverityBadge, Source } from "./ui";

/** The systems that apply: EV battery only for an EV (the others every vehicle has). */
export function applicableSystems(subscores: Record<string, number>, fuel?: string | null) {
  return Object.entries(subscores || {}).filter(([k]) => fuel === "ev" || !k.startsWith("EV"));
}

export function mainReason(h: any): string | null {
  const rule = [...(h?.rules || [])].sort((a: any, b: any) => b.points - a.points)[0];
  const factor = (h?.factors || []).find((f: any) => f.shap > 0);
  if (rule && rule.points >= 5) return `${rule.rule} (−${rule.points} points)`;
  if (factor) return `${factor.label} (model factor)`;
  return rule ? `${rule.rule} (−${rule.points} points)` : null;
}

export function VehicleHealthSummary({ fusion, fuel, active, onPick, extra, compact = false }: {
  fusion: any; fuel?: string | null; active?: string | null; onPick?: (system: string | null) => void; extra?: ReactNode; compact?: boolean;
}) {
  const h = fusion?.health;
  if (!h) return null;
  const sev = scoreSeverity(h.score)!;
  const reason = mainReason(h);
  const systems = applicableSystems(h.subscores, fuel);
  const deducted = h.rules.reduce((x: number, r: any) => x + r.points, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <ScoreRing value={h.score} size={compact ? 84 : 104} label="Health" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge s={sev} />
            <span className="text-[12px] text-fg-3">Vehicle Health / Risk Score · an application estimate, not a mechanical certainty</span>
          </div>
          {reason && <p className="mt-1.5 text-[13.5px]"><span className="text-fg-3">Main reason:</span> <b>{reason}</b></p>}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-fg-2">
            {fusion.next_fail && <span>Next-inspection fail risk <b>{pct(fusion.next_fail.p_fail_next)}</b>{nextFailNote(fusion.next_fail) ? <span className="text-fg-3"> ({nextFailNote(fusion.next_fail)})</span> : null}</span>}
            {fusion.flood && <span>Flood likelihood <b>{pct(fusion.flood.p)}</b></span>}
          </div>
          {extra}
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="label">By system{onPick ? " · click to see its findings" : ""}</span>
          {active && onPick && <button className="text-[12px] text-cyan hover:underline" onClick={() => onPick(null)}>Show all</button>}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {systems.map(([k, v]) => {
            const on = active === k;
            const body = (
              <>
                <div className="flex justify-between gap-2 text-[12.5px]"><span className="truncate">{k}</span><b style={{ color: scoreColor(v) }}>{v}</b></div>
                <Bar value={v} color={scoreColor(v)} />
              </>
            );
            return onPick ? (
              <button key={k} onClick={() => onPick(on ? null : k)} aria-pressed={on}
                className={`rounded-lg px-2 py-1 text-left transition hover:bg-ink-750 ${on ? "bg-cyan/10 ring-1 ring-cyan/60" : ""}`}
                title={`${k}: ${SEVERITY[scoreSeverity(v)!].label}`}>{body}</button>
            ) : <div key={k} className="px-2 py-1">{body}</div>;
          })}
        </div>
      </div>
      <details className="group rounded-xl border border-ink-600 bg-ink-850 px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[12.5px]">
          <span><b>How the score is built</b> <span className="text-fg-3">· model {h.model_score}, minus {deducted} points of rule deductions</span></span>
          <span className="text-fg-3 group-open:hidden">Expand</span>
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2"><span className="label">Model factors</span><Source kind="live_model" text="Fusion model (SHAP)" /></div>
            <ul className="flex flex-col gap-1 text-[12.5px]">
              {h.factors.slice(0, 5).map((f: any) => (
                <li key={f.feature} className="flex justify-between gap-2">
                  <span>{f.label}{f.value != null ? ` (${typeof f.value === "number" ? +f.value.toFixed(2) : f.value})` : ""}</span>
                  <span style={{ color: f.shap > 0 ? "#F87171" : "#34D399" }}>{f.shap > 0 ? "raises risk" : "lowers risk"}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2"><span className="label">Rule deductions</span><Source kind="live_logic" text="What the history model cannot see" /></div>
            <ul className="flex flex-col gap-1 text-[12.5px]">
              {h.rules.length ? h.rules.map((r: any, i: number) => <li key={i} className="flex justify-between gap-2"><span>{r.rule}</span><span className="shrink-0 text-bad">−{r.points}</span></li>)
                : <li className="text-fg-3">None: no rule took points off.</li>}
            </ul>
            {h.rules.length > 0 && <p className="mt-1.5 text-[11.5px] text-fg-3">Computed when the lane finishes, from lane findings the history model cannot see.</p>}
          </div>
        </div>
        {h.not_measured?.length > 0 && <p className="mt-2 text-[11.5px] text-fg-4">Not measured in this lane (typical values used): {h.not_measured.join(", ")}.</p>}
      </details>
    </div>
  );
}
