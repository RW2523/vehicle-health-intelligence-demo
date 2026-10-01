"use client";
/* Shared live-inspection state: loads the latest inspection for a lane (or an id), backfills the stored readings,
   then applies WebSocket messages as they arrive. Used by the lane and examiner consoles. */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { laneOf } from "./format";
import { LiveMsg, useLive } from "./live";

export type Live = {
  insp: any | null;
  step: string;
  player: any | null;
  enose: { t: number; ch: number[] }[];
  obd: { t: number; rpm: number | null; coolant: number | null }[];
  pn: { t: number; v: number }[];
  brake: Record<string, { t: number; f: number }[]>;
  instruments: Record<string, any>;
  results: Record<string, any>;
  alerts: any[];
  fusion: any | null;
};

const empty = (): Live => ({ insp: null, step: "", player: null, enose: [], obd: [], pn: [], brake: {}, instruments: {}, results: {}, alerts: [], fusion: null });

/** A decision made on the client is never undone by a replayed "alert raised" message or a stale fetch. */
function keepDecided(incoming: any, existing: any | undefined) {
  if (existing && existing.status !== "open" && incoming.status === "open")
    return { ...incoming, status: existing.status, decided_by: existing.decided_by, reason: existing.reason, decided_at: existing.decided_at };
  return incoming;
}

function sortAlerts(a: any[]) {
  return [...a].sort((x, y) => (x.rank || 999) - (y.rank || 999) || (y.fail_item ? 1 : 0) - (x.fail_item ? 1 : 0));
}

export function useInspection(opts: { lane?: string; session?: string; id?: string }) {
  const [s, setS] = useState<Live>(empty);
  const [notFound, setNotFound] = useState(false);
  const idRef = useRef<string | null>(null);
  // Only the newest full load may apply (seq), and live messages that arrive while one is in flight wait for it
  // (pending), so a partial picture never replaces the full one or shows before it.
  const seq = useRef(0);
  const pending = useRef<LiveMsg[] | null>(null);
  const apply = useRef<(m: LiveMsg) => void>(() => {});

  const loadFull = useCallback(async (id?: string) => {
    const my = ++seq.current;
    const newest = () => my === seq.current;
    if (!pending.current) pending.current = [];
    try {
      const d = id
        ? await api.get(`/api/inspections/${id}`)
        : await api.get("/api/inspections/latest", { lane_id: opts.lane, session_id: opts.session });
      if (!newest()) return;
      if (!d) {  // nothing has run on this lane / session yet
        idRef.current = null;
        setNotFound(true);
        setS(empty());
        return;
      }
      idRef.current = d.inspection_id;
      setNotFound(false);
      const [en, obd, pn, br] = await Promise.all(
        ["enose", "obd", "pn", "brake"].map((k) => api.get(`/api/inspections/${d.inspection_id}/readings`, { sensor: k, limit: 3000 }).catch(() => [])),
      );
      if (!newest()) return;
      const brake: Record<string, any[]> = {};
      br.forEach((r: any) => (brake[r.wheel] ||= []).push({ t: r.t_s, f: r.force_kn }));
      setS((prev) => ({
        insp: d, step: d.step, player: prev.insp?.inspection_id === d.inspection_id ? prev.player : null,  // a reload keeps the replay clock
        enose: en.map((r: any) => ({ t: r.t_s, ch: r.ch })),
        obd: obd.map((r: any) => ({ t: r.t_s, rpm: r.engine_rpm, coolant: r.coolant_temp_c })),
        pn: pn.map((r: any) => ({ t: r.t_s, v: r.pn_per_cm3 })),
        brake,
        instruments: d.results?.instruments || {},
        results: d.results || {},
        alerts: sortAlerts((d.alerts || []).map((a: any) =>
          prev.insp?.inspection_id === d.inspection_id ? keepDecided(a, prev.alerts.find((p) => p.alert_id === a.alert_id)) : a)),
        fusion: d.fusion?.health ? d.fusion : null,
      }));
    } catch (e: any) {
      if (newest() && e.status === 404) {
        setNotFound(true);
        setS(empty());
      }
    } finally {
      if (newest()) {  // then the live messages that arrived meanwhile, on top of the full state
        const q = pending.current || [];
        pending.current = null;
        q.forEach((m) => apply.current(m));
      }
    }
  }, [opts.lane, opts.session]);

  useEffect(() => {
    loadFull(opts.id);
  }, [loadFull, opts.id]);

  // before the first run there is no inspection yet: listen on the session's lane so the page fills in when it starts
  const lane = s.insp?.lane_id || opts.lane || laneOf(opts.session);
  const channels = [lane ? `lane:${lane}` : "", idRef.current ? `inspection:${idRef.current}` : ""].filter(Boolean);
  const handle = (m: LiveMsg) => {
    const d = m.data;
    if (m.type === "player") {
      setS((x) => ({ ...x, player: d }));
      return;
    }
    if (m.type === "inspection") {
      if (d.inspection_id !== idRef.current) {
        idRef.current = d.inspection_id;
        setNotFound(false);
        setS({ ...empty(), insp: { ...d, status: "in_lane", alerts: [], results: {}, measurements: {}, plate: d.vehicle?.plate } });
        // and fetch what it already has: on connect the server replays only the last message of each kind (one alert,
        // the health score), which looks complete but is not, for an inspection under way or finished
        loadFull(d.inspection_id);
      }
      return;
    }
    if (d?.inspection_id && idRef.current && d.inspection_id !== idRef.current && m.type === "alert") return;
    setS((x) => {
      switch (m.type) {
        case "step":
          return { ...x, step: d.step, insp: x.insp ? { ...x.insp, step: d.step, status: d.step === "examiner_review" || d.step === "report" || d.step === "done" ? (x.insp.status === "in_lane" ? "review" : x.insp.status) : x.insp.status } : x.insp };
        case "enose":
          return { ...x, enose: [...x.enose.slice(-1500), { t: d.t_s, ch: d.ch }] };
        case "obd":
          return { ...x, obd: [...x.obd.slice(-900), { t: d.t_s, rpm: d.engine_rpm, coolant: d.coolant_temp_c }] };
        case "pn":
          return { ...x, pn: [...x.pn, { t: d.t_s, v: d.pn_per_cm3 }] };
        case "brake": {
          const b = { ...x.brake };
          b[d.wheel] = [...(b[d.wheel] || []), { t: d.t_s, f: d.force_kn }];
          return { ...x, brake: b };
        }
        case "instrument":
          return { ...x, instruments: { ...x.instruments, [d.field]: d } };
        case "result":
          return { ...x, results: { ...x.results, [d.key]: d.value } };
        case "alert": {
          const others = x.alerts.filter((a) => a.alert_id !== d.alert_id);
          return { ...x, alerts: sortAlerts([...others, keepDecided(d, x.alerts.find((a) => a.alert_id === d.alert_id))]) };
        }
        case "alert_retracted":
          return { ...x, alerts: x.alerts.filter((a) => a.alert_id !== d.alert_id) };
        case "decision":
          return { ...x, alerts: x.alerts.map((a) => (a.alert_id === d.alert_id ? { ...a, ...d } : a)) };
        case "fusion":
          return { ...x, fusion: d, insp: x.insp ? { ...x.insp, status: "review", route: d.route, health_score: d.health?.score } : x.insp };
        case "report":
          return { ...x, insp: x.insp ? { ...x.insp, status: "reported", report: d, verdict: d.verdict } : x.insp };
        default:
          return x;
      }
    });
    if (m.type === "fusion") setTimeout(() => idRef.current && loadFull(idRef.current), 300);
  };
  apply.current = handle;
  const connected = useLive(channels, (m) => {
    if (pending.current && m.type !== "player") pending.current.push(m);
    else handle(m);
  });

  return { ...s, notFound, connected, reload: () => loadFull(idRef.current || undefined), setAlerts: (fn: (a: any[]) => any[]) => setS((x) => ({ ...x, alerts: fn(x.alerts) })) };
}
