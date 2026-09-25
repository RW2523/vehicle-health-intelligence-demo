"use client";
/* Session player: start / pause / fast-forward / speed / jump for a scripted lane session, with its live state.
   Used on Demo control (full) and on the lane console (compact), so the presenter never has to switch pages. */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { STEP_LABEL } from "@/lib/format";
import { useLive } from "@/lib/live";
import { toast } from "./ui";

/** Every session with its player state, kept live over the WebSocket. */
export function useSessions() {
  const [sessions, setSessions] = useState<any[]>([]);
  const load = useCallback(() => api.get("/api/sessions").then(setSessions).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  useLive(["player"], (m) => {
    if (m.type === "state") setSessions((ss) => ss.map((s) => (s.session_id === m.data.session_id ? { ...s, player: m.data } : s)));
  });
  const setPlayer = (p: any) => setSessions((ss) => ss.map((s) => (s.session_id === p.session_id ? { ...s, player: p } : s)));
  return { sessions, setPlayer, reload: load };
}

export const playerProgress = (p: any) => {
  const dur = p?.duration || 480;
  return { t: Math.min(Math.round(p?.t || 0), dur), dur, pct: Math.min(100, (100 * (p?.t || 0)) / dur) };
};

export function PlayerControls({ s, onState, compact = false, onFastDone }: { s: any; onState: (p: any) => void; compact?: boolean; onFastDone?: () => void }) {
  const p = s.player;
  const sid = s.session_id;
  const [busy, setBusy] = useState<string | null>(null);
  const call = async (path: string, body?: any, msg?: string) => {
    setBusy(path === "start" && body?.fast ? "fast" : path);
    try {
      const r = await api.post(`/api/sessions/${sid}/${path}`, body);
      onState(r);
      if (msg) toast(msg, "ok");
      if (body?.fast) onFastDone?.();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  };
  const status = p?.status || "idle";
  const running = status === "playing" || status === "paused";
  const { t, dur, pct } = playerProgress(p);
  const presets: any[] = s.presets || p?.presets || [];
  const active = (id: string) => {
    const pr = presets.find((x) => x.id === id);
    return pr && Object.entries(pr.overrides).every(([k, v]) => p?.overrides?.[k] === v);
  };
  const speed = (
    <label className="flex items-center gap-2 text-[12.5px] text-fg-3">
      Speed
      <select aria-label="Speed" className="input py-1.5" value={p?.speed || 1} onChange={(e) => call("speed", { speed: Number(e.target.value) })}>
        {[0.5, 1, 2, 4, 8, 16].map((x) => <option key={x} value={x}>{x}×</option>)}
      </select>
    </label>
  );
  const buttons = (
    <>
      <button className="btn btn-primary" disabled={!!busy} onClick={() => call("start", { speed: p?.speed || (compact ? 4 : 1), overrides: p?.overrides || {} }, `${sid} started - watch it live`)}
        title={running ? "Start this session again from the beginning" : "Replay the lane sensors in real time"}>
        {running ? "Restart" : status === "finished" ? "Run again" : "Start"}
      </button>
      {status === "playing" && <button className="btn" disabled={!!busy} onClick={() => call("pause")}>Pause</button>}
      {status === "paused" && <button className="btn" disabled={!!busy} onClick={() => call("resume")}>Resume</button>}
      <button className="btn" disabled={!!busy} onClick={() => call("start", { fast: true, overrides: p?.overrides || {} }, `${sid} completed instantly`)}
        title="Run the whole session at once (about 5 seconds)">
        {busy === "fast" ? "Fast-forwarding…" : "Fast-forward"}
      </button>
    </>
  );
  if (compact)
    return (
      <div className="flex flex-wrap items-center gap-2">
        {buttons}
        {speed}
      </div>
    );
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {buttons}
        {speed}
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
          <span className="font-mono">{t} / {dur} s</span>
        </div>
        <div className="h-2 rounded bg-ink-600"><div className="h-2 rounded bg-cyan transition-all" style={{ width: `${pct}%` }} /></div>
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
