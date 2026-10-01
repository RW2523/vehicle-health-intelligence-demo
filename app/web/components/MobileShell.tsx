"use client";
/* The mobile app's shell: the vehicle owner's phone app. On a desktop it runs inside a realistic phone frame with a side
   panel (what the app is, the app switcher and account, the presenter's persona switcher and an "open on your phone"
   QR code); on a phone it is the whole screen. Inside: a top app bar, the scrolling screen and a bottom tab bar. */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ROLE_HOME, User, canOpen, logout, useUser } from "@/lib/auth";
import { APPS } from "@/lib/apps";
import { myt } from "@/lib/format";
import { useClock, useFetch } from "@/lib/live";
import { DemoBar, useActiveUseCase } from "./Demo";
import { Icon } from "./icons";
import { AppSwitcher, Avatar, Logo, ROLE_LABEL, UserMenu, useLoginGate } from "./Shell";
import { toast } from "./ui";

/* ---------------------------------------------------------------- the owners and the tabs */

/** The three private owners of the demo (fictional); the presenter shows the app as any of them. */
export const OWNERS = [
  { plate: "DMO 9006", name: "Nurul Aina", car: "Perodua Myvi", year: 2019, vtype: "Hatchback", story: "Self-check, booking and the passport" },
  { plate: "DMO 9003", name: "Faizal Omar", car: "Honda Civic", year: 2016, vtype: "Sedan", story: "Selling: identity and odometer history" },
  { plate: "DMO 9002", name: "Daniel Wong", car: "BYD Atto 3 EV", year: 2022, vtype: "SUV", story: "EV battery health and flood evidence" },
];

export type MobileTab = "home" | "vehicle" | "check" | "book" | "assistant";
const TABS: { id: MobileTab; label: string; href: string; d: string }[] = [
  { id: "home", label: "Home", href: "/mobile", d: "M3.5 10.5L12 3.8l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-6h-5.6v6H5A1.5 1.5 0 0 1 3.5 19z" },
  { id: "vehicle", label: "Vehicle", href: "/mobile/vehicle", d: "M3 13.5l2-5.2A2 2 0 0 1 6.9 7h10.2a2 2 0 0 1 1.9 1.3l2 5.2V18h-2.6M6 18H3v-4.5h18M6.5 18a1.9 1.9 0 1 0 3.8 0 1.9 1.9 0 0 0-3.8 0zM13.7 18a1.9 1.9 0 1 0 3.8 0 1.9 1.9 0 0 0-3.8 0" },
  { id: "check", label: "Check", href: "/mobile/check", d: "M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8.5 12l2.5 2.5 4.5-5" },
  { id: "book", label: "Book", href: "/mobile/book", d: "M4.5 6h15v14h-15zM4.5 10.5h15M9 3.5v4M15 3.5v4M8.5 14h2M13.5 14h2M8.5 17h2" },
  { id: "assistant", label: "Assistant", href: "/mobile/assistant", d: "M4 5.5h16v10.5H10l-4.5 3.8V16H4zM8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" },
];
/** The old owner app's tabs (/owner?tab=…, now /mobile?tab=…) and the screen each one became. */
export const TAB_SCREEN: Record<string, string> = {
  passport: "/mobile/vehicle", check: "/mobile/check", book: "/mobile/book", chat: "/mobile/assistant", assistant: "/mobile/assistant",
  sale: "/mobile/sell", vehicle: "/mobile/vehicle", home: "/mobile",
};

/* ---------------------------------------------------------------- hooks */

const MQ = "(min-width: 768px)";
const subscribeMQ = (cb: () => void) => {
  const m = window.matchMedia(MQ);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** True on a desktop or tablet (the framed layout), false on a phone, undefined while the server renders. */
export function useDesktop(): boolean | undefined {
  return useSyncExternalStore<boolean | undefined>(subscribeMQ, () => window.matchMedia(MQ).matches, () => undefined);
}

let knownUser: User | null | undefined;
/** The logged-in account, remembered between the app's screens (so moving between tabs does not flash a loading
 *  state while the account loads again). */
export function useMobileUser(): User | null | undefined {
  const u = useUser();
  if (u !== undefined) knownUser = u;
  return u === undefined ? knownUser : u;
}

/** The vehicle the app shows: an owner always sees their own; the presenter and the viewer pick one with ?plate=.
 *  `plate` is null until the account is known (so nothing is fetched for the wrong vehicle). */
export function useMobilePlate(): { user: User | null | undefined; plate: string | null } {
  const user = useMobileUser();
  const sp = useSearchParams();
  const asked = (sp.get("plate") || "").trim().toUpperCase().replace(/\s+/g, " ");
  const plate = !user ? null : user.role === "owner" ? user.plate || null : asked || OWNERS[0].plate;
  return { user, plate };
}

/** Links between the app's screens keep the presenter's chosen vehicle. */
export function useMobileHref() {
  const { user, plate } = useMobilePlate();
  const keep = user && user.role !== "owner" ? plate : null;
  return useCallback((path: string, params: Record<string, string | null | undefined> = {}) => {
    const [base, query] = path.split("?");
    const q = new URLSearchParams(query || "");
    if (keep && !q.has("plate")) q.set("plate", keep);
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  }, [keep]);
}

/** Where a use-case step's link opens in the mobile app ("/owner?tab=book" is the Book screen). */
function screenOf(href: string) {
  const [path, query] = href.split("#")[0].split("?");
  if (path === "/owner" || path === "/mobile") return TAB_SCREEN[new URLSearchParams(query || "").get("tab") || ""] || "/mobile";
  return path;
}

/* ---------------------------------------------------------------- bottom sheets (inside the phone screen) */

const SheetHost = createContext<HTMLElement | null>(null);

/** A bottom sheet over the phone screen (the whole screen on a phone). */
export function MobileSheet({ open, onClose, title, children, dismissable = true }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; dismissable?: boolean }) {
  const host = useContext(SheetHost);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open || !host) return null;
  return createPortal(
    <div className="absolute inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="m-fade absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div className="m-sheet relative max-h-[90%] overflow-y-auto overscroll-contain rounded-t-[28px] bg-white px-5 pt-2 shadow-[0_-20px_60px_-20px_rgba(15,23,42,0.45)]"
        style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}>
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-slate-300" aria-hidden />
        {title && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[18px] font-bold tracking-tight">{title}</h2>
            {dismissable && (
              <button onClick={onClose} aria-label="Close" className="-mr-1 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 active:scale-95">
                <Icon name="close" size={16} width={2.2} />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    host,
  );
}

/* ---------------------------------------------------------------- pieces of the phone */

const CSS = `
@keyframes m-sheet-in { from { transform: translateY(100%) } to { transform: none } }
@keyframes m-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes m-pop-in { from { opacity: 0; transform: translateY(6px) scale(.98) } to { opacity: 1; transform: none } }
@keyframes m-dot { 0%, 80%, 100% { transform: translateY(0); opacity: .35 } 40% { transform: translateY(-4px); opacity: 1 } }
@keyframes m-scan { 0% { top: 6% } 50% { top: 88% } 100% { top: 6% } }
@keyframes m-wave { 0%, 100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
@keyframes m-ring { from { transform: scale(.6); opacity: .7 } to { transform: scale(1.6); opacity: 0 } }
@keyframes m-spin { to { transform: rotate(360deg) } }
.m-sheet { animation: m-sheet-in .28s cubic-bezier(.2,.8,.2,1) }
.m-fade { animation: m-fade-in .2s ease-out }
.m-pop { animation: m-pop-in .28s cubic-bezier(.2,.8,.2,1) both }
.m-dot { animation: m-dot 1.2s infinite ease-in-out }
.m-scan { animation: m-scan 2.6s ease-in-out infinite }
.m-wave { animation: m-wave 0.9s ease-in-out infinite; transform-origin: center }
.m-ring { animation: m-ring 1.6s ease-out infinite }
.m-spin { animation: m-spin 0.9s linear infinite }
.m-noscroll::-webkit-scrollbar { display: none } .m-noscroll { scrollbar-width: none }
.m-screen ::-webkit-scrollbar { width: 0; height: 0 }
@media (prefers-reduced-motion: reduce) { .m-sheet, .m-fade, .m-pop, .m-dot, .m-scan, .m-wave, .m-ring, .m-spin { animation: none } }
`;

function StatusBar() {
  const now = useClock();
  return (
    <div className="relative flex h-[50px] items-center justify-between px-8 pt-1.5 text-[15px] font-semibold text-slate-900" aria-hidden>
      <span className="w-16 tabular-nums">{now ? myt(now, { hour: "2-digit", minute: "2-digit", hour12: false }) : ""}</span>
      <span className="absolute left-1/2 top-[11px] flex h-[33px] w-[120px] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#1b2333] ring-1 ring-[#2a3550]" />
      </span>
      <span className="flex items-center gap-[5px]">
        <svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor" /><rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor" /><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" /></svg>
        <svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 2.3c2.3 0 4.4.9 6 2.4l1.2-1.3A10.4 10.4 0 0 0 8 .5C5.2.5 2.7 1.6.8 3.4L2 4.7a8.6 8.6 0 0 1 6-2.4zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.7 6.7 0 0 0 8 4.1c-1.8 0-3.4.7-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3zm0 3.5c-.5 0-1 .2-1.3.5L8 11.5l1.3-1.6c-.3-.3-.8-.5-1.3-.5z" fill="currentColor" /></svg>
        <svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" opacity=".4" /><rect x="2" y="2" width="17" height="9" rx="2.4" fill="currentColor" /><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill="currentColor" opacity=".45" /></svg>
      </span>
    </div>
  );
}

function TabBar({ tab, framed, badges }: { tab?: MobileTab; framed: boolean; badges: Partial<Record<MobileTab, number | boolean>> }) {
  const href = useMobileHref();
  return (
    <nav aria-label="Mobile app tabs" className="relative z-30 grid shrink-0 grid-cols-5 border-t border-slate-200/70 bg-white/85 px-1.5 pt-1.5 backdrop-blur-xl"
      style={{ paddingBottom: framed ? 26 : "max(8px, env(safe-area-inset-bottom))" }}>
      {TABS.map((t) => {
        const on = tab === t.id;
        const b = badges[t.id];
        return (
          <Link key={t.id} href={href(t.href)} aria-current={on ? "page" : undefined}
            aria-label={`${t.label}${typeof b === "number" && b > 0 ? `, ${b} new` : b === true ? ", needs attention" : ""}`}
            className="group flex flex-col items-center gap-[3px] py-0.5 outline-none">
            <span className={`relative flex h-8 w-[52px] items-center justify-center rounded-full transition-all duration-200 ${on ? "bg-[#DCE8FF]" : "group-active:bg-slate-100"}`}>
              <svg width="23" height="23" viewBox="0 0 24 24" fill={on ? "rgba(37,99,235,0.14)" : "none"} stroke={on ? "#1D4ED8" : "#64748B"}
                strokeWidth={on ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={t.d} /></svg>
              {typeof b === "number" && b > 0 && (
                <span className="absolute right-1 top-[-3px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#EF4444] px-1 text-[10px] font-bold text-white ring-2 ring-white">{b}</span>
              )}
              {b === true && <span className="absolute right-3 top-0.5 h-2.5 w-2.5 rounded-full bg-[#EF4444] ring-2 ring-white" />}
            </span>
            <span className={`text-[10.5px] font-semibold leading-none ${on ? "text-[#1D4ED8]" : "text-slate-500"}`}>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** The running guided-demo use case, when its next step is on another screen. */
function GuideBanner() {
  const { active } = useActiveUseCase();
  const path = usePathname();
  if (!active || active.complete || !active.next) return null;
  if (screenOf(active.next.href) === path) return null;
  return (
    <Link href={active.next.href} className="m-pop mb-3 flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50/90 px-3.5 py-2.5 text-[12.5px]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-[10px] font-bold text-white">{active.id.replace("UC-", "")}</span>
      <span className="min-w-0 flex-1 leading-tight"><b className="block text-[#1D4ED8]">Guided demo · {active.id}</b><span className="block truncate text-slate-600">Next: {active.next.cta}</span></span>
      <Icon name="arrow" size={16} color="#2563EB" />
    </Link>
  );
}

function NotAvailable({ user }: { user: User }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-50 ring-1 ring-amber-200"><Icon name="lock" size={28} color="#B45309" /></span>
      <h2 className="text-[20px] font-bold tracking-tight">Not available to this account</h2>
      <p className="text-[14px] leading-relaxed text-slate-600">The mobile app is the vehicle owner&apos;s. You are logged in as {user.name} ({ROLE_LABEL[user.role] || user.role}).</p>
      <a className="btn btn-primary mt-2" href={ROLE_HOME[user.role] || "/"}>Go to your apps<Icon name="arrow" size={15} /></a>
    </div>
  );
}

function Splash() {
  return (
    <div className="flex flex-col gap-3 pt-3" role="status" aria-label="Loading">
      <div className="skeleton h-[180px] rounded-[24px]" />
      <div className="grid grid-cols-4 gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[72px] rounded-2xl" />)}</div>
      <div className="skeleton h-[120px] rounded-[24px]" />
    </div>
  );
}

type ShellProps = {
  children: ReactNode;
  /** The screen's name in the top bar (Home shows the brand when omitted). */
  title?: ReactNode;
  /** A back button: the screen it goes back to, or true for the browser's history. */
  back?: string | boolean;
  /** What the back button says to screen readers (and next to the chevron): "All for sale". */
  backLabel?: string;
  /** The tab shown as current in the tab bar. */
  tab?: MobileTab;
  /** A public page opened from a QR code: no login, no tab bar. */
  public?: boolean;
  /** Buttons on the right of the top bar. */
  actions?: ReactNode;
  /** A bar fixed above the tab bar (a pay button, the chat composer). */
  footer?: ReactNode;
  /** Badges on the tabs (a number, or true for a dot); the Book tab counts open bookings by itself. */
  badges?: Partial<Record<MobileTab, number | boolean>>;
  /** The screen starts at the top again when this changes. */
  scrollKey?: string | number;
  /** No side padding: the screen lays itself out. */
  flush?: boolean;
};

function Screen({ framed, user, p }: { framed: boolean; user: User | null | undefined; p: ShellProps }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const isPublic = !!p.public;
  const { plate } = useMobilePlate();
  const allowed = isPublic || (user && canOpen(user.role, ["owner"]));
  const guided = !isPublic && (user?.role === "presenter" || user?.role === "viewer");
  const books = useFetch<any[]>(!isPublic && allowed && plate ? "/api/owner/bookings" : null, { plate: plate || undefined }, [p.scrollKey]);
  const open = (books.data || []).filter((b) => b.status === "confirmed" || b.status === "pending_payment").length;
  const badges = { book: open, ...(p.badges || {}) };
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [p.scrollKey]);
  const home = !p.title;
  return (
    <div ref={setHost} className="m-screen relative flex h-full w-full flex-col overflow-hidden text-slate-900"
      style={{ ["--m-head" as string]: framed ? "104px" : "calc(54px + env(safe-area-inset-top))", background: "radial-gradient(420px 260px at 0% 0%, rgba(191,219,254,0.55), transparent 70%), radial-gradient(380px 300px at 100% 30%, rgba(224,231,255,0.6), transparent 70%), linear-gradient(180deg, #F5F8FD 0%, #EEF3FA 100%)", colorScheme: "light" }}>
      <SheetHost.Provider value={host}>
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
          onScroll={(e) => setScrolled((e.currentTarget as HTMLDivElement).scrollTop > 4)}>
          <header className={`sticky top-0 z-30 transition-[background,box-shadow] duration-200 ${scrolled ? "bg-[#F4F7FC]/[0.98] shadow-[0_1px_0_rgba(15,23,42,0.08)] backdrop-blur-2xl" : "bg-transparent"}`}
            style={{ paddingTop: framed ? 0 : "env(safe-area-inset-top)" }}>
            {framed && <StatusBar />}
            <div className="flex h-[54px] items-center gap-1.5 px-4">
              {p.back ? (
                typeof p.back === "string" ? (
                  <Link href={p.back} aria-label={p.backLabel || "Back"} className="-ml-2 flex h-10 min-w-10 shrink-0 items-center gap-0.5 rounded-full pr-2 text-[#2563EB] active:bg-blue-50">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
                    {p.backLabel && <span className="max-w-[96px] truncate text-[15px] font-medium" aria-hidden>{p.backLabel}</span>}
                  </Link>
                ) : (
                  <button onClick={() => router.back()} aria-label={p.backLabel || "Back"} className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#2563EB] active:bg-blue-50">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
                  </button>
                )
              ) : isPublic ? <span className="mr-0.5 shrink-0"><Logo size={28} /></span> : null}
              <div className="min-w-0 flex-1">
                {home ? (
                  <span className="flex items-center gap-2"><Logo size={30} /><span className="truncate text-[17px] font-extrabold tracking-tight">VehicleSense</span></span>
                ) : typeof p.title === "string" ? <h1 className="truncate text-[17px] font-bold tracking-tight">{p.title}</h1> : p.title}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {guided && !framed && <span className="[&_a]:max-w-[120px]"><DemoBar /></span>}
                {allowed && p.actions}
              </div>
            </div>
          </header>
          <main className={p.flush ? "" : "px-4 pb-8 pt-1"}>
            {!isPublic && user === undefined ? <div className={p.flush ? "px-4" : ""}><Splash /></div>
              : !isPublic && user === null ? null
              : !allowed ? <NotAvailable user={user as User} />
              : (
                <>
                  {guided && <div className={p.flush ? "px-4" : ""}><GuideBanner /></div>}
                  {p.children}
                </>
              )}
          </main>
        </div>
        {allowed && p.footer && <div className="relative z-30 shrink-0">{p.footer}</div>}
        {!isPublic && (user === undefined || allowed) && <TabBar tab={p.tab} framed={framed} badges={allowed ? badges : {}} />}
        {!isPublic && user && !allowed && framed && <div className="h-6 shrink-0" />}
        {isPublic && framed && <div className="h-6 shrink-0" />}
        {framed && <span className="pointer-events-none absolute bottom-[8px] left-1/2 z-40 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-slate-900/85" aria-hidden />}
      </SheetHost.Provider>
    </div>
  );
}

/* ---------------------------------------------------------------- the desktop side panel */

/** A small label above a group in the side panel. */
function PanelLabel({ children }: { children: ReactNode }) {
  return <div className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-3">{children}</div>;
}

function PersonaSwitcher({ plate }: { plate: string | null }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const pick = (p: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set("plate", p);
    q.delete("ticket");
    router.replace(`${path}?${q.toString()}`, { scroll: false });
  };
  const others = plate && !OWNERS.some((o) => o.plate === plate);
  return (
    <section aria-label="Show the app as">
      <PanelLabel>Show the app as</PanelLabel>
      <div className="flex flex-col gap-0.5 rounded-2xl bg-white/75 p-1 ring-1 ring-white">
        {OWNERS.map((o) => {
          const on = o.plate === plate;
          return (
            <button key={o.plate} onClick={() => pick(o.plate)} aria-pressed={on}
              className={`flex items-center gap-3 rounded-xl px-2.5 py-[5px] text-left transition ${on ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-white"}`}>
              <Avatar name={o.name} size={34} />
              <span className="min-w-0 flex-1 leading-tight">
                <b className="block truncate text-[13.5px]">{o.name}</b>
                <span className="block truncate text-[12px] text-fg-2">{o.plate} · {o.car}</span>
                <span className="block truncate text-[11.5px] text-fg-3">{o.story}</span>
              </span>
              {on && <Icon name="check" size={16} color="#2563EB" width={2.4} />}
            </button>
          );
        })}
        {others && <div className="px-2.5 py-1.5 text-[12px] text-fg-3">Now showing {plate} (opened from a link)</div>}
      </div>
    </section>
  );
}

/** The address with places to wrap after its slashes and separators (never in the middle of a word). */
function WrappedUrl({ url }: { url: string }) {
  const parts = url.replace(/^https?:\/\//, "").split(/(?<=[/?&])/);
  return <>{parts.map((p, i) => <span key={i}>{p}{i < parts.length - 1 && <wbr />}</span>)}</>;
}

function OpenOnPhone({ user }: { user: User | null | undefined }) {
  const path = usePathname();
  const sp = useSearchParams();
  const [url, setUrl] = useState("");
  const [qrOk, setQrOk] = useState(true);
  const search = sp.toString();
  useEffect(() => {
    setUrl(window.location.href);
    setQrOk(true);
  }, [path, search]);
  const canQr = !!user && canOpen(user.role, ["owner"]) && url;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", "ok");
    } catch {
      toast("Select the address and copy it", "info");
    }
  };
  return (
    <section aria-label="Open on your phone">
      <PanelLabel>{canQr ? "Open on your phone: scan or type" : "Open on your phone"}</PanelLabel>
      <div className="flex items-center gap-3 rounded-2xl bg-white/75 p-2.5 ring-1 ring-white">
        {canQr && qrOk && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/owner/link-qr.svg?url=${encodeURIComponent(url)}`} alt="QR code of this page" onError={() => setQrOk(false)}
            className="h-[76px] w-[76px] shrink-0 rounded-xl bg-white p-1 ring-1 ring-slate-200" />
        )}
        <div className="min-w-0 flex-1">
          <code className="block break-words font-mono text-[11.5px] leading-snug text-fg" title={url}>{url ? <WrappedUrl url={url} /> : "…"}</code>
          <button className="btn btn-sm mt-2" onClick={copy}><Icon name="copy" size={14} />Copy link</button>
        </div>
      </div>
    </section>
  );
}

function SidePanel({ user, isPublic }: { user: User | null | undefined; isPublic: boolean }) {
  const { plate } = useMobilePlate();
  const href = useMobileHref();
  const owner = canOpen(user?.role, ["owner"]);
  const guided = user?.role === "presenter" || user?.role === "viewer";
  // the lower part scrolls when the window is short; a fade at its foot shows there is more
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = scroller.current;
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [measure, user, isPublic]);
  // the account button shows the name and the role: once is enough when they are the same ("Demo presenter")
  const sameRole = !!user && (ROLE_LABEL[user.role] || user.role) === user.name;
  const tryIt = [
    { label: "Run the self-check", sub: "Tint and a lamp fail first; fix, run again", path: "/mobile/check", icon: "camera" },
    { label: "Book and pay", sub: "Hub and slot, mock payment, check-in QR", path: "/mobile/book", icon: "calendar" },
    { label: "See the passport", sub: "Certificates, odometer, findings, papers", path: "/mobile/vehicle", icon: "shield" },
    { label: "Ask the assistant", sub: "Bahasa Melayu, English or Chinese", path: "/mobile/assistant", icon: "chat" },
    { label: "Shop for a used vehicle", sub: "Every listing with its whole record", path: "/mobile/sell", icon: "sale" },
  ];
  const fade = more ? "linear-gradient(to bottom, #000 calc(100% - 44px), transparent)" : undefined;
  return (
    <aside className="flex max-h-[calc(100dvh-48px)] w-[290px] shrink-0 flex-col rounded-[30px] border border-white/70 bg-white/[0.8] shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_30px_60px_-30px_rgba(15,23,42,0.35)] backdrop-blur-2xl lg:w-[340px]"
      aria-label="About the mobile app">
      <div className="flex shrink-0 flex-col gap-3 px-4 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <Logo size={42} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[19px] font-extrabold tracking-tight">VehicleSense Mobile</span>
            <span className="block truncate text-[12.5px] text-fg-3">{isPublic ? "A public page of the owner's app" : "The vehicle owner's phone app"}</span>
          </span>
          {user && <AppSwitcher current="mobile" />}
        </div>
        {/* what the app does is the "Try it" list below; a public page says what it is */}
        {(isPublic || !owner) && (
          <p className="text-[13px] leading-relaxed text-fg-2">
            {isPublic
              ? "Opened from a QR code: no login is needed, and anyone holding the code sees the same result."
              : "The health passport, a guided self-check with the phone's camera, booking with a mock payment and a check-in QR code, and an assistant in Bahasa Melayu, English and Chinese."}
          </p>
        )}
        {user && <span className={sameRole ? "[&_button_.flex-col>span]:hidden" : ""}><UserMenu user={user} /></span>}
        {guided && !isPublic && <div className="flex min-w-0 [&_a]:!flex [&_a]:w-full [&_a]:!max-w-full [&_a]:justify-center [&_a]:py-1.5"><DemoBar /></div>}
      </div>
      <div ref={scroller} onScroll={measure} className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain border-t border-slate-900/[0.07] px-4 pb-4 pt-3"
        style={{ maskImage: fade, WebkitMaskImage: fade }}>
        {user?.role === "presenter" && !isPublic && <PersonaSwitcher plate={plate} />}
        {owner && !isPublic && (
          <section aria-label="Try it">
            <PanelLabel>Try it</PanelLabel>
            <div className="flex flex-col gap-0.5 rounded-2xl bg-white/75 p-1 ring-1 ring-white">
              {tryIt.map((t) => (
                <Link key={t.path} href={href(t.path)} className="flex items-center gap-3 rounded-xl px-2.5 py-[5px] hover:bg-white">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#DBEAFE] to-[#EFF6FF]"><Icon name={t.icon} size={16} color="#2563EB" /></span>
                  <span className="min-w-0 leading-tight"><b className="block truncate text-[13px]">{t.label}</b><span className="block truncate text-[11.5px] text-fg-3">{t.sub}</span></span>
                </Link>
              ))}
            </div>
          </section>
        )}
        <OpenOnPhone user={user} />
        <p className="px-1 text-[11.5px] leading-snug text-fg-3">Concept demo · fictional data · mock payments</p>
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------- the shell */

export function MobileShell(props: ShellProps) {
  const user = useMobileUser();
  const desktop = useDesktop();
  const isPublic = !!props.public;
  useLoginGate(isPublic ? undefined : user);
  return (
    <>
      <style>{CSS}</style>
      {desktop === undefined ? <div className="min-h-[100dvh]" /> : desktop ? (
        <div className="flex min-h-[100dvh] items-center justify-center gap-8 px-4 py-6 lg:gap-14">
          <div className="relative shrink-0" style={{ width: 414, height: "max(560px, min(868px, calc(100dvh - 48px)))" }}>
            <span className="absolute -left-[3px] top-[118px] h-8 w-[4px] rounded-l-md bg-[#232a38]" aria-hidden />
            <span className="absolute -left-[3px] top-[172px] h-14 w-[4px] rounded-l-md bg-[#232a38]" aria-hidden />
            <span className="absolute -left-[3px] top-[238px] h-14 w-[4px] rounded-l-md bg-[#232a38]" aria-hidden />
            <span className="absolute -right-[3px] top-[200px] h-20 w-[4px] rounded-r-md bg-[#232a38]" aria-hidden />
            <div className="h-full w-full rounded-[58px] bg-[#0B0F19] p-[12px] shadow-[inset_0_0_0_2px_#2C3446,inset_0_0_0_5px_#0B0F19,0_60px_120px_-40px_rgba(15,23,42,0.55),0_30px_60px_-30px_rgba(37,99,235,0.25)]">
              <div className="h-full w-full overflow-hidden rounded-[46px] bg-white">
                <Screen framed user={user} p={props} />
              </div>
            </div>
          </div>
          <SidePanel user={user} isPublic={isPublic} />
        </div>
      ) : (
        <div className="h-[100dvh] w-full overflow-hidden">
          <Screen framed={false} user={user} p={props} />
        </div>
      )}
    </>
  );
}

/** The account sheet (avatar on Home): who is logged in, the presenter's vehicle switch, the other apps, log out. */
export function AccountSheet({ open, onClose, user, plate }: { open: boolean; onClose: () => void; user: User; plate: string | null }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const apps = APPS.filter((a) => a.id !== "mobile" && canOpen(user.role, a.roles));
  const pick = (p: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set("plate", p);
    q.delete("ticket");
    router.replace(`${path}?${q.toString()}`, { scroll: false });
    onClose();
  };
  return (
    <MobileSheet open={open} onClose={onClose} title="Account">
      <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
        <Avatar name={user.name} size={46} />
        <span className="min-w-0 leading-tight"><b className="block truncate text-[15px]">{user.name}</b><span className="block truncate text-[12.5px] text-slate-500">{user.title}</span></span>
      </div>
      {user.role === "presenter" && (
        <div className="mt-4">
          <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Show the app as</div>
          <div className="flex flex-col gap-1">
            {OWNERS.map((o) => (
              <button key={o.plate} onClick={() => pick(o.plate)} aria-pressed={o.plate === plate}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2 text-left ${o.plate === plate ? "bg-blue-50 ring-1 ring-blue-200" : "active:bg-slate-50"}`}>
                <Avatar name={o.name} size={34} />
                <span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-[14px]">{o.name}</b><span className="block truncate text-[12px] text-slate-500">{o.plate} · {o.car}</span></span>
                {o.plate === plate && <Icon name="check" size={16} color="#2563EB" width={2.4} />}
              </button>
            ))}
          </div>
        </div>
      )}
      {apps.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Other apps</div>
          {apps.map((a) => (
            <a key={a.id} href={a.href} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 active:bg-slate-50">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50"><Icon name={a.icon} size={18} color="#2563EB" /></span>
              <span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-[14px]">{a.full}</b><span className="block truncate text-[12px] text-slate-500">{a.sub}</span></span>
              <Icon name="chev" size={16} color="#94A3B8" />
            </a>
          ))}
        </div>
      )}
      <button onClick={logout} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-50 py-3 text-[14px] font-semibold text-rose-700 active:bg-rose-100">
        <Icon name="logout" size={17} color="#BE123C" />Log out
      </button>
    </MobileSheet>
  );
}
