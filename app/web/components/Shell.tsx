"use client";
/* One app shell for every screen: navigation grouped by who uses it, a header that says where you are and what comes
   next, the live pipeline status and the Malaysia clock. Sidebar on desktops, icon rail on small laptops, a drawer on
   phones and tablets. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { llmLabel, mydate, myt } from "@/lib/format";
import { useClock } from "@/lib/live";
import { NextStep } from "./Guide";
import { Icon } from "./icons";

export const NAV = [
  { group: "Start here", items: [{ href: "/", label: "Demo control", sub: "Guided demo and sessions", icon: "play" }] },
  {
    group: "Inspection lane",
    items: [
      { href: "/lane", label: "Lane console", sub: "Live sensors and AI", icon: "lane" },
      { href: "/examiner", label: "Examiner", sub: "Decide alerts, issue report", icon: "examiner" },
      { href: "/report", label: "Reports", sub: "Results and QR verification", icon: "report" },
      { href: "/vision", label: "AI vision", sub: "Photo models on demand", icon: "vision" },
    ],
  },
  {
    group: "Fleets and owners",
    items: [
      { href: "/fleet", label: "Fleet intelligence", sub: "Risk, forecasts, bookings", icon: "fleet" },
      { href: "/fleet/vehicle", label: "Vehicle history", sub: "Wear trend and forecast", icon: "history" },
      { href: "/owner", label: "Owner app", sub: "Assistant, booking, self-check", icon: "owner" },
    ],
  },
  {
    group: "Oversight",
    items: [
      { href: "/hq", label: "HQ operations", sub: "Integrity, demand, audit", icon: "hq" },
      { href: "/regulator", label: "Regulator", sub: "JPJ and DOE view", icon: "regulator" },
    ],
  },
];

/** The nav entry for a path: the longest matching prefix ("/fleet/vehicle/VKR 3128" is Vehicle history). */
export function navMatch(path: string) {
  const all = NAV.flatMap((g) => g.items.map((it) => ({ ...it, group: g.group })));
  return all
    .filter((it) => (it.href === "/" ? path === "/" : path === it.href || path.startsWith(it.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <path d="M5 8l10 24h5L10 8z" fill="#FF7A1A" />
      <path d="M35 8L22 32h-5L30 8z" fill="#3B82F6" />
      <circle cx="20" cy="8" r="3.2" fill="#22D3EE" />
    </svg>
  );
}

function StatusDot() {
  const [s, setS] = useState<any>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const load = () => api.get("/api/system/status").then(setS).catch(() => setS(null)).finally(() => setChecked(true));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);
  const ok = !!s;
  const llm = s ? llmLabel(s.llm.backend) : null;
  return (
    <span className="chip border-ink-600 text-fg-2" title={s ? `Assistant and reports: ${llm || "template engine"} · bus ${s.bus.kind} · ${s.database}` : "API not reachable"}>
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-ok pulse-dot" : checked ? "bg-bad" : "bg-fg-4"}`} />
      <span className="hidden sm:inline">{ok ? `Pipeline live${llm ? " · LLM" : ""}` : checked ? "API offline" : "Connecting…"}</span>
    </span>
  );
}

function NavLinks({ rail = false, onNavigate }: { rail?: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  const cur = navMatch(path);
  return (
    <nav aria-label="Apps" className="flex flex-col gap-3 py-3">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className={rail ? "mx-4 mb-1 border-t border-ink-600 xl:hidden" : "hidden"} />
          <div className={`px-5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4 ${rail ? "hidden xl:block" : ""}`}>{g.group}</div>
          {g.items.map((it) => {
            const on = cur?.href === it.href;
            return (
              <Link key={it.href} href={it.href} onClick={onNavigate} aria-current={on ? "page" : undefined} title={it.label}
                className={`mx-2 flex items-center gap-3 rounded-lg px-3 py-2 transition ${rail ? "justify-center xl:justify-start" : ""} ${on ? "bg-cyan/10 text-fg shadow-[inset_3px_0_0_#22D3EE]" : "text-fg-3 hover:bg-ink-750 hover:text-fg"}`}>
                <Icon name={it.icon} size={19} color={on ? "#22D3EE" : "currentColor"} />
                <span className={`min-w-0 flex-col leading-tight ${rail ? "hidden xl:flex" : "flex"}`}>
                  <span className="text-[13.5px] font-semibold">{it.label}</span>
                  <span className="truncate text-[11px] text-fg-4">{it.sub}</span>
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Brand({ full = true }: { full?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="VehicleSense AI - Demo control">
      <Logo size={30} />
      {full && (
        <span className="flex flex-col leading-tight">
          <span className="font-display text-[16px] font-bold">VehicleSense <span className="text-cyan">AI</span></span>
          <span className="text-[9.5px] font-semibold tracking-[0.14em] text-fg-4">VEHICLE HEALTH INTELLIGENCE</span>
        </span>
      )}
    </Link>
  );
}

export function Shell({ children, context, wide = false }: { children: ReactNode; context?: ReactNode; wide?: boolean }) {
  const path = usePathname();
  const now = useClock();
  const cur = navMatch(path);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-ink-600 bg-ink-850 lg:flex lg:w-[72px] xl:w-[236px]">
        <div className="flex h-16 shrink-0 items-center justify-center border-b border-ink-600 px-4 xl:justify-start">
          <span className="xl:hidden"><Brand full={false} /></span>
          <span className="hidden xl:block"><Brand /></span>
        </div>
        <NavLinks rail />
        <p className="mt-auto hidden px-5 pb-5 text-[11px] leading-relaxed text-fg-4 xl:block">Concept demo · fictional vehicles, owners and examiners.</p>
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="drawer-in absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto border-r border-ink-600 bg-ink-850">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-ink-600 px-4">
              <Brand />
              <button className="btn btn-sm" aria-label="Close menu" onClick={() => setOpen(false)}><Icon name="close" size={16} /></button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-ink-600 bg-ink-900/90 px-4 backdrop-blur lg:px-6">
          <button className="btn btn-sm lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Icon name="menu" size={18} /></button>
          <span className="lg:hidden"><Brand full={false} /></span>
          {cur && (
            <div className="flex min-w-0 items-center gap-2 text-[13px]">
              <span className="hidden text-fg-4 sm:inline">{cur.group}</span>
              <span className="hidden text-fg-4 sm:inline">/</span>
              <b className="truncate">{cur.label}</b>
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {context}
            <NextStep />
            <StatusDot />
            <div className="hidden flex-col items-end leading-tight 2xl:flex">
              <span className="text-[11px] text-fg-3">{mydate(now)}</span>
              <span className="font-mono text-[14px] font-semibold">{myt(now)} <span className="text-[10.5px] text-fg-3">MYT</span></span>
            </div>
          </div>
        </header>
        <main className={`mx-auto w-full min-w-0 flex-1 px-4 py-5 lg:px-6 ${wide ? "" : "max-w-[1600px]"}`}>{children}</main>
        <footer className="border-t border-ink-600 px-4 py-3 text-[11.5px] text-fg-4 lg:px-6">
          Concept demo prepared for vehicle-inspection stakeholders. Fictional vehicles, owners and examiners. Every panel says how its content is produced: live model, live logic, simulated, synthetic or real public data.
        </footer>
      </div>
    </div>
  );
}
