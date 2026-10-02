"use client";
/* What the screen is about, for the floating assistant: the vehicle, inspection, finding, lane, appointment or report in
   view. The assistant reads most of it from the address itself; a page adds what the address does not say (the finding
   in focus, say) with useAssistantContext. */
import { useEffect, useSyncExternalStore } from "react";

export type AssistantContext = {
  plate?: string | null;
  inspection_id?: string | null;
  alert_id?: string | null;
  lane_id?: string | null;
  appointment_id?: string | null;
  report_id?: string | null;
  /** what the panel shows as "Asking about …" */
  label?: string | null;
};

let page: AssistantContext = {};
const subs = new Set<() => void>();

function emit() {
  subs.forEach((f) => f());
}

/** A page states what it shows; cleared when it unmounts. Pass the same object shape on every render. */
export function useAssistantContext(ctx: AssistantContext) {
  const key = JSON.stringify(ctx);
  useEffect(() => {
    page = { ...ctx };
    emit();
    return () => {
      page = {};
      emit();
    };
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
}

export function usePageAssistantContext(): AssistantContext {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => page, () => page);
}

/** What the address says: /vehicles/{plate}, /inspection/{id}[/findings|/review]?finding=, /lane?lane=, /appointments?id=,
 *  /report?id=, /oversight/flood?vehicle=, /assistant?plate=. */
export function contextFromLocation(pathname: string, search: string): AssistantContext {
  const q = new URLSearchParams(search);
  const ctx: AssistantContext = {};
  let m = pathname.match(/^\/vehicles\/([^/]+)/);
  if (m) ctx.plate = decodeURIComponent(m[1]);
  m = pathname.match(/^\/inspection\/([^/]+)/);
  if (m) {
    ctx.inspection_id = decodeURIComponent(m[1]);
    if (q.get("finding")) ctx.alert_id = q.get("finding");
  }
  if (pathname === "/lane" && q.get("lane")) ctx.lane_id = q.get("lane");
  if (pathname === "/appointments" && q.get("id")) ctx.appointment_id = q.get("id");
  if (pathname === "/report" && q.get("id")) ctx.report_id = q.get("id");
  if (pathname.startsWith("/oversight/flood") && q.get("vehicle")) ctx.plate = q.get("vehicle");
  if (q.get("plate")) ctx.plate = ctx.plate || q.get("plate");
  return ctx;
}
