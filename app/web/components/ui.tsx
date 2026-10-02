"use client";
import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PROVENANCE, PROVENANCE_ORDER, SEVERITY, Severity, provenance } from "@/lib/present";

/** The plain label of a data source ("live_model" -> "LIVE MODEL"). */
export const sourceLabel = (kind: string) => PROVENANCE[provenance(kind).kind].label;

/** Provenance badge: one of the labels (with its meaning on hover and for screen readers), plus what exactly produced
 *  the value. One quiet style everywhere: a small grey tag with the label's coloured dot, so it never competes with a
 *  severity, an outcome or an action. `dense` keeps the detail in the tooltip only (crowded rows and cards). */
export function Source({ kind, text, className = "", dense = false }: { kind: string; text?: string; className?: string; dense?: boolean }) {
  const { kind: k, detail } = provenance(kind, text);
  const s = PROVENANCE[k];
  const help = `${s.label}: ${s.help}${detail ? ` (${detail})` : ""}`;
  const show = detail && !dense;
  // a grid, not a flex row: the dot and the label keep their width (the tag never shrinks below the label in a
  // crowded row) and only the detail column gives way, truncated
  return (
    <span className={`inline-grid max-w-full items-center gap-1.5 whitespace-nowrap rounded-md bg-slate-500/[0.07] px-1.5 py-[3px] text-[10.5px] font-semibold leading-none text-fg-3 ${show ? "grid-cols-[auto_auto_minmax(0,auto)]" : "grid-cols-[auto_auto]"} ${className}`}
      title={help} aria-label={help}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} aria-hidden />
      <span className="tracking-[0.06em]">{s.label}</span>
      {show && <span className="min-w-0 truncate font-medium normal-case tracking-normal text-fg-4" aria-hidden>· {detail}</span>}
    </span>
  );
}
export const ProvenanceBadge = Source;

/** What each provenance label means: for first-time viewers (header help and the demo control). */
export function ProvenanceLegend({ compact = false }: { compact?: boolean }) {
  return (
    <ul className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 sm:gap-x-5"}`}>
      {PROVENANCE_ORDER.map((k) => (
        <li key={k} className="grid grid-cols-[116px_minmax(0,1fr)] items-start gap-2 text-[12.5px] leading-snug">
          <span className="mt-0.5"><Source kind={k} /></span>
          <span className="text-fg-3">{PROVENANCE[k].help}</span>
        </li>
      ))}
    </ul>
  );
}

/** Normal / Attention / Critical, with text (never colour alone). */
export function SeverityBadge({ s, className = "" }: { s: Severity; className?: string }) {
  const v = SEVERITY[s];
  return (
    <span className={`chip ${className}`} style={{ borderColor: v.color + "80", color: v.color, background: v.color + "14" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.color }} aria-hidden />{v.label}
    </span>
  );
}

/** A panel still loading: keeps its place with a skeleton and says what is coming. */
export function LoadingState({ label = "Loading…", rows = 3, className = "" }: { label?: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={`flex flex-col gap-2 ${className}`}>
      <span className="text-[12.5px] text-fg-3">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <span key={i} className="skeleton h-3.5 rounded" style={{ width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}

/** Something could not load: say so in plain words and offer a retry, keeping the page usable. */
export function ErrorState({ title = "This panel could not load", children, onRetry }: { title?: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-bad/40 bg-bad/5 px-4 py-3 text-[13px]">
      <b className="text-bad">{title}</b>
      {children && <span className="text-fg-3">{children}</span>}
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Card({ title, right, children, className = "", pad = true }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${pad ? "card-pad" : ""} ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {typeof title === "string" ? <h2 className="h-title min-w-0">{title}</h2> : title}
          <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{right}</div>
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, color, right }: { label: string; value: ReactNode; sub?: ReactNode; color?: string; right?: ReactNode }) {
  return (
    <div className="card card-pad flex flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] text-fg-3">{label}</span>
        {right}
      </div>
      <span className="font-display text-[28px] font-semibold leading-tight" style={{ color }}>{value}</span>
      {sub && <span className="text-[12px] text-fg-3">{sub}</span>}
    </div>
  );
}

export function Pill({ children, color = "#64748B", solid = false }: { children: ReactNode; color?: string; solid?: boolean }) {
  return (
    <span className="chip max-w-full whitespace-normal" style={{ borderColor: color, color: solid ? "#FFFFFF" : color, background: solid ? color : color + "18" }}>
      {children}
    </span>
  );
}

/** Nothing to show yet: say why, and offer the next action instead of a dead end. */
export const EmptyState = (p: { children?: ReactNode; title?: ReactNode; actions?: ReactNode }) => Empty(p);
export function Empty({ children, title, actions }: { children?: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-500 bg-ink-850/40 px-6 py-10 text-center">
      {title && <div className="font-display text-[18px] font-semibold text-fg">{title}</div>}
      {children && <div className="max-w-[560px] text-[13.5px] leading-relaxed text-fg-3">{children}</div>}
      {actions && <div className="mt-3 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

/** Eyebrow, title, one line on what the page is for, and the page's actions - the same on every screen. */
export function PageHeader({ title, sub, actions, children, eyebrow }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-[28px] font-extrabold leading-[1.1] tracking-tight text-fg sm:text-[34px] xl:text-[40px]">{title}</h1>
        {sub && <p className="mt-2 max-w-[820px] text-[14.5px] text-fg-2 sm:text-[16px]">{sub}</p>}
        {children}
      </div>
      {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Tab buttons; `nowrap` keeps them on one row that scrolls sideways on a narrow screen. */
export function Tabs({ value, onChange, items, size = "md", nowrap = false }: { value: string; onChange: (v: any) => void; items: { id: string; label: ReactNode }[]; size?: "sm" | "md"; nowrap?: boolean }) {
  return (
    <div role="tablist" className={`${nowrap ? "flex max-w-full flex-nowrap overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap" : "inline-flex flex-wrap"} gap-1 rounded-xl border border-white/80 bg-white/70 p-1 shadow-glass`}>
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={`rounded-lg px-3 ${size === "sm" ? "py-1 text-[12px]" : "py-1.5 text-[13px]"} font-semibold transition ${value === it.id ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow-sm" : "text-fg-2 hover:bg-white"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

type ToastKind = "info" | "ok" | "err";
let pushToast: (m: string, kind: ToastKind) => void = () => {};
/** Short confirmation in the corner; errors in red. At most three stay on screen. */
export const toast = (m: string, kind: ToastKind = "info") => pushToast(m, kind);
const TOAST_COL: Record<ToastKind, string> = { info: "#2563EB", ok: "#059669", err: "#DC2626" };

export function Toaster() {
  const [msgs, setMsgs] = useState<{ id: number; m: string; kind: ToastKind }[]>([]);
  useEffect(() => {
    pushToast = (m, kind) => {
      const id = Date.now() + Math.random();
      setMsgs((x) => [...x.filter((y) => y.m !== m), { id, m, kind }].slice(-3));
      setTimeout(() => setMsgs((x) => x.filter((y) => y.id !== id)), kind === "err" ? 6000 : 3200);
    };
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
      {msgs.map((t) => (
        <div key={t.id} role="status" className="toast-in flex max-w-[420px] items-start gap-2.5 rounded-xl border border-ink-500 bg-ink-750 px-4 py-3 text-[13px] font-medium text-fg shadow-2xl"
          style={{ borderLeft: `3px solid ${TOAST_COL[t.kind]}` }}>
          {t.m}
        </div>
      ))}
    </div>
  );
}

export function ScoreRing({ value, size = 120, label = "Health" }: { value: number | null | undefined; size?: number; label?: string }) {
  const sw = size >= 100 ? 10 : 7;
  const r = size / 2 - sw + 1;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  const col = value == null ? "#CBD5E1" : v < 50 ? "#DC2626" : v < 70 ? "#D97706" : "#059669";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E8F0" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-display font-semibold" style={{ color: col, fontSize: Math.round(size * 0.26) }}>{value == null ? "–" : Math.round(v)}</span>
        {size >= 96 && <span className="mt-1 text-[11px] text-fg-3">{label}</span>}
      </div>
    </div>
  );
}

export function Bar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded bg-ink-600">
      <div className="h-1.5 rounded" style={{ width: `${Math.max(2, Math.min(100, (100 * value) / max))}%`, background: color }} />
    </div>
  );
}

export function Modal({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  // rendered into <body>: a modal opened from the blurred sticky header would otherwise be confined to the header
  // (backdrop-filter makes it the containing block of fixed elements)
  return createPortal(
    <div role="dialog" aria-label={title} className="fade-in fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-3 backdrop-blur-[3px] sm:p-6" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-[900px] overflow-auto rounded-3xl border border-white bg-white p-4 shadow-float sm:w-auto sm:min-w-[360px] sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-6">
          <h2 className="h-title">{title}</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
