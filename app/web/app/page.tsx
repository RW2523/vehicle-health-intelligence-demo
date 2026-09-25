"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Card, Pill, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { STEP_LABEL, fmtN } from "@/lib/format";
import { useLive } from "@/lib/live";

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

function PlayerControls({ s, onState }: { s: any; onState: (p: any) => void }) {
  const p = s.player;
  const sid = s.session_id;
  const [busy, setBusy] = useState(false);
  const call = async (path: string, body?: any, msg?: string) => {
    setBusy(true);
    try {
      const r = await api.post(`/api/sessions/${sid}/${path}`, body);
      onState(r);
      if (msg) toast(msg);
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  const status = p?.status || "idle";
  const t = p?.t || 0, dur = p?.duration || 480;
  const presets: any[] = s.presets || [];
  const active = (id: string) => {
    const pr = presets.find((x) => x.id === id);
    return pr && Object.entries(pr.overrides).every(([k, v]) => p?.overrides?.[k] === v);
  };
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" disabled={busy} onClick={() => call("start", { speed: p?.speed || 1, overrides: p?.overrides || {} }, `${sid} started`)}>
          {status === "idle" || status === "finished" ? "Start" : "Restart"}
        </button>
        {status === "playing" && <button className="btn" disabled={busy} onClick={() => call("pause")}>Pause</button>}
        {status === "paused" && <button className="btn" disabled={busy} onClick={() => call("resume")}>Resume</button>}
        <button className="btn" disabled={busy} onClick={() => call("start", { fast: true, overrides: p?.overrides || {} }, `${sid} completed instantly`)}>
          Fast-forward
        </button>
        <label className="flex items-center gap-2 text-[12.5px] text-fg-3">
          Speed
          <select aria-label="Speed" className="input py-1.5" value={p?.speed || 1} onChange={(e) => call("speed", { speed: Number(e.target.value) })}>
            {[0.5, 1, 2, 4, 8, 16].map((x) => <option key={x} value={x}>{x}×</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-fg-3">
          Jump to
          <select aria-label="Jump to step" className="input py-1.5" value="" onChange={(e) => e.target.value && call("seek", { step: e.target.value })}>
            <option value="">step…</option>
            {(p?.timeline || []).map((st: any) => <option key={st.step} value={st.step}>{STEP_LABEL[st.step] || st.step}</option>)}
          </select>
        </label>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-[12px] text-fg-3">
          <span>{status === "idle" ? "Not started" : `${STEP_LABEL[p?.step] || p?.step || "–"} · ${status}`}</span>
          <span className="font-mono">{Math.round(t)} / {dur} s</span>
        </div>
        <div className="h-2 rounded bg-ink-600"><div className="h-2 rounded bg-cyan transition-all" style={{ width: `${Math.min(100, (100 * t) / dur)}%` }} /></div>
      </div>
      {presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-fg-3">Change live:</span>
          {presets.map((pr) => (
            <button key={pr.id} className={`btn btn-sm ${active(pr.id) ? "border-cyan bg-cyan/10" : ""}`} aria-pressed={active(pr.id)}
              onClick={() => {
                const ov = { ...(p?.overrides || {}) };
                if (active(pr.id)) Object.keys(pr.overrides).forEach((k) => delete ov[k]);
                else Object.assign(ov, pr.overrides);
                call("overrides", { overrides: ov, replace: true }, active(pr.id) ? `Removed: ${pr.label}` : `Applied: ${pr.label} (affects values from now on)`);
              }}>
              {pr.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DemoControl() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const load = useCallback(() => {
    api.get("/api/sessions").then(setSessions).catch(() => {});
    api.get("/api/system/status").then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => api.get("/api/system/status").then(setStatus).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [load]);
  useLive(["player"], (m) => {
    if (m.type === "state") setSessions((ss) => ss.map((s) => (s.session_id === m.data.session_id ? { ...s, player: m.data } : s)));
  });
  const setPlayer = (p: any) => setSessions((ss) => ss.map((s) => (s.session_id === p.session_id ? { ...s, player: p } : s)));

  return (
    <Shell>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold">Demo control</h1>
          <p className="text-[14px] text-fg-3">Six scripted sessions. Lane sessions replay real-time sensor streams; every result downstream is computed live.</p>
        </div>
        <div className="flex gap-2"><Source kind="simulated" text="Sensor streams: simulated" /><Source kind="live_model" /><Source kind="real" /></div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
            <p className="text-[13px] text-bad">The API is not reachable. Start the backend (see README).</p>
          ) : (
            <div className="flex flex-col gap-4 text-[13px]">
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Database", status.database], ["Message bus", status.bus.kind], ["Bus messages", fmtN(status.bus.published)],
                  ["WebSocket clients", status.websocket.clients], ["Model calls", fmtN(status.processor.model_calls)],
                  ["Readings stored", fmtN(status.counts.readings)], ["Evidence entries", fmtN(status.counts.evidence_entries)],
                  ["Assistant / reports", status.llm.backend],
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
