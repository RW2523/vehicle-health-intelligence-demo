"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactNode, Suspense, use, useEffect, useRef, useState } from "react";
import { LineChart } from "@/components/charts";
import { IconTile, Panel, StatusPill, Tone } from "@/components/glass";
import { HealthTrends } from "@/components/HealthTrends";
import { Icon } from "@/components/icons";
import { ImageCard, ImageViewer, LibImage } from "@/components/ImageViewer";
import { PhotoCreditBadge } from "@/components/Photo";
import { Shell } from "@/components/Shell";
import { ErrorState, LoadingState, Modal, Source } from "@/components/ui";
import { VehicleImage } from "@/components/VehicleImage";
import { dmy, fmtN } from "@/lib/format";
import { useFetch } from "@/lib/live";

const RES: Record<string, Tone> = { PASS: "green", FAIL: "red", CONDITIONAL: "amber", REFERRED: "blue", PASS_ADVISORY: "amber" };
/** A result in the words the rest of the app uses ("Pass", "Fail", "Pass · advisory"). */
const RES_WORD: Record<string, string> = { PASS: "Pass", FAIL: "Fail", CONDITIONAL: "Conditional", REFERRED: "Referred", PASS_ADVISORY: "Pass · advisory" };
const resWord = (r?: string | null) => (r ? RES_WORD[r] || r : "–");
const FUEL: Record<string, string> = { ev: "EV", petrol: "Petrol", diesel: "Diesel", hybrid: "Hybrid" };
const fuelLabel = (f?: string | null) => (f ? FUEL[f.toLowerCase()] || f.replace(/^./, (c) => c.toUpperCase()) : "");

/** A row that scrolls sideways (tabs, the ten plates): the current item is brought into view, and a fade at an edge
 *  says there is more to scroll to. Only the row scrolls, never the page. */
function ScrollRow({ children, className = "", label, role, active }: { children: ReactNode; className?: string; label: string; role?: string; active: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  const measure = () => {
    const el = ref.current;
    if (el) setEdge({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(() => {
    const el = ref.current;
    const cur = el?.querySelector<HTMLElement>("[aria-selected='true'], [aria-current='page']");
    if (el && cur && el.scrollWidth > el.clientWidth) el.scrollLeft = cur.offsetLeft - (el.clientWidth - cur.offsetWidth) / 2;
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative min-w-0 max-w-full">
      <div ref={ref} onScroll={measure} role={role} aria-label={label} className={`relative flex max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>{children}</div>
      {edge.l && <span className="pointer-events-none absolute inset-y-0 left-0 w-10 rounded-l-full bg-gradient-to-r from-white via-white/80 to-white/0" aria-hidden />}
      {edge.r && <span className="pointer-events-none absolute inset-y-0 right-0 w-12 rounded-r-full bg-gradient-to-l from-white via-white/80 to-white/0" aria-hidden />}
    </div>
  );
}
const TODAY: Record<string, { label: string; tone: Tone }> = {
  completed: { label: "Inspected today", tone: "green" }, in_progress: { label: "On a lane now", tone: "amber" }, in_queue: { label: "Waiting at the hub", tone: "blue" },
  scheduled: { label: "Expected today", tone: "gray" },
};
const TABS = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "history", label: "Inspection history", icon: "history" },
  { id: "health", label: "Health trends", icon: "trend" },
  { id: "photos", label: "Photos", icon: "image" },
  { id: "claims", label: "Claims & bookings", icon: "doc" },
];

function Gallery({ p }: { p: any }) {
  const v = p.vehicle;
  const photos: any[] = [p.photos?.hero, ...(p.photos?.gallery || [])].filter(Boolean).filter((x: any, i: number, a: any[]) => a.findIndex((y) => y.url === x.url) === i);
  const [cur, setCur] = useState(0);
  const ph = photos[cur];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative aspect-[16/10] overflow-hidden rounded-3xl bg-gradient-to-b from-[#F1F5FB] to-[#DEE6F2]">
        <VehicleImage plate={v.plate} vtype={v.vtype} photo={ph} size="full" className="h-full w-full" />
        <span className="absolute bottom-3 left-3 rounded-lg bg-[#0F172A]/85 px-3 py-1 font-mono text-[15px] font-bold tracking-wider text-white">{v.plate}</span>
        {ph?.credit && <PhotoCreditBadge photo={ph} />}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((x: any, i: number) => (
            <button key={x.url} onClick={() => setCur(i)} aria-label={`Photo ${i + 1}: ${x.label || x.view || ""}`} aria-pressed={i === cur}
              className={`h-14 w-20 shrink-0 overflow-hidden rounded-xl ring-2 transition ${i === cur ? "ring-cyan" : "ring-transparent opacity-80 hover:opacity-100"}`}>
              <VehicleImage plate={v.plate} vtype={v.vtype} photo={x} size="480" className="h-full w-full" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Odometer({ p }: { p: any }) {
  const v = p.vehicle;
  const pts = p.odometer.points;
  return (
    <Panel title="Odometer" action={<Source kind="live_logic" text="Rollback check" />}>
      {pts.length >= 2 ? (
        <LineChart height={170} yFmt={(x) => `${Math.round(x / 1000)}k`} xLabels={pts.map((q: any, i: number) => ({ x: i, label: q.date.slice(0, 7) }))}
          series={[{ color: "#2563EB", dots: true, area: true, points: pts.map((q: any, i: number) => ({ x: i, y: q.km })) }]} />
      ) : <p className="text-[13.5px] text-fg-3">{pts.length ? `${fmtN(pts[0].km)} km on ${dmy(pts[0].date)}` : "No odometer readings on record."}</p>}
      <p className={`mt-2 text-[13px] ${p.odometer.rollback ? "font-semibold text-bad" : "text-ok"}`}>
        {p.odometer.rollback ? `Rollback: the register shows ${fmtN(v.odometer_km)} km, lower than ${fmtN(p.odometer.max.km)} km recorded on ${dmy(p.odometer.max.date)}.` : "The readings only go up."}
      </p>
    </Panel>
  );
}

const TRAIL = "flex shrink-0 flex-col items-end gap-1 text-right sm:w-[112px]";

function History({ p, compact = false }: { p: any; compact?: boolean }) {
  const hist = [...p.inspections].reverse();
  const today = p.today?.status === "completed" ? p.today : null;
  const n = p.inspections.length + p.reports.length + (today ? 1 : 0);
  return (
    <Panel title={`Inspection History (${n})`} action={<>{p.reports.length > 0 && <Source kind="live_model" text="Lane reports" />}<Source kind="synthetic" text="History" /></>}>
      <ol className="flex flex-col">
        {today && (
          <li className="flex items-center gap-3 border-b border-ink-600/50 py-3">
            <IconTile icon="clipboard" tone={RES[today.result] || "gray"} size={42} />
            <span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-[14px]">{today.inspection_type} · today</b>
              <span className="block truncate text-[12.5px] text-fg-3">Lane {today.lane} · {today.start_at}–{today.end_at}{today.issues?.length ? ` · ${today.issues.join("; ")}` : ""}</span></span>
            <span className={TRAIL}><StatusPill tone={RES[today.result] || "gray"}>{resWord(today.result)}</StatusPill></span>
          </li>
        )}
        {p.reports.map((r: any) => (
          <li key={r.report_id} className="flex items-center gap-3 border-b border-ink-600/50 py-3 last:border-0">
            <IconTile icon="award" tone={RES[r.verdict] || "gray"} size={42} />
            <span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-[14px]">{r.kind}</b><span className="block truncate text-[12.5px] text-fg-3">{dmy(r.issued_at || r.created_at)} · {r.synthetic ? "synthetic record" : "lane report"}{r.health != null ? ` · health ${r.health}` : ""}{r.findings?.length ? ` · ${r.findings.slice(0, 2).join("; ")}` : ""}</span></span>
            <span className={TRAIL}>
              <StatusPill tone={RES[r.verdict] || "gray"}>{resWord(r.verdict)}</StatusPill>
              <Link className="inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-cyan hover:underline" href={`/report?id=${r.report_id}`}>Report<Icon name="chev" size={13} /></Link>
            </span>
          </li>
        ))}
        {(compact ? hist.slice(0, 4) : hist).map((i: any) => (
          <li key={i.id} className="flex items-center gap-3 border-b border-ink-600/50 py-3 last:border-0">
            <IconTile icon="clipboard" tone={RES[i.result] || "gray"} size={42} />
            <span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-[14px]">{i.type}</b>
              <span className="block truncate text-[12.5px] text-fg-3">{dmy(i.date)} · {fmtN(i.odometer_km)} km{i.fail_reasons.length ? ` · failed on ${i.fail_reasons.join(", ").replaceAll("_", " ")}` : ""}</span>
              {!compact && (i.brake_efficiency_pct != null || i.tyre_tread_min_mm != null || i.corrosion != null) && (
                <span className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-fg-3">
                  {i.brake_efficiency_pct != null && <span>Brakes <b className="text-fg">{Math.round(i.brake_efficiency_pct)}%</b></span>}
                  {i.tyre_tread_min_mm != null && <span>Tread <b className="text-fg">{i.tyre_tread_min_mm} mm</b></span>}
                  {i.corrosion != null && <span>Corrosion <b className="text-fg">{i.corrosion}/10</b></span>}
                </span>
              )}
            </span>
            <span className={TRAIL}><StatusPill tone={RES[i.result] || "gray"}>{resWord(i.result)}</StatusPill></span>
          </li>
        ))}
        {!n && <p className="text-[13.5px] text-fg-3">No inspection on record for this vehicle.</p>}
      </ol>
    </Panel>
  );
}

/** A private vehicle has no telematics: its trends are the readings of its earlier inspections. */
function InspectionTrends({ p }: { p: any }) {
  const rows = p.inspections.filter((i: any) => i.brake_efficiency_pct != null || i.tyre_tread_min_mm != null);
  if (rows.length < 2) return <p className="card card-pad text-[13.5px] text-fg-3">Not enough earlier inspections to draw a trend for {p.vehicle.plate} yet.</p>;
  const chart = (key: string, label: string, unit: string, limit: number, color: string) => (
    <Panel title={label} action={<Source kind="synthetic" text="Earlier inspections" />}>
      <LineChart height={190} xLabels={rows.map((r: any, i: number) => ({ x: i, label: r.date.slice(0, 7) }))} yFmt={(x) => `${x.toFixed(key === "tyre_tread_min_mm" ? 1 : 0)}`}
        hlines={[{ y: limit, color: "#DC2626", label: `Limit ${limit} ${unit}` }]}
        series={[{ color, dots: true, area: true, points: rows.map((r: any, i: number) => ({ x: i, y: r[key] ?? limit })) }]} />
    </Panel>
  );
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {chart("brake_efficiency_pct", "Brake efficiency at each inspection (%)", "%", 50, "#2563EB")}
      {chart("tyre_tread_min_mm", "Worst tyre tread at each inspection (mm)", "mm", 1.6, "#7C3AED")}
      <p className="text-[12.5px] text-fg-3 xl:col-span-2">Private vehicles have no fleet telematics, so their trends are the measurements of their earlier inspections. Fleet vehicles add twelve months of readings and a forecast to the fail limit.</p>
    </div>
  );
}

function Profile({ plate }: { plate: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = TABS.some((t) => t.id === sp.get("tab")) ? sp.get("tab")! : "overview";
  const d = useFetch<any>(`/api/vehicles/${encodeURIComponent(plate)}/profile`);
  const list = useFetch<any>("/api/vehicles", { page_size: 50 });
  const [viewer, setViewer] = useState<number | null>(null);
  const [stock, setStock] = useState<any>(null);
  const p = d.data;
  const setTab = (t: string) => router.replace(`/vehicles/${encodeURIComponent(plate)}${t === "overview" ? "" : `?tab=${t}`}`, { scroll: false });
  const library: LibImage[] = p?.library || [];
  return (
    <Shell>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Link href="/vehicles" className="inline-flex items-center gap-1 text-[14px] text-fg-2 hover:text-cyan"><Icon name="back" size={16} />Vehicle Records</Link>
        <ScrollRow label="The ten vehicles" active={plate} className="gap-1.5 pb-1">
          {(list.data?.items || []).map((x: any) => (
            <Link key={x.plate} href={`/vehicles/${encodeURIComponent(x.plate)}${tab === "overview" ? "" : `?tab=${tab}`}`} aria-current={x.plate === plate ? "page" : undefined}
              className={`chip shrink-0 px-3 py-1.5 text-[12px] ${x.plate === plate ? "border-cyan bg-blue-50 font-semibold text-[#1D4ED8]" : "border-white/80 bg-white/70 text-fg-2 hover:bg-white"}`}>{x.plate}</Link>
          ))}
        </ScrollRow>
      </div>
      {d.error ? <ErrorState title="Vehicle not found">{d.error}</ErrorState> : !p ? <div className="card p-6"><LoadingState label={`Loading ${plate}…`} rows={6} /></div> : (() => {
        const v = p.vehicle;
        return (
          <>
            <section className="card mb-5 grid grid-cols-1 gap-6 p-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
              <Gallery p={p} />
              <div className="flex min-w-0 flex-col">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="eyebrow">Vehicle record</span>
                  {p.today && <StatusPill tone={TODAY[p.today.status].tone} dot>{TODAY[p.today.status].label} · {p.today.status === "completed" ? p.today.end_at : p.today.status === "in_progress" ? `lane ${p.today.lane}` : p.today.arrival_at}</StatusPill>}
                  {p.main?.session && <span className="pill bg-blue-50 text-[#1D4ED8]">Lane {p.main.lane.split("-L")[1]} replay</span>}
                </div>
                <h1 className="mt-1 text-[34px] font-extrabold leading-tight tracking-tight">{v.make} {v.model}</h1>
                <div className="text-[16px] text-fg-2">{v.plate} · {v.year} · {v.vtype} · {fuelLabel(v.fuel)}</div>
                {p.main?.story && <p className="mt-3 rounded-2xl bg-blue-50/70 px-4 py-3 text-[13.5px] leading-relaxed text-[#1E3A8A]">{p.main.story}</p>}
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[13.5px] sm:grid-cols-3">
                  <div><dt className="text-fg-3">Owner</dt><dd className="font-semibold">{v.owner_name || (p.fleet ? p.fleet.name : "Company")}</dd></div>
                  <div><dt className="text-fg-3">Odometer</dt><dd className="font-semibold">{fmtN(v.odometer_km)} km</dd></div>
                  <div><dt className="text-fg-3">Road tax until</dt><dd className="font-semibold">{dmy(v.mvl_expiry)}</dd></div>
                  <div><dt className="text-fg-3">Registered in</dt><dd className="font-semibold">{v.state || "–"}</dd></div>
                  <div><dt className="text-fg-3">Use</dt><dd className="font-semibold capitalize">{v.usage || "–"}</dd></div>
                  <div><dt className="text-fg-3">Paint</dt><dd className="font-semibold capitalize">{p.photos?.paint || "–"}</dd></div>
                  <div className="col-span-2 sm:col-span-3"><dt className="text-fg-3">Chassis no.</dt><dd className="break-all font-mono text-[12.5px]">{v.chassis_no}</dd></div>
                </dl>
                <div className="mt-auto flex flex-col gap-3 pt-5">
                  <div className="flex flex-wrap gap-2">
                    <Link className="btn btn-primary" href={`/appointments?new=1&plate=${encodeURIComponent(v.plate)}`}><Icon name="calendar" size={16} color="#fff" />Book appointment</Link>
                    <Link className="btn" href={`/assistant?plate=${encodeURIComponent(v.plate)}`}><Icon name="bot" size={16} />Ask the Chat Bot</Link>
                  </div>
                  <nav aria-label="Elsewhere in VehicleSense" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] font-semibold text-cyan">
                    {p.links.passport && <Link className="inline-flex items-center gap-1.5 hover:underline" href={p.links.passport}><Icon name="owner" size={15} />Owner&apos;s app</Link>}
                    {p.links.sale && <Link className="inline-flex items-center gap-1.5 hover:underline" href={p.links.sale}><Icon name="sale" size={15} />For sale</Link>}
                    <Link className="inline-flex items-center gap-1.5 hover:underline" href={p.links.flood}><Icon name="flood" size={15} />Flood risk</Link>
                  </nav>
                </div>
              </div>
            </section>
            <div className="mb-5">
              <ScrollRow role="tablist" label="Record" active={tab} className="gap-1.5 rounded-full border border-white/80 bg-white/70 p-1 shadow-glass">
                {TABS.filter((t) => t.id !== "photos" || library.length || p.photos?.hero).map((t) => (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                    className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[13.5px] font-semibold transition ${tab === t.id ? "bg-gradient-to-r from-[#3B82F6] to-[#1D4ED8] text-white shadow" : "text-fg-2 hover:bg-white"}`}>
                    <Icon name={t.icon} size={16} color={tab === t.id ? "#fff" : "#475569"} />{t.label}
                  </button>
                ))}
              </ScrollRow>
            </div>
            {tab === "overview" && (
              <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <History p={p} compact />
                <div className="flex min-w-0 flex-col gap-5">
                  <Odometer p={p} />
                  {library.length > 0 && (
                    <Panel title="Inspection images" action={<button className="text-[13px] font-semibold text-cyan" onClick={() => setTab("photos")}>All {library.length}</button>}>
                      <div className="grid grid-cols-2 gap-2">
                        {library.slice(0, 4).map((e, k) => <ImageCard key={e.id} e={e} compact onOpen={() => setViewer(k)} />)}
                      </div>
                    </Panel>
                  )}
                </div>
              </div>
            )}
            {tab === "history" && (
              <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <History p={p} />
                <Odometer p={p} />
              </div>
            )}
            {tab === "health" && (p.fleet_health ? <HealthTrends plate={v.plate} /> : <InspectionTrends p={p} />)}
            {tab === "photos" && (
              <div className="flex flex-col gap-5">
                {p.photos?.hero && (
                  <Panel title="Photos" action={<Source kind="sample" text="Stock photos · representative of the model" />}>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
                      {[p.photos.hero, ...(p.photos.gallery || [])].filter((x: any, i: number, a: any[]) => a.findIndex((y) => y.url === x.url) === i).map((x: any) => (
                        <button key={x.url} onClick={() => setStock(x)} className="group overflow-hidden rounded-2xl border border-white/80 bg-white/70 text-left shadow-glass">
                          <VehicleImage plate={v.plate} vtype={v.vtype} photo={x} size="960" className="aspect-[4/3] w-full transition group-hover:scale-[1.03]" />
                          <span className="block px-3 py-2 text-[12px]"><b className="block capitalize">{x.label || x.view}</b><span className="block truncate text-fg-3">{x.credit}</span></span>
                        </button>
                      ))}
                    </div>
                    <p className="mt-3 text-[12px] text-fg-3">Representative photos of the model, not this vehicle. Replace any of them with your own in Settings → Images.</p>
                  </Panel>
                )}
                {library.length > 0 && (
                  <Panel title="Inspection images" action={<Source kind="sample" text="Sample images · AI boxes pre-drawn" />}>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {library.map((e, k) => <ImageCard key={e.id} e={e} compact onOpen={() => setViewer(k)} />)}
                    </div>
                  </Panel>
                )}
              </div>
            )}
            {tab === "claims" && (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <Panel title="Insurance claims" action={<Source kind="synthetic" text="Insurer feed" />}>
                  {p.claims.length ? (
                    <ul className="flex flex-col gap-2 text-[13.5px]">
                      {p.claims.map((c: any, i: number) => (
                        <li key={i} className={`flex justify-between gap-2 rounded-xl px-3 py-2 ${c.type.includes("flood") ? "bg-red-50 font-semibold text-bad" : "bg-white/70"}`}>
                          <span className="capitalize">{c.type}{c.total_loss ? " · total loss" : ""}</span><span>RM {fmtN(c.amount_rm)} · {dmy(c.date)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-[13.5px] text-ok">No insurance claims on record.</p>}
                </Panel>
                <Panel title="Bookings" href={p.links.appointments} actionLabel="Appointments">
                  {p.bookings.length ? (
                    <ul className="flex flex-col gap-2 text-[13.5px]">
                      {p.bookings.map((b: any) => (
                        <li key={b.booking_id} className="flex flex-wrap justify-between gap-2 rounded-xl bg-white/70 px-3 py-2">
                          <span className="font-semibold">{b.type_label}</span><span className="text-fg-3">{dmy(b.date)} {b.slot} · {b.status.replace("_", " ")}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-[13px] text-fg-3">No bookings.</p>}
                </Panel>
              </div>
            )}
            <ImageViewer items={library} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
            <Modal open={!!stock} onClose={() => setStock(null)} title={stock ? `${v.plate} · ${stock.label || stock.view || "Photo"}` : ""}>
              {stock && (
                <div className="flex flex-col gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={stock.url} alt={`${v.make} ${v.model}`} className="max-h-[70vh] rounded-2xl" />
                  <a className="text-[12px] text-fg-3 hover:text-cyan" href={stock.page_url} target="_blank" rel="noreferrer">{stock.credit}{stock.license_url ? " · licence" : ""}</a>
                </div>
              )}
            </Modal>
          </>
        );
      })()}
    </Shell>
  );
}

export default function VehicleProfile({ params }: { params: Promise<{ plate: string }> }) {
  const { plate } = use(params);
  return <Suspense><Profile plate={decodeURIComponent(plate)} /></Suspense>;
}
