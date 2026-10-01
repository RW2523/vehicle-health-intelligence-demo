"use client";
/* The mobile app's building blocks: cards, list rows, section titles, the number plate, verdict pills, segmented
   controls and switches, sized for a 360-390 px phone screen (no breakpoints: the framed phone is narrow on any
   desktop too). */
import Link from "next/link";
import { ReactNode } from "react";
import { Ring, StatusPill, TONE, Tone } from "./glass";
import { Icon } from "./icons";

/** Primary and secondary buttons. */
export const BTN = "inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#3B82F6] to-[#2563EB] px-4 py-3.5 text-[15px] font-semibold text-white shadow-[0_12px_24px_-12px_rgba(37,99,235,0.9)] transition active:scale-[.985] disabled:opacity-40";
export const BTN2 = "inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[14px] font-semibold text-slate-800 shadow-sm transition active:scale-[.985] active:bg-slate-50 disabled:opacity-40";

export function MCard({ children, className = "", pad = true, as = "section", label }: { children: ReactNode; className?: string; pad?: boolean; as?: "section" | "div" | "article"; label?: string }) {
  const T = as;
  return <T aria-label={label} className={`rounded-[22px] border border-white/90 bg-white/85 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_12px_30px_-18px_rgba(15,23,42,0.28)] backdrop-blur-xl ${pad ? "p-4" : ""} ${className}`}>{children}</T>;
}

/** A section title above a card or list, with an optional link on the right. */
export function MTitle({ children, action, href, id }: { children: ReactNode; action?: ReactNode; href?: string; id?: string }) {
  return (
    <div className="mb-2 mt-6 flex flex-wrap items-end justify-between gap-x-3 gap-y-1.5" id={id}>
      <h2 className="min-w-0 text-[16px] font-bold tracking-tight">{children}</h2>
      {href ? <Link href={href} className="-my-2.5 shrink-0 py-2.5 pl-3 text-[13px] font-semibold text-[#2563EB]">{action || "See all"}</Link> : action}
    </div>
  );
}

/** A list row: icon tile, title and sub-line, something on the right; a link or a button when it goes somewhere. */
export function MRow({ icon, tone = "blue", title, sub, right, href, onClick, chevron = !!(href || onClick), label, children }: {
  icon?: ReactNode | string; tone?: Tone; title: ReactNode; sub?: ReactNode; right?: ReactNode; href?: string; onClick?: () => void; chevron?: boolean; label?: string; children?: ReactNode;
}) {
  const t = TONE[tone];
  const body = (
    <>
      {icon && (typeof icon === "string"
        ? <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]" style={{ background: t.bg, boxShadow: `inset 0 0 0 1px ${t.ring}` }}><Icon name={icon} size={19} color={t.solid} width={1.9} /></span>
        : icon)}
      <span className="min-w-0 flex-1 leading-snug">
        <span className="line-clamp-2 break-words text-[14.5px] font-semibold text-slate-900">{title}</span>
        {sub && <span className="block text-[12.5px] text-slate-500">{sub}</span>}
        {children}
      </span>
      {right && <span className="shrink-0 text-right">{right}</span>}
      {chevron && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>}
    </>
  );
  const cls = "flex w-full items-center gap-3 px-4 py-3 text-left transition active:bg-slate-50";
  if (href) return <Link href={href} aria-label={label} className={cls}>{body}</Link>;
  if (onClick) return <button onClick={onClick} aria-label={label} className={cls}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

/** Rows in one card with hairlines between them. */
export function MList({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return <MCard pad={false} className={`divide-y divide-slate-100 overflow-hidden ${className}`} label={label}>{children}</MCard>;
}

/** A Malaysian number plate (white on black). */
export function Plate({ plate, size = "md" }: { plate: string; size?: "sm" | "md" | "lg" }) {
  const s = size === "lg" ? "px-3 py-1 text-[17px]" : size === "sm" ? "px-1.5 py-[1px] text-[11px]" : "px-2 py-0.5 text-[13px]";
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md bg-[#0B1220] font-bold tracking-[0.08em] text-white shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.35)] ${s}`}>{plate}</span>;
}

export const RESULT_TONE: Record<string, Tone> = { PASS: "green", FAIL: "red", CONDITIONAL: "amber", REFERRED: "blue", PASS_ADVISORY: "amber" };
export function Verdict({ v, className = "" }: { v?: string | null; className?: string }) {
  if (!v) return null;
  return <StatusPill tone={RESULT_TONE[v] || "gray"} dot className={className}>{v === "PASS_ADVISORY" ? "PASS · advisory" : v}</StatusPill>;
}

export const scoreTone = (v?: number | null): Tone => (v == null ? "gray" : v < 50 ? "red" : v < 70 ? "amber" : "green");
export const scoreCol = (v?: number | null) => TONE[scoreTone(v)].solid;

/** The vehicle's health score in a ring; without a score, the latest inspection's result in a soft ring of its colour
 *  ("PASS · Latest"); nothing at all when there is neither. */
export function HealthBadge({ health, latest, size = 62, stroke = 7, track }: {
  health?: number | null; latest?: { result?: string | null } | null; size?: number; stroke?: number; track?: string;
}) {
  if (health != null)
    return (
      <Ring value={health} size={size} stroke={stroke} color={scoreCol(health)} track={track}>
        <span className="font-extrabold leading-none" style={{ color: scoreCol(health), fontSize: Math.round(size * 0.28) }}>{health}</span>
        <span className="mt-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-slate-400">Health</span>
      </Ring>
    );
  const r = latest?.result;
  if (!r) return null;
  const t = TONE[RESULT_TONE[r] || "gray"];
  const word = r === "PASS_ADVISORY" ? "PASS" : r;
  return (
    <span role="img" aria-label={`Latest inspection: ${word}`} title="No health score yet: the latest inspection's result">
      <Ring value={100} size={size} stroke={stroke} color={t.ring} track={track}>
        {word.length <= 4
          ? <span className="font-extrabold leading-none" style={{ color: t.fg, fontSize: Math.round(size * 0.22) }}>{word}</span>
          : <Icon name={r === "REFERRED" ? "info" : "warn"} size={Math.round(size * 0.3)} color={t.fg} width={2.2} />}
        <span className="mt-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-slate-400">Latest</span>
      </Ring>
    </span>
  );
}

/** "today", "tomorrow", "in 17 days", "3 days ago". */
export function inDays(days: number) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  const n = Math.abs(days);
  const span = n < 60 ? `${n} days` : n < 350 ? `${Math.round(n / 30.4)} months` : n < 400 ? "a year" : `${Math.round(n / 365)} years`;
  return days > 0 ? `in ${span}` : `${span} ago`;
}

/** "Fri, 2 Oct" (a calendar date as it is). */
export const dayLabel = (iso?: string | null, year = false) =>
  !iso ? "–" : new Date(iso.slice(0, 10) + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });

/** Good morning / afternoon / evening, in Malaysia time. */
export function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", hour12: false }));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** A row of options, one chosen (a native-feeling segmented control). */
export function Segmented<T extends string>({ value, onChange, items, label, className = "" }: {
  value: T; onChange: (v: NoInfer<T>) => void; items: { id: NoInfer<T>; label: ReactNode }[]; label: string; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`grid gap-1 rounded-[14px] bg-slate-200/60 p-1 ${className}`} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it) => (
        <button key={it.id} aria-pressed={value === it.id} onClick={() => onChange(it.id)}
          className={`truncate rounded-[11px] px-2 py-[10px] text-[13px] font-semibold transition ${value === it.id ? "bg-white text-slate-900 shadow-[0_2px_8px_-2px_rgba(15,23,42,0.18)]" : "text-slate-500 active:text-slate-800"}`}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** An on/off switch with its label. */
export function Switch({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-50">
      <span className="min-w-0 flex-1 leading-snug"><span className="block text-[14.5px] font-medium">{label}</span>{sub && <span className="block text-[12px] text-slate-500">{sub}</span>}</span>
      <span className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors ${checked ? "bg-[#22C55E]" : "bg-slate-300"}`} aria-hidden>
        <span className={`absolute top-[2px] h-[26px] w-[26px] rounded-full bg-white shadow-md transition-all ${checked ? "left-[22px]" : "left-[2px]"}`} />
      </span>
    </button>
  );
}

/** Nothing to show: an icon, a title, why, and what to do. */
export function MEmpty({ icon = "info", title, children, action }: { icon?: string; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[22px] border border-dashed border-slate-300 bg-white/50 px-6 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100"><Icon name={icon} size={22} color="#64748B" /></span>
      <b className="text-[15px]">{title}</b>
      {children && <p className="text-[13px] leading-relaxed text-slate-500">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Loading placeholder blocks. */
export function MSkeleton({ rows = 3, h = 64 }: { rows?: number; h?: number }) {
  return (
    <div className="flex flex-col gap-2.5" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton rounded-[20px]" style={{ height: h }} />)}
    </div>
  );
}

/** Something could not load: plain words and a retry. */
export function MError({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
      <span>{children}</span>
      {onRetry && <button className="rounded-xl bg-white px-3 py-1.5 text-[12.5px] font-semibold text-rose-700 ring-1 ring-rose-200" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** A small round icon button for the top bar. */
export function BarButton({ icon, label, onClick, href, dot }: { icon: string; label: string; onClick?: () => void; href?: string; dot?: boolean }) {
  const inner = (
    <>
      <Icon name={icon} size={20} color="#1E293B" width={1.9} />
      {dot && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-[#EF4444] ring-2 ring-white" aria-hidden />}
    </>
  );
  const cls = "relative flex h-10 w-10 items-center justify-center rounded-full bg-white/80 shadow-[0_4px_14px_-6px_rgba(15,23,42,0.25)] ring-1 ring-white active:scale-95";
  return href ? <Link href={href} aria-label={label} className={cls}>{inner}</Link> : <button onClick={onClick} aria-label={label} className={cls}>{inner}</button>;
}
