"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useActiveUseCase } from "@/components/Demo";
import { StatCard, StatusPill, Tone } from "@/components/glass";
import { Icon } from "@/components/icons";
import { Shell } from "@/components/Shell";
import { Empty, LoadingState, PageHeader, Source } from "@/components/ui";
import { VehicleImage } from "@/components/VehicleImage";
import { dmy, fmtN, riskColor } from "@/lib/format";
import { useFetch } from "@/lib/live";

const RES: Record<string, Tone> = { PASS: "green", FAIL: "red", CONDITIONAL: "amber", REFERRED: "blue" };
const TODAY: Record<string, { label: string; tone: Tone }> = {
  completed: { label: "Inspected today", tone: "green" }, in_progress: { label: "On a lane now", tone: "amber" },
  in_queue: { label: "Waiting", tone: "blue" }, scheduled: { label: "Expected today", tone: "gray" },
};
const SEGMENTS = [
  { id: "all", label: "All vehicles" },
  { id: "lane", label: "Lane replays" },
  { id: "fleet", label: "Fleet" },
  { id: "private", label: "Private" },
  { id: "attention", label: "Needs attention" },
];

const needsAttention = (v: any) => v.latest?.result === "FAIL" || v.today?.result === "FAIL" || v.health?.risk === "High";

/** The fleet vehicles' health at a glance: risk, the soonest to reach a fail limit, and FLEET07's next-inspection risk. */
function FleetHealth({ items }: { items: any[] }) {
  const ov = useFetch<any>("/api/fleet/overview", { fleet_id: "FLEET07" });
  const fleet = items.filter((v) => v.health);
  const soon = [...fleet].sort((a, b) => (parseFloat(a.health.weeks_label.replace(/[^0-9.]/g, "")) || 999) - (parseFloat(b.health.weeks_label.replace(/[^0-9.]/g, "")) || 999))[0];
  const np = ov.data?.next_periodic;
  const truck = np?.vehicles?.find((x: any) => items.some((v) => v.plate === x.plate));
  return (
    <section className="card mb-5 grid grid-cols-1 gap-4 p-5 md:grid-cols-3" aria-label="Fleet health">
      <div className="min-w-0">
        <div className="eyebrow mb-1">Fleet health</div>
        <b className="text-[22px]">{fleet.filter((v) => v.health.risk === "High").length} high-risk trends</b>
        <p className="text-[13px] text-fg-3">of {fleet.length} fleet vehicles; their readings come from fleet telematics and earlier inspections.</p>
      </div>
      {soon && (
        <Link href={`/vehicles/${encodeURIComponent(soon.plate)}?tab=health`} className="min-w-0 rounded-2xl bg-white/70 p-3 ring-1 ring-ink-600/60 hover:ring-blue-200">
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-4">First to reach a fail limit</div>
          <b className="block text-[16px]">{soon.plate} · {soon.health.weeks_label}</b>
          <span className="block truncate text-[12.5px] text-fg-3">{soon.health.metric} · {soon.make} {soon.model}</span>
        </Link>
      )}
      {truck && (
        <Link href={`/vehicles/${encodeURIComponent(truck.plate)}?tab=health`} className="min-w-0 rounded-2xl bg-white/70 p-3 ring-1 ring-ink-600/60 hover:ring-blue-200">
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-fg-4">{np.fleet_id} · next periodic inspection: fail risk</div>
          <b className="block text-[16px]" style={{ color: truck.p_fail_next >= np.threshold ? "#DC2626" : "#047857" }}>{truck.plate} · {Math.round(truck.p_fail_next * 100)}%</b>
          <span className="block truncate text-[12.5px] text-fg-3">due {dmy(truck.next_due)} · {np.model.split(" (")[0]}</span>
        </Link>
      )}
    </section>
  );
}

function Records() {
  const sp = useSearchParams();
  const router = useRouter();
  const d = useFetch<any>("/api/vehicles", { page_size: 50 });
  const { active: uc } = useActiveUseCase();
  const [q, setQ] = useState("");
  const seg = sp.get("view") || (sp.get("fleet") ? "fleet" : "all");
  const items: any[] = d.data?.items || [];
  const shown = useMemo(() => items.filter((v) => {
    if (seg === "lane" && !v.session) return false;
    if (seg === "fleet" && !v.fleet_id) return false;
    if (seg === "private" && v.fleet_id) return false;
    if (seg === "attention" && !needsAttention(v)) return false;
    const s = q.trim().toLowerCase();
    return !s || `${v.plate} ${v.make} ${v.model} ${v.owner} ${v.vtype}`.toLowerCase().includes(s);
  }), [items, seg, q]);
  const ucCar = uc && items.find((v) => v.plate === uc.plate);
  const today = items.filter((v) => v.today);
  return (
    <Shell>
      <PageHeader eyebrow="Vehicle Records" title="Vehicle Records" sub="The ten vehicles at the Central Inspection Hub: each one's inspections, health trends, photos, claims and bookings."
        actions={<Source kind="synthetic" text="Fictional vehicles · stock photos" />} />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard icon="car" tone="blue" label="Vehicles" value={d.data ? String(items.length) : "…"} sub={`${items.filter((v) => v.fleet_id).length} fleet · ${items.filter((v) => !v.fleet_id).length} private`} />
        <StatCard icon="checkc" tone="green" label="Inspected today" value={d.data ? String(today.filter((v) => v.today.status === "completed").length) : "…"} sub={`${today.length} at the hub today`} />
        <StatCard icon="lane" tone="amber" label="On a lane now" value={d.data ? String(today.filter((v) => v.today.status === "in_progress").length) : "…"} sub="live and scheduled" />
        <StatCard icon="warn" tone="red" label="Needs attention" value={d.data ? String(items.filter(needsAttention).length) : "…"} sub="a fail or a high-risk trend" />
      </div>
      {ucCar && (
        <section className="card mb-5 flex flex-wrap items-center gap-4 border-blue-100 bg-gradient-to-r from-blue-50/90 to-white/80 p-4" aria-label={`${uc.id} vehicle`}>
          <VehicleImage plate={ucCar.plate} vtype={ucCar.vtype} photo={ucCar.photo} size="480" className="h-[64px] w-[104px] rounded-2xl" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="eyebrow">{uc.id} vehicle</div>
            <b className="text-[17px]">{ucCar.plate} · {ucCar.make} {ucCar.model}</b>
            <div className="text-[13px] text-fg-3">{ucCar.health ? `${ucCar.health.metric}: ${ucCar.health.weeks_label} to the fail limit` : ucCar.story}</div>
          </div>
          <Link className="btn btn-primary" href={`/vehicles/${encodeURIComponent(ucCar.plate)}?tab=${ucCar.health ? "health" : "overview"}`}>Open its history<Icon name="arrow" size={15} /></Link>
        </section>
      )}
      {(seg === "fleet" || seg === "attention") && items.length > 0 && <FleetHealth items={items} />}
      <section className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex max-w-full gap-1.5 overflow-x-auto rounded-full border border-white/80 bg-white/70 p-1 shadow-glass" role="tablist" aria-label="Show">
          {SEGMENTS.map((s) => (
            <button key={s.id} role="tab" aria-selected={seg === s.id} onClick={() => router.replace(s.id === "all" ? "/vehicles" : `/vehicles?view=${s.id}`, { scroll: false })}
              className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold transition ${seg === s.id ? "bg-gradient-to-r from-[#3B82F6] to-[#1D4ED8] text-white shadow" : "text-fg-2 hover:bg-white"}`}>
              {s.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex w-full items-center gap-2 rounded-full border border-white/80 bg-white/80 px-4 py-2.5 shadow-glass sm:w-[300px]">
          <Icon name="search" size={16} color="#64748B" />
          <input className="w-full bg-transparent text-[13.5px] focus:outline-none" placeholder="Plate, model or owner" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter the vehicles" />
        </label>
      </section>
      {!d.data ? <div className="card p-6"><LoadingState label="Loading the vehicles…" rows={6} /></div> : !shown.length ? (
        <Empty title="No vehicle matches" actions={<button className="btn" onClick={() => { setQ(""); router.replace("/vehicles"); }}>Show all ten</button>}>Try another filter.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {shown.map((v) => (
            <Link key={v.plate} href={`/vehicles/${encodeURIComponent(v.plate)}`} aria-label={`${v.plate}, ${v.make} ${v.model}`}
              className="card group flex flex-col overflow-hidden p-0 transition hover:-translate-y-1 hover:shadow-float">
              <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-b from-[#F1F5FB] to-[#DEE6F2]">
                <VehicleImage plate={v.plate} vtype={v.vtype} photo={v.photo} className="h-full w-full transition duration-500 group-hover:scale-[1.04]" />
                <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                  {v.today && <StatusPill tone={TODAY[v.today.status].tone} dot>{TODAY[v.today.status].label}</StatusPill>}
                  {v.session && <span className="pill bg-white/90 text-[11.5px] text-fg-2 backdrop-blur">Lane {v.lane?.split("-L")[1]} replay</span>}
                </div>
                <span className="absolute bottom-3 left-3 rounded-lg bg-[#0F172A]/85 px-2.5 py-1 font-mono text-[13px] font-bold tracking-wider text-white">{v.plate}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 leading-tight">
                    <b className="block truncate text-[16px]">{v.make} {v.model}</b>
                    <span className="block truncate text-[12.5px] text-fg-3">{v.year} · {v.vtype} · {v.fuel} · {v.owner}</span>
                  </div>
                  {v.latest ? <StatusPill tone={RES[v.latest.result] || "gray"}>{v.latest.result}</StatusPill> : <StatusPill tone="gray">New</StatusPill>}
                </div>
                <p className="line-clamp-2 text-[12.5px] leading-snug text-fg-2">{v.story}</p>
                {v.health && (
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12px]" style={{ background: riskColor(v.health.risk) + "14", color: riskColor(v.health.risk) }}>
                    <Icon name="trend" size={15} color={riskColor(v.health.risk)} />
                    <span className="min-w-0 truncate"><b>{v.health.metric}</b> · {v.health.weeks_label} to the limit</span>
                  </div>
                )}
                <div className="mt-auto flex items-center justify-between border-t border-ink-600/60 pt-2.5 text-[12px] text-fg-3">
                  <span>{fmtN(v.odometer_km)} km · {v.inspections} inspection{v.inspections === 1 ? "" : "s"}</span>
                  <span>{v.latest ? (v.latest.source === "today" ? "today" : dmy(v.latest.date)) : "–"}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}

export default function Page() {
  return <Suspense><Records /></Suspense>;
}
