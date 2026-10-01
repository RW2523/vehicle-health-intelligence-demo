"use client";
/* Mobile app · Vehicle: the Vehicle Health Passport. Overview (score, findings and advisories, health certificates),
   history (odometer, inspections, timeline, claims) and documents (registration, road tax, reports, receipts). */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { StatusPill, Tone } from "@/components/glass";
import { Icon } from "@/components/icons";
import { MobileShell, useMobileHref, useMobilePlate } from "@/components/MobileShell";
import { HealthBadge, MCard, MEmpty, MError, MList, MRow, MSkeleton, MTitle, Plate, RESULT_TONE, Segmented, Verdict, dayLabel, inDays, scoreCol } from "@/components/mobileKit";
import { BOOKING_STATUS, latestCheck, useBookings, usePassport, useProfile } from "@/components/mobileData";
import { MobileVehiclePhoto, useMobilePhotos } from "@/components/mobilePhoto";
import { Source } from "@/components/ui";
import { fmtN } from "@/lib/format";
import { useFetch } from "@/lib/live";

type Seg = "overview" | "history" | "documents";

function PassportCard({ p }: { p: any }) {
  const v = p.vehicle;
  const road = (p.reminders || []).find((r: any) => r.kind === "road_tax");
  const due = p.next_due;
  return (
    <section aria-label="Vehicle Health Passport" className="m-pop overflow-hidden rounded-[26px] bg-gradient-to-br from-[#0B2B5C] via-[#1D4ED8] to-[#3B82F6] text-white shadow-[0_24px_50px_-26px_rgba(30,58,138,0.9)]">
      <div className="relative px-4 pb-2 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="whitespace-nowrap text-[11.5px] font-semibold uppercase tracking-[0.12em] text-blue-100">Vehicle Health Passport</div>
            <div className="mt-1.5"><Plate plate={v.plate} size="lg" /></div>
            <div className="mt-2 text-[15px] font-bold">{v.make} {v.model} · {v.year}</div>
            <div className="text-[12.5px] text-blue-100">{fmtN(v.odometer_km)} km · {v.fuel === "ev" ? "electric" : v.fuel} · {v.state}</div>
          </div>
          {(p.health != null || p.latest?.result) && (
            <div className="shrink-0 rounded-full bg-white/95 p-1 shadow-lg">
              <HealthBadge health={p.health} latest={p.latest} size={78} stroke={8} track="#E2E8F0" />
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-white/15">
        <div className="bg-[#1E40AF]/40 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-100">Next inspection</div>
          <div className="text-[14.5px] font-bold">{due?.booked ? `Booked ${dayLabel(due.booked.date)}` : due ? dayLabel(due.date, true) : "–"}</div>
          <div className="text-[11.5px] text-blue-100">{due ? (due.booked ? "See your ticket in Book" : due.days < 0 ? `Overdue by ${-due.days} days` : inDays(due.days)) : ""}</div>
        </div>
        <div className="bg-[#1E40AF]/40 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-100">Road tax expires</div>
          <div className="text-[14.5px] font-bold">{road ? dayLabel(road.date, true) : "–"}</div>
          <div className={`text-[11.5px] ${road && road.days <= 30 ? "font-semibold text-amber-200" : "text-blue-100"}`}>{road ? (road.days < 0 ? "Expired" : `in ${road.days} days`) : "Not on record"}</div>
        </div>
      </div>
    </section>
  );
}

function Gallery({ plate, vtype }: { plate: string; vtype?: string }) {
  const photos = useMobilePhotos(plate);
  const all = [...(photos.hero ? [photos.hero] : []), ...photos.gallery.filter((g) => g.url !== photos.hero?.url)];
  if (!all.length) return null;
  return (
    <>
      <MTitle>Photos</MTitle>
      <div className="m-noscroll -mx-4 flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1" aria-label="Vehicle photos">
        {all.map((ph, i) => (
          <figure key={ph.url + i} className="w-[220px] shrink-0 snap-start overflow-hidden rounded-[20px] bg-white shadow-sm ring-1 ring-white">
            <MobileVehiclePhoto plate={plate} vtype={vtype} photo={ph} size="480" credit className="h-[132px] w-full" />
            <figcaption className="line-clamp-2 px-3 py-2 text-[11.5px] leading-snug text-slate-500">{ph.label || ph.view || "Photo"}{ph.representative ? " · photo of the model" : ""}</figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}

type Advisory = { tone: Tone; title: string; sub?: string; from: string };

function advisories(p: any, prof: any): Advisory[] {
  const out: Advisory[] = [];
  const rep = prof?.reports?.[0];
  for (const f of rep?.findings || [])
    out.push({ tone: /advisory/i.test(f) ? "amber" : rep.verdict === "PASS" ? "amber" : "red", title: f, from: `${rep.kind}, ${dayLabel(rep.created_at, true)}` });
  if (prof?.odometer?.rollback)
    out.push({ tone: "red", title: "Odometer reads less than an earlier record", sub: `Highest on record: ${fmtN(prof.odometer.max.km)} km on ${dayLabel(prof.odometer.max.date, true)}`, from: "Inspection history" });
  const sc = latestCheck(p.events);
  for (const it of (sc?.items || []).filter((x: any) => !x.ok))
    out.push({ tone: "amber", title: `${it.item}: ${it.value}`, sub: it.advice || undefined, from: `Your self-check, ${dayLabel(sc.date, true)}` });
  const lastInsp = [...(prof?.inspections || [])].pop();
  if (lastInsp?.fail_reasons?.length && !rep)
    for (const r of lastInsp.fail_reasons.slice(0, 3)) out.push({ tone: lastInsp.result === "FAIL" ? "red" : "amber", title: r, from: `${lastInsp.type}, ${dayLabel(lastInsp.date, true)}` });
  return out;
}

function Overview({ p, prof, href }: { p: any; prof: any; href: (path: string, q?: Record<string, string>) => string }) {
  const [all, setAll] = useState(false);
  const adv = advisories(p, prof);
  const certs = p.certificates || [];
  const shown = all ? certs : certs.slice(0, 5);
  return (
    <>
      <MTitle>Findings and advisories</MTitle>
      {adv.length ? (
        <MCard pad={false} className="divide-y divide-slate-100" label="Findings and advisories">
          {adv.map((a, i) => (
            <div key={i} className="flex gap-3 px-4 py-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: a.tone === "red" ? "#EF4444" : "#F59E0B" }} aria-hidden>!</span>
              <span className="min-w-0 leading-snug">
                <span className="block text-[14px] font-semibold">{a.title}</span>
                {a.sub && <span className="block text-[12.5px] text-slate-600">{a.sub}</span>}
                <span className="block text-[11.5px] text-slate-400">{a.from}</span>
              </span>
            </div>
          ))}
        </MCard>
      ) : (
        <MCard className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50"><Icon name="check" size={18} color="#059669" width={2.4} /></span><span className="text-[14px]">No open findings or advisories.</span></MCard>
      )}

      <MTitle>Health certificates · {certs.length}</MTitle>
      {!certs.length ? <MEmpty icon="award" title="No certificates yet" action={<Link className="text-[13.5px] font-semibold text-[#2563EB]" href={href("/mobile/book")}>Book an inspection</Link>}>A health certificate is issued after each inspection.</MEmpty> : (
        <MCard pad={false} className="divide-y divide-slate-100" label="Health certificates">
          {shown.map((c: any, i: number) => {
            const ring = c.score ?? (c.result === "PASS" ? 100 : c.result === "FAIL" ? 0 : 60);
            return (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] text-[14px] font-extrabold" title={c.score != null ? "Health score from the lane" : c.result}
                  style={{ borderColor: scoreCol(ring), color: "#0F172A" }}>{c.score ?? (c.result === "PASS" ? "✓" : c.result === "FAIL" ? "✕" : "!")}</span>
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="block text-[14px] font-semibold">{c.kind}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-slate-500">
                    <Verdict v={c.result} className="!px-2 !py-0.5 !text-[10.5px]" />
                    <span>{dayLabel(c.date, true)}</span>
                    {c.odometer_km != null && <span>{fmtN(c.odometer_km)} km</span>}
                  </span>
                </span>
                {c.verify_token && <a className="shrink-0 rounded-full bg-blue-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-[#1D4ED8]" href={`/verify/${c.verify_token}`}>Verify</a>}
              </div>
            );
          })}
          {certs.length > 5 && (
            <button className="w-full py-3 text-[13px] font-semibold text-[#2563EB]" onClick={() => setAll((x) => !x)}>{all ? "Show fewer" : `Show all ${certs.length}`}</button>
          )}
        </MCard>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5"><Source kind="live_model" text="Lane reports" /><Source kind="synthetic" text="Earlier inspections" /></div>

      <MTitle>Selling or buying?</MTitle>
      <MList>
        <MRow icon="sale" tone="amber" title="Marketplace" sub="Used cars and motorcycles, each with its whole inspection record" href={href("/mobile/sell")} />
        <MRow icon="award" tone="green" title="Prepare to sell" sub="An Ownership Transfer inspection gives buyers a report they can verify" href={href("/mobile/book", { type: "TRANSFER" })} />
      </MList>
    </>
  );
}

function OdometerChart({ points, now, nowDate }: { points: { date: string; km: number }[]; now: number; nowDate: string | null }) {
  const pts = [...points.map((p) => ({ ...p, now: false })), ...(nowDate ? [{ date: nowDate, km: now, now: true }] : [])].sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return null;
  const t = pts.map((p) => new Date(p.date).getTime());
  const t0 = Math.min(...t), t1 = Math.max(...t);
  const k1 = Math.max(...pts.map((p) => p.km)) * 1.08;
  const W = 320, H = 130, L = 8, R = 8, T = 12, B = 22;
  const x = (d: string) => L + ((new Date(d).getTime() - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (km: number) => T + (1 - km / k1) * (H - T - B);
  let max = 0;
  const marks = pts.map((p) => {
    const down = p.km < max - 1000;
    max = Math.max(max, p.km);
    return { ...p, down };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Odometer readings over time">
      <defs><linearGradient id="odo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3B82F6" stopOpacity=".25" /><stop offset="1" stopColor="#3B82F6" stopOpacity="0" /></linearGradient></defs>
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={L} x2={W - R} y1={T + f * (H - T - B)} y2={T + f * (H - T - B)} stroke="#E2E8F0" strokeDasharray="3 4" />)}
      <path d={`M${x(marks[0].date)},${H - B} ${marks.map((m) => `L${x(m.date)},${y(m.km)}`).join(" ")} L${x(marks[marks.length - 1].date)},${H - B} Z`} fill="url(#odo)" />
      <path d={marks.map((m, i) => `${i ? "L" : "M"}${x(m.date)},${y(m.km)}`).join(" ")} fill="none" stroke="#2563EB" strokeWidth="2.2" strokeLinejoin="round" />
      {marks.map((m, i) => <circle key={i} cx={x(m.date)} cy={y(m.km)} r={m.down ? 5 : 3.6} fill={m.down ? "#EF4444" : m.now ? "#fff" : "#2563EB"} stroke={m.down ? "#fff" : "#2563EB"} strokeWidth={m.now ? 2.2 : 1.5} />)}
      <text x={L} y={H - 6} fontSize="10" fill="#94A3B8">{new Date(t0).getFullYear()}</text>
      <text x={W - R} y={H - 6} fontSize="10" fill="#94A3B8" textAnchor="end">{nowDate ? "Now" : new Date(t1).getFullYear()}</text>
    </svg>
  );
}

const EVENT_ICON: Record<string, { icon: string; tone: Tone }> = {
  report: { icon: "doc", tone: "blue" }, inspection: { icon: "clipboard", tone: "purple" }, self_check: { icon: "camera", tone: "sky" },
  booking: { icon: "calendar", tone: "gray" }, claim: { icon: "warn", tone: "red" },
};

function History({ p, prof }: { p: any; prof: any }) {
  const [more, setMore] = useState(false);
  const branches = useFetch<any[]>("/api/branches");
  const hubName = (id: string) => (branches.data || []).find((b) => b.branch_id === id)?.name || (branches.data ? id : "");
  const v = p.vehicle;
  const road = (p.reminders || []).find((r: any) => r.kind === "road_tax");
  const today = p.next_due ? new Date(new Date(p.next_due.date + "T00:00:00").getTime() - p.next_due.days * 864e5).toISOString().slice(0, 10)
    : road ? new Date(new Date(road.date + "T00:00:00").getTime() - road.days * 864e5).toISOString().slice(0, 10) : null;
  const odo = prof?.odometer;
  const insp = [...(prof?.inspections || [])].reverse();
  const events = more ? p.events : p.events.slice(0, 8);
  return (
    <>
      <MTitle>Odometer</MTitle>
      <MCard label="Odometer">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[24px] font-extrabold tracking-tight">{fmtN(v.odometer_km)} <span className="text-[14px] font-semibold text-slate-400">km now</span></span>
          {odo && <StatusPill tone={odo.rollback ? "red" : "green"} dot>{odo.rollback ? "Rollback" : "Consistent"}</StatusPill>}
        </div>
        {odo ? <OdometerChart points={odo.points} now={v.odometer_km} nowDate={today} /> : <MSkeleton rows={1} h={110} />}
        <p className={`mt-1 text-[12.5px] ${odo?.rollback ? "font-semibold text-rose-700" : "text-emerald-700"}`}>
          {!odo ? "" : odo.rollback ? `It reads ${fmtN(odo.max.km - v.odometer_km)} km less than the ${fmtN(odo.max.km)} km recorded on ${dayLabel(odo.max.date, true)}.` : "The readings only go up."}
        </p>
        {odo?.points?.length > 0 && (
          <ol className="mt-2 flex flex-col gap-1 border-t border-slate-100 pt-2 text-[12.5px]">
            {[...odo.points].reverse().map((pt: any, i: number) => (
              <li key={i} className="flex justify-between gap-2"><span className="text-slate-500">{dayLabel(pt.date, true)}</span><b>{fmtN(pt.km)} km</b></li>
            ))}
          </ol>
        )}
      </MCard>

      <MTitle>Inspection history · {insp.length}</MTitle>
      {!prof ? <MSkeleton rows={2} /> : !insp.length ? <MEmpty icon="clipboard" title="No earlier inspections">Lane reports appear under Overview.</MEmpty> : (
        <MCard pad={false} className="divide-y divide-slate-100">
          {insp.map((i: any) => (
            <details key={i.id} className="group px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center gap-3">
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="block text-[14px] font-semibold">{i.type}</span>
                  <span className="block text-[12px] text-slate-500">{dayLabel(i.date, true)} · {fmtN(i.odometer_km)} km{hubName(i.branch_id) ? ` · ${hubName(i.branch_id)}` : ""}</span>
                </span>
                <Verdict v={i.result} />
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.2" className="transition group-open:rotate-90" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
              </summary>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                {[["Brakes", i.brake_efficiency_pct, "%"], ["Tyre tread", i.tyre_tread_min_mm, "mm"], ["Corrosion", i.corrosion, "/10"]].map(([l, val, u]) => (
                  <div key={l as string} className="rounded-xl bg-slate-50 px-2 py-1.5"><div className="text-[10.5px] text-slate-500">{l}</div><b className="text-[13px]">{val == null ? "–" : `${fmtN(val as number, 1)}${u}`}</b></div>
                ))}
              </div>
              {i.fail_reasons?.length > 0 && <p className="mt-2 text-[12.5px] text-rose-700">{i.result === "FAIL" ? "Failed on: " : "Noted: "}{i.fail_reasons.join("; ")}</p>}
            </details>
          ))}
        </MCard>
      )}

      <MTitle>Timeline</MTitle>
      <MCard pad={false} className="px-4 py-2">
        <ol className="relative">
          {events.map((e: any, i: number) => {
            const ic = EVENT_ICON[e.kind] || { icon: "info", tone: "gray" as Tone };
            return (
              <li key={i} className="relative flex gap-3 py-2.5">
                {i < events.length - 1 && <span className="absolute left-[17px] top-11 h-[calc(100%-36px)] w-px bg-slate-200" aria-hidden />}
                <span className="z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-slate-200"><Icon name={ic.icon} size={16} color={ic.tone === "red" ? "#DC2626" : "#2563EB"} /></span>
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="flex items-start justify-between gap-2"><b className="text-[13.5px]">{e.title}</b><span className="shrink-0 text-[11.5px] text-slate-400">{dayLabel(e.date, true)}</span></span>
                  <span className="block text-[12px] text-slate-500">
                    {e.kind === "inspection" && `${fmtN(e.odometer_km)} km${e.fail_reasons ? ` · ${e.fail_reasons}` : ""}`}
                    {e.kind === "self_check" && (e.items?.filter((x: any) => !x.ok).map((x: any) => x.item).join(", ") || "Nothing to fix")}
                    {e.kind === "claim" && `RM ${fmtN(e.amount_rm)}`}
                    {e.kind === "report" && <a className="font-semibold text-[#2563EB]" href={`/verify/${e.verify_token}`}>Verify report</a>}
                    {e.kind === "booking" && (BOOKING_STATUS[e.status]?.label || e.status)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {p.events.length > 8 && <button className="w-full border-t border-slate-100 py-3 text-[13px] font-semibold text-[#2563EB]" onClick={() => setMore((m) => !m)}>{more ? "Show fewer" : `Show all ${p.events.length}`}</button>}
      </MCard>

      {prof?.claims?.length > 0 && (
        <>
          <MTitle>Insurance claims</MTitle>
          <MList>
            {prof.claims.map((c: any, i: number) => (
              <MRow key={i} icon="warn" tone={/flood/.test(c.type) || c.total_loss ? "red" : "amber"} title={c.type.replace(/^./, (s: string) => s.toUpperCase())}
                sub={`${dayLabel(c.date, true)}${c.total_loss ? " · total loss" : ""}`} right={<b className="text-[13px]">RM {fmtN(c.amount_rm)}</b>} />
            ))}
          </MList>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5"><Source kind="synthetic" text="Inspection history and claims" /></div>
    </>
  );
}

function Documents({ p, plate }: { p: any; plate: string }) {
  const v = p.vehicle;
  const certs = p.certificates || [];
  const books = useBookings(plate);
  const road = (p.reminders || []).find((r: any) => r.kind === "road_tax");
  const paid = (books.data || []).filter((b) => b.payment_ref);
  return (
    <>
      <MTitle action={<Source kind="mock" text="Registry" />}>Registration</MTitle>
      <MCard label="Registration">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
          {[["Number plate", v.plate], ["Make and model", `${v.make} ${v.model}`], ["Year", v.year], ["Chassis no.", v.chassis_no], ["Engine no.", v.engine_no],
            ["Registered owner", v.owner_name || "Company"], ["State", v.state], ["Fuel", v.fuel === "ev" ? "Electric" : v.fuel]].map(([k, val]) => (
            <div key={k as string} className="contents"><dt className="text-slate-500">{k}</dt><dd className="min-w-0 break-words text-right font-semibold">{val ?? "–"}</dd></div>
          ))}
        </dl>
      </MCard>

      <MTitle>Road tax</MTitle>
      <MList>
        <MRow icon="receipt" tone={road && road.days <= 30 ? "amber" : "green"} title={road ? `Valid until ${dayLabel(road.date, true)}` : "Not on record"}
          sub={road ? (road.days < 0 ? "Expired: renew before driving" : `${road.days} days left · renewing needs a valid insurance cover note`) : undefined} />
      </MList>

      <MTitle>Reports and certificates · {certs.length}</MTitle>
      {!certs.length ? <MEmpty icon="doc" title="No reports or certificates yet">Each inspection adds its report here, with a link anyone can use to verify it.</MEmpty> : (
        <MList label="Reports and certificates">
          {certs.map((c: any, i: number) => (
            <MRow key={i} icon="doc" tone={RESULT_TONE[c.result] || "gray"} title={c.kind}
              sub={<span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1"><Verdict v={c.result} className="!px-2 !py-0.5 !text-[10.5px]" />
                <span>{dayLabel(c.date, true)}{c.score != null ? ` · health ${c.score}` : ""}{c.odometer_km != null ? ` · ${fmtN(c.odometer_km)} km` : ""}</span></span>}
              href={c.verify_token ? `/verify/${c.verify_token}` : undefined}
              label={c.verify_token ? `Verify the ${c.kind} of ${dayLabel(c.date, true)}` : undefined} />
          ))}
        </MList>
      )}

      <MTitle action={<Source kind="mock" text="Payment gateway" />}>Payment receipts</MTitle>
      {!books.data ? <MSkeleton rows={1} /> : !paid.length ? <MEmpty icon="wallet" title="No payments yet">Receipts of your booking payments appear here.</MEmpty> : (
        <MList>
          {paid.map((b) => (
            <MRow key={b.booking_id} icon="wallet" tone={b.status === "cancelled" ? "gray" : "blue"} title={`RM ${b.price_rm.toFixed(2)} · ${b.type_label}`}
              sub={`${b.payment_ref} · ${dayLabel(b.date, true)}${b.status === "cancelled" ? " · refunded" : ""}`} />
          ))}
        </MList>
      )}
    </>
  );
}

function VehicleScreen() {
  const sp = useSearchParams();
  const router = useRouter();
  const { plate } = useMobilePlate();
  const href = useMobileHref();
  const seg = (["overview", "history", "documents"].includes(sp.get("tab") || "") ? sp.get("tab") : "overview") as Seg;
  const pass = usePassport(plate);
  const prof = useProfile(plate);
  const p = pass.data;
  const setSeg = (s: Seg) => router.replace(href("/mobile/vehicle", { tab: s === "overview" ? null : s }), { scroll: false });
  const title = useMemo(() => (p ? `${p.vehicle.make} ${p.vehicle.model}` : "Vehicle"), [p]);
  return (
    <MobileShell tab="vehicle" title={title} scrollKey={plate || ""}>
      {pass.error && !p ? <MError onRetry={pass.reload}>The passport could not load. {pass.error}</MError> : !p ? <MSkeleton rows={4} h={110} /> : (
        <>
          <PassportCard p={p} />
          <Segmented label="Passport sections" className="mt-4" value={seg} onChange={setSeg}
            items={[{ id: "overview", label: "Overview" }, { id: "history", label: "History" }, { id: "documents", label: "Documents" }]} />
          {seg === "overview" && <><Gallery plate={p.vehicle.plate} vtype={p.vehicle.vtype} /><Overview p={p} prof={prof.data} href={href} /></>}
          {seg === "history" && <History p={p} prof={prof.data} />}
          {seg === "documents" && <Documents p={p} plate={p.vehicle.plate} />}
        </>
      )}
    </MobileShell>
  );
}

export default function Page() {
  return <Suspense><VehicleScreen /></Suspense>;
}
