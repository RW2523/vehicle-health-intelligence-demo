"use client";
/* The Chat Bot: an operations copilot for hub staff (POST /api/copilot/chat). Every answer is built from numbered facts
   taken from the platform's data; the answer cites them as [n], each citation opens its fact and the page it comes
   from, and every answer says which engine wrote it (the local LLM or the template engine). Conversations are kept per
   account: a list on the left (a drawer on phones), new chat, delete. Vehicle chips scope a question to one of the ten
   main vehicles. Text is rendered by a tiny safe renderer (bold, lists, line breaks, citations): never as HTML. */
import Link from "next/link";
import { Fragment, KeyboardEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, api } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { llmLabel } from "@/lib/format";
import { useFetch } from "@/lib/live";
import { Icon } from "./icons";
import { VehiclePhoto, useVehiclePhotos } from "./Photo";
import { Source, toast } from "./ui";

export type Fact = { n: number; text: string; kind: string; href?: string | null; prov?: string };
export type ChatLink = { label: string; href: string };
export type ChatMsg = {
  id: string; role: "user" | "assistant"; text: string; source?: string | null; facts?: Fact[]; links?: ChatLink[];
  suggestions?: string[]; vehicle?: string | null; plate?: string | null; created_at?: string | null; error?: string; retry?: string;
};
export type Conversation = { id: string; title: string; updated_at: string | null; count: number };
export type ChipVehicle = { plate: string; make: string; model: string; year: number; vtype: string; fuel: string; nick: string; fleet: boolean };

export const STARTERS: { q: string; icon: string; sub: string }[] = [
  { q: "Summarise today at the hub", icon: "home", sub: "Lanes, queue, results" },
  { q: "What's on lane 3 right now?", icon: "lane", sub: "Live inspection and findings" },
  { q: "Why did DMO 9001 fail?", icon: "warn", sub: "Report, failed items" },
  { q: "Show the history of the Myvi", icon: "history", sub: "Inspections, odometer, claims" },
  { q: "Which vehicles have appointments this week?", icon: "calendar", sub: "Bookings by day" },
  { q: "What is the brake efficiency limit for a prime mover?", icon: "brake", sub: "Inspection rules" },
  { q: "Which fleet vehicle will reach its tread limit first?", icon: "tyre", sub: "Wear trends and forecasts" },
  { q: "What can you do?", icon: "bot", sub: "Everything I can answer" },
];
const VIEWER_NOTE =
  "You're signed in as the read-only guest viewer. Asking the assistant saves a conversation, so it is open to the staff accounts (examiner, operations, regulator and fleet). You can read the suggested questions here.";
const KIND_LABEL: Record<string, string> = {
  hub: "Today at the hub", lane: "Lane", queue: "Queue", schedule: "Today's plan", inspection: "Live inspection", finding: "Finding",
  verdict: "Verdict", report: "Report", certificate: "Certificate", booking: "Appointment", history: "History", odometer: "Odometer",
  claim: "Insurance claim", trend: "Health trend", forecast: "Forecast", rule: "Inspection rule", measurement: "Measurement",
  kb: "Inspection guide", vehicle: "Vehicle", fee: "Fee",
};

let seq = 0;
const uid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** "just now", "5 min ago", "3 h ago", "yesterday", "28 Sep". */
export function relTime(iso?: string | null, now = Date.now()) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const s = Math.max(0, (now - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" });
}

/** The answer as plain text (for copying): no markup, no citation numbers. */
export const plainText = (t: string) => t.replace(/\*\*/g, "").replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "").trim();

// ------------------------------------------------------------------ safe renderer
const INLINE = /(\*\*[^*\n]+?\*\*|\[\d+(?:\s*[,–-]\s*\d+)*\])/g;

function citeNums(token: string): number[] {
  const out: number[] = [];
  for (const part of token.slice(1, -1).split(",")) {
    const m = part.trim().match(/^(\d+)\s*[–-]\s*(\d+)$/);
    if (m) for (let i = +m[1]; i <= Math.min(+m[2], +m[1] + 9); i++) out.push(i);
    else if (/^\d+$/.test(part.trim())) out.push(+part.trim());
  }
  return out;
}

/** Bold and [n] citations in one line of text; everything else is plain text. */
function Inline({ text, facts, onCite, active }: { text: string; facts: Fact[]; onCite?: (n: number) => void; active?: number | null }) {
  const parts = text.split(INLINE);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (p.startsWith("**") && p.endsWith("**") && p.length > 4)
          return <strong key={i} className="font-semibold text-fg"><Inline text={p.slice(2, -2)} facts={facts} onCite={onCite} active={active} /></strong>;
        if (/^\[\d/.test(p) && p.endsWith("]")) {
          const ns = citeNums(p).filter((n) => facts.some((f) => f.n === n));
          if (!ns.length) return null;
          return <Fragment key={i}>{ns.map((n) => <CitationChip key={n} n={n} fact={facts.find((f) => f.n === n)!} on={active === n} onClick={onCite} />)}</Fragment>;
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

type Block = { kind: "p"; lines: string[] } | { kind: "h"; text: string } | { kind: "ul" | "ol"; items: { text: string; sub: string[]; num?: number }[] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const flush = () => { if (cur) blocks.push(cur); cur = null; };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const indent = line.length - line.trimStart().length;
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    const h = line.match(/^\s*#{1,4}\s+(.*)$/);
    if (!line.trim()) { flush(); continue; }
    if (h) { flush(); blocks.push({ kind: "h", text: h[1] }); continue; }
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      const body = (ul ? ul[1] : ol![2]).trim();
      const c = cur as Block | null;
      if (indent >= 2 && c && (c.kind === "ul" || c.kind === "ol") && c.items.length) { c.items[c.items.length - 1].sub.push(body); continue; }
      if (!c || c.kind !== kind) { flush(); cur = { kind, items: [] } as Block; }
      (cur as any).items.push({ text: body, sub: [], num: ol ? +ol[1] : undefined });
      continue;
    }
    if (cur && (cur as Block).kind === "p") (cur as any).lines.push(line.trim());
    else { flush(); cur = { kind: "p", lines: [line.trim()] }; }
  }
  flush();
  return blocks;
}

/** Renders the model's or the template's text: paragraphs, **bold**, bullet and numbered lists (one level of nesting),
 *  headings as bold lines, line breaks and [n] citations. Only React text nodes: nothing is parsed as HTML. */
export function RichText({ text, facts = [], onCite, active }: { text: string; facts?: Fact[]; onCite?: (n: number) => void; active?: number | null }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const il = (t: string) => <Inline text={t} facts={facts} onCite={onCite} active={active} />;
  return (
    <div className="flex flex-col gap-2 text-[14px] leading-relaxed text-fg-2 [overflow-wrap:anywhere]">
      {blocks.map((b, i) => {
        if (b.kind === "h") return <p key={i} className="font-semibold text-fg">{il(b.text)}</p>;
        if (b.kind === "p") return <p key={i}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{il(l)}</Fragment>)}</p>;
        const List = b.kind === "ul" ? "ul" : "ol";
        return (
          <List key={i} className={`flex flex-col gap-1 pl-5 ${b.kind === "ul" ? "list-disc marker:text-[#93C5FD]" : "list-decimal marker:font-semibold marker:text-fg-3"}`}>
            {b.items.map((it, j) => (
              <li key={j} className="pl-0.5">
                {il(it.text)}
                {it.sub.length > 0 && <ul className="mt-1 flex list-[circle] flex-col gap-0.5 pl-5 marker:text-fg-4">{it.sub.map((s, k) => <li key={k}>{il(s)}</li>)}</ul>}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/** A citation: opens the fact it points to (its text, where it comes from and the page it links to). */
export function CitationChip({ n, fact, on = false, onClick }: { n: number; fact: Fact; on?: boolean; onClick?: (n: number) => void }) {
  return (
    <button type="button" onClick={() => onClick?.(n)} title={fact.text} aria-label={`Source ${n}: ${fact.text}`} aria-pressed={on}
      className={`mx-[1px] inline-flex h-[18px] min-w-[18px] -translate-y-[1px] items-center justify-center rounded-md px-1 align-middle text-[10.5px] font-bold leading-none ring-1 transition ${
        on ? "bg-cyan text-white ring-cyan" : "bg-blue-50 text-[#1D4ED8] ring-blue-200 hover:bg-blue-100"}`}>
      {n}
    </button>
  );
}

/** One fact, as a citation opens it. */
export function FactCard({ fact, onClose }: { fact: Fact; onClose?: () => void }) {
  return (
    <div className="fade-in relative rounded-xl border border-blue-100 bg-[#F5F8FF] p-3 text-[13px]" role="note" aria-label={`Source ${fact.n}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2 pr-7">
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-cyan px-1 text-[11px] font-bold text-white">{fact.n}</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-3">{KIND_LABEL[fact.kind] || fact.kind}</span>
        {fact.prov && <Source kind={fact.prov} />}
      </div>
      {onClose && <button type="button" className="absolute right-2 top-2 rounded-md p-1 text-fg-4 hover:bg-white hover:text-fg" onClick={onClose} aria-label="Close source"><Icon name="close" size={14} /></button>}
      <p className="leading-relaxed text-fg-2 [overflow-wrap:anywhere]">{fact.text}</p>
      {fact.href && (
        <Link href={fact.href} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-cyan hover:underline">
          Open the page<Icon name="arrow" size={13} />
        </Link>
      )}
    </div>
  );
}

export function BotAvatar({ size = 34 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full text-white shadow-md ring-2 ring-white" aria-hidden
      style={{ width: size, height: size, background: "linear-gradient(135deg, #60A5FA, #1D4ED8)" }}>
      <Icon name="bot" size={Math.round(size * 0.55)} color="#fff" width={1.9} />
    </span>
  );
}

/** Which engine is answering now: the local LLM (and its model) or the template engine. */
export function useEngine() {
  const st = useFetch<any>("/api/system/status");
  const llm = st.data?.llm;
  const on = !!llmLabel(llm?.backend);
  return { loaded: !!st.data || !!st.error, on, model: on ? (llm?.model as string) : null, backend: llm?.backend as string | undefined };
}

/** "qwen3:30b-a3b-instruct-2507-q4_K_M" -> "qwen3 30b-a3b" (the full name is in the tooltip). */
export const shortModel = (m: string) => {
  const [name, tag = ""] = m.split("/").pop()!.split(":");
  const t = tag.split("-").filter((x) => !/^(instruct|chat|q\d.*|fp\d+|\d{4})$/i.test(x)).join("-");
  return [name, t].filter(Boolean).join(" ");
};

export function EngineChip({ engine }: { engine: ReturnType<typeof useEngine> }) {
  if (!engine.loaded) return <span className="chip border-ink-500 text-fg-4"><span className="h-1.5 w-1.5 rounded-full bg-fg-4" />Checking engine…</span>;
  return (
    <span className={`chip max-w-full ${engine.on ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-ink-500 bg-white/70 text-fg-2"}`}
      title={engine.on ? `Answers are written by the local LLM (${engine.model}) from the platform's facts` : "No local LLM reachable: the template engine composes answers from the platform's facts"}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${engine.on ? "bg-ok pulse-dot" : "bg-fg-4"}`} aria-hidden />
      <span className="shrink-0">{engine.on ? "Local LLM" : "Template engine"}</span>
      {engine.on && engine.model && <span className="min-w-0 truncate font-medium text-emerald-600/80">· {shortModel(engine.model)}</span>}
    </span>
  );
}

/** "Answered by …": the engine that wrote this answer. */
export function AnsweredBy({ source }: { source?: string | null }) {
  const llm = llmLabel(source);
  const model = llm && source ? source.slice(source.indexOf(":") + 1) : "";
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[11.5px] text-fg-4" title={llm ? `Written by the local LLM (${llm}) from the cited facts` : "Composed by the template engine from the cited facts"}>
      <Icon name={llm ? "bolt" : "list"} size={13} color={llm ? "#0284C7" : "#7C3AED"} />
      <span className="truncate">Answered by {llm ? `the local LLM · ${shortModel(model)}` : "the template engine"}</span>
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    const t = plainText(text);
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(t);
      else {  // plain http on the LAN has no clipboard API: copy through a hidden text box
        const ta = document.createElement("textarea");
        ta.value = t;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (!ok) throw new Error("copy refused");
      }
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      toast("Could not copy: the browser blocked the clipboard", "err");
    }
  };
  return (
    <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-fg-3 hover:bg-white hover:text-fg" aria-label="Copy answer">
      <Icon name={done ? "check" : "copy"} size={13} />{done ? "Copied" : "Copy"}
    </button>
  );
}

/** One message. The assistant's carries its citations, link buttons, sources, the engine and copy. */
export function MessageBubble({ m, last, onAsk, onRetry, readOnly }: {
  m: ChatMsg; last?: boolean; onAsk?: (q: string) => void; onRetry?: (q: string) => void; readOnly?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [sources, setSources] = useState(false);
  if (m.role === "user")
    return (
      <div className="fade-in flex justify-end">
        <div className="max-w-[88%] sm:max-w-[75%]">
          {m.plate && <div className="mb-1 text-right text-[11px] font-semibold text-fg-4">About {m.plate}</div>}
          <div className="rounded-2xl rounded-br-md bg-gradient-to-b from-[#3B82F6] to-[#2563EB] px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-[0_8px_20px_-10px_rgba(37,99,235,0.8)] [overflow-wrap:anywhere] whitespace-pre-wrap">
            {m.text}
          </div>
        </div>
      </div>
    );
  const facts = m.facts || [];
  const fact = active != null ? facts.find((f) => f.n === active) : null;
  return (
    <div className="fade-in flex items-start gap-3">
      <span className="hidden sm:flex"><BotAvatar /></span>
      <div className="min-w-0 max-w-full flex-1 sm:max-w-[88%] sm:flex-initial">
        <div className="mb-1.5 flex items-center gap-1.5 sm:hidden"><BotAvatar size={22} /><span className="text-[11.5px] font-semibold text-fg-3">VehicleSense Assistant</span></div>
        {m.error ? (
          <div className="rounded-2xl rounded-tl-md border border-red-200 bg-red-50/80 px-4 py-3 text-[13.5px] text-fg-2" role="alert">
            <div className="flex items-start gap-2">
              <Icon name="warn" size={17} color="#DC2626" />
              <p className="min-w-0 [overflow-wrap:anywhere]">{m.error}</p>
            </div>
            {m.retry && !readOnly && (
              <button type="button" className="btn btn-sm mt-2" onClick={() => onRetry?.(m.retry!)}><Icon name="refresh" size={14} />Try again</button>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/90 bg-white/85 px-3.5 py-3 shadow-glass backdrop-blur sm:rounded-tl-md sm:px-4">
            <RichText text={m.text} facts={facts} active={active} onCite={(n) => setActive((a) => (a === n ? null : n))} />
            {fact && <div className="mt-3"><FactCard fact={fact} onClose={() => setActive(null)} /></div>}
            {!!m.links?.length && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {m.links.map((l) => (
                  <Link key={l.href} href={l.href} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50/70 px-2.5 py-1.5 text-[12px] font-semibold text-[#1D4ED8] hover:bg-blue-100">
                    <Icon name="link" size={13} /><span className="truncate">{l.label}</span>
                  </Link>
                ))}
              </div>
            )}
            {sources && facts.length > 0 && (
              <ol className="mt-3 flex flex-col gap-1.5 border-t border-ink-600 pt-3 text-[12.5px]" aria-label="Sources">
                {facts.map((f) => (
                  <li key={f.n} className="flex gap-2">
                    <span className="mt-[1px] inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-md bg-blue-50 px-1 text-[10.5px] font-bold text-[#1D4ED8] ring-1 ring-blue-200">{f.n}</span>
                    <span className="min-w-0 leading-snug text-fg-3 [overflow-wrap:anywhere]">
                      {f.text}
                      {f.href && <> <Link href={f.href} className="font-semibold text-cyan hover:underline">Open</Link></>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-ink-600/70 pt-2">
              <AnsweredBy source={m.source} />
              <span className="ml-auto flex items-center gap-0.5">
                {facts.length > 0 && (
                  <button type="button" onClick={() => setSources((s) => !s)} aria-expanded={sources}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-fg-3 hover:bg-white hover:text-fg">
                    <Icon name="doc" size={13} />{sources ? "Hide" : `${facts.length}`} source{facts.length === 1 || sources ? "" : "s"}
                  </button>
                )}
                <CopyButton text={m.text} />
              </span>
            </div>
          </div>
        )}
        {last && !m.error && !!m.suggestions?.length && !readOnly && (
          <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Suggested follow-up questions">
            {m.suggestions.map((s) => (
              <button key={s} type="button" onClick={() => onAsk?.(s)}
                className="max-w-full rounded-full border border-blue-100 bg-white/80 px-3 py-1.5 text-left text-[12.5px] font-medium text-[#1D4ED8] shadow-sm transition hover:border-cyan/50 hover:bg-blue-50">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TypingBubble() {
  return (
    <div className="fade-in flex items-start gap-3" role="status" aria-live="polite">
      <span className="hidden sm:flex"><BotAvatar /></span>
      <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border border-white/90 bg-white/85 px-4 py-3 shadow-glass">
        {[0, 1, 2].map((i) => <span key={i} className="pulse-dot h-2 w-2 rounded-full bg-[#60A5FA]" style={{ animationDelay: `${i * 0.18}s` }} />)}
        <span className="ml-1 text-[12.5px] text-fg-3">Looking it up…</span>
      </div>
    </div>
  );
}

/** The account's conversations: new chat, each one with its title and when it was last used, and delete. */
export function ConversationList({ items, loading, current, onOpen, onNew, onDelete, readOnly }: {
  items: Conversation[]; loading: boolean; current: string | null; onOpen: (id: string) => void; onNew: () => void;
  onDelete: (id: string) => void; readOnly?: boolean;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button type="button" className="btn btn-primary w-full" onClick={onNew}><Icon name="plus" size={16} color="#fff" />New chat</button>
      <div className="mb-1 mt-4 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-4">History</div>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {loading && !items.length && <div className="flex flex-col gap-2 p-1">{[0, 1, 2].map((i) => <span key={i} className="skeleton h-10 rounded-xl" />)}</div>}
        {!loading && !items.length && <p className="px-1 py-3 text-[12.5px] leading-relaxed text-fg-4">{readOnly ? "Conversations appear here for staff accounts." : "Your conversations appear here."}</p>}
        <ul className="flex flex-col gap-1">
          {items.map((c) => {
            const on = c.id === current;
            return (
              <li key={c.id} className={`group relative rounded-xl ${on ? "bg-white shadow-glass ring-1 ring-blue-100" : "hover:bg-white/70"}`}>
                {confirm === c.id ? (
                  <div className="flex items-center gap-1.5 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-bad">Delete this chat?</span>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => { setConfirm(null); onDelete(c.id); }}>Delete</button>
                    <button type="button" className="btn btn-sm" onClick={() => setConfirm(null)}>Keep</button>
                  </div>
                ) : (
                  <>
                    <button type="button" onClick={() => onOpen(c.id)} aria-current={on ? "true" : undefined} className="block w-full rounded-xl py-2 pl-3 pr-10 text-left">
                      <span className={`block truncate text-[13px] ${on ? "font-semibold text-[#1D4ED8]" : "font-medium text-fg"}`}>{c.title}</span>
                      <span className="block truncate text-[11.5px] text-fg-4">{relTime(c.updated_at, now)} · {Math.ceil(c.count / 2)} question{c.count > 2 ? "s" : ""}</span>
                    </button>
                    {!readOnly && (
                      <button type="button" onClick={() => setConfirm(c.id)} aria-label={`Delete “${c.title}”`}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-fg-4 transition hover:bg-red-50 hover:text-bad lg:opacity-0 lg:focus:opacity-100 lg:group-hover:opacity-100">
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** A small picture of a vehicle for its chip: its photo from the image library, or its illustration. */
function ChipThumb({ v }: { v: ChipVehicle }) {
  const photos = useVehiclePhotos(v.plate);
  return (
    <span className="flex h-7 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-b from-[#F1F5F9] to-[#E2E8F0]">
      <VehiclePhoto plate={v.plate} vtype={v.vtype} photo={photos.data?.hero || null} size="480" className="h-7 w-11" alt={`${v.make} ${v.model}`} />
    </span>
  );
}

/** The ten main vehicles: picking one scopes the next questions to it. A sideways strip that snaps to a chip and fades
 *  out at an edge where more chips are hidden. */
export function VehicleChips({ vehicles, value, onChange, disabled }: { vehicles: ChipVehicle[]; value: string | null; onChange: (p: string | null) => void; disabled?: boolean }) {
  const strip = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, vehicles.length]);
  if (!vehicles.length) return null;
  const fade = edge.left || edge.right
    ? `linear-gradient(to right, ${edge.left ? "transparent, #000 32px" : "#000"}, ${edge.right ? "#000 calc(100% - 40px), transparent" : "#000"})`
    : undefined;
  return (
    <div ref={strip} onScroll={measure} className="-mx-1 flex snap-x snap-mandatory scroll-px-1 gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
      style={{ maskImage: fade, WebkitMaskImage: fade }} role="group" aria-label="Ask about a vehicle">
      {vehicles.map((v) => {
        const on = value === v.plate;
        return (
          <button key={v.plate} type="button" disabled={disabled} onClick={() => onChange(on ? null : v.plate)} aria-pressed={on}
            title={`${v.plate} · ${v.make} ${v.model} (${v.year})`}
            className={`flex shrink-0 snap-start items-center gap-2 rounded-xl border py-1 pl-1 pr-2.5 text-left transition disabled:opacity-50 ${
              on ? "border-cyan bg-blue-50 ring-2 ring-blue-100" : "border-white/90 bg-white/75 hover:border-cyan/40 hover:bg-white"}`}>
            <ChipThumb v={v} />
            <span className="leading-tight">
              <span className={`block whitespace-nowrap text-[12px] font-bold ${on ? "text-[#1D4ED8]" : "text-fg"}`}>{v.plate}</span>
              <span className="block whitespace-nowrap text-[10.5px] text-fg-3">{v.nick}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** True on phone widths (under 640 px). */
export function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const f = () => setNarrow(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return narrow;
}

/** The message box: grows with the text; Enter sends, Shift+Enter starts a new line. */
export function Composer({ value, onChange, onSend, busy, disabled, chip, onClearChip, inputRef }: {
  value: string; onChange: (v: string) => void; onSend: () => void; busy: boolean; disabled?: boolean; chip?: string | null;
  onClearChip?: () => void; inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const local = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef || local;
  const narrow = useNarrow();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value, ref]);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!busy && value.trim()) onSend();
    }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!busy && value.trim()) onSend(); }}
      className={`flex items-end gap-2 rounded-2xl border bg-white/90 p-1.5 pl-3 shadow-glass transition focus-within:border-cyan focus-within:ring-4 focus-within:ring-blue-100 ${disabled ? "border-ink-500 opacity-70" : "border-ink-500/80"}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
        {chip && (
          <span className="inline-flex w-fit max-w-full items-center gap-1 rounded-full bg-blue-50 py-0.5 pl-2 pr-1 text-[11.5px] font-semibold text-[#1D4ED8] ring-1 ring-blue-100">
            <Icon name="car" size={12} />About {chip}
            <button type="button" onClick={onClearChip} className="rounded-full p-0.5 hover:bg-blue-100" aria-label={`Stop asking about ${chip}`}><Icon name="close" size={11} /></button>
          </span>
        )}
        <textarea ref={ref} rows={1} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} maxLength={1000}
          placeholder={disabled ? "Asking is open to staff accounts" : chip ? `Ask about ${chip}…` : narrow ? "Ask a question…" : "Ask about a vehicle, a lane, the queue, a report or a rule…"}
          aria-label="Your question" className="max-h-[160px] min-h-[24px] w-full resize-none bg-transparent text-[14px] leading-6 text-fg placeholder:text-fg-4 focus:outline-none disabled:cursor-not-allowed" />
      </div>
      <button type="submit" disabled={busy || disabled || !value.trim()} aria-label="Send"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,0.7)] transition hover:from-[#2563EB] hover:to-[#1D4ED8] disabled:from-[#BFD3FE] disabled:to-[#BFD3FE] disabled:shadow-none">
        {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden /> : <Icon name="send" size={18} color="#fff" />}
      </button>
    </form>
  );
}

/** Before the first question: what the assistant does and questions to start with. */
export function Welcome({ name, onAsk, readOnly }: { name?: string; onAsk: (q: string) => void; readOnly?: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col items-center px-1 py-4 text-center sm:py-6">
      <BotAvatar size={58} />
      <h2 className="mt-4 text-[22px] font-extrabold tracking-tight sm:text-[26px]">{name ? `Hi ${name}, how can I help?` : "How can I help?"}</h2>
      <p className="mt-1.5 max-w-[620px] text-[13.5px] leading-relaxed text-fg-3 sm:text-[14.5px]">
        Ask about today&apos;s lanes and queue, the ten main vehicles, inspections and findings, reports, appointments, fleet health
        trends and the inspection rules. Every answer cites the platform data it comes from.
      </p>
      {readOnly && (
        <div className="mt-4 flex max-w-[620px] items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-left text-[13px] text-amber-900" role="note">
          <span className="mt-0.5 shrink-0"><Icon name="info" size={17} color="#B45309" /></span><span>{VIEWER_NOTE}</span>
        </div>
      )}
      <div className="mt-6 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
        {STARTERS.map((s) => (
          <button key={s.q} type="button" disabled={readOnly} onClick={() => onAsk(s.q)}
            className="group flex items-center gap-3 rounded-2xl border border-white/90 bg-white/75 p-3 text-left shadow-glass transition hover:-translate-y-0.5 hover:border-cyan/40 hover:bg-white disabled:pointer-events-none disabled:opacity-70">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#DBEAFE] to-[#EFF6FF]"><Icon name={s.icon} size={19} color="#2563EB" /></span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold leading-snug text-fg">{s.q}</span>
              <span className="block text-[12px] text-fg-4">{s.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  // into <body>: a drawer inside a blurred card would be confined to the card
  return createPortal(
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Conversations">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="drawer-in absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col gap-3 border-r border-white/70 bg-white/95 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <b className="text-[15px]">Conversations</b>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close conversations"><Icon name="close" size={15} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const fromApi = (m: any): ChatMsg => ({
  id: uid(), role: m.role, text: m.text, source: m.source, facts: m.facts || [], links: m.links || [], suggestions: m.suggestions || [],
  vehicle: m.vehicle, plate: m.plate, created_at: m.created_at,
});

/** The whole Chat Bot: conversation list, the conversation, vehicle chips and the composer. */
export function CopilotChat() {
  const user = useUser();
  const readOnly = user?.role === "viewer";
  const engine = useEngine();
  const vehicles = useFetch<ChipVehicle[]>(user ? "/api/copilot/vehicles" : null);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [cid, setCid] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [chip, setChip] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);

  const loadConvs = useCallback(() => {
    api.get("/api/copilot/conversations").then(setConvs).catch(() => {}).finally(() => setConvLoading(false));
  }, []);

  const setUrl = (id: string | null) => {
    try {
      const u = new URL(window.location.href);
      if (id) u.searchParams.set("c", id); else u.searchParams.delete("c");
      u.searchParams.delete("q");
      u.searchParams.delete("plate");
      window.history.replaceState(null, "", u.pathname + (u.search ? u.search : ""));
    } catch {}
  };

  const open = useCallback(async (id: string) => {
    setDrawer(false);
    setOpening(true);
    try {
      const d = await api.get(`/api/copilot/conversations/${encodeURIComponent(id)}`);
      const ms: ChatMsg[] = d.messages.map(fromApi);
      setMsgs(ms);
      setCid(id);
      setFocus([...ms].reverse().find((m) => m.role === "assistant")?.vehicle || null);
      setUrl(id);
    } catch (e: any) {
      toast(e instanceof ApiError && e.status === 404 ? "That conversation no longer exists" : e.message, "err");
      setUrl(null);
    } finally {
      setOpening(false);
    }
  }, []);

  const newChat = () => {
    setCid(null);
    setMsgs([]);
    setFocus(null);
    setChip(null);
    setInput("");
    setDrawer(false);
    setUrl(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const remove = async (id: string) => {
    try {
      const r = await fetch(`/api/copilot/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });  // lib/api has no delete
      if (!r.ok && r.status !== 404) throw new Error(r.status === 403 ? "Deleting is open to staff accounts" : "The conversation could not be deleted");
      setConvs((cs) => cs.filter((c) => c.id !== id));
      if (id === cid) newChat();
      toast("Conversation deleted", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  const send = useCallback(async (text: string, retry = false, plateFor?: string | null) => {
    const q = text.trim();
    if (!q || busy) return;
    if (readOnly) {
      toast("Asking is open to staff accounts: the guest viewer can read only", "info");
      return;
    }
    const plate = plateFor !== undefined ? plateFor : chip;
    setMsgs((ms) => {
      const kept = ms.filter((m) => !m.error);
      return retry ? kept : [...kept, { id: uid(), role: "user", text: q, plate }];
    });
    setInput("");
    setBusy(true);
    try {
      const r = await api.post("/api/copilot/chat", { conversation_id: cid, message: q, plate });
      setCid(r.conversation_id);
      setUrl(r.conversation_id);
      setFocus(r.vehicle || null);
      setMsgs((ms) => [...ms, { id: uid(), role: "assistant", text: r.answer, source: r.source, facts: r.facts, links: r.links,
                                suggestions: r.suggestions, vehicle: r.vehicle }]);
      loadConvs();
    } catch (e: any) {
      const status = e instanceof ApiError ? e.status : 0;
      const msg = status === 403 ? VIEWER_NOTE
        : status === 0 || status >= 500 ? "The assistant could not be reached. Check the connection and try again."
        : e.message || "Something went wrong.";
      setMsgs((ms) => [...ms, { id: uid(), role: "assistant", text: "", error: msg, retry: status === 403 ? undefined : q }]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [busy, chip, cid, loadConvs, readOnly]);

  // first load: the conversation list, then ?c= (open a conversation), ?plate= (pick a vehicle) and ?q= (ask it now)
  useEffect(() => {
    if (!user || started.current) return;
    started.current = true;
    loadConvs();
    const p = new URLSearchParams(window.location.search);
    const c = p.get("c"), plate = p.get("plate")?.toUpperCase() || null, q = p.get("q");
    if (plate) setChip(plate);
    if (c) open(c);
    else if (q && user.role !== "viewer") send(q, false, plate);
    else if (q) setInput(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const el = scroller.current;
    if (el && msgs.length) el.scrollTo({ top: el.scrollHeight, behavior: msgs.length > 2 ? "smooth" : "auto" });
  }, [msgs, busy]);

  const lastAssistant = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "assistant") return msgs[i].id;
    return null;
  }, [msgs]);
  const vlist = vehicles.data || [];
  const focusV = vlist.find((v) => v.plate === focus);
  const list = (
    <ConversationList items={convs} loading={convLoading} current={cid} onOpen={open} onNew={newChat} onDelete={remove} readOnly={readOnly} />
  );

  // before the first question a phone shows the whole welcome (every suggestion) and the page scrolls; a chat keeps
  // the fixed height with its own scroller
  const welcome = !opening && !msgs.length;
  return (
    <div className={`flex h-[calc(100dvh-168px)] min-h-[520px] gap-4 sm:h-[calc(100dvh-112px)] lg:h-[calc(100dvh-146px)] 2xl:h-[calc(100dvh-162px)] ${welcome ? "max-sm:h-auto" : ""}`}>
      <aside className="card hidden w-[272px] shrink-0 flex-col p-3 lg:flex" aria-label="Conversations">{list}</aside>
      <Drawer open={drawer} onClose={() => setDrawer(false)}>{list}</Drawer>

      <section className="card flex min-w-0 flex-1 flex-col overflow-hidden" aria-label="VehicleSense Assistant">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-white/80 px-3 py-3 sm:gap-x-3 sm:px-4 lg:px-5">
          <button type="button" className="btn btn-sm lg:hidden" onClick={() => setDrawer(true)} aria-label="Show conversations"><Icon name="history" size={16} /></button>
          <div className="min-w-0 flex-1 sm:flex-none">
            <div className="eyebrow text-[11px]">Chat Bot</div>
            <h1 className="truncate text-[17px] font-extrabold leading-tight tracking-tight sm:text-[22px]">VehicleSense Assistant</h1>
          </div>
          <button type="button" className="btn btn-sm lg:hidden" onClick={newChat} aria-label="New chat"><Icon name="plus" size={16} /></button>
          <div className="flex w-full min-w-0 items-center gap-1.5 sm:ml-auto sm:w-auto sm:flex-wrap sm:justify-end">
            <span className="flex min-w-0 shrink"><EngineChip engine={engine} /></span>
            <span className="flex min-w-0 shrink-[2]"><Source kind={engine.on ? "live_model" : "live_logic"} text="From platform data" /></span>
          </div>
        </header>

        <div ref={scroller} className={`min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 ${welcome ? "max-sm:flex-none max-sm:overflow-visible" : ""}`} aria-live="polite">
          {opening ? (
            <div className="flex flex-col gap-3 p-2">{[0, 1, 2].map((i) => <span key={i} className="skeleton h-14 rounded-2xl" style={{ width: `${90 - i * 18}%` }} />)}</div>
          ) : !msgs.length ? (
            <Welcome name={user?.name?.split(" ")[0]} onAsk={(q) => send(q)} readOnly={readOnly} />
          ) : (
            <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4">
              {msgs.map((m) => (
                <MessageBubble key={m.id} m={m} last={m.id === lastAssistant && !busy} onAsk={(q) => send(q)} onRetry={(q) => send(q, true)} readOnly={readOnly} />
              ))}
              {busy && <TypingBubble />}
            </div>
          )}
        </div>

        <div className="border-t border-white/80 bg-white/40 px-3 pb-3 pt-2 sm:px-5">
          <div className="mx-auto flex w-full max-w-[900px] flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2 text-[11.5px] text-fg-4">
              <span className="shrink-0 font-semibold uppercase tracking-[0.12em]">Vehicles</span>
              {focusV && !chip && <span className="min-w-0 truncate">· talking about <b className="text-fg-3">{focusV.plate}</b> ({focusV.nick})</span>}
            </div>
            <VehicleChips vehicles={vlist} value={chip} onChange={setChip} disabled={readOnly} />
            {readOnly && msgs.length > 0 && <p className="text-[12px] text-amber-800">{VIEWER_NOTE}</p>}
            <Composer value={input} onChange={setInput} onSend={() => send(input)} busy={busy} disabled={readOnly} chip={chip} onClearChip={() => setChip(null)} inputRef={inputRef} />
            <p className="hidden text-center text-[11px] text-fg-4 sm:block">Enter to send · Shift+Enter for a new line · Answers come only from the platform&apos;s records and can be checked with each source.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
