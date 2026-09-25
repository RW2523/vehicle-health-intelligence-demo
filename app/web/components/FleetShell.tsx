"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { mydate, myt } from "@/lib/format";
import { useClock } from "@/lib/live";
import { Logo } from "./Shell";

const NAV = [
  { href: "/lane", title: "Live Inspection", sub: "Real-time AI inspection", d: "M3 5h18v12H3zM8 21h8M12 17v4M8 11l2.5 2.5L16 8" },
  { href: "/fleet", title: "Fleet Intelligence", sub: "Fleet insights & analytics", d: "M4 20V10M10 20V4M16 20v-8M22 20H2", exact: true },
  { href: "/vision", title: "AI Findings", sub: "Detected issues & alerts", d: "M12 3l10 18H2zM12 10v5M12 18v.5" },
  { href: "/fleet/vehicle", title: "Vehicle History", sub: "Degradation & forecast", d: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" },
  { href: "/report", title: "Reports", sub: "Generate & view reports", d: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h7M9 17h7" },
  { href: "/", title: "Demo control", sub: "Sessions & pipeline", d: "M5 4l14 8-14 8z" },
];

export function FleetShell({ children, pill }: { children: ReactNode; pill: string }) {
  const path = usePathname();
  const now = useClock();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-ink-600 bg-gradient-to-b from-[#0C1628] to-[#0A1322] lg:flex">
        <Link href="/" className="flex h-[78px] items-center gap-2.5 border-b border-ink-600 px-5">
          <Logo size={34} />
          <span className="flex flex-col leading-tight">
            <span className="font-display text-[17px] font-bold">VehicleSense</span>
            <span className="text-[9.5px] font-semibold tracking-[0.12em] text-fg-3">INSPECTION INTELLIGENCE</span>
          </span>
        </Link>
        <nav aria-label="Sections" className="mt-5 flex flex-col gap-1">
          {NAV.map((n) => {
            const on = n.exact ? path === n.href : path.startsWith(n.href) && n.href !== "/";
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
                className={`flex items-center gap-4 px-5 py-3.5 ${on ? "bg-gradient-to-r from-[#2F7BFF47] to-transparent shadow-[inset_3px_0_0_#3B82F6]" : "hover:bg-ink-800"}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={on ? "#60A5FA" : "#9FB3D1"} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={n.d} /></svg>
                <span className="flex flex-col whitespace-nowrap"><span className="text-[14px] font-semibold">{n.title}</span><span className="text-[11.5px] text-fg-3">{n.sub}</span></span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-6 pb-7 text-[11.5px] font-semibold leading-[1.9] tracking-[0.2em] text-[#A9BAD3]">TRUSTED VEHICLES<br />SAFER ROADS<br />BRIGHTER MALAYSIA</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[78px] shrink-0 items-center gap-5 border-b border-ink-600 bg-[#0C1628] px-6">
          <div className="flex flex-col">
            <span className="font-display text-[22px] font-semibold">VehicleSense <span className="text-cyan">AI</span></span>
            <span className="text-[10.5px] tracking-[0.1em] text-fg-3">AI-POWERED VEHICLE HEALTH FOR SAFER ROADS</span>
          </div>
          <span className="chip border-[#10B981] bg-[#10B981]/10 px-3.5 py-2 text-[12.5px] tracking-[0.06em] text-[#34D399]"><span className="h-2 w-2 rounded-full bg-[#34D399]" />{pill}</span>
          <span className="chip border-ink-500 text-fg-2">Synthetic fleet data</span>
          <div className="ml-auto flex items-center gap-5">
            <div className="flex flex-col items-end leading-tight"><span className="text-[12px] text-fg-3">{mydate(now)}</span><span className="font-mono text-[17px] font-semibold">{myt(now)} <span className="text-[11px] text-fg-3">MYT</span></span></div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1D3A66] text-[14px] font-bold text-[#CFE3FF]">AR</span>
              <span className="hidden flex-col leading-tight md:flex"><span className="text-[13.5px] font-semibold">Aisha Rahman</span><span className="text-[12px] text-fg-3">Fleet manager</span></span>
            </div>
          </div>
        </header>
        <main className="flex-1 px-6 py-5">{children}</main>
        <footer className="flex justify-between border-t border-ink-600 px-6 py-2.5 text-[11.5px] text-fg-4">
          <span>VehicleSense AI · synthetic fleets (5 operators + FLEET07) · photos: sample captures</span>
          <span className="tracking-[0.12em]">SAFER MALAYSIAN ROADS THROUGH SMARTER INSPECTIONS</span>
        </footer>
      </div>
    </div>
  );
}

export const ICONS: Record<string, string> = {
  brake: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 8a8 8 0 0 1 4-4",
  tyre: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 3v5M12 16v5M3 12h5M16 12h5",
  smoke: "M3 17h9a3 3 0 0 0 0-6h-1M3 13h5M14 7a3 3 0 0 1 6 1 3 3 0 0 1-1 5.8M17 17h4",
  spring: "M12 2v3M12 19v3M7 5h10l-10 3.5h10L7 12h10L7 15.5h10L7 19h10",
  lamp: "M9 7a5 5 0 1 1 0 10zM3 8h3M3 12h3M3 16h3M9 7v10",
  rust: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11zM10 14h4",
  cam: "M3 8h13v9H3zM16 11l5-3v9l-5-3M8 12.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0",
  oil: "M8 3s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9zM15 16h6M18 13v6",
  pad: "M4 6h16v4H4zM6 10v8h12v-8M10 14h4",
  crack: "M4 4l6 5-3 3 6 4-2 4M14 4l2 4 4 1",
  batt: "M3 7h18v12H3zM7 4v3M17 4v3M7 13h4M15 11v4M13 13h4",
  vib: "M2 12h3l2-5 3 10 3-10 3 10 2-5h4",
};
