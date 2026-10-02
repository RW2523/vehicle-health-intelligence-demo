"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Agenda, ApptDetail, ApptPhoto, ApptTable, Appt, Listing, MiniMonth, NewAppointment, Options, STATUS_FILTERS, Seg, Sheet, StagePill, WeekStrip,
  addDays, dayLong, dayMonth, dayShort, isSunday, monthGrid, monthOf, mytToday, weekStart,
} from "@/components/appointments";
import { TONE, Tone } from "@/components/glass";
import { Icon } from "@/components/icons";
import { Shell } from "@/components/Shell";
import { ErrorState, LoadingState, PageHeader, Source } from "@/components/ui";
import { api } from "@/lib/api";
import { useAssistantContext } from "@/lib/assistantContext";
import { useUser } from "@/lib/auth";
import { useFetch } from "@/lib/live";

const WRITERS = ["presenter", "examiner", "hq", "fleet"];

/** One of the five numbers on top, compact; a button that sets the view behind it. */
function MiniStat({ icon, tone, label, value, sub, onClick, active = false, className = "" }: { icon: string; tone: Tone; label: string; value: number; sub: string; onClick: () => void; active?: boolean; className?: string }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`card flex min-w-0 ${className} flex-col px-3.5 py-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-lg sm:px-4 sm:py-3 ${active ? "ring-2 ring-blue-200" : ""}`}>
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-fg-3"><Icon name={icon} size={14} width={2.2} color={TONE[tone].solid} /><span className="truncate">{label}</span></span>
      <b className="text-[24px] font-bold leading-tight tracking-tight">{value}</b>
      <span className="truncate text-[12px] text-fg-4">{sub}</span>
    </button>
  );
}

/** The agenda or table with nothing in it: say so plainly, why, and what can be done. */
function NoAppointments({ label, why, action }: { label: string; why: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-ink-500 bg-white/40 px-6 py-8 text-center" role="status">
      <Icon name="calendar" size={30} width={1.4} color="#94A3B8" />
      <b className="text-[16px]">No appointments for this period.</b>
      <span className="text-[13px] text-fg-3">{label} · {why}</span>
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1280px)");
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

function Appointments() {
  const sp = useSearchParams();
  const router = useRouter();
  const user = useUser();
  const wide = useWide();
  const canWrite = !!user && WRITERS.includes(user.role);
  const [selected, setSelected] = useState<string>(() => sp.get("date") || mytToday());
  const [month, setMonth] = useState(() => monthOf(sp.get("date") || mytToday()));
  const [mode, setMode] = useState<"day" | "week">((sp.get("mode") as any) === "week" ? "week" : "day");
  const [view, setView] = useState<"list" | "table">("list");
  const [status, setStatus] = useState("");
  const [plate, setPlate] = useState("");
  const [hub, setHub] = useState("");
  const [openId, setOpenId] = useState<string | null>(sp.get("id"));
  const [detail, setDetail] = useState<Appt | null>(null);
  const [newOpen, setNewOpen] = useState(sp.get("new") === "1");
  const [newDate, setNewDate] = useState<string | null>(null);
  const [monthOpen, setMonthOpen] = useState(false);

  const ws = weekStart(selected);
  const grid = monthGrid(month);
  const from = grid[0] < ws ? grid[0] : ws;
  const to = grid[41] > addDays(ws, 6) ? grid[41] : addDays(ws, 6);
  const L = useFetch<Listing>(user ? "/api/appointments" : null, { from, to, status, plate, branch_id: hub });
  const O = useFetch<Options>(user ? "/api/appointments/options" : null);
  useEffect(() => {
    const t = setInterval(() => L.reload(), 30000);  // lane check-ins and other desks' changes
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const D = L.data;
  const today = D?.today || mytToday();

  // keep the address in step: the day, the open appointment
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("date", selected);
    if (mode === "week") q.set("mode", "week");
    if (openId) q.set("id", openId);
    router.replace(`/appointments?${q}`, { scroll: false });
  }, [selected, mode, openId]); // eslint-disable-line react-hooks/exhaustive-deps

  // the open appointment: from the list, or fetched when it is outside the range shown
  useEffect(() => {
    if (!openId) return setDetail(null);
    const hit = D?.items.find((a) => a.booking_id === openId);
    if (hit) return setDetail(hit);
    if (detail?.booking_id === openId) return;
    let alive = true;
    api.get(`/api/appointments/${openId}`).then((a) => alive && setDetail(a)).catch(() => alive && setOpenId(null));
    return () => { alive = false; };
  }, [openId, D]); // eslint-disable-line react-hooks/exhaustive-deps

  useAssistantContext(detail ? { appointment_id: detail.booking_id, plate: detail.plate, label: `${detail.plate} · ${dayShort(detail.date)} ${detail.slot}` } : {});

  const pick = useCallback((d: string) => { setSelected(d); setMonth(monthOf(d)); }, []);
  const step = (n: number) => pick(addDays(selected, mode === "week" ? 7 * n : n));
  const shown = useMemo(() => {
    const items = D?.items || [];
    const lo = mode === "day" ? selected : ws, hi = mode === "day" ? selected : addDays(ws, 6);
    return items.filter((a) => a.date >= lo && a.date <= hi);
  }, [D, mode, selected, ws]);
  const live = shown.filter((a) => a.status !== "cancelled").length;
  const upcoming = useMemo(() => (D?.items || []).filter((a) => (a.date > today || (a.date === today && a.slot >= D!.now)) && a.status !== "cancelled").slice(0, 4), [D, today]);
  const onChanged = (a: Appt) => {
    if (detail && a.date !== detail.date) pick(a.date);  // moved: follow it to its new day
    setDetail(a);
    L.reload();
  };
  const open = (a: Appt) => { setOpenId(a.booking_id); setDetail(a); };
  const book = (d?: string | null) => { setNewDate(d || (selected >= today ? selected : today)); setNewOpen(true); };
  const filtered = !!(status || plate || hub);
  const st = D?.stats;
  const rangeLabel = mode === "day" ? dayLong(selected) : `${dayShort(ws)} – ${dayShort(addDays(ws, 6))}`;
  const shortLabel = mode === "day" ? dayShort(selected) : `${dayMonth(ws)} – ${dayMonth(addDays(ws, 6))}`;

  const monthCard = (
    <>
      <MiniMonth month={month} selected={selected} today={today} days={D?.days || {}} onSelect={(d) => { pick(d); setMonthOpen(false); }} onMonth={setMonth} />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-600 pt-3 text-[12px] text-fg-3">
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-cyan" />Appointments</span>
        <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full ring-1 ring-blue-200" />Today</span>
        <span>Sundays closed</span>
      </div>
    </>
  );

  return (
    <Shell>
      <PageHeader eyebrow="Appointments" title="Appointments"
        sub="Bookings of the hub's ten vehicles: book a slot, take payment, move or cancel, and check vehicles in on the day."
        actions={canWrite ? <button className="btn btn-primary btn-lg" onClick={() => book()}><Icon name="plus" size={16} />New appointment</button> : undefined} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Source kind="live_logic" text="Bookings, slot rules and check-in" />
        <Source kind="synthetic" text="Seeded bookings · other customers' slot occupancy" />
        <Source kind="mock" text="Payment gateway" />
      </div>

      {L.error && !D ? <ErrorState title="The appointments could not load" onRetry={L.reload}>{L.error}</ErrorState> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-6 sm:gap-3 xl:grid-cols-5">
            {!st ? Array.from({ length: 5 }).map((_, i) => <div key={i} className={`card px-4 py-3 xl:col-span-1 ${i < 3 ? "sm:col-span-2" : i === 3 ? "sm:col-span-3" : "col-span-2 sm:col-span-3"}`}><LoadingState label={i ? "" : "Loading appointments…"} rows={2} /></div>) : (
              <>
                <MiniStat className="sm:col-span-2 xl:col-span-1" icon="calendar" tone="blue" label="Today" value={st.today} sub={dayShort(today)} onClick={() => { pick(today); setMode("day"); }} />
                <MiniStat className="sm:col-span-2 xl:col-span-1" icon="list" tone="purple" label="This week" value={st.week} sub={`${dayMonth(st.week_from)} – ${dayMonth(st.week_to)}`} onClick={() => { pick(today); setMode("week"); }} />
                <MiniStat className="sm:col-span-2 xl:col-span-1" icon="wallet" tone="amber" label="Awaiting payment" value={st.awaiting_payment} sub={`RM ${Math.round(st.awaiting_payment_rm)} to collect`} active={status === "awaiting_payment"} onClick={() => setStatus("awaiting_payment")} />
                <MiniStat className="sm:col-span-3 xl:col-span-1" icon="checkc" tone="green" label="Checked in today" value={st.checked_in_today} sub={`of ${st.today} today`} active={status === "checked_in"} onClick={() => { pick(today); setMode("day"); setStatus("checked_in"); }} />
                <MiniStat className="col-span-2 sm:col-span-3 xl:col-span-1" icon="xc" tone="red" label="Cancelled" value={st.cancelled} sub="this week and later" active={status === "cancelled"} onClick={() => setStatus("cancelled")} />
              </>
            )}
          </div>

          <section className="card mb-5 flex flex-col gap-3 p-3 sm:p-4" aria-label="Calendar">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <button className="btn btn-sm px-2" aria-label={mode === "week" ? "Previous week" : "Previous day"} onClick={() => step(-1)}><Icon name="back" size={15} /></button>
                <button className="btn btn-sm" onClick={() => pick(today)}>Today</button>
                <button className="btn btn-sm px-2" aria-label={mode === "week" ? "Next week" : "Next day"} onClick={() => step(1)}><Icon name="chev" size={15} /></button>
              </div>
              <h2 className="min-w-0 flex-1 truncate text-[16px] font-bold sm:text-[18px]"><span className="sm:hidden">{shortLabel}</span><span className="hidden sm:inline">{rangeLabel}</span></h2>
              <div className="flex flex-wrap items-center gap-2">
                <Seg label="Day or week" value={mode} onChange={(v) => setMode(v)} items={[["day", "Day"], ["week", "Week"]] as const} />
                <Seg label="List or table" value={view} onChange={(v) => setView(v)} items={[["list", <><Icon key="i" name="list" size={14} />List</>], ["table", <><Icon key="i" name="doc" size={14} />Table</>]] as const} />
                <button className="btn xl:hidden" aria-expanded={monthOpen} onClick={() => setMonthOpen((x) => !x)}><Icon name="calendar" size={15} />Month</button>
              </div>
            </div>
            <WeekStrip selected={selected} today={today} days={D?.days || {}} onSelect={pick} />
            {monthOpen && <div className="rounded-2xl bg-white/70 p-3 ring-1 ring-ink-600 sm:max-w-[360px] xl:hidden">{monthCard}</div>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center">
              <label className="flex min-w-0 items-center gap-2 text-[12.5px] text-fg-3 lg:w-[230px]"><Icon name="filter" size={14} />
                <select className="input min-w-0 flex-1 py-1.5" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                  {STATUS_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}{k && D?.counts?.[k] != null ? ` (${D.counts[k]})` : ""}</option>)}
                </select>
              </label>
              <select className="input min-w-0 py-1.5 lg:w-[230px]" value={plate} onChange={(e) => setPlate(e.target.value)} aria-label="Vehicle">
                <option value="">All ten vehicles</option>
                {(O.data?.vehicles || []).map((v) => <option key={v.plate} value={v.plate}>{v.plate} · {v.make} {v.model}</option>)}
              </select>
              <select className="input min-w-0 py-1.5 lg:w-[230px]" value={hub} onChange={(e) => setHub(e.target.value)} aria-label="Hub">
                <option value="">{(O.data?.branches.length || 0) > 1 ? "All hubs" : "My hub"}</option>
                {(O.data?.branches || []).map((b) => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}
              </select>
              {filtered && <button className="btn btn-sm justify-self-start" onClick={() => { setStatus(""); setPlate(""); setHub(""); }}><Icon name="close" size={13} />Clear filters</button>}
            </div>
          </section>

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
            <section className="card min-w-0 p-4 lg:p-5" aria-label="Agenda">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <h2 className="text-[18px] font-bold tracking-tight">{mode === "day" ? (selected === today ? "Today's agenda" : `Agenda · ${dayShort(selected)}`) : "The week, day by day"}</h2>
                  <p className="text-[13px] text-fg-3">{D ? `${live} appointment${live === 1 ? "" : "s"}${shown.length > live ? ` · ${shown.length - live} cancelled` : ""}${filtered ? " · filtered" : ""}${mode === "day" && selected === today ? ` · now ${D.now}` : ""}` : "Loading appointments…"}</p>
                </div>
                {L.loading && D && <span className="text-[12px] text-fg-4">Refreshing…</span>}
              </div>
              {!D ? <LoadingState label="Loading appointments…" rows={6} /> : view === "table" ? (
                shown.length ? <ApptTable items={shown} selectedId={openId} onOpen={open} /> : (
                  <NoAppointments label={mode === "day" ? dayShort(selected) : `${dayMonth(ws)} – ${dayMonth(addDays(ws, 6))}`}
                    why={filtered ? "Nothing matches these filters." : isSunday(selected) && mode === "day" ? "The hubs are closed on Sundays." : selected < today ? "Nothing was booked." : "Nothing is booked yet."}
                    action={filtered ? <button className="btn btn-sm" onClick={() => { setStatus(""); setPlate(""); setHub(""); }}>Clear filters</button>
                      : canWrite && selected >= today && !(isSunday(selected) && mode === "day") ? <button className="btn btn-sm" onClick={() => book()}><Icon name="plus" size={14} />Book a slot</button> : null} />
                )
              ) : (
                mode === "week" && !shown.length ? (
                  <NoAppointments label={`${dayMonth(ws)} – ${dayMonth(addDays(ws, 6))}`} why={filtered ? "Nothing matches these filters." : addDays(ws, 6) < today ? "Nothing was booked that week." : "Nothing is booked yet that week."}
                    action={filtered ? <button className="btn btn-sm" onClick={() => { setStatus(""); setPlate(""); setHub(""); }}>Clear filters</button>
                      : canWrite && addDays(ws, 6) >= today ? <button className="btn btn-sm" onClick={() => book(ws >= today ? ws : today)}><Icon name="plus" size={14} />Book a slot</button> : null} />
                ) : <Agenda mode={mode} selected={selected} today={today} now={D.now} items={shown} selectedId={openId} onOpen={open} onBook={canWrite ? (d) => book(d) : undefined} filtered={filtered} />
              )}
            </section>

            <aside className="hidden min-w-0 xl:sticky xl:top-4 xl:block">
              {wide && detail ? (
                <section className="card max-h-[calc(100vh-2rem)] overflow-y-auto p-5" aria-label="Appointment">
                  <ApptDetail a={detail} today={today} options={O.data} canWrite={canWrite} onChanged={onChanged} onClose={() => setOpenId(null)} />
                </section>
              ) : (
                <div className="flex flex-col gap-5">
                  <section className="card p-5" aria-label="Month">{monthCard}</section>
                  <section className="card p-5" aria-label="Next up">
                    <h2 className="mb-2 text-[16px] font-bold">Next up</h2>
                    {!D ? <LoadingState rows={3} /> : !upcoming.length ? <p className="text-[13px] text-fg-3">No upcoming appointments for this period.</p> : (
                      <ul className="flex flex-col gap-2">
                        {upcoming.map((a) => (
                          <li key={a.booking_id}>
                            <button onClick={() => { pick(a.date); open(a); }} className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition hover:bg-white">
                              <ApptPhoto plate={a.plate} vtype={a.vehicle.vtype} className="h-10 w-14 shrink-0 rounded-lg" />
                              <span className="min-w-0 flex-1 leading-tight"><b className="block text-[14px]">{a.plate}</b><span className="block whitespace-nowrap text-[12px] text-fg-3">{dayShort(a.date)} · {a.slot}</span><span className="block truncate text-[11.5px] text-fg-4">{a.branch_name}</span></span>
                              <StagePill stage={a.stage} className="shrink-0" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              )}
            </aside>
          </div>
        </>
      )}

      <Sheet open={!wide && !!detail} onClose={() => setOpenId(null)} label={detail ? `Appointment ${detail.plate}` : "Appointment"}>
        {detail && <ApptDetail a={detail} today={today} options={O.data} canWrite={canWrite} onChanged={onChanged} onClose={() => setOpenId(null)} />}
      </Sheet>
      <NewAppointment open={newOpen} onClose={() => setNewOpen(false)} options={O.data} today={today} initialDate={newDate} initialPlate={sp.get("plate")}
        onCreated={(a) => { setNewOpen(false); pick(a.date); setMode("day"); L.reload(); open(a); }} />
    </Shell>
  );
}

export default function Page() {
  return <Suspense><Appointments /></Suspense>;
}
