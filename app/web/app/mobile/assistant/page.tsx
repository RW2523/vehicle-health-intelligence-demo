"use client";
/* Mobile app · Assistant: chat with the owner assistant in Bahasa Melayu, English or Chinese (answers from the
   knowledge base, phrased by the local LLM when it runs; Express slot lookups come from the live booking system). */
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { MobileShell, useMobileHref, useMobilePlate } from "@/components/MobileShell";
import { Segmented } from "@/components/mobileKit";
import { Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { llmLabel } from "@/lib/format";
import { useFetch } from "@/lib/live";

type Msg = { role: "user" | "assistant"; text: string; at: string; source?: string; tool?: any; lang?: string; failed?: boolean };
type Lang = "auto" | "ms" | "en" | "zh";
const GREETING = "Hai! Saya pembantu VehicleSense. Tanya dalam BM, English atau 中文.";
const LANG_HINT: Record<Lang, string> = { auto: "Tanya apa-apa…", ms: "Tanya apa-apa…", en: "Ask anything…", zh: "请输入问题…" };
const now = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hour12: false });

function Bot({ size = 30 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#60A5FA] to-[#1D4ED8] shadow-sm ring-2 ring-white" style={{ width: size, height: size }} aria-hidden>
      <Icon name="bot" size={Math.round(size * 0.55)} color="#fff" width={1.9} />
    </span>
  );
}

function Bubble({ m, href }: { m: Msg; href: (p: string, q?: Record<string, string | null>) => string }) {
  const mine = m.role === "user";
  const engine = m.source && m.source !== "template" ? llmLabel(m.source) : null;
  return (
    <div className={`m-pop flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
      {!mine && <Bot size={28} />}
      <div className={`max-w-[80%] ${mine ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div className={`whitespace-pre-wrap px-3.5 py-2.5 text-[14px] leading-relaxed shadow-sm ${mine
          ? "rounded-[20px] rounded-br-md bg-gradient-to-br from-[#3B82F6] to-[#2563EB] text-white"
          : `rounded-[20px] rounded-bl-md bg-white text-slate-900 ring-1 ${m.failed ? "ring-rose-200" : "ring-slate-100"}`}`}>
          {m.text.replace(/\*\*/g, "")}
          {m.tool?.slots?.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {m.tool.slots.map((s: string) => (
                <Link key={s} href={href("/mobile/book")} className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-amber-900 active:scale-95">{s} Express</Link>
              ))}
            </div>
          )}
        </div>
        <div className={`flex items-center gap-1.5 px-1 text-[10.5px] text-slate-400 ${mine ? "flex-row-reverse" : ""}`}>
          <span>{m.at}</span>
          {!mine && m.source !== undefined && m.source !== "" && <span title={engine || undefined}>· {engine ? "local LLM" : "knowledge base"}</span>}
          {mine && <Icon name="check" size={12} color="#60A5FA" width={2.4} />}
        </div>
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex items-end gap-2" role="status" aria-label="The assistant is typing">
      <Bot size={28} />
      <div className="flex gap-1 rounded-[20px] rounded-bl-md bg-white px-4 py-3.5 shadow-sm ring-1 ring-slate-100">
        {[0, 1, 2].map((i) => <span key={i} className="m-dot h-2 w-2 rounded-full bg-slate-400" style={{ animationDelay: `${i * 0.16}s` }} />)}
      </div>
    </div>
  );
}

function AssistantScreen() {
  const { plate } = useMobilePlate();
  const href = useMobileHref();
  const script = useFetch<any>("/api/owner/self-check/script");
  const key = `vhi-mobile-chat:${plate || ""}`;
  const [conv, setConv] = useState(() => "m" + Math.random().toString(36).slice(2, 9));
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<Lang>("auto");
  const end = useRef<HTMLDivElement>(null);
  // the chat survives moving between the app's screens (this browser tab only)
  useEffect(() => {
    if (!plate) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      if (saved?.conv) {
        setConv(saved.conv);
        setMsgs(saved.msgs || []);
        return;
      }
    } catch {}
    setMsgs([{ role: "assistant", text: GREETING, at: now(), source: "" }]);
  }, [key, plate]);
  useEffect(() => {
    if (!plate || !msgs.length) return;
    try { sessionStorage.setItem(key, JSON.stringify({ conv, msgs: msgs.slice(-40) })); } catch {}
  }, [msgs, conv, key, plate]);
  // block body: newer browsers return a Promise from scrollIntoView, which React would call as the effect cleanup
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);
  const send = async (t: string) => {
    if (!t.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", text: t.trim(), at: now() }]);
    setText("");
    setBusy(true);
    try {
      const r = await api.post("/api/owner/assistant", { conversation: conv, text: t.trim(), lang: lang === "auto" ? undefined : lang });
      setMsgs((m) => [...m, { role: "assistant", text: r.answer, source: r.source, tool: r.tool, lang: r.lang, at: now() }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", text: "Sorry, I can't answer right now. Please try again in a moment.", source: "", at: now(), failed: true }]);
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  const clear = () => {
    const c = "m" + Math.random().toString(36).slice(2, 9);
    setConv(c);
    setMsgs([{ role: "assistant", text: GREETING, at: now(), source: "" }]);
  };
  const quick: string[] = [...(script.data?.assistant_script || []).map((s: any) => s.user_bm), "What is the window tint limit?", "电动车怎么检验？", "Berapa harga pemeriksaan sukarela?"];
  return (
    <MobileShell tab="assistant" flush
      title={
        <span className="flex items-center gap-2.5">
          <Bot size={34} />
          <span className="min-w-0 leading-tight">
            <h1 className="truncate text-[16px] font-bold">Assistant</h1>
            <span className="flex items-center gap-1 text-[11.5px] text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Online · BM, English, 中文</span>
          </span>
        </span>
      }
      actions={<button onClick={clear} aria-label="New chat" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80 shadow-sm ring-1 ring-white active:scale-95"><Icon name="edit" size={18} color="#1E293B" /></button>}
      footer={
        <div className="border-t border-slate-200/70 bg-white/90 pb-2 pt-2 backdrop-blur-xl">
          <div className="m-noscroll flex gap-1.5 overflow-x-auto px-3 pb-2" aria-label="Suggested questions">
            {quick.map((q) => (
              <button key={q} disabled={busy} className="shrink-0 rounded-full border border-blue-200 bg-blue-50/70 px-3 py-1.5 text-[12.5px] font-medium text-[#1D4ED8] active:scale-95 disabled:opacity-50" onClick={() => send(q)}>{q}</button>
            ))}
          </div>
          <form className="flex items-center gap-2 px-3" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <input aria-label="Message" className="min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2.5 text-[14.5px] text-slate-900 placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
              value={text} onChange={(e) => setText(e.target.value)} placeholder={LANG_HINT[lang]} enterKeyHint="send" />
            <button disabled={busy || !text.trim()} aria-label="Send" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#3B82F6] to-[#2563EB] shadow-[0_8px_16px_-8px_rgba(37,99,235,0.9)] active:scale-95 disabled:opacity-40">
              <Icon name="send" size={19} color="#fff" width={2} />
            </button>
          </form>
        </div>
      }>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-2">
        <Segmented label="Answer language" value={lang} onChange={setLang} className="mb-1"
          items={[{ id: "auto", label: "Auto" }, { id: "ms", label: "BM" }, { id: "en", label: "English" }, { id: "zh", label: "中文" }]} />
        <div className="flex justify-center"><Source kind="live_logic" text="Knowledge base · live booking slots" /></div>
        {msgs.map((m, i) => <Bubble key={i} m={m} href={href} />)}
        {busy && <Typing />}
        <div ref={end} />
      </div>
    </MobileShell>
  );
}

export default function Page() {
  return <Suspense><AssistantScreen /></Suspense>;
}
