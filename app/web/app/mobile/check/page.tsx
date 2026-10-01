"use client";
/* Mobile app · Check: the guided pre-inspection self-check. Four captures with the phone (window tint with the light
   meter, the headlamps, the tyres, a 20 s engine clip), then the verdict: what to fix before booking. Tyre photos run
   through the live Tyre AI model and the engine clip through the live acoustic model; the tint and headlamp readings
   are simulated phone checks, set with the demo controls under the viewfinder. */
import { Suspense, useEffect, useRef, useState } from "react";
import { refreshUseCase } from "@/components/Demo";
import { Icon } from "@/components/icons";
import { MobileShell, useMobileHref, useMobilePlate } from "@/components/MobileShell";
import { BTN, BTN2, MCard, MList, MRow, MSkeleton, MTitle, Switch, dayLabel } from "@/components/mobileKit";
import { latestCheck, usePassport } from "@/components/mobileData";
import { Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { useFetch } from "@/lib/live";

type Stage = "intro" | "tint" | "lamps" | "tyres" | "engine" | "review" | "analysing" | "result";
const STEPS: { id: Stage; label: string }[] = [{ id: "tint", label: "Tint" }, { id: "lamps", label: "Lamps" }, { id: "tyres", label: "Tyres" }, { id: "engine", label: "Engine" }];
const TYRES = ["Front left", "Front right", "Rear left", "Rear right"];
const EXTRA_TYRES = ["images/tyre/perfect/tyre_helath_qualit_00001.jpg", "images/tyre/perfect/tyre_helath_qualit_00002.jpg"];
const WORN_TYRE = "images/tyre/defective/tyre_helath_qualit_00231.jpg";
const KNOCK = "audio/engine_knocking/car_engine_sou_00000.wav";

const VERDICT_STYLE: Record<string, { bg: string; fg: string; icon: string; ring: string }> = {
  "Ready for inspection": { bg: "from-emerald-500 to-emerald-600", fg: "text-emerald-50", icon: "check", ring: "#A7F3D0" },
  "Fix these first": { bg: "from-amber-400 to-amber-500", fg: "text-amber-50", icon: "wrench", ring: "#FDE68A" },
  "Needs a professional check": { bg: "from-rose-500 to-rose-600", fg: "text-rose-50", icon: "warn", ring: "#FECACA" },
};
const VERDICT_TEXT: Record<string, string> = {
  "Ready for inspection": "Nothing the phone can check stops this car passing. You can book now.",
  "Fix these first": "These are quick fixes you can do yourself before booking.",
  "Needs a professional check": "Have a workshop look at the items below before the inspection.",
};

/* ---------------------------------------------------------------- the camera */

function Viewfinder({ children, hint, flash, scanning, dark = true }: { children: React.ReactNode; hint: string; flash: boolean; scanning?: boolean; dark?: boolean }) {
  return (
    <div className={`relative aspect-[5/6] w-full overflow-hidden rounded-[26px] ${dark ? "bg-[#0B1220]" : "bg-slate-200"} shadow-[0_24px_40px_-24px_rgba(15,23,42,0.8)]`}>
      {children}
      {/* corner guides */}
      {["left-4 top-4 border-l-[3px] border-t-[3px] rounded-tl-xl", "right-4 top-4 border-r-[3px] border-t-[3px] rounded-tr-xl", "bottom-4 left-4 border-b-[3px] border-l-[3px] rounded-bl-xl", "bottom-4 right-4 border-b-[3px] border-r-[3px] rounded-br-xl"]
        .map((c) => <span key={c} className={`pointer-events-none absolute h-7 w-7 border-white/85 ${c}`} aria-hidden />)}
      {scanning && <span className="m-scan pointer-events-none absolute inset-x-6 h-[2px] rounded-full bg-cyan-300 shadow-[0_0_14px_3px_rgba(103,232,249,0.8)]" aria-hidden />}
      <span className="absolute left-1/2 top-4 max-w-[78%] -translate-x-1/2 rounded-full bg-black/55 px-3 py-1.5 text-center text-[12px] font-medium text-white backdrop-blur">{hint}</span>
      {flash && <span className="m-fade pointer-events-none absolute inset-0 bg-white" style={{ animationDirection: "reverse", animationDuration: ".35s" }} aria-hidden />}
    </div>
  );
}

function Shutter({ onClick, disabled, label, done }: { onClick: () => void; disabled?: boolean; label: string; done?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label}
      className="relative flex h-[74px] w-[74px] items-center justify-center rounded-full bg-white/20 ring-[3px] ring-white/90 backdrop-blur transition active:scale-90 disabled:opacity-50">
      <span className={`flex h-[58px] w-[58px] items-center justify-center rounded-full transition ${done ? "bg-emerald-500" : "bg-white"}`}>
        {done && <Icon name="check" size={28} color="#fff" width={3} />}
      </span>
    </button>
  );
}

function TintScene({ vlt, measured }: { vlt: number; measured: boolean }) {
  const dark = Math.max(0.05, Math.min(0.92, (100 - vlt) / 100));
  return (
    <svg viewBox="0 0 300 360" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#334155" /><stop offset="1" stopColor="#0F172A" /></linearGradient>
        <linearGradient id="door" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#CBD5E1" /><stop offset="1" stopColor="#64748B" /></linearGradient>
        <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#BAE6FD" /><stop offset="1" stopColor="#7DD3FC" /></linearGradient>
      </defs>
      <rect width="300" height="360" fill="url(#sky)" />
      <path d="M-10 120 Q40 70 120 64 L230 64 Q280 70 320 120 L320 380 L-10 380 Z" fill="url(#door)" />
      <path d="M22 128 Q60 86 124 80 L222 80 Q262 86 290 128 Z" fill="url(#glass)" />
      <path d="M22 128 Q60 86 124 80 L222 80 Q262 86 290 128 Z" fill="#020617" opacity={dark} />
      <path d="M40 120 L120 92" stroke="#fff" strokeOpacity={0.35 - dark * 0.3} strokeWidth="6" strokeLinecap="round" />
      <line x1="150" y1="80" x2="150" y2="128" stroke="#475569" strokeWidth="4" />
      <rect x="40" y="200" width="56" height="10" rx="5" fill="#475569" />
      <path d="M-10 300 L320 300" stroke="#94A3B8" strokeOpacity=".4" />
      <g transform="translate(205 106)">
        <circle r="30" fill="none" stroke={measured ? (vlt < 50 ? "#F87171" : "#34D399") : "#E2E8F0"} strokeWidth="2.5" strokeDasharray={measured ? "0" : "5 5"} />
        <line x1="-40" x2="-34" stroke="#E2E8F0" strokeWidth="2" /><line x1="34" x2="40" stroke="#E2E8F0" strokeWidth="2" />
        <line y1="-40" y2="-34" stroke="#E2E8F0" strokeWidth="2" /><line y1="34" y2="40" stroke="#E2E8F0" strokeWidth="2" />
      </g>
    </svg>
  );
}

function LampScene({ left, right }: { left: boolean; right: boolean }) {
  const lamp = (x: number, on: boolean) => (
    <g key={x}>
      {on && <ellipse cx={x} cy="186" rx="58" ry="40" fill="url(#beam)" />}
      <ellipse cx={x} cy="186" rx="30" ry="16" fill={on ? "url(#lit)" : "#1E293B"} stroke="#94A3B8" strokeWidth="2" />
      {!on && <path d={`M${x - 10} ${186 - 6} l20 12 M${x + 10} ${186 - 6} l-20 12`} stroke="#F87171" strokeWidth="2.5" strokeLinecap="round" />}
    </g>
  );
  return (
    <svg viewBox="0 0 300 360" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="lit"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".6" stopColor="#FEF9C3" /><stop offset="1" stopColor="#FDE68A" /></radialGradient>
        <radialGradient id="beam"><stop offset="0" stopColor="#FEF9C3" stopOpacity=".75" /><stop offset="1" stopColor="#FEF9C3" stopOpacity="0" /></radialGradient>
        <linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E2E8F0" /><stop offset="1" stopColor="#94A3B8" /></linearGradient>
      </defs>
      <rect width="300" height="360" fill="#0B1220" />
      <path d="M40 140 Q50 96 92 90 L208 90 Q250 96 260 140 L270 236 Q270 252 254 252 L46 252 Q30 252 30 236 Z" fill="url(#body)" />
      <path d="M78 98 L222 98 L240 140 L60 140 Z" fill="#1E293B" opacity=".85" />
      <rect x="112" y="200" width="76" height="26" rx="8" fill="#334155" />
      {[0, 1, 2, 3].map((i) => <line key={i} x1="118" x2="182" y1={206 + i * 5} y2={206 + i * 5} stroke="#64748B" />)}
      {lamp(80, left)}{lamp(220, right)}
      <rect x="118" y="236" width="64" height="12" rx="2" fill="#0F172A" />
      <path d="M30 300 L270 300" stroke="#334155" />
      <text x="80" y="290" textAnchor="middle" fontSize="12" fill="#CBD5E1">Left</text>
      <text x="220" y="290" textAnchor="middle" fontSize="12" fill="#CBD5E1">Right</text>
    </svg>
  );
}

function Wave({ live, done }: { live: boolean; done: boolean }) {
  const bars = Array.from({ length: 30 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45)));
  return (
    <div className="absolute inset-x-6 top-1/2 flex h-24 -translate-y-1/2 items-center justify-between" aria-hidden>
      {bars.map((h, i) => (
        <span key={i} className={`w-[5px] rounded-full ${live ? "m-wave bg-cyan-300" : done ? "bg-cyan-300/90" : "bg-white/25"}`}
          style={{ height: `${(live || done ? h : 0.18) * 100}%`, animationDelay: `${(i % 7) * 0.09}s` }} />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- the flow */

function Progress({ stage }: { stage: Stage }) {
  const i = STEPS.findIndex((s) => s.id === stage);
  const at = stage === "review" ? 4 : i;
  return (
    <div className="mb-3" aria-label={`Step ${Math.min(at + 1, 4)} of 4`}>
      <div className="grid grid-cols-4 gap-1.5">
        {STEPS.map((s, k) => <span key={s.id} className={`h-1.5 rounded-full transition-colors ${k < at ? "bg-emerald-500" : k === at ? "bg-[#2563EB]" : "bg-slate-300/70"}`} />)}
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5 text-center text-[11px] font-semibold">
        {STEPS.map((s, k) => <span key={s.id} className={k === at ? "text-[#1D4ED8]" : k < at ? "text-emerald-700" : "text-slate-400"}>{s.label}</span>)}
      </div>
    </div>
  );
}

function DemoControls({ children, kind = "simulated", text = "Phone check" }: { children: React.ReactNode; kind?: string; text?: string }) {
  return (
    <div className="mt-3 rounded-[18px] border border-dashed border-slate-300 bg-white/60 px-1 py-1">
      <div className="flex items-center justify-between px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Demo controls<Source kind={kind} text={text} /></div>
      {children}
    </div>
  );
}

function CheckScreen() {
  const { user, plate } = useMobilePlate();
  const readOnly = user?.role === "viewer";  // the read-only viewer sees the flow but cannot save a check
  const href = useMobileHref();
  const script = useFetch<any>("/api/owner/self-check/script");
  const [k, setK] = useState(0);
  const pass = usePassport(plate, [k]);
  const [stage, setStage] = useState<Stage>("intro");
  const [res, setRes] = useState<any>(null);
  const [last, setLast] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [scan, setScan] = useState(false);
  // the captures and the demo controls
  const [tint, setTint] = useState(38);
  const [tintDone, setTintDone] = useState(false);
  const [lampL, setLampL] = useState("not working");
  const [lampsDone, setLampsDone] = useState(false);
  const [tyres, setTyres] = useState(0);
  const [worn, setWorn] = useState(false);
  const [knock, setKnock] = useState(false);
  const [rec, setRec] = useState<"" | "live" | "done">("");
  const [secs, setSecs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const base = script.data?.first_attempt;
  const tyreImgs: string[] = base ? [...base.tyre_images, EXTRA_TYRES[0], worn ? WORN_TYRE : EXTRA_TYRES[1]].slice(0, 4) : [];
  const clip = knock ? KNOCK : base?.engine_audio;
  useEffect(() => {
    if (playing) audio.current?.play().catch(() => setPlaying(false));
    else audio.current?.pause();
  }, [playing]);

  const shoot = (then: () => void, ms = 700) => {
    setScan(true);
    setTimeout(() => {
      setFlash(true);
      setScan(false);
      then();
      setTimeout(() => setFlash(false), 350);
    }, ms);
  };
  const record = () => {
    setRec("live");
    setSecs(0);
    let s = 0;
    const t = setInterval(() => {
      s += 1;
      setSecs(s);
      if (s >= 20) {
        clearInterval(t);
        setRec("done");
      }
    }, 150);  // the 20 s clip, sped up for the demo
  };
  const run = async (attempt: any) => {
    setBusy(true);
    setLast(attempt);
    setStage("analysing");
    try {
      const [r] = await Promise.all([api.post("/api/owner/self-check", { plate, ...attempt }), new Promise((ok) => setTimeout(ok, 900))]);
      setRes(r);
      setStage("result");
      setK((x) => x + 1);
      refreshUseCase();
    } catch (e: any) {
      toast(e.message, "err");
      setStage("intro");
    } finally {
      setBusy(false);
    }
  };
  const restart = () => {
    setStage("intro");
    setRes(null);
    setTintDone(false);
    setLampsDone(false);
    setTyres(0);
    setRec("");
    setPlaying(false);
  };
  const guided = () => ({ tint_vlt_pct: tint, headlamp_left: lampL, headlamp_right: "ok", tyre_images: tyreImgs, engine_audio: clip });
  const runAgain = () => {
    setTint(71);
    setLampL("ok");
    run(last && last !== base && last.tyre_images?.length === 4
      ? { ...last, tint_vlt_pct: Math.max(71, last.tint_vlt_pct ?? 71), headlamp_left: "ok", headlamp_right: "ok" }
      : script.data.second_attempt);
  };
  const lastCheck = latestCheck(pass.data?.events);
  const lastFix = lastCheck?.items?.filter((x: any) => !x.ok).length || 0;
  const title = stage === "intro" ? "Self-check" : stage === "result" ? "Your result" : stage === "analysing" ? "Checking" : "Guided self-check";
  const stepIdx = STEPS.findIndex((s) => s.id === stage);
  const back = stepIdx > 0 ? () => setStage(STEPS[stepIdx - 1].id) : stage === "review" ? () => setStage("engine") : null;

  return (
    <MobileShell tab="check" title={title} scrollKey={stage}
      actions={stage !== "intro" && stage !== "analysing" ? <button onClick={restart} className="rounded-full px-3 py-2 text-[14px] font-semibold text-[#2563EB] active:bg-blue-50">{stage === "result" ? "Done" : "Cancel"}</button> : undefined}>
      {!script.data ? <MSkeleton rows={3} h={120} /> : (
        <>
          {stage === "intro" && (
            <>
              <section className="m-pop overflow-hidden rounded-[26px] bg-gradient-to-br from-[#312E81] via-[#4338CA] to-[#6366F1] p-5 text-white shadow-[0_24px_50px_-26px_rgba(67,56,202,0.9)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11.5px] font-semibold uppercase tracking-[0.16em] text-indigo-200">Before you book</div>
                    <h2 className="mt-1 text-[22px] font-extrabold leading-tight">Pre-inspection self-check</h2>
                    <p className="mt-1.5 text-[13.5px] leading-snug text-indigo-100">Take photos of the tint, both headlamps and all 4 tyres, and record 20 seconds of engine sound. The app tells you what to fix before you book.</p>
                  </div>
                  <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30">
                    <span className="m-ring absolute inset-0 rounded-2xl ring-2 ring-white/40" aria-hidden />
                    <Icon name="camera" size={26} color="#fff" />
                  </span>
                </div>
                <div className="mt-3 flex gap-2 text-[12px] font-semibold"><span className="rounded-full bg-white/15 px-2.5 py-1">About 2 minutes</span><span className="rounded-full bg-white/15 px-2.5 py-1">4 captures</span></div>
                <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-[15px] font-bold text-[#3730A3] shadow-[0_12px_24px_-12px_rgba(15,23,42,0.6)] active:scale-[.985]" onClick={() => setStage("tint")}>
                  <Icon name="camera" size={18} color="#4338CA" />Start guided check
                </button>
              </section>
              <MList className="mt-4" label="What the self-check covers">
                <MRow icon="eye" tone="sky" title="Window tint" sub="Light meter on the front side window" right={<Source kind="simulated" />} chevron={false} />
                <MRow icon="lamp" tone="amber" title="Headlamps" sub="One photo with both lamps on" right={<Source kind="simulated" />} chevron={false} />
                <MRow icon="tyre" tone="purple" title="Tyres" sub="A photo of each tyre · Tyre AI" right={<Source kind="live_model" />} chevron={false} />
                <MRow icon="vib" tone="green" title="Engine sound" sub="20 s at idle · acoustic model" right={<Source kind="live_model" />} chevron={false} />
              </MList>
              {lastCheck && (
                <p className="mt-3 text-center text-[12.5px] text-slate-500">Last check on {dayLabel(lastCheck.date, true)}: {lastFix ? `${lastFix} item${lastFix === 1 ? "" : "s"} to put right` : "nothing to put right"}.</p>
              )}
              <MTitle action={<Source kind="sample" text="Demo car's captures" />}>Quick run</MTitle>
              <MCard>
                <p className="text-[13px] leading-snug text-slate-600">Run the check on the demo car&apos;s captures (tint at 38%, the left headlamp out), then again once they are fixed.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button disabled={busy || readOnly} className={BTN2} onClick={() => run({ ...base, tint_vlt_pct: tint, headlamp_left: lampL })}>{busy ? "Checking…" : "Run self-check"}</button>
                  <button disabled={busy || readOnly} className={BTN2} onClick={runAgain}>Run again after fixing</button>
                </div>
                {readOnly && <p className="mt-2 text-[12px] text-slate-500">Read-only account: the checks cannot be run.</p>}
              </MCard>
            </>
          )}

          {stage === "tint" && (
            <>
              <Progress stage={stage} />
              <Viewfinder hint="Hold the meter flat on the front side window" flash={flash} scanning={scan}>
                <TintScene vlt={tint} measured={tintDone} />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-6 pb-5 pt-10">
                  <span className={`rounded-full px-3 py-1.5 text-[13px] font-bold ${tintDone ? (tint < 50 ? "bg-rose-500 text-white" : "bg-emerald-500 text-white") : "bg-white/20 text-white"}`}>{tintDone ? `VLT ${tint}%` : "VLT --%"}</span>
                  <Shutter label="Measure the tint" onClick={() => shoot(() => setTintDone(true))} done={tintDone} />
                  <span className="w-[74px] text-right text-[11px] text-white/70">Limit 50%</span>
                </div>
              </Viewfinder>
              <DemoControls>
                <label className="block px-3 pb-3 pt-1 text-[13.5px]">
                  <span className="flex items-center justify-between">Tint reading (VLT) <b>{tint}%</b></span>
                  <input aria-label="Tint VLT" type="range" min={20} max={85} value={tint} onChange={(e) => { setTint(+e.target.value); setTintDone(false); }} className="mt-1 w-full accent-[#2563EB]" />
                </label>
              </DemoControls>
              <button disabled={!tintDone} className={`${BTN} mt-4 w-full`} onClick={() => setStage("lamps")}>Next: headlamps</button>
            </>
          )}

          {stage === "lamps" && (
            <>
              <Progress stage={stage} />
              <Viewfinder hint="Switch the headlamps on and stand 3 m in front" flash={flash} scanning={scan}>
                <LampScene left={lampL === "ok"} right />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-6 pb-5 pt-10">
                  <span className="flex w-[90px] flex-col gap-1 text-[11.5px] font-semibold">
                    {lampsDone ? <>
                      <span className={`rounded-full px-2 py-0.5 ${lampL === "ok" ? "bg-emerald-500" : "bg-rose-500"} text-white`}>Left {lampL === "ok" ? "on" : "out"}</span>
                      <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-white">Right on</span>
                    </> : <span className="text-white/70">Both lamps in frame</span>}
                  </span>
                  <Shutter label="Take the headlamp photo" onClick={() => shoot(() => setLampsDone(true))} done={lampsDone} />
                  <span className="w-[90px]" />
                </div>
              </Viewfinder>
              <DemoControls>
                <label className="flex items-center justify-between gap-3 px-3 pb-3 pt-1 text-[13.5px]">Left headlamp
                  <select aria-label="Left headlamp" className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-[13.5px]" value={lampL} onChange={(e) => { setLampL(e.target.value); setLampsDone(false); }}>
                    <option value="ok">working</option><option value="not working">not working</option>
                  </select>
                </label>
              </DemoControls>
              <button disabled={!lampsDone} className={`${BTN} mt-4 w-full`} onClick={() => setStage("tyres")}>Next: tyres</button>
            </>
          )}

          {stage === "tyres" && (
            <>
              <Progress stage={stage} />
              <Viewfinder hint={tyres < 4 ? `${TYRES[tyres]} tyre: fill the circle with the tread` : "All four tyres captured"} flash={flash} scanning={scan}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/media/data/${tyreImgs[Math.min(tyres, 3)]}`} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" />
                <span className="pointer-events-none absolute left-1/2 top-[44%] h-[62%] w-[78%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-white/80" aria-hidden />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent px-5 pb-5 pt-12">
                  <span className="w-[86px] text-[13px] font-bold text-white">{tyres}/4</span>
                  <Shutter label={tyres < 4 ? `Photograph the ${TYRES[tyres].toLowerCase()} tyre` : "All tyres captured"} disabled={tyres >= 4} onClick={() => shoot(() => setTyres((n) => n + 1), 500)} done={tyres >= 4} />
                  <span className="w-[86px]" />
                </div>
              </Viewfinder>
              <div className="mt-3 grid grid-cols-4 gap-2" aria-label="Tyre photos">
                {TYRES.map((t, i) => (
                  <div key={t} className="text-center">
                    <div className={`aspect-square overflow-hidden rounded-2xl ${i < tyres ? "ring-2 ring-emerald-500" : "border-2 border-dashed border-slate-300 bg-white/60"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {i < tyres && <img src={`/media/data/${tyreImgs[i]}`} alt={`${t} tyre photo`} className="h-full w-full object-cover" />}
                    </div>
                    <div className="mt-1 text-[10.5px] font-semibold text-slate-500">{t}</div>
                  </div>
                ))}
              </div>
              <DemoControls kind="sample" text="Sample tyre photos">
                <Switch checked={worn} onChange={(w) => { setWorn(w); if (tyres > 3) setTyres(3); }} label="Rear right tyre is worn" sub="Use a worn tyre's photo: the Tyre AI should catch it" />
              </DemoControls>
              <button disabled={tyres < 4} className={`${BTN} mt-4 w-full`} onClick={() => setStage("engine")}>Next: engine sound</button>
            </>
          )}

          {stage === "engine" && (
            <>
              <Progress stage={stage} />
              <Viewfinder hint="Engine at idle, bonnet open, phone 30 cm from the engine" flash={false}>
                <div className="absolute inset-0 bg-gradient-to-b from-[#0B1220] to-[#111C33]" />
                <Wave live={rec === "live"} done={rec === "done"} />
                <div className="absolute inset-x-0 top-[22%] text-center text-[34px] font-extrabold tabular-nums text-white">0:{String(rec ? secs : 20).padStart(2, "0")}</div>
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-6 pb-5 pt-10">
                  <span className="w-[86px]">
                    {rec === "done" && clip && (
                      <button onClick={() => setPlaying((x) => !x)} className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white" aria-label={playing ? "Stop playing the clip" : "Play the clip"}>
                        <Icon name={playing ? "close" : "play"} size={13} color="#fff" />{playing ? "Stop" : "Play"}
                      </button>
                    )}
                  </span>
                  <button onClick={record} disabled={rec === "live"} aria-label={rec === "done" ? "Record again" : "Record 20 seconds"}
                    className="relative flex h-[74px] w-[74px] items-center justify-center rounded-full ring-[3px] ring-white/90 active:scale-90 disabled:opacity-80">
                    {rec === "live" && <span className="m-ring absolute inset-0 rounded-full ring-4 ring-rose-400" aria-hidden />}
                    <span className={`bg-rose-500 transition-all ${rec === "live" ? "h-7 w-7 rounded-lg" : "h-[56px] w-[56px] rounded-full"}`} />
                  </button>
                  <span className="w-[86px] text-right text-[12px] font-semibold text-white/80">{rec === "done" ? "Recorded" : rec === "live" ? "Listening…" : "Tap to record"}</span>
                </div>
              </Viewfinder>
              {clip && <audio ref={audio} src={`/media/data/${clip}`} onEnded={() => setPlaying(false)} preload="none" />}
              <DemoControls kind="sample" text="Sample engine clips">
                <Switch checked={knock} onChange={(v) => { setKnock(v); setRec(""); setPlaying(false); }} label="The engine knocks" sub="Use a knocking engine's clip: the acoustic model should hear it" />
              </DemoControls>
              <button disabled={rec !== "done"} className={`${BTN} mt-4 w-full`} onClick={() => setStage("review")}>Review captures</button>
            </>
          )}

          {stage === "review" && (
            <>
              <Progress stage={stage} />
              <h2 className="px-1 text-[20px] font-extrabold tracking-tight">Ready to check</h2>
              <p className="px-1 text-[13px] text-slate-500">The tyre photos go to the Tyre AI and the clip to the acoustic model.</p>
              <MList className="mt-3" label="Captures">
                <MRow icon="eye" tone="sky" title="Window tint" sub={`VLT ${tint}% measured`} onClick={() => setStage("tint")} label="Retake the tint reading" />
                <MRow icon="lamp" tone="amber" title="Headlamps" sub={`Left ${lampL === "ok" ? "working" : "not working"} · right working`} onClick={() => setStage("lamps")} label="Retake the headlamp photo" />
                <MRow icon="tyre" tone="purple" title="Tyres" sub="4 photos" onClick={() => setStage("tyres")} label="Retake the tyre photos"
                  right={<span className="flex -space-x-2">{tyreImgs.map((t, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={`/media/data/${t}`} alt="" className="h-7 w-7 rounded-full object-cover ring-2 ring-white" />
                  ))}</span>} />
                <MRow icon="vib" tone="green" title="Engine sound" sub="20 s clip at idle" onClick={() => setStage("engine")} label="Record the engine again" />
              </MList>
              <button disabled={busy || readOnly} className={`${BTN} mt-4 w-full`} onClick={() => run(guided())}><Icon name="bolt" size={18} color="#fff" />Analyse captures</button>
            </>
          )}

          {stage === "analysing" && (
            <div className="flex flex-col items-center px-4 pt-10 text-center" role="status" aria-live="polite">
              <span className="relative flex h-28 w-28 items-center justify-center">
                <span className="m-ring absolute inset-0 rounded-full bg-blue-200/60" aria-hidden />
                <span className="m-spin absolute inset-2 rounded-full border-[3px] border-blue-200 border-t-[#2563EB]" aria-hidden />
                <Icon name="bolt" size={34} color="#2563EB" />
              </span>
              <h2 className="mt-6 text-[20px] font-extrabold">Checking your captures</h2>
              <ul className="mt-4 flex flex-col gap-2 text-left text-[13.5px] text-slate-600">
                <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#2563EB] pulse-dot" />Tyre AI is looking at the photos</li>
                <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#2563EB] pulse-dot" />The acoustic model is listening to the engine</li>
                <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#2563EB] pulse-dot" />Comparing tint and lamps with the limits</li>
              </ul>
            </div>
          )}

          {stage === "result" && res && (
            <div className="flex flex-col gap-3" role="status">
              <section className={`m-pop rounded-[26px] bg-gradient-to-br p-5 text-white shadow-lg ${VERDICT_STYLE[res.verdict]?.bg || "from-slate-500 to-slate-600"}`}>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/40"><Icon name={VERDICT_STYLE[res.verdict]?.icon || "info"} size={26} color="#fff" width={2.2} /></span>
                <div className="mt-3 text-[24px] font-extrabold leading-tight">{res.verdict}</div>
                <div className={`mt-1 text-[13.5px] ${VERDICT_STYLE[res.verdict]?.fg || ""}`}>{VERDICT_TEXT[res.verdict]}</div>
                <div className="mt-3 text-[12px] font-semibold opacity-90">{res.items.filter((i: any) => i.ok).length} of {res.items.length} checks fine</div>
              </section>
              <MCard pad={false} className="divide-y divide-slate-100" label="Self-check items">
                {[...res.items].sort((a: any, b: any) => Number(a.ok) - Number(b.ok)).map((it: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3">
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${it.ok ? "bg-emerald-500" : "bg-rose-500"}`}>
                      {it.ok ? <Icon name="check" size={14} color="#fff" width={3} /> : <b className="text-[12px]">!</b>}
                    </span>
                    <div className="min-w-0 flex-1 text-[13.5px] leading-snug">
                      <div><b>{it.item}</b> · {it.value}{it.p != null && <span className="text-slate-400"> ({Math.round(it.p * 100)}%)</span>}</div>
                      {it.advice && <div className="text-[12.5px] text-slate-600">{it.advice}</div>}
                      <div className="mt-1"><Source kind={/live model/.test(it.source) ? "live_model" : "simulated"} text={it.source.replace(/^.*\((.*)\)$/, "$1")} /></div>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {it.image && <img src={it.image} alt={`${it.item} photo`} className="h-12 w-12 shrink-0 rounded-xl object-cover" />}
                  </div>
                ))}
              </MCard>
              {res.verdict === "Fix these first" && (
                <button disabled={busy} className={`${BTN} w-full`} onClick={runAgain}><Icon name="refresh" size={18} color="#fff" />Run again after fixing</button>
              )}
              {res.verdict === "Ready for inspection" && (
                <a className={`${BTN} w-full`} href={href("/mobile/book")}><Icon name="calendar" size={18} color="#fff" />Book an inspection</a>
              )}
              {res.verdict === "Needs a professional check" && (
                <a className={`${BTN} w-full`} href={href("/mobile/assistant")}><Icon name="chat" size={18} color="#fff" />Ask the assistant what to do</a>
              )}
              <button className={`${BTN2} w-full`} onClick={restart}>Start a new check</button>
              {res.verdict === "Ready for inspection" && <p className="text-center text-[12.5px] text-slate-500">Next: book an inspection in the Book tab.</p>}
            </div>
          )}

          {back && <button className="mt-3 w-full py-2 text-[13.5px] font-semibold text-slate-500" onClick={back}>Back</button>}
        </>
      )}
    </MobileShell>
  );
}

export default function Page() {
  return <Suspense><CheckScreen /></Suspense>;
}
