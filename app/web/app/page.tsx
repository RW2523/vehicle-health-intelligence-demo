"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { GuideCard } from "@/components/Guide";
import { PlayerControls, useSessions } from "@/components/Player";
import { Shell } from "@/components/Shell";
import { Card, PageHeader, Pill, Source } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtN, llmLabel } from "@/lib/format";

const LINKS: Record<string, { href: string; label: string }[]> = {
  S1: [{ href: "/lane?lane=BR00-L3", label: "Lane console" }, { href: "/examiner?session=S1", label: "Examiner" }],
  S2: [{ href: "/lane?lane=BR01-L2", label: "Lane console" }, { href: "/examiner?session=S2", label: "Examiner" }],
  S3: [{ href: "/lane?lane=BR02-L1", label: "Lane console" }, { href: "/examiner?session=S3", label: "Examiner" }],
  S4: [{ href: "/hq", label: "HQ integrity & maintenance" }],
  S5: [{ href: "/fleet?fleet=FLEET07", label: "Fleet portal (FLEET07)" }, { href: "/regulator", label: "Regulator view" }],
  S6: [{ href: "/owner?plate=DMO%209006", label: "Owner app" }],
};
const FEATURES: Record<string, string> = {
  S1: "5, 7, 8, 10–13, 15, 16, 19–21, 23, 24", S2: "8, 11, 12, 17–19, 24, 25, 32", S3: "5, 6, 9, 13, 14, 22, 24",
  S4: "23, 26, 31", S5: "20, 27–30", S6: "1–4, 25",
};

export default function DemoControl() {
  const { sessions, setPlayer } = useSessions();
  const [status, setStatus] = useState<any>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const load = () => api.get("/api/system/status").then(setStatus).catch(() => setStatus(null)).finally(() => setChecked(true));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <Shell>
      <PageHeader title="Demo control" sub="Six scripted sessions. Lane sessions replay real-time sensor streams; every result downstream is computed live."
        actions={<><Source kind="simulated" text="Sensor streams: simulated" /><Source kind="live_model" /><Source kind="real" /></>} />
      <GuideCard s1Player={sessions.find((s) => s.session_id === "S1")?.player} />
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div id="sessions" className="grid scroll-mt-20 grid-cols-1 gap-4 lg:grid-cols-2">
          {sessions.map((s) => (
            <Card key={s.session_id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Pill color="#22D3EE">{s.session_id}</Pill>
                    <span className="text-[12px] text-fg-3">Features {FEATURES[s.session_id]}</span>
                  </div>
                  <h2 className="mt-2 font-display text-[16px] font-semibold leading-snug">{s.title}</h2>
                  {s.vehicle && (
                    <p className="mt-1 text-[12.5px] text-fg-3">{s.vehicle.plate} · {s.vehicle.make} {s.vehicle.model} · {s.vehicle.year} · {fmtN(s.vehicle.odometer_km)} km</p>
                  )}
                </div>
                {s.kind === "lane" && <span className="chip border-ink-500 text-fg-3">{s.lane_id}</span>}
              </div>
              {s.kind === "lane" ? (
                <PlayerControls s={s} onState={setPlayer} />
              ) : (
                <p className="mt-3 text-[13px] text-fg-2">
                  {s.session_id === "S4" && "Examiner integrity analytics, the hash-chain audit and lane-equipment maintenance run on the HQ dashboard."}
                  {s.session_id === "S5" && "Fleet FLEET07 (44 trucks): next-Berkala fail risk and bulk rebooking; the regulator view shows defect trends and roadside remote sensing."}
                  {s.session_id === "S6" && "An owner asks the assistant in BM, books a GEAR slot, runs a self-check (tint and headlamp fail, then pass) and sees the passport update."}
                </p>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                {LINKS[s.session_id].map((l) => (
                  <Link key={l.href} href={l.href} className="btn btn-sm">{l.label} →</Link>
                ))}
              </div>
            </Card>
          ))}
        </div>
        <Card title="Under the hood" right={<Source kind="real" text="Live pipeline status" />}>
          {!status ? (
            <p className={`text-[13px] ${checked ? "text-bad" : "text-fg-3"}`}>{checked ? "The API is not reachable. Start the backend (see README)." : "Loading…"}</p>
          ) : (
            <div className="flex flex-col gap-4 text-[13px]">
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Database", status.database], ["Message bus", status.bus.kind], ["Bus messages", fmtN(status.bus.published)],
                  ["WebSocket clients", status.websocket.clients], ["Model calls", fmtN(status.processor.model_calls)],
                  ["Readings stored", fmtN(status.counts.readings)], ["Evidence entries", fmtN(status.counts.evidence_entries)],
                  ["Assistant / reports", llmLabel(status.llm.backend) || "Template engine"],
                  ["Photo explanations", llmLabel(status.vlm?.backend) || "Off"],
                ].map(([k, v]) => (
                  <div key={k as string} className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-2">
                    <div className="text-[11px] text-fg-3">{k}</div>
                    <div className="font-semibold">{v}</div>
                  </div>
                ))}
              </div>
              {status.llm.note && <p className="text-[12px] text-fg-3">{status.llm.note}</p>}
              <div>
                <div className="label mb-2">Models</div>
                <ul className="flex flex-col gap-2">
                  {status.models.map((m: any) => (
                    <li key={m.key} className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{m.title}</span>
                        <Source kind={m.runs_as} />
                      </div>
                      <div className="mt-1 text-[11.5px] text-fg-3">{metricLine(m)}</div>
                    </li>
                  ))}
                </ul>
              </div>
              {Object.keys(status.processor.latency_ms || {}).length > 0 && (
                <div>
                  <div className="label mb-2">Last model latency (ms)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(status.processor.latency_ms).map(([k, v]: any) => (
                      <span key={k} className="chip border-ink-500 text-fg-2">{k} {v}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
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
    case "enose": return `accuracy ${(x.holdout_accuracy_random_split * 100).toFixed(1)}% random split · ${(x.holdout_accuracy_later_batches_drift * 100).toFixed(1)}% on later batches (drift)`;
    case "acoustic": return `CV accuracy ${(x.cv_accuracy * 100).toFixed(1)}% · macro-F1 ${x.cv_macro_f1} · fingerprint EER ${(x.fingerprint_eer * 100).toFixed(0)}%`;
    case "soh": return `SOH from discharge MAE ${x.soh_from_discharge_mae_pct} pts (NASA)`;
    case "fusion": return `health AUC ${x.health.holdout_auc_time_split} · next-fail AUC ${x.next_fail.holdout_auc} · flood AUC ${x.flood.holdout_auc_physical_evidence_only} (physical evidence)`;
    case "demand": return `14-day MAPE ${(x.holdout_mape * 100).toFixed(1)}% vs ${(x.naive_last_week_mape * 100).toFixed(1)}% naive`;
    default: return "";
  }
}
