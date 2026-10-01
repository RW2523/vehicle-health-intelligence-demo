"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActiveUseCaseCard, UseCase, UseCaseCard, startUseCase, useActiveUseCase } from "@/components/Demo";
import { Icon } from "@/components/icons";
import { PlayerControls, useSessions } from "@/components/Player";
import { Shell } from "@/components/Shell";
import { ErrorState, LoadingState, ProvenanceLegend, Source } from "@/components/ui";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { LANE_SESSIONS, fmtN, llmLabel } from "@/lib/format";

const FLOW = [
  { t: "Check-in", d: "Plate camera and booking code" },
  { t: "Inspect", d: "Lane sensors, cameras and AI modules" },
  { t: "Review findings", d: "Each AI finding with its evidence" },
  { t: "Decide", d: "The examiner confirms or dismisses" },
  { t: "Report", d: "Plain-language, QR-verifiable" },
  { t: "Downstream", d: "Owner, fleet, HQ, regulator, buyer" },
];

/** What the product is, in one screen: the pitch, the inspection flow, and where to start. */
function Hero({ onStart, busy, canRun }: { onStart: () => void; busy: boolean; canRun: boolean }) {
  return (
    <section className="card mb-5 overflow-hidden">
      <div className="flex flex-col gap-4 p-5 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[760px]">
            <span className="label text-cyan">VehicleSense AI · vehicle inspection platform</span>
            <h1 className="mt-1 font-display text-[26px] font-semibold leading-tight sm:text-[30px]">Every inspection, from lane to verified result</h1>
            <p className="mt-2 text-[14.5px] leading-relaxed text-fg-2">
              Lane sensors and cameras feed AI models that flag what a person might miss. An examiner decides every finding,
              the report is hash-chained and QR-verifiable, and owners, fleets, HQ and buyers see the outcome.
            </p>
          </div>
          {canRun && (
            <div className="flex flex-col items-start gap-1.5">
              <button className="btn btn-primary btn-lg" disabled={busy} onClick={onStart}>{busy ? "Starting…" : "Start the recommended demo"}<Icon name="arrow" size={16} /></button>
              <span className="text-[12px] text-fg-3">UC-01 · about 6 minutes · then pick any use case below</span>
            </div>
          )}
        </div>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="How an inspection flows">
          {FLOW.map((f, i) => (
            <li key={f.t} className="flex gap-2.5 rounded-xl border border-ink-600 bg-ink-850 px-3 py-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan/15 text-[11px] font-bold text-cyan">{i + 1}</span>
              <span className="min-w-0"><b className="block text-[13px]">{f.t}</b><span className="block text-[11.5px] leading-snug text-fg-3">{f.d}</span></span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export default function DemoControl() {
  const router = useRouter();
  const user = useUser();
  const { sessions, setPlayer } = useSessions();
  const { active } = useActiveUseCase();
  const [list, setList] = useState<UseCase[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [checked, setChecked] = useState(false);
  const canRun = user?.role === "presenter";

  useEffect(() => {
    const load = () => api.get("/api/usecases").then((r) => { setList(r.items); setErr(null); }).catch((e) => setErr(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [active?.id, active?.done]);
  useEffect(() => {
    const load = () => api.get("/api/system/status").then(setStatus).catch(() => setStatus(null)).finally(() => setChecked(true));
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  const start = async (id: string) => {
    setBusy(id);
    await startUseCase(id, (href) => router.push(href));
    setBusy(null);
  };
  const items = (list || []).map((u) => (active && u.id === active.id ? active : u));
  const llm = llmLabel(status?.llm?.backend);
  const lanes = sessions.filter((s) => s.kind === "lane");

  return (
    <Shell>
      <Hero onStart={() => start("UC-01")} busy={busy === "UC-01"} canRun={canRun} />
      {checked && !status && <div className="mb-4"><ErrorState title="The inspection services are not reachable">The pages show what they last loaded. Start the backend (see the README) and this notice clears.</ErrorState></div>}
      {status && !llm && (
        <p className="mb-4 rounded-xl border border-ink-600 bg-ink-850 px-4 py-2.5 text-[13px] text-fg-3">
          The local language model is not reachable, so report summaries and the assistant use the template engine. Every inspection result is still computed live.
        </p>
      )}
      {active && <ActiveUseCaseCard uc={active} busy={busy === active.id} onRestart={() => start(active.id)} />}

      <section id="usecases" className="scroll-mt-20">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-[19px] font-semibold">Use cases <span className="text-[13px] font-normal text-fg-3">· nine end-to-end journeys</span></h2>
          <p className="text-[13px] text-fg-3">{canRun ? "Start one: it opens its first screen, and every page then shows the step and what to do next." : "Read only: the presenter starts the use cases."}</p>
        </div>
        {err && !list ? <ErrorState title="Could not load the use cases" onRetry={() => location.reload()}>{err}</ErrorState>
          : !list ? <LoadingState label="Loading the use cases…" rows={4} />
          : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {items.map((u) => (
                <UseCaseCard key={u.id} uc={u} active={active?.id === u.id} busy={busy === u.id || !canRun} onStart={() => start(u.id)} />
              ))}
            </div>
          )}
      </section>

      <section className="mt-8" aria-label="Presenter controls">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-[17px] font-semibold">Presenter controls · lane replays</h2>
          <p className="text-[12.5px] text-fg-3">Pause, speed up, jump to a step or change a value while a replay runs. Restarting a replay starts a new inspection; seeded data is never deleted.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {lanes.map((s) => {
            const l = LANE_SESSIONS.find((x) => x.session === s.session_id);
            return (
              <div key={s.session_id} className="card card-pad">
                <div className="grid grid-cols-1 items-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-3">{s.session_id} · {l?.label} · Central Inspection Hub</div>
                    <h3 className="font-display text-[15px] font-semibold leading-snug">{s.title}</h3>
                    {s.vehicle && <p className="text-[12px] text-fg-3">{s.vehicle.plate} · {s.vehicle.year} · {fmtN(s.vehicle.odometer_km)} km</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Link className="btn btn-sm" href={`/lane?lane=${s.lane_id}`}>Lane</Link>
                    <Link className="btn btn-sm" href={`/inspection/${s.session_id}`}>Inspection</Link>
                  </div>
                </div>
                {canRun ? <PlayerControls s={s} onState={setPlayer} quiet /> : <p className="mt-2 text-[12.5px] text-fg-3">Status: {s.player?.status || "idle"}</p>}
              </div>
            );
          })}
          {!lanes.length && <LoadingState label="Loading the lane replays…" />}
        </div>
      </section>

      <div className="mt-8 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <details className="card card-pad group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
            <span className="h-title">What the data labels mean</span><span className="text-[12px] text-fg-3 group-open:hidden">Show</span>
          </summary>
          <div className="mt-3"><ProvenanceLegend /></div>
        </details>
        <details className="card card-pad group">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span className="h-title min-w-0 flex-[1_1_240px]">Under the hood · live pipeline and models</span>
            <span className="flex shrink-0 items-center gap-2"><Source kind="live_logic" text="Pipeline status" /><span className="text-[12px] text-fg-3 group-open:hidden">Show</span></span>
          </summary>
          {!status ? <p className={`mt-3 text-[13px] ${checked ? "text-bad" : "text-fg-3"}`}>{checked ? "The API is not reachable." : "Loading…"}</p> : (
            <div className="mt-3 flex flex-col gap-4 text-[13px]">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  ["Database", status.database], ["Message bus", status.bus.kind], ["Bus messages", fmtN(status.bus.published)],
                  ["WebSocket clients", status.websocket.clients], ["Model calls", fmtN(status.processor.model_calls)],
                  ["Evidence entries", fmtN(status.counts.evidence_entries)],
                  ["Assistant / reports", llm || "Template engine"], ["Photo explanations", llmLabel(status.vlm?.backend) || "Off"],
                ].map(([k, v]) => (
                  <div key={k as string} className="min-w-0 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2">
                    <div className="text-[11px] text-fg-3">{k}</div>
                    <div className="truncate font-semibold" title={String(v)}>{v}</div>
                  </div>
                ))}
              </div>
              <ul className="flex flex-col gap-2">
                {status.models.map((m: any) => (
                  <li key={m.key} className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{m.title}</span><Source kind={m.runs_as} /></div>
                    <div className="mt-1 text-[11.5px] text-fg-3">{metricLine(m)}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </details>
      </div>
    </Shell>
  );
}

function metricLine(m: any): string {
  const x = m.metrics;
  if (!m.ready) return "not trained - run make train-vision";
  if (!x) return "computed on request";
  switch (m.key) {
    case "tyre":
    case "damage": return `validation accuracy ${(x.top1_val_accuracy * 100).toFixed(1)}% on ${x.n_val} held-out images`;
    case "corrosion": return `balanced accuracy ${(x.balanced_accuracy * 100).toFixed(0)}% (rust vs clean vehicle photos)`;
    case "enose": return `future R&D, not in the result · accuracy ${(x.holdout_accuracy_random_split * 100).toFixed(1)}% random split · ${(x.holdout_accuracy_later_batches_drift * 100).toFixed(1)}% on later batches (drift)`;
    case "acoustic": return `CV accuracy ${(x.cv_accuracy * 100).toFixed(1)}% · macro-F1 ${x.cv_macro_f1} · fingerprint EER ${(x.fingerprint_eer * 100).toFixed(0)}%`;
    case "soh": return `SOH from discharge MAE ${x.soh_from_discharge_mae_pct} pts (NASA)`;
    case "fusion": return `health AUC ${x.health.holdout_auc_time_split} · next-fail AUC ${x.next_fail.holdout_auc} · flood AUC ${x.flood.holdout_auc_physical_evidence_only} (physical evidence)`;
    case "demand": return `14-day MAPE ${(x.holdout_mape * 100).toFixed(1)}% vs ${(x.naive_last_week_mape * 100).toFixed(1)}% naive`;
    default: return "";
  }
}
