"use client";
/* The floating VehicleSense AI assistant: a button in the bottom-right corner of the inspection and oversight apps that
   opens a compact panel. It knows what the screen shows (the vehicle, inspection, finding, lane, appointment or report,
   from the address and from what the page states with useAssistantContext), so "why was this flagged?" is answered about
   the finding in view. "Open full assistant" carries the conversation to /assistant. */
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { AssistantContext, contextFromLocation, usePageAssistantContext } from "@/lib/assistantContext";
import { useUser } from "@/lib/auth";
import { BotAvatar, ChatMsg, MessageBubble, TypingBubble } from "./copilot";
import { Icon } from "./icons";

let seq = 0;
const uid = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`;

/** "Finding AL1d06e329 · inspection LI88de6dc3", "Lane 3", "DMO 9001": what the panel says it is asking about. */
export function contextLabel(c: AssistantContext): string | null {
  if (c.label) return c.label;
  if (c.alert_id) return `Finding ${c.alert_id}${c.inspection_id ? ` · inspection ${c.inspection_id}` : ""}`;
  if (c.inspection_id) return `Inspection ${c.inspection_id}${c.plate ? ` · ${c.plate}` : ""}`;
  if (c.report_id) return `Report ${c.report_id}`;
  if (c.appointment_id) return `Appointment ${c.appointment_id}`;
  if (c.lane_id) return `Lane ${c.lane_id.split("-L").pop()}`;
  if (c.plate) return `Vehicle ${c.plate}`;
  return null;
}

/** Questions that fit the screen. */
export function starterQuestions(c: AssistantContext): string[] {
  if (c.alert_id) return ["Why was this flagged?", "What happens if this finding is confirmed?", "Summarise this inspection"];
  if (c.inspection_id) return ["Summarise this inspection", "Which findings on this inspection still need a decision?", "Show this vehicle's history"];
  if (c.report_id) return ["Why did this vehicle get this result?", "Show this vehicle's history", "When is this vehicle's next appointment?"];
  if (c.appointment_id) return ["Summarise this appointment", "Show this vehicle's history", "Why did this vehicle fail before?"];
  if (c.lane_id) return ["What's on this lane right now?", "What is next on this lane?", "Summarise today at the hub"];
  if (c.plate) return [`Summarise ${c.plate}`, `Show the history of ${c.plate}`, `Why did ${c.plate} fail?`];
  return ["Summarise today at the hub", "Which vehicles have appointments this week?", "What can you do?"];
}

function Dock() {
  const user = useUser();
  const path = usePathname();
  const search = useSearchParams();
  const page = usePageAssistantContext();
  const ctx: AssistantContext = { ...contextFromLocation(path, search.toString()), ...Object.fromEntries(Object.entries(page).filter(([, v]) => v)) };
  const label = contextLabel(ctx);
  const readOnly = user?.role === "viewer";
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [cid, setCid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setTimeout(() => button.current?.focus(), 0);
  }, []);
  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 60);
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, close]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy || readOnly) return;
    setMsgs((ms) => [...ms.filter((m) => !m.error), { id: uid(), role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const r = await api.post("/api/copilot/chat", {
        conversation_id: cid, message: q, plate: null,
        context: { plate: ctx.plate || null, inspection_id: ctx.inspection_id || null, alert_id: ctx.alert_id || null,
                   lane_id: ctx.lane_id || null, appointment_id: ctx.appointment_id || null, report_id: ctx.report_id || null },
      });
      setCid(r.conversation_id);
      setMsgs((ms) => [...ms, { id: uid(), role: "assistant", text: r.answer, source: r.source, facts: r.facts, links: r.links,
                                suggestions: r.suggestions, vehicle: r.vehicle }]);
    } catch (e: any) {
      const status = e instanceof ApiError ? e.status : 0;
      setMsgs((ms) => [...ms, { id: uid(), role: "assistant", text: "", retry: q,
        error: status === 0 || status >= 500 ? "The assistant could not be reached. Check the connection and try again." : e.message || "Something went wrong." }]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  const full = cid ? `/assistant?c=${encodeURIComponent(cid)}` : ctx.plate ? `/assistant?plate=${encodeURIComponent(ctx.plate)}` : "/assistant";
  const last = [...msgs].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <>
      {!open && (
        <button ref={button} onClick={() => setOpen(true)} aria-label="Open the VehicleSense AI assistant" aria-haspopup="dialog"
          className="fixed bottom-4 right-4 z-40 flex h-14 items-center gap-2 rounded-full bg-gradient-to-b from-[#3B82F6] to-[#1D4ED8] pl-2 pr-2 text-white shadow-[0_14px_34px_-12px_rgba(29,78,216,0.85)] ring-4 ring-white/70 transition hover:brightness-110 sm:bottom-6 sm:right-6 sm:pr-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15"><Icon name="bot" size={22} color="#fff" width={1.9} /></span>
          <span className="hidden text-[13.5px] font-semibold sm:inline">Ask VehicleSense AI</span>
        </button>
      )}
      {open && (
        <section role="dialog" aria-label="VehicleSense AI assistant"
          className="fade-in fixed inset-x-2 bottom-2 z-50 flex max-h-[min(640px,calc(100dvh-5rem))] flex-col overflow-hidden rounded-3xl border border-white bg-white/95 shadow-float backdrop-blur-xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[420px]">
          <header className="flex items-center gap-3 border-b border-ink-600 px-4 py-3">
            <BotAvatar size={34} />
            <div className="min-w-0 flex-1 leading-tight">
              <b className="block text-[14.5px]">VehicleSense AI</b>
              <span className="block truncate text-[12px] text-fg-3" title={label || undefined}>{label ? `Asking about ${label}` : "Ask about vehicles, lanes, inspections and rules"}</span>
            </div>
            {msgs.length > 0 && (
              <button className="btn btn-sm" onClick={() => { setMsgs([]); setCid(null); }} aria-label="New conversation"><Icon name="plus" size={14} /></button>
            )}
            <button className="btn btn-sm" onClick={close} aria-label="Close the assistant"><Icon name="close" size={15} /></button>
          </header>
          <div ref={scroller} className="flex min-h-[180px] flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3.5">
            {!msgs.length && (
              <div className="flex flex-col gap-2">
                <p className="text-[13px] text-fg-3">
                  {readOnly ? "The guest viewer can read the suggested questions; asking is open to the staff accounts."
                    : "Answers come from this platform's own records, with the sources cited. Try:"}
                </p>
                {starterQuestions(ctx).map((s) => (
                  <button key={s} disabled={readOnly} onClick={() => send(s)}
                    className="rounded-2xl border border-blue-100 bg-blue-50/50 px-3.5 py-2.5 text-left text-[13.5px] font-medium text-[#1D4ED8] transition enabled:hover:border-cyan/50 enabled:hover:bg-blue-50 disabled:opacity-70">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m) => <MessageBubble key={m.id} m={m} last={m.id === last} onAsk={send} onRetry={send} readOnly={readOnly} />)}
            {busy && <TypingBubble />}
          </div>
          <form className="flex items-end gap-2 border-t border-ink-600 px-3 py-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea ref={inputRef} rows={1} value={input} disabled={readOnly} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder={readOnly ? "Read-only account" : label ? "Ask about this screen…" : "Ask a question…"} aria-label="Your question"
              className="max-h-28 min-h-[42px] flex-1 resize-none rounded-2xl border border-ink-500 bg-white px-3.5 py-2.5 text-[14px] focus:border-cyan focus:outline-none focus:ring-4 focus:ring-blue-100" />
            <button type="submit" className="btn btn-primary h-[42px] px-3" disabled={readOnly || busy || !input.trim()} aria-label="Send"><Icon name="send" size={16} color="#fff" /></button>
          </form>
          <div className="flex items-center justify-between gap-2 px-4 pb-3 text-[12px]">
            <span className="text-fg-4">Cites the platform's records</span>
            <Link href={full} onClick={() => setOpen(false)} className="inline-flex items-center gap-1 font-semibold text-cyan hover:underline">
              Open full assistant<Icon name="arrow" size={13} />
            </Link>
          </div>
        </section>
      )}
    </>
  );
}

export function AssistantDock() {
  return (
    <Suspense>
      <Dock />
    </Suspense>
  );
}
