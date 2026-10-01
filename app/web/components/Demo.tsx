"use client";
/* The guided demo: the nine use cases (vhi/services/usecases.py), their live progress, the journey stepper and the
   header bar that always says which use case is running, where it is and what to do next. */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReactNode, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { useLive } from "@/lib/live";
import { Icon } from "./icons";
import { Source, toast } from "./ui";

export type Step = { id: string; stage: string; label: string; kind: string; href: string; cta: string; done: boolean; current?: boolean };
export type UseCase = {
  id: string; title: string; session: string | null; lane: string | null; plate: string | null; vehicle: string; vtype: string;
  scenario: string; outcome: string; minutes: number; provenance: string[]; autostart: boolean; stages: string[];
  steps: Step[]; done: number; complete: boolean; next: Step | null; inspection: any; run: any; latest_report: any;
};

/* ---------------------------------------------------------------- a tiny shared store: one poller for every view */
type State = { active: UseCase | null; loaded: boolean };
let state: State = { active: null, loaded: false };
const subs = new Set<() => void>();
let timer: any = null;
let inflight: Promise<void> | null = null;

function emit(next: State) {
  state = next;
  subs.forEach((f) => f());
}

export function refreshUseCase(): Promise<void> {
  if (inflight) return inflight;
  inflight = api.get("/api/usecases/active")
    .then((r) => emit({ active: r.active, loaded: true }))
    .catch(() => emit({ ...state, loaded: true }))
    .finally(() => (inflight = null));
  return inflight;
}
export const setActiveUseCase = (a: UseCase | null) => emit({ active: a, loaded: true });

function subscribe(f: () => void) {
  subs.add(f);
  if (subs.size === 1) {
    refreshUseCase();
    timer = setInterval(refreshUseCase, 4000);
  }
  return () => {
    subs.delete(f);
    if (!subs.size) clearInterval(timer);
  };
}

/** The running use case with its live progress (null when none runs). */
export function useActiveUseCase() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** Start (or restart) a use case and go to its first step. */
export async function startUseCase(id: string, go: (href: string) => void) {
  try {
    const p: UseCase = await api.post(`/api/usecases/${id}/start`);
    setActiveUseCase(p);
    toast(`${p.id} started: ${p.title}`, "ok");
    if (p.next) go(p.next.href);
  } catch (e: any) {
    toast(e.message, "err");
  }
}

export async function stopUseCase() {
  await api.post("/api/usecases/stop").catch(() => {});
  setActiveUseCase(null);
}

/** Mark a step shown that is not a page of its own (e.g. opening a report card); used by the pages. */
export async function visitStep(path: string) {
  const r = await fetch("/api/usecases/visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) })
    .then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (r) setActiveUseCase(r.active);
}

/** Records the pages the presenter opens against the running use case (its "show this screen" steps). */
function VisitTracker() {
  const path = usePathname();
  const sp = useSearchParams();
  const user = useUser();
  const search = sp.toString();
  useEffect(() => {
    if (user?.role !== "presenter") return;
    let alive = true;
    (state.loaded ? Promise.resolve() : refreshUseCase()).then(() => {
      if (alive && state.active && !state.active.complete) visitStep(window.location.pathname + window.location.search);
    });
    return () => {
      alive = false;
    };
  }, [path, search, user?.role]);
  return null;
}

/* ---------------------------------------------------------------- the journey stepper */
export function JourneyStepper({ steps, compact = false, onPick }: { steps: Step[]; compact?: boolean; onPick?: (s: Step) => void }) {
  return (
    <ol className={`flex min-w-0 flex-wrap items-center gap-y-2 ${compact ? "gap-x-1" : "gap-x-1.5"}`} aria-label="Journey">
      {steps.map((s, i) => {
        const tone = s.done ? "done" : s.current ? "current" : "todo";
        const circle = (
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold ${tone === "done" ? "bg-ok text-ink-900" : tone === "current" ? "bg-cyan text-ink-900" : "border border-ink-500 text-fg-4"}`}>
            {s.done ? <Icon name="check" size={11} width={2.6} /> : i + 1}
          </span>
        );
        const label = <span className={`text-[12px] font-semibold ${tone === "current" ? "text-fg" : tone === "done" ? "text-fg-2" : "text-fg-4"} ${compact && tone !== "current" ? "hidden md:inline" : ""}`}>{s.stage}</span>;
        const body = <span className="flex items-center gap-1.5">{circle}{label}</span>;
        return (
          <li key={s.id} className="flex items-center gap-1" aria-current={s.current ? "step" : undefined} title={`${s.stage}: ${s.label}${s.done ? " (done)" : s.current ? " (now)" : ""}`}>
            {onPick ? <button className="rounded-md px-0.5" onClick={() => onPick(s)}>{body}</button> : body}
            {i < steps.length - 1 && <span className={`mx-0.5 h-px w-3 ${s.done ? "bg-ok/60" : "bg-ink-500"}`} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/** The one dominant next action of the running use case (a link to its screen), or the page's own action. */
export function NextAction({ uc, here, children }: { uc: UseCase | null; here?: string | string[]; children?: ReactNode }) {
  if (children) return <>{children}</>;
  if (!uc) return null;
  if (uc.complete) return <Link className="btn btn-primary" href="/demo#usecases"><Icon name="check" size={15} />Use case complete · back to demo control</Link>;
  const n = uc.next;
  const at = Array.isArray(here) ? here : here ? [here] : [];
  if (!n || at.includes(n.href.split("#")[0].split("?")[0])) return null;
  return <Link className="btn btn-primary" href={n.href}>{n.cta}<Icon name="arrow" size={15} /></Link>;
}

/* ---------------------------------------------------------------- the header bar */
function DemoBarInner() {
  const { active } = useActiveUseCase();
  const user = useUser();
  const path = usePathname();
  useLive(active ? ["usecases", "inspections"] : [], () => refreshUseCase());
  const guided = user?.role === "presenter" || user?.role === "viewer";
  if (!guided) return null;
  if (!active)
    return <Link href="/demo#usecases" className="chip hidden h-11 border-white/80 bg-white/80 px-4 text-[12.5px] text-fg-2 shadow-glass hover:border-cyan/60 hover:bg-white md:inline-flex">Guided demo</Link>;
  const n = active.next;
  return (
    <Link href={active.complete ? "/demo#usecases" : n?.href || "/"} title={`${active.id} ${active.title}${n ? ` · next: ${n.label}` : ""}`}
      aria-current={n && n.href.split("#")[0] === path ? "step" : undefined}
      className="chip h-11 max-w-[46vw] border-cyan/60 bg-cyan/10 text-fg shadow-glass hover:bg-cyan/20 sm:px-3.5 sm:text-[12.5px]">
      <b className="text-cyan">{active.id}</b>
      <span className="hidden text-fg-3 sm:inline">{active.complete ? "complete" : `step ${Math.min(active.done + 1, active.steps.length)}/${active.steps.length}`}</span>
      <span className="hidden truncate lg:inline">{active.complete ? "· back to the use cases" : `· ${n?.stage}`}</span>
      <Icon name="arrow" size={13} />
    </Link>
  );
}

export function DemoBar() {
  return (
    <Suspense>
      <VisitTracker />
      <DemoBarInner />
    </Suspense>
  );
}

/* ---------------------------------------------------------------- demo control pieces */
export function UseCaseCard({ uc, active, onStart, busy }: { uc: UseCase; active: boolean; onStart: () => void; busy: boolean }) {
  const pct = uc.steps.length ? (100 * uc.done) / uc.steps.length : 0;
  return (
    <article className={`card card-pad flex flex-col gap-2.5 ${active ? "border-cyan/70 shadow-[0_0_0_1px_rgba(37,99,235,0.35)]" : ""}`} aria-label={`${uc.id} ${uc.title}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-fg-3">
            <span className="text-cyan">{uc.id}</span><span>{uc.vtype}</span><span className="normal-case tracking-normal text-fg-4">~{uc.minutes} min</span>
          </div>
          <h3 className="mt-1 font-display text-[16px] font-semibold leading-snug">{uc.title}</h3>
          <p className="text-[12.5px] text-fg-3">{uc.plate ? `${uc.plate} · ` : ""}{uc.vehicle}</p>
        </div>
        {active && <span className="chip shrink-0 border-cyan/60 text-cyan">{uc.complete ? "Complete" : "Running"}</span>}
      </div>
      <p className="text-[13px] leading-relaxed text-fg-2">{uc.scenario}</p>
      <p className="text-[12.5px] leading-relaxed text-fg-3"><b className="text-fg-2">Expected outcome:</b> {uc.outcome}</p>
      <div className="flex flex-wrap gap-1.5">{uc.provenance.map((k) => <Source key={k} kind={k} />)}</div>
      {active && (
        <div className="h-1.5 rounded bg-ink-600" aria-label={`${uc.done} of ${uc.steps.length} steps done`}>
          <div className="h-1.5 rounded bg-cyan transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {active && !uc.complete && uc.next ? (
          <>
            <Link className="btn btn-primary" href={uc.next.href}>Continue: {uc.next.cta}<Icon name="arrow" size={15} /></Link>
            <button className="btn btn-sm" disabled={busy} onClick={onStart}>Restart</button>
          </>
        ) : (
          <button className="btn" disabled={busy} onClick={onStart}>{busy ? "Starting…" : active ? "Run again" : "Start"}{!active && <Icon name="arrow" size={15} />}</button>
        )}
        <span className="text-[11.5px] text-fg-4">{uc.stages.length} steps: {uc.stages.slice(0, 3).join(" → ")}…</span>
      </div>
    </article>
  );
}

/** The running use case, pinned on demo control: where it is, what it found so far, what comes next. */
export function ActiveUseCaseCard({ uc, onRestart, busy }: { uc: UseCase; onRestart: () => void; busy: boolean }) {
  const router = useRouter();
  const i = uc.inspection;
  return (
    <section className="card card-pad mb-4 border-cyan/60" aria-label="Running use case">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label text-cyan">Now running · {uc.id}</div>
          <h2 className="mt-1 font-display text-[19px] font-semibold">{uc.title}</h2>
          <p className="text-[13px] text-fg-3">{uc.plate ? `${uc.plate} · ` : ""}{uc.vehicle}{uc.lane ? ` · ${uc.lane.replace(/^BR00-L/, "lane ")} at the Central Inspection Hub` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {uc.complete ? <span className="chip border-ok/60 text-ok"><Icon name="check" size={13} />Complete</span>
            : uc.next && <button className="btn btn-primary" onClick={() => router.push(uc.next!.href)}>Continue: {uc.next.cta}<Icon name="arrow" size={15} /></button>}
          <button className="btn btn-sm" disabled={busy} onClick={onRestart}>Restart use case</button>
          <button className="btn btn-sm" onClick={stopUseCase}>End</button>
        </div>
      </div>
      <div className="mt-3 overflow-x-auto pb-1"><JourneyStepper steps={uc.steps} onPick={(s) => router.push(s.href)} /></div>
      <div className="mt-3 grid grid-cols-1 gap-3 text-[13px] md:grid-cols-3">
        <div className="rounded-xl border border-ink-600 bg-ink-850 px-3 py-2">
          <div className="text-[11.5px] text-fg-3">Now</div>
          <div className="font-semibold">{uc.complete ? "Every step done" : `${uc.next?.stage}: ${uc.next?.label}`}</div>
        </div>
        <div className="rounded-xl border border-ink-600 bg-ink-850 px-3 py-2">
          <div className="text-[11.5px] text-fg-3">Findings so far</div>
          <div className="font-semibold">
            {!i ? (uc.session ? "The inspection has not started" : "–")
              : i.status === "in_lane" ? `${i.alerts} alert${i.alerts === 1 ? "" : "s"} · lane running`
              : `${i.alerts} finding${i.alerts === 1 ? "" : "s"} · ${i.open ? `${i.open} to decide` : "all decided"}${i.health != null ? ` · health ${Math.round(i.health)}` : ""}`}
            {i?.report && <span> · {i.report.verdict}</span>}
          </div>
        </div>
        <div className="rounded-xl border border-ink-600 bg-ink-850 px-3 py-2">
          <div className="text-[11.5px] text-fg-3">Expected outcome</div>
          <div className="text-fg-2">{uc.outcome}</div>
        </div>
      </div>
    </section>
  );
}
