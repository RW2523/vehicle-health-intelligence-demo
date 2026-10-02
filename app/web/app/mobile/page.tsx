"use client";
/* Mobile app · Home: the owner's vehicle at a glance, the next booking, quick actions, the latest report and updates.
   The owner app's old addresses (/owner?tab=… → /mobile?tab=…) open the matching screen. */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { AccountSheet, MobileSheet, MobileShell, TAB_SCREEN, useMobileHref, useMobilePlate } from "@/components/MobileShell";
import { BTN, BarButton, HealthBadge, MCard, MError, MList, MRow, MSkeleton, MTitle, OwnerSource, Plate, Verdict, dayLabel, greeting, inDays } from "@/components/mobileKit";
import { Booking, BOOKING_STATUS, NEWS, Update, latestCheck, openBookings, ownerUpdates, useBookings, usePassport, useProfile } from "@/components/mobileData";
import { MobileVehiclePhoto, useMobilePhotos } from "@/components/mobilePhoto";
import { StatusPill } from "@/components/glass";
import { fmtN } from "@/lib/format";

function VehicleCard({ p, href }: { p: any; href: (path: string, q?: Record<string, string>) => string }) {
  const v = p.vehicle;
  const photos = useMobilePhotos(v.plate);
  const road = (p.reminders || []).find((r: any) => r.kind === "road_tax");
  const due = p.next_due;
  return (
    <Link href={href("/mobile/vehicle")} aria-label={`${v.plate} ${v.make} ${v.model}: open the health passport`}
      className="m-pop block overflow-hidden rounded-[26px] bg-white shadow-[0_24px_50px_-28px_rgba(30,58,138,0.55)] ring-1 ring-white transition active:scale-[.99]">
      <div className="relative h-[168px] overflow-hidden bg-gradient-to-br from-[#DBEAFE] via-[#EEF4FF] to-[#E0F2FE]">
        {photos.hero ? (
          <MobileVehiclePhoto plate={v.plate} vtype={v.vtype} photo={photos.hero} size="960" credit className="h-full w-full" />
        ) : (
          <div className="flex h-full items-end justify-center px-6 pb-3"><MobileVehiclePhoto plate={v.plate} vtype={v.vtype} className="h-[118px] w-full max-w-[300px]" /></div>
        )}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <Plate plate={v.plate} />
          <span className="rounded-full bg-white/85 px-2.5 py-1 text-[11.5px] font-semibold text-slate-700 shadow-sm backdrop-blur">{v.fuel === "ev" ? "Electric" : v.fuel === "diesel" ? "Diesel" : "Petrol"} · {v.vtype}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 px-4 pb-3 pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[19px] font-extrabold tracking-tight">{v.make} {v.model}</div>
          <div className="text-[12.5px] text-slate-500">{v.year} · {fmtN(v.odometer_km)} km · {v.state}</div>
        </div>
        <HealthBadge health={p.health} latest={p.latest} size={62} stroke={7} />
      </div>
      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        <div className="rounded-2xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Next inspection</div>
          <div className="mt-0.5 text-[14px] font-bold">{due?.booked ? dayLabel(due.booked.date) : due ? dayLabel(due.date) : "–"}</div>
          <div className={`text-[11.5px] ${due && !due.booked && due.days < 0 ? "font-semibold text-rose-600" : "text-slate-500"}`}>
            {due?.booked ? "Booked" : due ? (due.days < 0 ? `Overdue by ${-due.days} days` : inDays(due.days)) : ""}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Road tax</div>
          <div className="mt-0.5 text-[14px] font-bold">{road ? dayLabel(road.date) : "–"}</div>
          <div className={`text-[11.5px] ${road && road.days <= 30 ? "font-semibold text-amber-600" : "text-slate-500"}`}>{road ? (road.days < 0 ? "Expired" : `Expires ${inDays(road.days)}`) : "Not on record"}</div>
        </div>
      </div>
    </Link>
  );
}

function Ticket({ b, href }: { b: Booking; href: (path: string, q?: Record<string, string>) => string }) {
  const st = BOOKING_STATUS[b.status];
  return (
    <Link href={href("/mobile/book", { ticket: b.booking_id })} aria-label={`Your booking ${b.booking_id}: open the ticket`}
      className="relative flex overflow-hidden rounded-[22px] bg-gradient-to-br from-[#1E3A8A] via-[#1D4ED8] to-[#3B82F6] text-white shadow-[0_20px_40px_-24px_rgba(30,58,138,0.9)] active:scale-[.99]">
      <div className="min-w-0 flex-1 py-4 pl-4 pr-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-100">Your booking</span><StatusPill tone={st?.tone || "gray"} className="!py-0.5 !text-[10.5px]">{st?.label || b.status}</StatusPill></div>
        <div className="mt-1.5 whitespace-nowrap text-[19px] font-extrabold leading-tight min-[380px]:text-[22px]">{dayLabel(b.date)} · {b.slot}</div>
        <div className="truncate text-[13px] text-blue-100">{b.type_label}{b.gear ? " · Express" : ""}</div>
        <div className="mt-1 flex items-center gap-1.5 truncate text-[12.5px] text-blue-50"><Icon name="pin" size={14} color="#BFDBFE" />{b.branch_name}</div>
      </div>
      <div className="relative flex w-[84px] shrink-0 flex-col items-center justify-center gap-1 border-l border-dashed border-white/40 px-2">
        <span className="absolute -left-[9px] -top-[9px] h-[18px] w-[18px] rounded-full bg-[#EEF3FA]" aria-hidden />
        <span className="absolute -bottom-[9px] -left-[9px] h-[18px] w-[18px] rounded-full bg-[#EEF3FA]" aria-hidden />
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white"><Icon name="qr" size={30} color="#1E3A8A" width={1.8} /></span>
        <span className="text-[10.5px] font-semibold text-blue-100">Show ticket</span>
      </div>
    </Link>
  );
}

/** The owner's journey with a vehicle: check it, book, check in at the lane, the inspection, the passport, selling. */
const JOURNEY = [
  { label: "Self-check", icon: "camera" }, { label: "Book", icon: "calendar" }, { label: "Check-in", icon: "qr" },
  { label: "Inspection", icon: "clipboard" }, { label: "Passport", icon: "shield" }, { label: "Sell", icon: "sale" },
];
type Next = { at: number; title: string; sub: string; cta: string; to: string; ticket?: Booking };

/** Where this vehicle is on the journey, from its bookings, self-checks, reports and listing: the one next step. */
function nextStep(p: any, prof: any, books: Booking[] | null | undefined, href: (path: string, q?: Record<string, string>) => string): Next {
  const open = openBookings(books);
  const pending = open.find((b) => b.status === "pending_payment");
  const booked = open.find((b) => b.status === "confirmed");
  if (pending) return { at: 1, title: "Finish paying for your booking", sub: `${pending.type_label} · ${dayLabel(pending.date)} ${pending.slot} · ${pending.branch_name}`, cta: "Pay and get the check-in code", to: href("/mobile/book", { ticket: pending.booking_id }) };
  if (booked) return { at: 2, title: "", sub: "", cta: "", to: "", ticket: booked };
  const rep = p.latest?.source === "report" ? p.latest : null;
  // the vehicle's latest lane inspection: in the lane or with the examiner until its report is issued
  const lane = [...(prof?.live || [])].sort((x: any, y: any) => String(y.started_at).localeCompare(String(x.started_at)))[0];
  if (lane && lane.status !== "reported")
    return { at: 3, title: lane.status === "in_lane" ? "In the lane: the inspection is under way" : "The examiner is reviewing the results",
      sub: `${lane.inspection_type || "Inspection"}. The report appears in your passport as soon as the examiner signs it off.`, cta: "Open the passport", to: href("/mobile/vehicle") };
  const sc = latestCheck(p.events);
  // dates are days: on the day of a self-check, a report counts as newer only when the lane inspected the car that day
  const inspected = rep && (!sc || rep.date > sc.date || (lane?.status === "reported" && String(lane.started_at).slice(0, 10) >= sc.date));
  if (inspected) {
    const listing = (prof?.links?.sale || "").split("id=")[1];
    if (listing) return { at: 5, title: `Your ${p.vehicle.model} is listed for sale`, sub: "Buyers see its whole record and can verify the latest report themselves.", cta: "See your listing", to: href("/mobile/sell", { listing }) };
    return { at: 4, title: `${rep.kind}: ${rep.result === "PASS_ADVISORY" ? "PASS" : rep.result}`, sub: `Issued ${dayLabel(rep.date, true)}. It is in your passport, with a link anyone can use to verify it.`, cta: "Open the passport", to: href("/mobile/vehicle") };
  }
  if (sc && /Ready/.test(sc.title)) return { at: 1, title: "Ready for an inspection", sub: `Your self-check on ${dayLabel(sc.date, true)} found nothing to fix. Book a slot at a hub near you.`, cta: "Book an inspection", to: href("/mobile/book") };
  const fix = (sc?.items || []).filter((x: any) => !x.ok).map((x: any) => x.item);
  if (sc) return { at: 0, title: `Fix ${fix.length || "a few"} item${fix.length === 1 ? "" : "s"}, then check again`, sub: fix.length ? `${fix.join(", ")}: the self-check shows what to do.` : "The self-check shows what to do.", cta: "Open the self-check", to: href("/mobile/check") };
  return { at: 0, title: "Start with a self-check", sub: "Four quick checks with your phone show what to fix before the inspection.", cta: "Start the self-check", to: href("/mobile/check") };
}

/** The journey as six steps and the next one as the screen's main button (or the booking's ticket, when booked). */
function NextStep({ n, href }: { n: Next; href: (path: string, q?: Record<string, string>) => string }) {
  return (
    <MCard className="m-pop" label="Your next step">
      <ol className="flex items-center" aria-label={`Your inspection journey: step ${n.at + 1} of ${JOURNEY.length}, ${JOURNEY[n.at].label}`}>
        {JOURNEY.map((j, i) => (
          <li key={j.label} className="flex flex-1 items-center last:flex-none" aria-current={i === n.at ? "step" : undefined}>
            <span title={j.label} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${i < n.at ? "bg-emerald-500" : i === n.at ? "bg-[#2563EB] shadow-[0_0_0_4px_#DBEAFE]" : "bg-slate-100"}`}>
              {i < n.at ? <Icon name="check" size={14} color="#fff" width={3} /> : <Icon name={j.icon} size={15} color={i === n.at ? "#fff" : "#94A3B8"} width={2} />}
            </span>
            <span className="sr-only">{j.label}{i < n.at ? " (done)" : i === n.at ? " (now)" : ""}</span>
            {i < JOURNEY.length - 1 && <span className={`mx-1 h-[3px] min-w-[6px] flex-1 rounded-full ${i < n.at ? "bg-emerald-400" : "bg-slate-200"}`} aria-hidden />}
          </li>
        ))}
      </ol>
      <div className="mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-[#2563EB]">Next step · {JOURNEY[n.at].label}</div>
      {n.ticket ? <div className="mt-2"><Ticket b={n.ticket} href={href} /></div> : (
        <>
          <div className="mt-0.5 text-[16px] font-bold leading-snug">{n.title}</div>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-600">{n.sub}</p>
          <Link className={`${BTN} mt-3 w-full`} href={n.to}>{n.cta}<Icon name="arrow" size={17} color="#fff" /></Link>
        </>
      )}
    </MCard>
  );
}

const ACTIONS = [
  { path: "/mobile/check", label: "Self-check", icon: "camera", from: "#EDE9FE", to: "#F5F3FF", col: "#7C3AED" },
  { path: "/mobile/book", label: "Book", icon: "calendar", from: "#DBEAFE", to: "#EFF6FF", col: "#2563EB" },
  { path: "/mobile/vehicle", label: "Passport", icon: "shield", from: "#D1FAE5", to: "#ECFDF5", col: "#059669" },
  { path: "/mobile/sell", label: "Marketplace", icon: "sale", from: "#FEF3C7", to: "#FFFBEB", col: "#D97706" },
];

function UpdateRow({ u }: { u: Update }) {
  return <MRow icon={u.icon} tone={u.tone} title={u.title} sub={u.sub} href={u.href} />;
}

function Home() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user, plate } = useMobilePlate();
  const href = useMobileHref();
  const tab = sp.get("tab");
  // the owner app's old addresses: /mobile?tab=book&plate=… is the Book screen
  useEffect(() => {
    if (!tab) return;
    const q = new URLSearchParams();
    for (const k of ["plate", "listing"]) if (sp.get(k)) q.set(k, sp.get(k)!);
    const to = TAB_SCREEN[tab] || "/mobile";
    router.replace(q.toString() ? `${to}?${q}` : to);
  }, [tab, sp, router]);
  const pass = usePassport(tab ? null : plate);
  const prof = useProfile(tab ? null : plate);
  const books = useBookings(tab ? null : plate);
  const [sheet, setSheet] = useState<"" | "updates" | "account">("");
  const p = pass.data;
  const updates = ownerUpdates(p, prof.data, books.data, href);
  const urgent = updates.some((u) => u.tone === "red" || u.tone === "amber");
  const rep = prof.data?.reports?.[0];
  const cert = p?.certificates?.[0];
  const first = (p?.vehicle?.owner_name || user?.name || "").split(" ")[0];
  return (
    <MobileShell tab="home" scrollKey={plate || ""}
      actions={user && (
        <>
          <BarButton icon="bell" label={`Updates${urgent ? ", some need attention" : ""}`} dot={urgent} onClick={() => setSheet("updates")} />
          <button onClick={() => setSheet("account")} aria-label={`Account: ${user.name}`} className="rounded-full ring-2 ring-white active:scale-95">
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: "linear-gradient(135deg, #60A5FA, #1E3A8A)" }}>
              {(user.role === "owner" ? user.name : p?.vehicle?.owner_name || user.name).split(/\s+/).slice(0, 2).map((w: string) => w[0]).join("").toUpperCase()}
            </span>
          </button>
        </>
      )}>
      {tab ? <MSkeleton rows={3} h={120} /> : (
        <>
          <div className="mb-4 mt-1">
            <div className="text-[14px] font-medium text-slate-500">{greeting()}{first ? "," : ""}</div>
            <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">{first || "Welcome"}</h1>
          </div>
          {pass.error && !p ? <MError onRetry={pass.reload}>Your vehicle could not load. {pass.error}</MError> : !p ? <MSkeleton rows={1} h={300} label="Loading your vehicle…" /> : <VehicleCard p={p} href={href} />}

          {/* the one thing to do next (the booking's ticket while one is booked) */}
          {p && books.data && (prof.data || prof.error) ? <div className="mt-4"><NextStep n={nextStep(p, prof.data, books.data, href)} href={href} /></div>
            : p && books.error ? <div className="mt-4"><MError onRetry={books.reload}>Your bookings could not load, so the next step is not shown. {books.error}</MError></div>
            : p && <div className="mt-4"><MSkeleton rows={1} h={150} label="Working out your next step…" /></div>}

          <div className="mt-5 grid grid-cols-4 gap-2" role="navigation" aria-label="Quick actions">
            {ACTIONS.map((a) => (
              <Link key={a.path} href={href(a.path)} className="flex flex-col items-center gap-1.5 rounded-2xl py-1 active:scale-95">
                <span className="flex h-[54px] w-[54px] items-center justify-center rounded-[18px] shadow-[0_10px_20px_-14px_rgba(15,23,42,0.45)] ring-1 ring-white"
                  style={{ background: `linear-gradient(145deg, ${a.from}, ${a.to})` }}>
                  <Icon name={a.icon} size={24} color={a.col} width={1.9} />
                </span>
                <span className="text-[12px] font-semibold text-slate-700">{a.label}</span>
              </Link>
            ))}
          </div>

          <MTitle href={href("/mobile/vehicle")} action="Passport">Latest report</MTitle>
          {!p ? <MSkeleton rows={1} h={120} label="Loading your latest report…" /> : rep ? (
            <MCard>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="line-clamp-2 text-[15px] font-bold leading-snug">{rep.kind}</div>
                  <div className="text-[12.5px] text-slate-500">{dayLabel(rep.created_at, true)}{rep.health != null ? ` · health ${rep.health}/100` : ""}</div>
                </div>
                <Verdict v={rep.verdict} />
              </div>
              {rep.findings?.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {rep.findings.slice(0, 3).map((f: string) => (
                    <li key={f} className="flex items-start gap-2 text-[13px] leading-snug"><span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />{f}</li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-[13px] text-slate-600">No findings: every check was within its limit.</p>}
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <OwnerSource kind="live_model" text="Lane report" />
                <a href={`/verify/${rep.verify_token}`} className="-my-2.5 flex shrink-0 items-center gap-1 whitespace-nowrap py-2.5 pl-3 text-[13px] font-semibold text-[#2563EB]"><Icon name="shield" size={15} />Verify report</a>
              </div>
            </MCard>
          ) : cert ? (
            <MCard>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="line-clamp-2 text-[15px] font-bold leading-snug">{cert.kind}</div><div className="text-[12.5px] text-slate-500">{dayLabel(cert.date, true)}{cert.odometer_km != null ? ` · ${fmtN(cert.odometer_km)} km` : ""}</div></div>
                <Verdict v={cert.result} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <OwnerSource kind="synthetic" text="Inspection history" />
                {cert.verify_token && <a href={`/verify/${cert.verify_token}`} className="-my-2.5 shrink-0 whitespace-nowrap py-2.5 pl-3 text-[13px] font-semibold text-[#2563EB]">Verify report</a>}
              </div>
            </MCard>
          ) : <MCard><p className="text-[13.5px] text-slate-600">No inspection on record yet. Book one to get a health certificate buyers can verify.</p></MCard>}

          <MTitle action={updates.length > 3 ? <button className="-my-2.5 py-2.5 pl-3 text-[13px] font-semibold text-[#2563EB]" onClick={() => setSheet("updates")}>See all</button> : undefined}>Updates</MTitle>
          {!p ? <MSkeleton rows={2} label="Loading your updates…" /> : updates.length ? <MList label="Updates">{updates.slice(0, 3).map((u) => <UpdateRow key={u.id} u={u} />)}</MList>
            : <MCard><p className="text-[13.5px] text-slate-600">Nothing needs your attention.</p></MCard>}

          <MTitle action={<OwnerSource kind="sample" />}>News</MTitle>
          <div className="m-noscroll -mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1">
            {NEWS.map((n) => (
              <Link key={n.id} href={href(n.href || "/mobile/assistant")} className="w-[240px] shrink-0 snap-start rounded-[22px] bg-white/85 p-4 shadow-[0_12px_30px_-20px_rgba(15,23,42,0.35)] ring-1 ring-white active:scale-[.99]">
                <Icon name={n.icon} size={22} color="#2563EB" />
                <div className="mt-2 text-[14.5px] font-bold">{n.title}</div>
                <p className="mt-1 text-[12.5px] leading-snug text-slate-500">{n.sub}</p>
              </Link>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-1.5">
            <OwnerSource kind="synthetic" text="Fictional vehicle and owner" />
            <OwnerSource kind="live_logic" text="Due dates and reminders" />
          </div>
        </>
      )}
      <MobileSheet open={sheet === "updates"} onClose={() => setSheet("")} title="Updates">
        {updates.length ? <div className="-mx-4 divide-y divide-slate-100">{updates.map((u) => <UpdateRow key={u.id} u={u} />)}</div>
          : <p className="text-[13.5px] text-slate-600">Nothing needs your attention.</p>}
        <div className="mb-1 mt-4 text-[12px] font-semibold uppercase tracking-wide text-slate-500">News</div>
        <div className="-mx-4 divide-y divide-slate-100">{NEWS.map((u) => <UpdateRow key={u.id} u={{ ...u, href: href(u.href || "/mobile/assistant") }} />)}</div>
      </MobileSheet>
      {user && <AccountSheet open={sheet === "account"} onClose={() => setSheet("")} user={user} plate={plate} />}
    </MobileShell>
  );
}

export default function Page() {
  return <Suspense><Home /></Suspense>;
}
