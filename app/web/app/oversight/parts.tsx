"use client";
/* Pieces shared by the Oversight pages: a KPI tile with its provenance, scrolling tables with sticky headers, and
   filter pills. */
import Link from "next/link";
import { ReactNode } from "react";
import { IconTile, TONE, Tone } from "@/components/glass";

/** A KPI: icon, label, the number (in the tone's colour when it needs attention), a note and where it comes from.
 *  With ``href`` it links; with ``onClick`` it is a toggle (``pressed``). */
export function OvStat({ icon, tone, label, value, sub, source, href, onClick, pressed, alert = false }: {
  icon: string; tone: Tone; label: string; value: ReactNode; sub?: ReactNode; source?: ReactNode; href?: string;
  onClick?: () => void; pressed?: boolean; alert?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center gap-3">
        <IconTile icon={icon} tone={tone} size={40} />
        <span className="min-w-0 text-[13px] font-semibold leading-snug text-fg-2">{label}</span>
      </div>
      <div className="mt-2.5 break-words text-[length:clamp(22px,6.4vw,30px)] font-bold leading-[1.1] tracking-tight" style={{ color: alert ? TONE[tone].fg : undefined }}>{value}</div>
      {sub && <div className="mt-1 text-[12.5px] leading-snug text-fg-3">{sub}</div>}
      {source && <div className="mt-auto flex flex-wrap gap-1.5 pt-2.5">{source}</div>}
    </>
  );
  const cls = `card flex h-full min-w-0 flex-col p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${pressed ? "ring-2 ring-cyan ring-offset-2 ring-offset-transparent" : ""}`;
  if (onClick) return <button className={cls} onClick={onClick} aria-pressed={!!pressed}>{body}</button>;
  if (href) return <Link className={cls} href={href}>{body}</Link>;
  return <div className={cls}>{body}</div>;
}

/** A table that scrolls inside its card (both ways), its header row staying in view. */
export function TableBox({ children, className = "max-h-[560px]" }: { children: ReactNode; className?: string }) {
  return <div className={`min-w-0 overflow-auto overscroll-x-contain rounded-xl border border-ink-600/80 bg-white/55 ${className}`}>{children}</div>;
}
/** thead classes for a TableBox table: sticky, frosted header cells. */
export const THEAD = "text-left text-[12px] text-fg-3 [&_th]:sticky [&_th]:top-0 [&_th]:z-[1] [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-ink-600 [&_th]:bg-[#F3F6FB]/95 [&_th]:px-3 [&_th]:py-2.5 [&_th]:font-semibold [&_th]:backdrop-blur";
/** tbody row classes for a TableBox table. */
export const TROW = "border-b border-ink-600/60 last:border-0 [&>td]:px-3 [&>td]:py-2.5";

/** A filter as a pill (aria-pressed), with an optional count. */
export function FilterPill({ on, onClick, children, count, tone = "blue" }: { on: boolean; onClick: () => void; children: ReactNode; count?: number; tone?: Tone }) {
  const t = TONE[tone];
  return (
    <button onClick={onClick} aria-pressed={on}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition ${on ? "text-white shadow-sm" : "bg-white/80 text-fg-2 ring-1 ring-ink-500/70 hover:bg-white"}`}
      style={on ? { background: `linear-gradient(180deg, ${t.solid}, ${t.fg})` } : undefined}>
      {children}
      {count != null && <span className={`rounded-full px-1.5 text-[11px] ${on ? "bg-white/25" : "bg-ink-700 text-fg-3"}`}>{count}</span>}
    </button>
  );
}

/** A time in Malaysia, hh:mm:ss. */
export const mytTime = (d: Date | null) =>
  d ? d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--";
