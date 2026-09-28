"use client";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/* View-only public links (VHI_PRESENTER_PIN): the presenter's PIN is kept in this browser and sent with every call.
   When the API refuses a change for want of it, the shell's presenter lock asks for it (PRESENTER_EVENT). */
const PIN_KEY = "vhi.presenterPin";
export const PRESENTER_EVENT = "vhi:presenter-pin";

export function presenterPin(): string | null {
  try {
    return window.localStorage.getItem(PIN_KEY);
  } catch {
    return null;
  }
}

export function setPresenterPin(pin: string | null) {
  try {
    if (pin) window.localStorage.setItem(PIN_KEY, pin);
    else window.localStorage.removeItem(PIN_KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent(PRESENTER_EVENT, { detail: { changed: true } }));
}

function withPin(headers: Record<string, string> = {}) {
  const pin = typeof window !== "undefined" ? presenterPin() : null;
  return pin ? { ...headers, "x-presenter-pin": pin } : headers;
}

async function handle(r: Response) {
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const j = await r.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
      if (j.code === "presenter_pin") window.dispatchEvent(new CustomEvent(PRESENTER_EVENT, { detail: { message: msg } }));
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
    return fetch(path + qs, { cache: "no-store", headers: withPin() }).then(handle);
  },
  post: (path: string, body?: any) =>
    fetch(path, { method: "POST", headers: withPin({ "content-type": "application/json" }), body: JSON.stringify(body ?? {}) }).then(handle),
  upload: (path: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(path, { method: "POST", headers: withPin(), body: fd }).then(handle);
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
