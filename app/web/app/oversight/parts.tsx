"use client";
/* Pieces shared by the Oversight pages: a KPI tile with its provenance, scrolling tables with sticky headers, and
   filter pills. */
import Link from "next/link";
import { ReactNode, useEffect, useRef, useState } from "react";
import { IconTile, TONE, Tone } from "@/components/glass";
import { useEdgeFade } from "@/components/OversightShell";

/** A KPI: icon, label, the number (in the tone's colour when it needs attention, or in ``color``), a note and where it
 *  comes from. With ``href`` it links; with ``onClick`` it is a toggle (``pressed``). */
export function OvStat({ icon, tone, label, value, sub, source, href, onClick, pressed, alert = false, color }: {
  icon: string; tone: Tone; label: string; value: ReactNode; sub?: ReactNode; source?: ReactNode; href?: string;
  onClick?: () => void; pressed?: boolean; alert?: boolean; color?: string;
}) {
  const body = (
    <>
      {/* a phone gets a smaller icon, level with the label's first line, so the label keeps most of the width; from sm a
          label of up to two lines sits within the icon's height, so the numbers line up across a row */}
      <div className="flex items-start gap-2 sm:items-center sm:gap-3">
        <span className="shrink-0 sm:hidden"><IconTile icon={icon} tone={tone} size={28} /></span>
        <span className="hidden shrink-0 sm:block"><IconTile icon={icon} tone={tone} size={40} /></span>
        <span className="min-w-0 pt-[5px] text-[12.5px] font-semibold leading-snug text-fg-2 sm:pt-0 sm:text-[13px]">{label}</span>
      </div>
      <div className="mt-2.5 break-words text-[length:clamp(22px,6.4vw,30px)] font-bold leading-[1.1] tracking-tight tabular-nums" style={{ color: color ?? (alert ? TONE[tone].fg : undefined) }}>{value}</div>
      {sub && <div className="mt-1 text-[12.5px] leading-snug text-fg-3">{sub}</div>}
      {source && <div className="mt-auto flex min-w-0 flex-wrap gap-1.5 pt-2.5">{source}</div>}
    </>
  );
  const cls = `card flex h-full min-w-0 flex-col p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-lg sm:p-4 ${pressed ? "ring-2 ring-cyan ring-offset-2 ring-offset-transparent" : ""}`;
  if (onClick) return <button className={cls} onClick={onClick} aria-pressed={!!pressed}>{body}</button>;
  if (href) return <Link className={cls} href={href}>{body}</Link>;
  return <div className={cls}>{body}</div>;
}

/** A table that scrolls inside its card (both ways), its header row staying in view; an edge fades while more of the
 *  table is hidden that way. */
export function TableBox({ children, className = "max-h-[560px]" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEdgeFade(ref);
  return <div ref={ref} className={`min-w-0 overflow-auto overscroll-x-contain rounded-xl border border-ink-600/80 bg-white/55 ${className}`}>{children}</div>;
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

/** Whether the screen is phone-width (narrower than Tailwind's sm, 640 px). */
export function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 639px)");
    const f = () => setNarrow(q.matches);
    f();
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, []);
  return narrow;
}

/** A time in Malaysia, hh:mm:ss. */
export const mytTime = (d: Date | null) =>
  d ? d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--";
