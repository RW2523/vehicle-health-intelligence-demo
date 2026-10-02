"use client";
/* The inspection app's shell: a floating glass frame with the brand, global search, the guided demo, the app switcher,
   notifications and the profile menu on top, the five sections on the left, the page, and the floating assistant in the
   corner. On phones the navigation becomes a drawer. The header pieces are shared with the mobile and oversight apps. */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import { APPS, AppId } from "@/lib/apps";
import { ROLE_HOME, User, canOpen, logout, useUser } from "@/lib/auth";
import { llmLabel } from "@/lib/format";
import { AssistantDock } from "./AssistantDock";
import { DemoBar, DemoProgressBar } from "./Demo";
import { Icon } from "./icons";
import { Modal, ProvenanceLegend } from "./ui";

type NavItem = { href: string; label: string; sub: string; icon: string; roles: string[]; hidden?: boolean };
/** The inspection app's five sections; `roles` open each one besides the presenter and the read-only viewer ("*" = everyone).
 *  The full assistant and Settings are pages too, but are reached from the floating assistant and the profile menu. */
export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Inspection",
    items: [
      { href: "/", label: "Dashboard", sub: "Today at the hub", icon: "home", roles: ["examiner", "hq"] },
      { href: "/lane", label: "Live Lane", sub: "Sensors and AI vision as it happens", icon: "lane", roles: ["examiner", "hq"] },
      { href: "/inspection", label: "Inspection Management", sub: "Capture, findings, approval, reports", icon: "clipboard", roles: ["examiner", "hq", "regulator"] },
      { href: "/vehicles", label: "Vehicle Records", sub: "History, health trends, photos", icon: "car", roles: ["examiner", "hq", "regulator", "fleet"] },
      { href: "/appointments", label: "Appointments", sub: "Bookings, slots, check-in", icon: "calendar", roles: ["examiner", "hq", "fleet"] },
      { href: "/assistant", label: "VehicleSense AI assistant", sub: "Ask about vehicles, lanes, rules", icon: "bot", roles: ["examiner", "hq", "regulator", "fleet"], hidden: true },
      { href: "/settings", label: "Settings", sub: "Account, images, demo, system", icon: "gear", roles: ["*"], hidden: true },
    ],
  },
];
// pages reached from the sections above (same highlight)
const ALIAS: [string, string][] = [["/examiner", "/inspection"], ["/report", "/inspection"], ["/fleet", "/vehicles"], ["/vision", "/lane"], ["/demo", "/settings"]];

/** The nav entry for a path: the longest matching prefix ("/vehicles/DMO 9001" is Vehicle Records). */
export function navMatch(path: string) {
  const all = NAV.flatMap((g) => g.items.map((it) => ({ ...it, group: g.group })));
  const p = ALIAS.find(([a]) => path === a || path.startsWith(a + "/"))?.[1] || path;
  return all
    .filter((it) => (it.href === "/" ? p === "/" : p === it.href || p.startsWith(it.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export function Logo({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, "");  // one gradient per logo: a hidden copy's would not render for the others
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <linearGradient id={`lg${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#60A5FA" /><stop offset="1" stopColor="#1D4ED8" /></linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="11" fill={`url(#lg${id})`} />
      <path d="M10 13l7 15h3l-6-15zM30 13l-8 15h-3l7-15z" fill="#fff" />
      <circle cx="20" cy="11.5" r="2.4" fill="#BFDBFE" />
    </svg>
  );
}

/** The logo and the app's name; `compact` is the logo alone, `small` a smaller one that fits the phone drawer. */
export function Brand({ home = "/", compact = false, small = false, app = "Inspection" }: { home?: string; compact?: boolean; small?: boolean; app?: string }) {
  return (
    <Link href={home} className={`flex min-w-0 items-center ${small ? "gap-2" : "gap-2.5"}`} aria-label={`VehicleSense ${app} - home`}>
      <Logo size={compact || small ? 30 : 34} />
      {!compact && <span className={`min-w-0 truncate whitespace-nowrap font-extrabold tracking-tight text-fg ${small ? "text-[16px]" : "text-[18px]"}`}>VehicleSense <span className="font-medium text-fg-2">{app}</span></span>}
    </Link>
  );
}

export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
export const ROLE_LABEL: Record<string, string> = {
  presenter: "Demo presenter", viewer: "Read-only viewer", examiner: "Examiner", hq: "Operations manager", regulator: "Regulator",
  fleet: "Fleet manager", owner: "Vehicle owner",
};

export function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white shadow-md"
      style={{ width: size, height: size, background: "linear-gradient(135deg, #60A5FA, #1E3A8A)" }} aria-hidden>{initials(name)}</span>
  );
}

export function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", f);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", f);
      document.removeEventListener("keydown", k);
    };
  }, [open, close]);
  return ref;
}

/** Search vehicles, owners, inspections, reports and today's schedule from anywhere. */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  // a placeholder that fits the box: the full hint on a wide header, shorter ones on a phone
  const input = useRef<HTMLInputElement>(null);
  const [room, setRoom] = useState(400);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setRoom(e[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const hint = room >= 300 ? "Search vehicle no., owner, or inspection no…" : room >= 190 ? "Search vehicles, inspections…" : "Search…";
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(null);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => api.get("/api/search", { q }).then((r) => { setRes(r); setOpen(true); }).catch(() => setRes(null)).finally(() => setBusy(false)), 220);
    return () => clearTimeout(t);
  }, [q]);
  const first = res?.groups?.[0]?.items?.[0];
  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };
  return (
    <div ref={ref} className="relative w-full max-w-[520px]">
      <form role="search" onSubmit={(e) => { e.preventDefault(); if (first) go(first.href); else if (q.trim()) go(`/vehicles?q=${encodeURIComponent(q.trim())}`); }}>
        <label className="flex items-center gap-2.5 rounded-full border border-white/80 bg-white/80 px-4 py-2.5 shadow-glass focus-within:ring-4 focus-within:ring-blue-100">
          <Icon name="search" size={18} color="#64748B" />
          <input ref={input} className="w-full min-w-0 bg-transparent text-[14px] text-fg placeholder:text-fg-4 focus:outline-none" placeholder={hint}
            aria-label="Search vehicles, owners and inspections" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => res && setOpen(true)} />
          {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan border-t-transparent" aria-hidden />}
        </label>
      </form>
      {open && res && (
        <div className="fade-in absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[70vh] overflow-auto rounded-2xl border border-white/80 bg-white/95 p-2 shadow-float backdrop-blur-xl" role="listbox" aria-label="Search results">
          {!res.groups.length && <p className="px-3 py-4 text-[13px] text-fg-3">Nothing matches “{res.q}”.</p>}
          {res.groups.map((g: any) => (
            <div key={g.group} className="py-1">
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-4">{g.group}</div>
              {g.items.map((it: any) => (
                <button key={it.href + it.title} role="option" aria-selected={false} onClick={() => go(it.href)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-blue-50">
                  <Icon name={it.kind === "vehicle" ? "car" : it.kind === "report" ? "doc" : it.kind === "schedule" ? "clock" : "clipboard"} size={17} color="#2563EB" />
                  <span className="min-w-0"><b className="block truncate text-[13.5px]">{it.title}</b><span className="block truncate text-[12px] text-fg-3">{it.sub}</span></span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SEEN = "vhi-notifications-seen";
export function Notifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [seen, setSeen] = useState<string>("");
  const ref = useOutside(open, () => setOpen(false));
  useEffect(() => {
    try { setSeen(localStorage.getItem(SEEN) || ""); } catch {}
    const load = () => api.get("/api/notifications").then(setItems).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  const unseen = items.filter((n) => !n.at || n.at > seen).length;
  const toggle = () => {
    setOpen((o) => !o);
    const now = new Date().toISOString();
    try { localStorage.setItem(SEEN, now); } catch {}
    setTimeout(() => setSeen(now), 1500);
  };
  const ICON: Record<string, string> = { alert: "warn", report: "doc", booking: "calendar", exception: "flag" };
  return (
    <div ref={ref} className="relative">
      <button className="relative flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-white/80 shadow-glass hover:bg-white" onClick={toggle}
        aria-label={`Notifications${unseen ? `, ${unseen} new` : ""}`} aria-expanded={open}>
        <Icon name="bell" size={20} color="#334155" />
        {unseen > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-cyan ring-2 ring-white" aria-hidden />}
      </button>
      {open && (
        <div className="fade-in fixed inset-x-4 top-[64px] z-50 w-auto rounded-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-[380px] border border-white/80 bg-white/95 p-2 shadow-float backdrop-blur-xl">
          <div className="px-3 pb-1 pt-2 text-[13px] font-bold">Notifications</div>
          {!items.length && <p className="px-3 py-4 text-[13px] text-fg-3">Nothing new.</p>}
          <ul className="max-h-[60vh] overflow-auto">
            {items.map((n) => (
              <li key={n.kind + n.id}>
                <Link href={n.href} onClick={() => setOpen(false)} className="flex gap-3 rounded-xl px-3 py-2.5 hover:bg-blue-50">
                  <Icon name={ICON[n.kind] || "bell"} size={17} color={n.kind === "alert" || n.kind === "exception" ? "#DC2626" : "#2563EB"} />
                  <span className="min-w-0"><b className="block truncate text-[13px]">{n.title}</b><span className="block truncate text-[12px] text-fg-3">{n.sub}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const ITEM = "flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] hover:bg-blue-50";

/** The profile menu: account, settings, the presenter's demo controls, the data labels and sign out. */
export function UserMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const ref = useOutside(open, () => setOpen(false));
  useEffect(() => {
    if (open) api.get("/api/system/status").then(setStatus).catch(() => setStatus(null));
  }, [open]);
  const role = ROLE_LABEL[user.role] || user.role;
  const second = role === user.name ? user.title : role;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Account: ${user.name}`}
        className="flex items-center gap-2.5 rounded-full border border-white/80 bg-white/80 p-1 shadow-glass hover:bg-white sm:py-1.5 sm:pl-1.5 sm:pr-3">
        <Avatar name={user.name} />
        <span className="hidden min-w-0 flex-col text-left leading-tight md:flex">
          <b className="max-w-[160px] truncate text-[14px]">{user.name}</b>
          {/* the role under the name, or the account's title where the role is the name ("Demo presenter") */}
          {second && <span className="max-w-[160px] truncate text-[12px] text-fg-3" title={second}>{second}</span>}
        </span>
        <span className="hidden sm:inline"><Icon name="down" size={16} color="#64748B" /></span>
      </button>
      {open && (
        <div className="fade-in absolute right-0 top-[calc(100%+8px)] z-50 w-[280px] rounded-2xl border border-white/80 bg-white/95 p-2 shadow-float backdrop-blur-xl">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar name={user.name} size={42} />
            <span className="min-w-0 leading-tight"><b className="block truncate">{user.name}</b><span className="block truncate text-[12px] text-fg-3">{user.title}</span></span>
          </div>
          <div className="mx-3 my-1 flex items-center gap-2 rounded-xl bg-[#F4F7FB] px-3 py-2 text-[12px] text-fg-3">
            <span className={`h-2 w-2 rounded-full ${status ? "bg-ok" : "bg-fg-4"}`} />
            {status ? `Pipeline live · ${llmLabel(status.llm?.backend) ? "local LLM on" : "template engine"}` : "Checking the pipeline…"}
          </div>
          <nav aria-label="Account" className="flex flex-col">
            <Link className={ITEM} href="/settings?tab=account" onClick={() => setOpen(false)}>
              <Icon name="user" size={17} color="#2563EB" />Profile and account
            </Link>
            <Link className={ITEM} href="/settings" onClick={() => setOpen(false)}>
              <Icon name="gear" size={17} color="#2563EB" />Settings
            </Link>
            {user.role === "presenter" && (
              <Link className={ITEM} href="/demo" onClick={() => setOpen(false)}>
                <Icon name="play" size={17} color="#2563EB" />Demo controls
              </Link>
            )}
            <button className={`${ITEM} w-full text-left`} onClick={() => { setLabels(true); setOpen(false); }}>
              <Icon name="info" size={17} color="#2563EB" />What the data labels mean
            </button>
            <div className="mx-3 my-1 border-t border-ink-600" />
            <button className={`${ITEM} w-full text-left text-bad hover:!bg-red-50`} onClick={logout}>
              <Icon name="logout" size={17} color="#DC2626" />Sign out
            </button>
          </nav>
        </div>
      )}
      <Modal open={labels} onClose={() => setLabels(false)} title="What the data labels mean">
        <p className="mb-3 max-w-[640px] text-[13px] text-fg-3">Every card, chart and result says how it was produced. Simulated, synthetic, sample, mock and future R&D content is never presented as live operational data.</p>
        <ProvenanceLegend />
      </Modal>
    </div>
  );
}

/** Switch between the three apps (each on its own address); lists the ones this account opens. */
export function AppSwitcher({ current }: { current: AppId }) {
  const user = useUser();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const apps = APPS.filter((a) => canOpen(user?.role, a.roles));
  if (apps.length < 2) return null;
  return (
    <div ref={ref} className="relative">
      <button className="flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-white/80 shadow-glass hover:bg-white" onClick={() => setOpen((o) => !o)}
        aria-label="Switch app" aria-expanded={open}>
        <Icon name="apps" size={19} color="#334155" />
      </button>
      {open && (
        <div className="fade-in fixed inset-x-4 top-[64px] z-50 w-auto rounded-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-[340px] border border-white/80 bg-white/95 p-2 shadow-float backdrop-blur-xl" role="menu" aria-label="Apps">
          <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-4">VehicleSense apps</div>
          {apps.map((a) => (
            <Link key={a.id} href={a.href} role="menuitem" onClick={() => setOpen(false)} aria-current={a.id === current ? "true" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${a.id === current ? "bg-blue-50 ring-1 ring-blue-100" : "hover:bg-blue-50"}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#DBEAFE] to-[#EFF6FF]"><Icon name={a.icon} size={19} color="#2563EB" /></span>
              <span className="min-w-0 leading-tight"><b className="block truncate text-[13.5px]">{a.full}</b><span className="block truncate text-[12px] text-fg-3">{a.sub}</span></span>
              {a.id === current && <span className="ml-auto text-[11px] font-semibold text-cyan">Open</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Send a visitor who is not logged in to the login page, coming back here afterwards. */
export function useLoginGate(user: User | null | undefined) {
  useEffect(() => {
    if (user === null) location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  }, [user]);
}

/** The other two apps, for the accounts that open them (each has its own address). */
function OtherApps({ role }: { role?: string }) {
  const apps = APPS.filter((a) => a.id !== "main" && canOpen(role, a.roles));
  if (!apps.length) return null;
  return (
    <nav aria-label="Other apps" className="flex flex-col gap-2">
      {apps.map((a) => (
        <Link key={a.id} href={a.href} className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/60 px-3 py-2.5 hover:bg-white">
          <Icon name={a.icon} size={18} color="#2563EB" />
          <span className="min-w-0 leading-tight"><b className="block truncate text-[13px]">{a.full.replace("VehicleSense ", "")} app</b><span className="block truncate text-[11px] text-fg-4">{a.sub}</span></span>
        </Link>
      ))}
    </nav>
  );
}

function NavLinks({ role, onNavigate }: { role?: string; onNavigate?: () => void }) {
  const path = usePathname();
  const cur = navMatch(path);
  const items = NAV.flatMap((g) => g.items).filter((it) => !it.hidden && canOpen(role, it.roles));
  return (
    <nav aria-label="Sections" className="flex flex-col gap-1">
      {items.map((it) => {
        const on = cur?.href === it.href;
        return (
          <Link key={it.href} href={it.href} onClick={onNavigate} aria-current={on ? "page" : undefined} title={it.sub}
            className={`group flex items-center gap-3 rounded-2xl px-3.5 py-3 transition ${on ? "bg-white text-fg shadow-glass ring-1 ring-blue-100" : "text-fg-2 hover:bg-white/60"}`}>
            <Icon name={it.icon} size={21} color={on ? "#2563EB" : "#475569"} width={on ? 2.1 : 1.8} />
            <span className={`min-w-0 truncate text-[14.5px] ${on ? "font-semibold text-[#1D4ED8]" : "font-medium"}`}>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell({ children, context, wide = false }: { children: ReactNode; context?: ReactNode; wide?: boolean }) {
  const path = usePathname();
  const cur = navMatch(path);
  const user = useUser();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useLoginGate(user);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  const home = ROLE_HOME[user?.role || ""] || "/";
  const allowed = !cur || canOpen(user?.role, cur.roles);
  const guided = user?.role === "presenter" || user?.role === "viewer";
  const searchable = user && user.role !== "owner";
  return (
    <div className="min-h-screen lg:p-4 2xl:p-6">
      <div className="flex min-h-screen flex-col lg:min-h-[calc(100vh-2rem)] lg:rounded-[30px] lg:border lg:border-white/60 lg:bg-white/[0.18] lg:shadow-float lg:backdrop-blur-[6px] 2xl:min-h-[calc(100vh-3rem)]">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-white/60 bg-white/60 px-4 py-3 backdrop-blur-xl md:flex-nowrap lg:static lg:rounded-t-[30px] lg:border-0 lg:bg-transparent lg:px-6 lg:py-5">
          <button className="btn btn-sm lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Icon name="menu" size={18} /></button>
          <div className="shrink-0 lg:w-[256px]"><span className="hidden sm:block"><Brand home={home} /></span><span className="sm:hidden"><Brand home={home} compact /></span></div>
          {searchable && <div className="order-last flex w-full min-w-0 justify-center md:order-none md:w-auto md:flex-1"><GlobalSearch /></div>}
          {!searchable && <div className="hidden flex-1 md:block" />}
          <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
            {allowed && context && <span className="hidden sm:contents">{context}</span>}
            {guided && <DemoBar />}
            <AppSwitcher current="main" />
            <Notifications />
            {user && <UserMenu user={user} />}
          </div>
        </header>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <div className="drawer-in absolute inset-y-0 left-0 flex w-[316px] max-w-[88vw] flex-col gap-4 overflow-y-auto border-r border-white/70 bg-white/90 p-4 backdrop-blur-xl">
              <div className="flex items-center justify-between gap-2"><Brand home={home} small /><button className="btn btn-sm shrink-0" aria-label="Close menu" onClick={() => setOpen(false)}><Icon name="close" size={16} /></button></div>
              <NavLinks role={user?.role} onNavigate={() => setOpen(false)} />
              <OtherApps role={user?.role} />
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-1 gap-2 lg:px-4 lg:pb-4">
          <aside className="hidden w-[264px] shrink-0 flex-col justify-between rounded-[24px] border border-white/60 bg-white/[0.42] p-3 shadow-glass backdrop-blur-2xl lg:flex">
            <NavLinks role={user?.role} />
            <div className="flex flex-col gap-3 px-1 pb-1 pt-6">
              <OtherApps role={user?.role} />
              <p className="px-2 text-[11px] leading-relaxed text-fg-4">Concept demo · fictional vehicles, owners, examiners and hubs.</p>
            </div>
          </aside>
          <main className={`mx-auto w-full min-w-0 flex-1 px-4 py-4 pb-24 lg:px-6 lg:py-2 lg:pb-24 ${wide ? "" : "max-w-[1640px]"}`}>
            {/* the dashboard shows the running scenario in its own card */}
            {guided && path !== "/" && <DemoProgressBar className="mb-4" />}
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
      {user && user.role !== "owner" && path !== "/assistant" && <AssistantDock />}
    </div>
  );
}
