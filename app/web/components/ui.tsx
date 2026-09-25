"use client";
import { ReactNode, useEffect, useState } from "react";

const SOURCE: Record<string, { label: string; c: string }> = {
  live_model: { label: "Live model", c: "#22D3EE" },
  live_logic: { label: "Live logic", c: "#A78BFA" },
  simulated: { label: "Simulated", c: "#FBBF24" },
  real: { label: "Real public data", c: "#34D399" },
  synthetic: { label: "Synthetic data", c: "#FB923C" },
  sample: { label: "Sample images", c: "#F472B6" },
  mock: { label: "Mock UI", c: "#9AA8BF" },
  llm: { label: "Local LLM", c: "#22D3EE" },
  template: { label: "Template engine", c: "#9AA8BF" },
};

/** Honest data label shown on every panel (live model / live logic / simulated / real / synthetic ...). */
export function Source({ kind, text }: { kind: string; text?: string }) {
  const s = SOURCE[kind] || { label: kind, c: "#9AA8BF" };
  return (
    <span className="chip" style={{ borderColor: s.c + "66", color: s.c, background: s.c + "12" }} title="How this panel's data is produced">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.c }} />
      {text || s.label}
    </span>
  );
}

export function Card({ title, right, children, className = "", pad = true }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${pad ? "card-pad" : ""} ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {typeof title === "string" ? <h2 className="h-title">{title}</h2> : title}
          <div className="flex flex-wrap items-center justify-end gap-2">{right}</div>
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

export function Pill({ children, color = "#9AA8BF", solid = false }: { children: ReactNode; color?: string; solid?: boolean }) {
  return (
    <span className="chip max-w-full whitespace-normal" style={{ borderColor: color, color: solid ? "#06202A" : color, background: solid ? color : color + "18" }}>
      {children}
    </span>
  );
}

/** Nothing to show yet: say why, and offer the next action instead of a dead end. */
export function Empty({ children, title, actions }: { children?: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-500 bg-ink-850/40 px-6 py-10 text-center">
      {title && <div className="font-display text-[18px] font-semibold text-fg">{title}</div>}
      {children && <div className="max-w-[560px] text-[13.5px] leading-relaxed text-fg-3">{children}</div>}
      {actions && <div className="mt-3 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

/** Title, one line on what the page is for, and the page's actions - the same on every screen. */
export function PageHeader({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-[24px] font-semibold leading-tight">{title}</h1>
        {sub && <p className="mt-1 max-w-[760px] text-[13.5px] text-fg-3">{sub}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs({ value, onChange, items, size = "md" }: { value: string; onChange: (v: any) => void; items: { id: string; label: ReactNode }[]; size?: "sm" | "md" }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-xl border border-ink-600 bg-ink-850 p-1">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={`rounded-lg px-3 ${size === "sm" ? "py-1 text-[12px]" : "py-1.5 text-[13px]"} font-semibold transition ${value === it.id ? "bg-cyan text-[#06202A]" : "text-fg-2 hover:bg-ink-700"}`}
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
const TOAST_COL: Record<ToastKind, string> = { info: "#22D3EE", ok: "#34D399", err: "#F87171" };

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
  const col = value == null ? "#2A3957" : v < 50 ? "#F87171" : v < 70 ? "#FBBF24" : "#34D399";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1F2B44" strokeWidth={sw} />
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
  return (
    <div role="dialog" aria-label={title} className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="card max-h-[90vh] max-w-[900px] overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-6">
          <h2 className="h-title">{title}</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
