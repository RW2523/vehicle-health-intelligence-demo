"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import { Pill, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { dmy, fmtN, scoreColor } from "@/lib/format";
import { useFetch } from "@/lib/live";

type Tab = "passport" | "book" | "check" | "chat";
const TABS: { id: Tab; label: string; d: string }[] = [
  { id: "passport", label: "Passport", d: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5" },
  { id: "book", label: "Book", d: "M4 6h16v14H4zM4 10h16M9 3v5M15 3v5" },
  { id: "check", label: "Self-check", d: "M5 12l4 4L19 6" },
  { id: "chat", label: "Assistant", d: "M4 5h16v11H9l-5 4z" },
];

function Passport({ plate, refreshKey }: { plate: string; refreshKey: number }) {
  const { data: p } = useFetch<any>(`/api/owner/passport/${encodeURIComponent(plate)}`, undefined, [refreshKey]);
  if (!p) return <p className="p-4 text-[13px] text-slate-500">Loading…</p>;
  const v = p.vehicle;
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="rounded-2xl bg-gradient-to-br from-[#0F4C81] to-[#0B2B4F] p-4 text-white">
        <div className="text-[12px] opacity-80">Vehicle Health Passport</div>
        <div className="mt-1 font-display text-[24px] font-bold">{v.plate}</div>
        <div className="text-[13px] opacity-90">{v.make} {v.model} · {v.year} · {fmtN(v.odometer_km)} km</div>
        <div className="mt-3 flex items-center justify-between">
          <div><div className="text-[11px] opacity-75">Latest health score</div><div className="font-display text-[28px] font-bold">{p.health ?? "–"}</div></div>
          {p.reminders?.map((r: any) => <div key={r.kind} className="text-right text-[12px]"><div className="opacity-75">Road tax expires</div><b>{dmy(r.date)}</b><div className="opacity-75">in {r.days} days</div></div>)}
        </div>
      </div>
      <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Timeline</div>
      <ol className="flex flex-col gap-2">
        {p.events.map((e: any, i: number) => (
          <li key={i} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2"><b className="text-[13.5px] text-slate-900">{e.title}</b><span className="text-[11.5px] text-slate-500">{dmy(e.date)}</span></div>
            <div className="text-[12px] text-slate-500">
              {e.kind === "inspection" && `${fmtN(e.odometer_km)} km${e.fail_reasons ? ` · ${e.fail_reasons}` : ""}`}
              {e.kind === "self_check" && e.items?.filter((x: any) => !x.ok).map((x: any) => x.item).join(", ")}
              {e.kind === "claim" && `RM ${fmtN(e.amount_rm)}`}
              {e.kind === "report" && <a className="text-sky-700 underline" href={`/verify/${e.verify_token}`}>Verify report</a>}
              {e.kind === "booking" && e.status}
              {" "}<span className="text-slate-400">· {e.source}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Book({ plate, onBooked }: { plate: string; onBooked: () => void }) {
  const [selling, setSelling] = useState(true);
  const [loan, setLoan] = useState(true);
  const types = useFetch<any>("/api/owner/inspection-types", { selling, buyer_loan: loan });
  const branches = useFetch<any[]>("/api/branches");
  const [itype, setItype] = useState("");
  const [branch, setBranch] = useState("BR01");
  const gear = useFetch<any>("/api/owner/gear", { branch_id: branch });
  const [date, setDate] = useState("");
  const slots = useFetch<any>(date ? "/api/owner/slots" : null, { branch_id: branch, date });
  const [slot, setSlot] = useState<any>(null);
  const [booking, setBooking] = useState<any>(null);
  useEffect(() => { if (types.data) setItype(types.data.recommended[0]); }, [types.data]);
  useEffect(() => { if (gear.data && !date) setDate(gear.data.date); }, [gear.data, date]);
  const price = (types.data?.types.find((t: any) => t.code === itype)?.price || 0) + (slot?.gear ? types.data?.gear_surcharge_rm || 0 : 0);
  const confirm = async () => {
    try {
      const b = await api.post("/api/owner/bookings", { plate, branch_id: branch, date, slot: slot.time, inspection_type: itype, gear: !!slot.gear });
      const paid = await api.post(`/api/owner/bookings/${b.booking_id}/pay`, { method: "FPX" });
      setBooking(paid);
      toast(`Booked and paid (mock FPX ${paid.payment_ref})`);
      onBooked();
    } catch (e: any) {
      toast(e.message);
    }
  };
  if (booking)
    return (
      <div className="flex flex-col items-center gap-3 p-5 text-center text-slate-900">
        <div className="text-[13px] font-semibold text-emerald-600">Booking confirmed</div>
        <div className="font-display text-[20px] font-bold">{booking.type_label}</div>
        <div className="text-[13px] text-slate-600">{branches.data?.find((b) => b.branch_id === booking.branch_id)?.name} · {dmy(booking.date)} {booking.slot} {booking.gear ? "· GEAR" : ""}</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/owner/bookings/${booking.booking_id}/qr.svg`} alt="Check-in QR code" className="h-44 w-44" />
        <div className="text-[12px] text-slate-500">Show this QR at the lane entry. RM {booking.price_rm.toFixed(2)} paid · {booking.payment_ref} (mock gateway)</div>
        <button className="rounded-xl border border-slate-300 px-4 py-2 text-[13px] font-semibold" onClick={() => { setBooking(null); setSlot(null); }}>Make another booking</button>
      </div>
    );
  return (
    <div className="flex flex-col gap-3 p-4 text-slate-900">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">1 · What are you doing?</div>
      <div className="flex flex-wrap gap-2 text-[13px]">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={selling} onChange={(e) => setSelling(e.target.checked)} /> Selling the car</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={loan} onChange={(e) => setLoan(e.target.checked)} /> Buyer takes a bank loan</label>
      </div>
      <div className="flex flex-wrap gap-2">
        {(types.data?.types || []).map((t: any) => (
          <button key={t.code} onClick={() => setItype(t.code)}
            className={`rounded-xl border px-3 py-2 text-left text-[12.5px] ${itype === t.code ? "border-sky-600 bg-sky-50" : "border-slate-200"}`}>
            <b>{t.code}</b> · RM {t.price}{types.data?.recommended.includes(t.code) && <span className="ml-1 text-emerald-600">recommended</span>}
          </button>
        ))}
      </div>
      <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">2 · Where and when?</div>
      <select aria-label="Branch" className="rounded-xl border border-slate-300 px-3 py-2 text-[13px]" value={branch} onChange={(e) => { setBranch(e.target.value); setSlot(null); }}>
        {(branches.data || []).map((b) => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
      </select>
      <input aria-label="Date" type="date" className="rounded-xl border border-slate-300 px-3 py-2 text-[13px]" value={date} onChange={(e) => { setDate(e.target.value); setSlot(null); }} />
      {gear.data && date === gear.data.date && <div className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-800">Tomorrow: GEAR premium slots available (+RM {gear.data.surcharge_rm}).</div>}
      <div className="grid grid-cols-4 gap-1.5">
        {(slots.data?.slots || []).map((s: any) => (
          <button key={s.time} disabled={!s.available} onClick={() => setSlot(s)}
            className={`rounded-lg border px-1 py-1.5 text-[12px] ${slot?.time === s.time ? "border-sky-600 bg-sky-600 text-white" : s.gear ? "border-amber-400 bg-amber-50" : "border-slate-200"} disabled:opacity-35`}>
            {s.time}{s.gear && <span className="block text-[9.5px] font-bold">GEAR</span>}
          </button>
        ))}
      </div>
      <button disabled={!slot || !itype} onClick={confirm} className="mt-1 rounded-xl bg-sky-600 px-4 py-3 text-[14px] font-semibold text-white disabled:opacity-40">
        {slot ? `Pay RM ${price.toFixed(2)} (FPX) and book ${slot.time}` : "Choose a slot"}
      </button>
      <p className="text-[11px] text-slate-400">Payment runs through a mock gateway in this demo.</p>
    </div>
  );
}

function SelfCheck({ plate, onDone }: { plate: string; onDone: () => void }) {
  const script = useFetch<any>("/api/owner/self-check/script");
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [tint, setTint] = useState(38);
  const [lampL, setLampL] = useState("not working");
  const run = async (attempt: any) => {
    setBusy(true);
    try {
      const r = await api.post("/api/owner/self-check", { plate, ...attempt });
      setRes(r);
      onDone();
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  const base = script.data?.first_attempt;
  return (
    <div className="flex flex-col gap-3 p-4 text-slate-900">
      <p className="text-[13px] text-slate-600">Take photos of the tint, both headlamps and all 4 tyres, and record 20 seconds of engine sound. The app tells you what to fix before you book.</p>
      {base && (
        <div className="rounded-xl border border-slate-200 p-3 text-[13px]">
          <label className="flex items-center justify-between gap-2">Tint reading (VLT) <b>{tint}%</b></label>
          <input aria-label="Tint VLT" type="range" min={20} max={85} value={tint} onChange={(e) => setTint(+e.target.value)} className="w-full" />
          <label className="mt-2 flex items-center justify-between">Left headlamp
            <select aria-label="Left headlamp" className="rounded-lg border border-slate-300 px-2 py-1" value={lampL} onChange={(e) => setLampL(e.target.value)}>
              <option value="ok">working</option><option value="not working">not working</option>
            </select>
          </label>
          <div className="mt-2 flex gap-1.5">
            {base.tyre_images.map((t: string) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={t} src={`/media/data/${t}`} alt="tyre photo" className="h-12 w-12 rounded-lg object-cover" />
            ))}
            <span className="self-center text-[11.5px] text-slate-500">+ engine clip (20 s)</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button disabled={busy} className="rounded-xl bg-sky-600 px-3 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40" onClick={() => run({ ...base, tint_vlt_pct: tint, headlamp_left: lampL })}>{busy ? "Checking…" : "Run self-check"}</button>
            <button disabled={busy} className="rounded-xl border border-slate-300 px-3 py-2.5 text-[13px] font-semibold" onClick={() => { setTint(71); setLampL("ok"); run(script.data.second_attempt); }}>After fixing (S6 attempt 2)</button>
          </div>
        </div>
      )}
      {res && (
        <div className="flex flex-col gap-2">
          <div className={`rounded-xl px-4 py-3 text-[15px] font-bold ${res.verdict === "Likely to pass" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{res.verdict}</div>
          {res.items.map((it: any, i: number) => (
            <div key={i} className="flex items-start gap-2 rounded-xl border border-slate-200 p-2.5 text-[12.5px]">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${it.ok ? "bg-emerald-500" : "bg-rose-500"}`}>{it.ok ? "✓" : "!"}</span>
              <div><b>{it.item}</b> · {it.value}{it.p ? ` (${Math.round(it.p * 100)}%)` : ""}<div className="text-slate-500">{it.advice || it.source}</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chat() {
  const script = useFetch<any>("/api/owner/self-check/script");
  const [conv] = useState(() => "c" + Math.random().toString(36).slice(2, 9));
  const [msgs, setMsgs] = useState<any[]>([{ role: "assistant", text: "Hai! Saya pembantu VehicleSense. Tanya dalam BM, English atau 中文.", source: "" }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs]);
  const send = async (t: string) => {
    if (!t.trim()) return;
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setText("");
    setBusy(true);
    try {
      const r = await api.post("/api/owner/assistant", { conversation: conv, text: t });
      setMsgs((m) => [...m, { role: "assistant", text: r.answer, source: r.source, tool: r.tool, kb: r.kb_item, lang: r.lang }]);
    } finally {
      setBusy(false);
    }
  };
  const quick = [...(script.data?.assistant_script || []).map((s: any) => s.user_bm), "What is the window tint limit?", "电动车怎么检验？"];
  return (
    <div className="flex h-full flex-col bg-[#ECE5DD]">
      <div className="flex-1 space-y-2 overflow-auto p-3">
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] shadow-sm ${m.role === "user" ? "ml-auto bg-[#DCF8C6] text-slate-900" : "bg-white text-slate-900"}`}>
            <div className="whitespace-pre-wrap">{m.text.replace(/\*\*/g, "")}</div>
            {m.tool?.slots?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">{m.tool.slots.map((s: string) => <span key={s} className="rounded-md border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[11px]">{s} GEAR</span>)}</div>
            )}
            {m.source && <div className="mt-1 text-[10px] text-slate-400">{m.source === "template" ? "Template engine" : `Local LLM · ${m.source}`}{m.kb ? ` · source: ${m.kb}` : ""}{m.lang ? ` · ${m.lang}` : ""}</div>}
          </div>
        ))}
        {busy && <div className="w-16 rounded-xl bg-white px-3 py-2 text-[13px] text-slate-400">…</div>}
        <div ref={end} />
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-2 pb-1">
        {quick.map((q: string) => <button key={q} className="shrink-0 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11.5px] text-slate-700" onClick={() => send(q)}>{q}</button>)}
      </div>
      <form className="flex gap-2 bg-[#F0F0F0] p-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input aria-label="Message" className="flex-1 rounded-full border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900" value={text} onChange={(e) => setText(e.target.value)} placeholder="Tanya apa-apa…" />
        <button className="rounded-full bg-[#128C7E] px-4 text-[13px] font-semibold text-white">Send</button>
      </form>
    </div>
  );
}

function OwnerApp() {
  const sp = useSearchParams();
  const plate = sp.get("plate") || "DMO 9006";
  const [tab, setTab] = useState<Tab>((sp.get("tab") as Tab) || "passport");
  const [k, setK] = useState(0);
  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-center gap-8">
        <div className="max-w-[360px] pt-6">
          <h1 className="font-display text-[26px] font-semibold">Owner app</h1>
          <p className="mt-2 text-[13.5px] text-fg-2">Session S6: an owner asks the assistant in BM which inspection they need, books a GEAR slot, runs a self-check (tint and headlamp fail, then pass after fixing) and sees the Health Passport update.</p>
          <div className="mt-3 flex flex-wrap gap-2"><Source kind="live_model" text="Tyre + engine-sound models" /><Source kind="template" text="Assistant: LLM or template" /><Source kind="mock" text="Payment: mock gateway" /></div>
          <p className="mt-3 text-[12px] text-fg-3">Vehicle: <Pill color="#22D3EE">{plate}</Pill></p>
        </div>
        <div className="flex h-[780px] w-[390px] flex-col overflow-hidden rounded-[36px] border-[10px] border-[#1A2233] bg-[#F5F7FA] shadow-2xl">
          <div className="flex items-center justify-between bg-white px-5 py-3 text-slate-900">
            <span className="font-display text-[15px] font-bold">VehicleSense</span>
            <span className="text-[12px] text-slate-500">{plate}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {tab === "passport" && <Passport plate={plate} refreshKey={k} />}
            {tab === "book" && <Book plate={plate} onBooked={() => setK((x) => x + 1)} />}
            {tab === "check" && <SelfCheck plate={plate} onDone={() => setK((x) => x + 1)} />}
            {tab === "chat" && <Chat />}
          </div>
          <nav className="grid grid-cols-4 border-t border-slate-200 bg-white">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${tab === t.id ? "text-sky-700" : "text-slate-500"}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d={t.d} /></svg>{t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
      <span className="hidden" style={{ color: scoreColor(0) }} />
    </Shell>
  );
}

export default function Page() {
  return <Suspense><OwnerApp /></Suspense>;
}
