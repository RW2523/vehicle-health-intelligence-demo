"use client";
/* One app shell for every screen: navigation grouped by who uses it, a header that says where you are and what comes
   next, the live pipeline status and the Malaysia clock. Sidebar on desktops, icon rail on small laptops, a drawer on
   phones and tablets. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ROLE_HOME, User, canOpen, logout, useUser } from "@/lib/auth";
import { llmLabel, mydate, myt } from "@/lib/format";
import { useClock } from "@/lib/live";
import { NextStep } from "./Guide";
import { Icon } from "./icons";

/** The apps, grouped by who uses them; `roles` open each one besides the presenter and the read-only viewer. */
export const NAV: { group: string; items: { href: string; label: string; sub: string; icon: string; roles: string[] }[] }[] = [
  { group: "Start here", items: [{ href: "/", label: "Demo control", sub: "Guided demo and sessions", icon: "play", roles: [] }] },
  {
    group: "Inspection lane",
    items: [
      { href: "/lane", label: "Lane console", sub: "Live sensors and AI", icon: "lane", roles: ["examiner", "hq"] },
      { href: "/examiner", label: "Examiner", sub: "Decide alerts, issue report", icon: "examiner", roles: ["examiner", "hq"] },
      { href: "/report", label: "Reports", sub: "Results and QR verification", icon: "report", roles: ["examiner", "hq"] },
      { href: "/vision", label: "AI vision", sub: "PUSPAKOM AI system results", icon: "vision", roles: ["examiner", "hq"] },
    ],
  },
  {
    group: "Fleets and owners",
    items: [
      { href: "/fleet", label: "Fleet intelligence", sub: "Risk, forecasts, bookings", icon: "fleet", roles: ["fleet", "hq"] },
      { href: "/fleet/vehicle", label: "Vehicle history", sub: "Wear trend and forecast", icon: "history", roles: ["fleet", "hq"] },
      { href: "/owner", label: "Owner app", sub: "Assistant, booking, self-check", icon: "owner", roles: ["owner"] },
    ],
  },
  {
    group: "Oversight",
    items: [
      { href: "/hq", label: "HQ operations", sub: "Lanes, integrity, demand, audit", icon: "hq", roles: ["hq"] },
      { href: "/regulator", label: "Regulator", sub: "JPJ and DOE view", icon: "regulator", roles: ["regulator", "hq"] },
      { href: "/sales", label: "Used-vehicle sales", sub: "Every listing, full record", icon: "sale", roles: ["hq", "regulator"] },
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

/** Who is logged in, and the way out. */
function UserMenu({ user }: { user: User }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="chip border-ink-600 text-fg-2" title={user.title}>
        <span className="h-2 w-2 rounded-full bg-cyan" />
        <span className="hidden max-w-[180px] truncate sm:inline">{user.name}</span>
        <span className="hidden text-fg-4 md:inline">· {user.role === "viewer" ? "read only" : user.role}</span>
      </span>
      <button className="btn btn-sm" onClick={logout} aria-label="Log out" title="Log out">
        <Icon name="logout" size={15} /><span className="hidden sm:inline">Log out</span>
      </button>
    </span>
  );
}

function NavLinks({ role, rail = false, onNavigate }: { role?: string; rail?: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  const cur = navMatch(path);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((it) => canOpen(role, it.roles)) })).filter((g) => g.items.length);
  return (
    <nav aria-label="Apps" className="flex flex-col gap-3 py-3">
      {groups.map((g) => (
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

function Brand({ full = true, home = "/" }: { full?: boolean; home?: string }) {
  return (
    <Link href={home} className="flex items-center gap-2.5" aria-label="VehicleSense AI - home">
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
  const user = useUser();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (user === null) location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  }, [user]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  const home = ROLE_HOME[user?.role || ""] || "/";
  const allowed = !cur || canOpen(user?.role, cur.roles);
  const guided = user?.role === "presenter" || user?.role === "viewer";
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-ink-600 bg-ink-850 lg:flex lg:w-[72px] xl:w-[236px]">
        <div className="flex h-16 shrink-0 items-center justify-center border-b border-ink-600 px-4 xl:justify-start">
          <span className="xl:hidden"><Brand full={false} home={home} /></span>
          <span className="hidden xl:block"><Brand home={home} /></span>
        </div>
        <NavLinks role={user?.role} rail />
        <p className="mt-auto hidden px-5 pb-5 text-[11px] leading-relaxed text-fg-4 xl:block">Concept demo · fictional vehicles, owners and examiners.</p>
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="drawer-in absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto border-r border-ink-600 bg-ink-850">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-ink-600 px-4">
              <Brand home={home} />
              <button className="btn btn-sm" aria-label="Close menu" onClick={() => setOpen(false)}><Icon name="close" size={16} /></button>
            </div>
            <NavLinks role={user?.role} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-ink-600 bg-ink-900/90 px-4 backdrop-blur lg:px-6">
          <button className="btn btn-sm lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Icon name="menu" size={18} /></button>
          <span className="lg:hidden"><Brand full={false} home={home} /></span>
          {cur && (
            <div className="flex min-w-0 items-center gap-2 text-[13px]">
              <span className="hidden text-fg-4 sm:inline">{cur.group}</span>
              <span className="hidden text-fg-4 sm:inline">/</span>
              <b className="truncate">{cur.label}</b>
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {allowed && context}
            {guided && <NextStep />}
            <StatusDot />
            {user && <UserMenu user={user} />}
            <div className="hidden flex-col items-end leading-tight 2xl:flex">
              <span className="text-[11px] text-fg-3">{mydate(now)}</span>
              <span className="font-mono text-[14px] font-semibold">{myt(now)} <span className="text-[10.5px] text-fg-3">MYT</span></span>
            </div>
          </div>
        </header>
        <main className={`mx-auto w-full min-w-0 flex-1 px-4 py-5 lg:px-6 ${wide ? "" : "max-w-[1600px]"}`}>
          {!user ? null : allowed ? children : (
            <div className="card card-pad mx-auto mt-10 max-w-[520px] text-center">
              <h1 className="font-display text-[20px] font-semibold">Not available to this account</h1>
              <p className="mt-2 text-[13.5px] text-fg-3">{cur?.label} is not part of the {user.role} apps. You are logged in as {user.name} ({user.title}).</p>
              <Link className="btn btn-primary mt-4" href={home}>Go to your apps<Icon name="arrow" size={15} /></Link>
            </div>
          )}
        </main>
        <footer className="border-t border-ink-600 px-4 py-3 text-[11.5px] text-fg-4 lg:px-6">
          Concept demo prepared for vehicle-inspection stakeholders. Fictional vehicles, owners and examiners. Every panel says how its content is produced: live model, live logic, simulated, synthetic or real public data.
        </footer>
      </div>
    </div>
  );
}
