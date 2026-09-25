"use client";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function handle(r: Response) {
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const j = await r.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {}
    throw new ApiError(r.status, msg);
  }
  return r.json();
}

export const api = {
  get: (path: string, params?: Record<string, any>) => {
    const qs = params
      ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "") as any).toString()
      : "";
    return fetch(path + qs, { cache: "no-store" }).then(handle);
  },
  post: (path: string, body?: any) =>
    fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then(handle),
  upload: (path: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(path, { method: "POST", body: fd }).then(handle);
  },
};

/** WebSocket URL for live updates: /ws on the page's own origin (the web server proxies it to the API) unless
 *  NEXT_PUBLIC_WS_URL is set. */
export function wsUrl(channels: string[]) {
  const base =
    process.env.NEXT_PUBLIC_WS_URL ||
    (typeof window !== "undefined" ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws` : "");
  return `${base}?channels=${encodeURIComponent(channels.join(","))}`;
}
