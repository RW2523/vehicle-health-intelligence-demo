"use client";
import { useEffect, useRef, useState } from "react";
import { api, wsUrl } from "./api";

export type LiveMsg = { channel: string; type: string; data: any };

/** Subscribe to WebSocket channels. Reconnects automatically; calls onMessage for every message. */
export function useLive(channels: string[], onMessage: (m: LiveMsg) => void, enabled = true) {
  const cb = useRef(onMessage);
  cb.current = onMessage;
  const [connected, setConnected] = useState(false);
  const key = channels.join(",");
  useEffect(() => {
    if (!enabled || !key) return;
    let ws: WebSocket | null = null;
    let stop = false;
    let retry: any;
    const open = () => {
      ws = new WebSocket(wsUrl(key.split(",")));
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!stop) retry = setTimeout(open, 1500);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (e) => {
        try {
          cb.current(JSON.parse(e.data));
        } catch {}
      };
    };
    open();
    return () => {
      stop = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [key, enabled]);
  return connected;
}

/** Fetch JSON once (and on deps change) with loading / error state. */
export function useFetch<T = any>(path: string | null, params?: Record<string, any>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const pkey = JSON.stringify(params ?? {});
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    api
      .get(path, params)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, pkey, tick, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

/** Malaysia time clock. */
export function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
