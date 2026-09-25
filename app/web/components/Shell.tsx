"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { mydate, myt } from "@/lib/format";
import { useClock } from "@/lib/live";

export const APPS = [
  { href: "/", label: "Demo control" },
  { href: "/lane", label: "Lane" },
  { href: "/vision", label: "AI vision" },
  { href: "/examiner", label: "Examiner" },
  { href: "/report", label: "Report" },
  { href: "/fleet", label: "Fleet" },
  { href: "/hq", label: "HQ" },
  { href: "/regulator", label: "Regulator" },
  { href: "/owner", label: "Owner app" },
];

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
  useEffect(() => {
    const load = () => api.get("/api/system/status").then(setS).catch(() => setS(null));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);
  const ok = !!s;
  return (
    <span className="chip border-ink-600 text-fg-2" title={s ? `bus ${s.bus.kind} · ${s.llm.backend} · ${s.database}` : "API not reachable"}>
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-ok pulse-dot" : "bg-bad"}`} />
      {ok ? `Pipeline live · ${s.llm.backend.startsWith("ollama") ? "LLM" : "template"}` : "API offline"}
    </span>
  );
}

export function Shell({ children, context, wide = false }: { children: ReactNode; context?: ReactNode; wide?: boolean }) {
  const path = usePathname();
  const now = useClock();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-6 border-b border-ink-600 bg-ink-850/95 px-5 backdrop-blur">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="font-display text-[17px] font-bold">VehicleSense <span className="text-cyan">AI</span></span>
        </Link>
        <nav aria-label="Apps" className="flex items-center gap-1 overflow-x-auto">
          {APPS.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              aria-current={active(a.href) ? "page" : undefined}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-[13.5px] font-semibold ${active(a.href) ? "bg-ink-700 text-fg shadow-[inset_0_-2px_0_#22D3EE]" : "text-fg-3 hover:text-fg"}`}
            >
              {a.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {context}
          <StatusDot />
          <div className="hidden flex-col items-end leading-tight xl:flex">
            <span className="text-[11px] text-fg-3">{mydate(now)}</span>
            <span className="font-mono text-[15px] font-semibold">{myt(now)} <span className="text-[11px] text-fg-3">MYT</span></span>
          </div>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-5 py-5 ${wide ? "" : "max-w-[1560px]"}`}>{children}</main>
      <footer className="border-t border-ink-600 px-5 py-3 text-[11.5px] text-fg-4">
        Concept demo prepared for vehicle-inspection stakeholders. Fictional vehicles, owners and examiners. Every panel is labelled live model, live logic, simulated, synthetic or real public data.
      </footer>
    </div>
  );
}
