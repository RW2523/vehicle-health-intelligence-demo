"use client";
/* The Oversight app's shell (/oversight): HQ, the regulator, used-vehicle sales and flood watch for the whole country.
   The same floating glass frame and header pieces as the inspection app, with its own identity: a deep-navy accent line
   and a control-room tab bar (the active tab is a navy pill, a Malaysia-time clock on the right). Wide by default, for
   maps and long tables. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useRef } from "react";
import { ROLE_HOME, canOpen, useUser } from "@/lib/auth";
import { useClock } from "@/lib/live";
import { DemoBar } from "./Demo";
import { Icon } from "./icons";
import { AppSwitcher, Brand, Notifications, ROLE_LABEL, UserMenu, useLoginGate } from "./Shell";

export type OvTab = { href: string; label: string; short: string; sub: string; icon: string; roles: string[] };
/** The Oversight sections; `roles` open each one besides the presenter and the read-only viewer. */
export const OV_TABS: OvTab[] = [
  { href: "/oversight", label: "Overview", short: "Overview", sub: "The four oversight views at a glance", icon: "globe", roles: ["hq", "regulator"] },
  { href: "/oversight/hq", label: "HQ operations · Lanes", short: "HQ", sub: "Exceptions, lanes, examiners, equipment, audit", icon: "hq", roles: ["hq"] },
  { href: "/oversight/regulator", label: "Regulator · Registrations", short: "Regulator", sub: "Registrations, defects, emissions, EVs", icon: "regulator", roles: ["regulator", "hq"] },
  { href: "/oversight/sales", label: "Used-vehicle sales", short: "Sales", sub: "Every listing with its whole record", icon: "sale", roles: ["hq", "regulator"] },
  { href: "/oversight/flood", label: "Flood watch", short: "Flood", sub: "River levels and the vehicles at risk, live", icon: "flood", roles: ["hq", "regulator"] },
];

/** The Oversight section a path belongs to (the longest matching prefix). */
export function ovMatch(path: string) {
  return OV_TABS.filter((t) => (t.href === "/oversight" ? path === "/oversight" || path === "/oversight/" : path === t.href || path.startsWith(t.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** Earlier addresses that the API still hands out (exception links and the like), pointed at their new place. */
export function ovHref(href: string) {
  return href
    .replace(/^\/(hq|regulator|sales|flood)(?=[/?#]|$)/, "/oversight/$1")
    .replace(/^\/fleet\/vehicle\/([^?#]+)/, "/vehicles/$1?tab=health")
    .replace(/^\/fleet(?=[?#]|$)/, "/vehicles")
    .replace(/^\/owner(?=[?#]|$)/, "/mobile")
    .replace(/^\/vision(?=[?#]|$)/, "/lane?view=vision")
    .replace(/^\/examiner(?=[?#]|$)/, "/inspection");
}

function MytClock() {
  const now = useClock();
  const t = now ? now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--";
  return (
    <span className="hidden shrink-0 items-center gap-2 rounded-xl bg-white/70 px-3 py-1.5 text-[12px] font-semibold text-[#0F1E46] ring-1 ring-[#1E3A8A]/10 md:inline-flex" title="Malaysia time">
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
      </span>
      <span className="text-fg-3">MYT</span><span className="font-mono tabular-nums tracking-tight">{t}</span>
    </span>
  );
}

/** The control-room tab bar: icons and labels, scrolls sideways on a phone, the active section a navy pill. */
function OvTabs({ role }: { role?: string }) {
  const path = usePathname();
  const cur = ovMatch(path);
  const bar = useRef<HTMLDivElement>(null);
  const on = useRef<HTMLAnchorElement>(null);
  const tabs = OV_TABS.filter((t) => canOpen(role, t.roles));
  useEffect(() => {
    // keep the active tab in view on a phone, without moving the page
    const b = bar.current, el = on.current;
    if (b && el && b.scrollWidth > b.clientWidth) b.scrollLeft = el.offsetLeft - (b.clientWidth - el.clientWidth) / 2;
  }, [path, tabs.length]);
  return (
    <div className="relative flex min-w-0 items-center gap-2 rounded-2xl border border-white/80 bg-gradient-to-r from-white/80 via-[#EEF2FB]/80 to-white/70 p-1.5 shadow-glass backdrop-blur-xl">
      <div ref={bar} className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="navigation" aria-label="Oversight sections">
        {tabs.map((t) => {
          const active = cur?.href === t.href;
          return (
            <Link key={t.href} ref={active ? on : undefined} href={t.href} aria-current={active ? "page" : undefined} title={t.sub}
              className={`group flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-[13.5px] transition sm:px-3.5 ${active
                ? "bg-gradient-to-b from-[#1E3A8A] to-[#0F1E46] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(15,30,70,0.9)]"
                : "font-medium text-fg-2 hover:bg-white/80 hover:text-fg"}`}>
              <Icon name={t.icon} size={18} color={active ? "#BFDBFE" : "#475569"} width={active ? 2 : 1.8} />
              <span className="whitespace-nowrap">{t.label}</span>
            </Link>
          );
        })}
      </div>
      <MytClock />
    </div>
  );
}

export function OversightShell({ children, context, wide = false }: { children: ReactNode; context?: ReactNode; wide?: boolean }) {
  const path = usePathname();
  const cur = ovMatch(path);
  const user = useUser();
  useLoginGate(user);
  const home = ROLE_HOME[user?.role || ""] || "/";
  const allowed = !cur || canOpen(user?.role, cur.roles);
  const guided = user?.role === "presenter" || user?.role === "viewer";
  return (
    <div className="min-h-screen lg:p-4 2xl:p-6">
      <div className="relative flex min-h-screen flex-col lg:min-h-[calc(100vh-2rem)] lg:rounded-[30px] lg:border lg:border-white/70 lg:bg-white/35 lg:shadow-float lg:backdrop-blur-xl 2xl:min-h-[calc(100vh-3rem)]">
        {/* the Oversight accent: a deep-navy line along the top of the frame */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-40 h-[3px] bg-gradient-to-r from-[#0F1E46] via-[#2563EB] to-[#38BDF8] lg:inset-x-10 lg:rounded-b-full" />
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/60 bg-white/70 px-4 py-3 backdrop-blur-xl lg:static lg:rounded-t-[30px] lg:border-0 lg:bg-transparent lg:px-6 lg:pb-3 lg:pt-5">
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            <span className="hidden sm:block"><Brand home="/oversight" app="Oversight" /></span>
            <span className="sm:hidden"><Brand home="/oversight" app="Oversight" compact /></span>
            <span className="hidden rounded-full bg-[#0F1E46] px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#BFDBFE] xl:inline">National</span>
          </div>
          <div className="flex-1" />
          <div className="flex shrink-0 items-center gap-2">
            {allowed && context && <span className="hidden sm:contents">{context}</span>}
            {guided && <DemoBar />}
            <AppSwitcher current="oversight" />
            <Notifications />
            {user && <UserMenu user={user} />}
          </div>
        </header>
        <div className="px-3 pt-3 lg:px-6 lg:pt-0">
          {user && <OvTabs role={user.role} />}
        </div>
        <main className={`mx-auto w-full min-w-0 flex-1 px-4 py-5 lg:px-6 ${wide ? "" : "max-w-[1800px]"}`}>
          {!user ? null : allowed ? children : (
            <div className="card card-pad mx-auto mt-10 max-w-[520px] text-center">
              <h1 className="text-[20px] font-bold">Not available to this account</h1>
              <p className="mt-2 text-[13.5px] text-fg-3">{cur?.label} is not part of the {ROLE_LABEL[user.role] || user.role} apps. You are logged in as {user.name} ({user.title}).</p>
              <Link className="btn btn-primary mt-4" href={home}>Go to your apps<Icon name="arrow" size={15} /></Link>
            </div>
          )}
          <footer className="mt-8 pb-4 text-[11.5px] leading-relaxed text-fg-4">
            VehicleSense AI concept demo. Fictional vehicles, owners, examiners and inspection hubs. Every panel is labelled with how its content is produced: live feed, public data, live model, live logic, simulated, synthetic, sample, mock or future R&D.
          </footer>
        </main>
      </div>
    </div>
  );
}
