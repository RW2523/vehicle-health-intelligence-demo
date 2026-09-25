"use client";
/* The guided demo: the ten-minute walkthrough as steps, so every page says where you are and what comes next. */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import { Icon } from "./icons";
import { toast } from "./ui";

export const GUIDE = [
  { id: "start", path: "/", href: "/", title: "Start S1", sub: "A tampered diesel prime mover drives into lane 3" },
  { id: "lane", path: "/lane", href: "/lane?lane=BR00-L3", title: "Watch the lane", sub: "Sensors stream in and AI alerts appear live" },
  { id: "examiner", path: "/examiner", href: "/examiner?session=S1", title: "Decide the alerts", sub: "Confirm, dismiss with a reason, or defer; then issue" },
  { id: "report", path: "/report", href: "/report", title: "Read the report", sub: "Plain-words summary, QR code, what the buyer sees" },
  { id: "fleet", path: "/fleet", href: "/fleet/vehicle/VKR%203128", title: "Fleet: VKR 3128", sub: "Brake wear trend, forecast, pattern report" },
  { id: "hq", path: "/hq", href: "/hq", title: "HQ tamper test", sub: "The hash chain catches an edited record" },
  { id: "owner", path: "/owner", href: "/owner?tab=chat", title: "Owner app", sub: "Ask in BM, self-check, book a GEAR slot" },
];
const KEY = "vhi-guide-visited";

export function guideIndex(path: string) {
  return GUIDE.findIndex((g) => (g.path === "/" ? path === "/" : path === g.path || path.startsWith(g.path + "/")));
}

function readVisited(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function markVisited(id: string) {
  try {
    const v = readVisited();
    if (!v[id]) localStorage.setItem(KEY, JSON.stringify({ ...v, [id]: true }));
  } catch {}
}

/** Header chip: "Next: Decide the alerts →" on guide pages, a way back to the guide everywhere else. */
export function NextStep() {
  const path = usePathname();
  const i = guideIndex(path);
  useEffect(() => {
    if (i >= 0) markVisited(GUIDE[i].id);
  }, [i]);
  if (i < 0)
    return <Link href="/#guide" className="chip hidden border-ink-500 text-fg-2 hover:border-cyan/60 md:inline-flex">Guided demo</Link>;
  const next = GUIDE[i + 1];
  if (!next)
    return <Link href="/#guide" className="chip hidden border-cyan/60 bg-cyan/10 text-fg md:inline-flex"><span className="text-fg-3">Step {i + 1}/{GUIDE.length} · Last step:</span> back to the guide<Icon name="arrow" size={13} /></Link>;
  return (
    <Link href={next.href} className="chip hidden border-cyan/60 bg-cyan/10 text-fg hover:bg-cyan/20 md:inline-flex" title={next.sub}>
      <span className="text-fg-3">Step {i + 1}/{GUIDE.length} · Next:</span> {next.title}
      <Icon name="arrow" size={13} />
    </Link>
  );
}

/** Demo control: the whole walkthrough, with progress taken from the live system where it can be. */
export function GuideCard({ s1Player }: { s1Player?: any }) {
  const router = useRouter();
  const [visited, setVisited] = useState<Record<string, boolean>>({});
  const [s1, setS1] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get("/api/inspections/latest", { session_id: "S1" }).then(setS1).catch(() => {}), []);
  useEffect(() => {
    setVisited(readVisited());
    load();
  }, [load]);
  useLive(["inspections"], () => load());
  const openAlerts = (s1?.alerts || []).filter((a: any) => a.status === "open").length;
  const done: Record<string, boolean> = {
    start: !!s1 || (s1Player?.status && s1Player.status !== "idle"),
    lane: !!s1 && s1.status !== "in_lane",
    examiner: !!s1 && (s1.status === "reported" || (s1.status !== "in_lane" && s1.alerts?.length > 0 && openAlerts === 0)),
    report: s1?.status === "reported" && !!visited.report,
    fleet: !!visited.fleet,
    hq: !!visited.hq,
    owner: !!visited.owner,
  };
  const nextIdx = GUIDE.findIndex((g) => !done[g.id]);
  const next = nextIdx >= 0 ? GUIDE[nextIdx] : null;
  const startS1 = async () => {
    setBusy(true);
    try {
      await api.post("/api/sessions/S1/start", { speed: 4 });
      toast("S1 started at 4× - it takes about 2 minutes", "ok");
      router.push("/lane?lane=BR00-L3");
    } catch (e: any) {
      toast(e.message, "err");
      setBusy(false);
    }
  };
  const reset = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {}
    setVisited({});
  };
  return (
    <section id="guide" className="card card-pad mb-5 scroll-mt-20">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[17px] font-semibold">Guided demo <span className="text-[13px] font-normal text-fg-3">· about 10 minutes</span></h2>
          <p className="text-[13px] text-fg-3">Follow the steps in order. Every page shows the next step at the top right.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {Object.keys(visited).length > 0 && <button className="btn btn-sm" onClick={reset}>Reset progress</button>}
          {!done.start ? (
            <button className="btn btn-primary" disabled={busy} onClick={startS1}>{busy ? "Starting…" : "Start S1 at 4× and watch the lane"}<Icon name="arrow" size={15} /></button>
          ) : next ? (
            <Link className="btn btn-primary" href={next.href}>Continue: {next.title}<Icon name="arrow" size={15} /></Link>
          ) : (
            <span className="chip border-ok/60 text-ok"><Icon name="check" size={13} />All steps done</span>
          )}
        </div>
      </div>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {GUIDE.map((g, k) => {
          const isNext = k === nextIdx;
          return (
            <li key={g.id}>
              <Link href={g.id === "start" ? "/#sessions" : g.href}
                className={`flex h-full gap-3 rounded-xl border p-3 transition hover:border-cyan/60 ${isNext ? "border-cyan bg-cyan/10" : done[g.id] ? "border-ok/40 bg-ok/5" : "border-ink-600 bg-ink-850"}`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done[g.id] ? "bg-ok text-ink-900" : isNext ? "bg-cyan text-ink-900" : "bg-ink-600 text-fg-3"}`}>
                  {done[g.id] ? <Icon name="check" size={13} width={2.4} /> : k + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">{g.title}{isNext && <span className="ml-1.5 text-[11px] font-bold uppercase text-cyan">next</span>}</span>
                  <span className="block text-[11.5px] leading-snug text-fg-3">{g.sub}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
