"use client";
/* The light glass design system: stat cards, soft status pills, rings, progress bars and section cards. */
import Link from "next/link";
import { ReactNode } from "react";
import { Icon } from "./icons";

export type Tone = "blue" | "green" | "amber" | "red" | "gray" | "purple" | "sky";
export const TONE: Record<Tone, { fg: string; bg: string; ring: string; solid: string }> = {
  blue: { fg: "#1D4ED8", bg: "#EFF4FF", ring: "#BFD3FE", solid: "#2563EB" },
  green: { fg: "#047857", bg: "#ECFDF3", ring: "#A7F3D0", solid: "#10B981" },
  amber: { fg: "#B45309", bg: "#FFF7E6", ring: "#FDE3A7", solid: "#F59E0B" },
  red: { fg: "#B91C1C", bg: "#FEF1F1", ring: "#FECACA", solid: "#EF4444" },
  gray: { fg: "#475569", bg: "#F1F5F9", ring: "#E2E8F0", solid: "#94A3B8" },
  purple: { fg: "#6D28D9", bg: "#F5F0FF", ring: "#DDD6FE", solid: "#8B5CF6" },
  sky: { fg: "#0369A1", bg: "#EDF8FF", ring: "#BAE6FD", solid: "#0EA5E9" },
};

/** A soft status pill ("In Operation", "Pass", "Major"). */
export function StatusPill({ tone = "gray", children, dot = false, className = "" }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  const t = TONE[tone];
  return (
    <span className={`pill gap-1.5 ${className}`} style={{ color: t.fg, background: t.bg, boxShadow: `inset 0 0 0 1px ${t.ring}` }}>
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.solid }} aria-hidden />}
      {children}
    </span>
  );
}

/** A square tinted tile with an icon (KPI cards, list rows). */
export function IconTile({ icon, tone = "blue", size = 52 }: { icon: string; tone?: Tone; size?: number }) {
  const t = TONE[tone];
  return (
    <span className="flex shrink-0 items-center justify-center rounded-2xl" style={{ width: size, height: size, background: `linear-gradient(145deg, ${t.bg}, #ffffff)`, boxShadow: `inset 0 0 0 1px ${t.ring}` }}>
      <Icon name={icon} size={Math.round(size * 0.46)} color={t.solid} width={2} />
    </span>
  );
}

/** A KPI: icon tile, label, the number, its change and a short note. */
export function StatCard({ icon, tone, label, value, delta, deltaTone = "green", sub, href }: {
  icon: string; tone: Tone; label: string; value: ReactNode; delta?: ReactNode; deltaTone?: Tone; sub?: ReactNode; href?: string;
}) {
  const body = (
    <div className="card flex h-full items-center gap-3.5 p-4 transition hover:-translate-y-0.5 hover:shadow-lg">
      <IconTile icon={icon} tone={tone} size={50} />
      <div className="min-w-0">
        <div className="text-[13px] font-medium leading-snug text-fg-3">{label}</div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[30px] font-bold leading-tight tracking-tight">{value}</span>
          {delta != null && <span className="whitespace-nowrap text-[13px] font-semibold" style={{ color: TONE[deltaTone].fg }}>{delta}</span>}
        </div>
        {sub && <div className="text-[12.5px] leading-snug text-fg-4">{sub}</div>}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block rounded-2xl">{body}</Link> : body;
}

/** A progress ring with the number in the middle. */
export function Ring({ value, size = 120, stroke = 12, color = "#2563EB", track = "#E8EEF7", children }: {
  value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(c * v) / 100} ${c}`} style={{ transition: "stroke-dasharray .6s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">{children}</div>
    </div>
  );
}

/** A ring split into parts (lane utilisation). */
export function SegmentRing({ parts, size = 150, stroke = 16, children }: { parts: { value: number; color: string }[]; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E8EEF7" strokeWidth={stroke} />
        {parts.map((p, i) => {
          const d = (c * p.value) / total;
          const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke} strokeDasharray={`${Math.max(0, d - 2)} ${c}`} strokeDashoffset={-acc} />;
          acc += d;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">{children}</div>
    </div>
  );
}

export function ProgressBar({ value, tone = "blue", className = "" }: { value: number; tone?: Tone; className?: string }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-[#E8EEF7] ${className}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: `linear-gradient(90deg, ${TONE[tone].solid}, ${TONE[tone].fg})` }} />
    </div>
  );
}

/** A card with a title row and an optional "View all" style link or actions. */
export function Panel({ title, action, href, actionLabel = "View all", children, className = "", pad = true, sub }: {
  title?: ReactNode; action?: ReactNode; href?: string; actionLabel?: string; children: ReactNode; className?: string; pad?: boolean; sub?: ReactNode;
}) {
  return (
    <section className={`card ${pad ? "p-4 lg:p-5" : ""} ${className}`}>
      {(title || action || href) && (
        <div className={`mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-1 ${pad ? "" : "px-4 pt-4 lg:px-5 lg:pt-5"}`}>
          <div className="min-w-0">
            {typeof title === "string" ? <h2 className="text-[18px] font-bold tracking-tight">{title}</h2> : title}
            {sub && <p className="text-[13px] text-fg-3">{sub}</p>}
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            {action}
            {href && <Link className="text-[13px] font-semibold text-cyan hover:underline" href={href}>{actionLabel}</Link>}
          </div>
        </div>
      )}
      {children}
    </section>
  );
}

/** The plain-language result tone of a verdict or an item status. */
export const VERDICT_TONE: Record<string, Tone> = {
  PASS: "green", FAIL: "red", CONDITIONAL: "amber", REFERRED: "blue", PASS_ADVISORY: "amber",
  pass: "green", fail: "red", advisory: "amber", review: "purple", in_progress: "amber", not_started: "gray",
};
