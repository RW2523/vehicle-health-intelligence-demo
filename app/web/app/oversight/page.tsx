"use client";
/* Oversight > Overview: the four oversight views as big tiles with their live numbers, the river stations on a live
   map, and the latest HQ exceptions. */
import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Panel, StatusPill, TONE, Tone } from "@/components/glass";
import { Icon } from "@/components/icons";
import { LiveBadge, LiveMap, MapPoint } from "@/components/LiveMap";
import { OV_TABS, OversightShell, ovHref } from "@/components/OversightShell";
import { ErrorState, LoadingState, SeverityBadge, Source } from "@/components/ui";
import { canOpen, useUser } from "@/lib/auth";
import { fmtN, pct } from "@/lib/format";
import { useClock, useFetch } from "@/lib/live";

const POLL_MS = 45_000;
const ST_COL: Record<string, string> = { danger: "#DC2626", warning: "#EA580C", alert: "#CA8A04", normal: "#059669", no_reading: "#94A3B8", no_thresholds: "#64748B" };
const ST_ORDER = ["no_thresholds", "no_reading", "normal", "alert", "warning", "danger"];
const EX_STATE: Record<string, { label: string; tone: Tone }> = { open: { label: "Open", tone: "red" }, acknowledged: { label: "Acknowledged", tone: "amber" }, actioned: { label: "Action recorded", tone: "green" } };

function Metric({ value, label, color }: { value: ReactNode; label: string; color?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white/70 px-3 py-2.5 ring-1 ring-ink-600/70">
      <div className="truncate text-[length:clamp(20px,5.6vw,28px)] font-extrabold leading-tight tracking-tight" style={{ color }}>{value}</div>
      <div className="text-[12px] leading-snug text-fg-3">{label}</div>
    </div>
  );
}

/** One oversight view: what it is for, two live numbers and where they come from. */
function AppTile({ href, icon, tone, title, sub, metrics, source, loading, error }: {
  href: string; icon: string; tone: Tone; title: string; sub: string; metrics: ReactNode; source: ReactNode; loading: boolean; error?: string | null;
}) {
  const t = TONE[tone];
  return (
    <Link href={href} className="group card relative flex min-w-0 flex-col overflow-hidden p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
      <span className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full opacity-60 blur-2xl" style={{ background: t.bg }} aria-hidden />
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${t.solid}, ${t.fg})` }} aria-hidden />
      <div className="relative flex items-start gap-3.5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl shadow-sm" style={{ background: `linear-gradient(145deg, ${t.solid}, ${t.fg})` }}>
          <Icon name={icon} size={26} color="#fff" width={2} />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-[18px] leading-tight tracking-tight">{title}</b>
          <span className="mt-0.5 block text-[13px] leading-snug text-fg-3">{sub}</span>
        </span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 text-fg-3 ring-1 ring-ink-600 transition group-hover:bg-blue-50 group-hover:text-cyan"><Icon name="arrow" size={16} /></span>
      </div>
      <div className="relative mt-4 grid grid-cols-2 gap-2.5">
        {error ? <div className="col-span-2 text-[12.5px] text-bad">Could not load: {error}</div> : loading ? <div className="col-span-2"><LoadingState label="Loading…" rows={2} /></div> : metrics}
      </div>
      <div className="relative mt-auto flex flex-wrap items-center gap-1.5 pt-4">{source}</div>
    </Link>
  );
}

export default function Overview() {
  const user = useUser();
  const role = user?.role;
  const can = (href: string) => !!user && canOpen(role, OV_TABS.find((t) => t.href === href)!.roles);
  const [poll, setPoll] = useState(0);
  const exc = useFetch<any>(can("/oversight/hq") ? "/api/hq/exceptions" : null);
  const ops = useFetch<any>(can("/oversight/hq") ? "/api/hq/ops" : null, undefined, [poll]);
  const reg = useFetch<any>(can("/oversight/regulator") ? "/api/regulator" : null);
  const sales = useFetch<any>(can("/oversight/sales") ? "/api/sales" : null);
  const fw = useFetch<any>(can("/oversight/flood") ? "/api/floodwatch" : null, undefined, [poll]);
  const st = useFetch<any>(can("/oversight/flood") ? "/api/floodwatch/stations" : null, undefined, [poll, fw.data?.source?.fetched_at]);
  const areas = useFetch<any>(can("/oversight/flood") ? "/api/floodwatch/areas" : null, { scope: "live" }, [fw.data?.source?.fetched_at]);
  const [polledAt, setPolledAt] = useState<Date | null>(null);
  const now = useClock();
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && setPoll((n) => n + 1), POLL_MS);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (st.data) setPolledAt(new Date());
  }, [st.data]);

  const X = exc.data;
  const openN = X ? X.items.filter((i: any) => i.state.status === "open").length : 0;
  const lanes: any[] = ops.data?.lanes || [];
  const running = lanes.filter((l) => l.status === "in_lane").length;
  const R = reg.data;
  const lastFail = R?.defects?.monthly?.at(-1);
  const S = sales.data;
  const F = fw.data;
  const atRisk = F ? (F.counts.warning || 0) + (F.counts.danger || 0) : 0;
  const A: any[] = areas.data?.items || [];

  const points = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    const items: any[] = st.data?.items || [];
    for (const k of ST_ORDER)
      for (const s of items) {
        if (s.status !== k || s.lat == null) continue;
        const risk = k === "danger" || k === "warning" || k === "alert";
        out.push({ id: s.id, layer: "stations", lat: s.lat, lon: s.lon, color: ST_COL[k], radius: k === "danger" ? 7 : k === "warning" ? 6 : k === "alert" ? 5.5 : 3,
          shape: k === "danger" || k === "warning" ? "pulse" : k === "no_thresholds" ? "ring" : "dot", faint: !risk, title: s.name,
          lines: [`${s.river} · ${s.district}, ${s.state}`, `${k.replace("_", " ")}${s.level != null ? ` · ${s.level.toFixed(2)} m` : ""}`] });
      }
    for (const a of A.filter((x) => x.level_exposure > 0 && x.lat != null))
      out.push({ id: `${a.state}|${a.district}`, layer: "districts", lat: a.lat, lon: a.lon, shape: "area", color: a.exposure >= 0.6 ? "#DC2626" : a.exposure >= 0.3 ? "#EA580C" : "#CA8A04",
        radius: 9 + Math.min(22, Math.sqrt(a.to_inspect) * 3), title: `${a.district}, ${a.state}`, lines: [`${a.to_inspect} vehicles to inspect`, ...(a.headline ? [a.headline] : [])] });
    return out;
  }, [st.data, A]);

  const date = now ? now.toLocaleDateString("en-GB", { timeZone: "Asia/Kuala_Lumpur", weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";
  const time = now ? now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" }) : "";
  const tiles = [
    can("/oversight/hq") && (
      <AppTile key="hq" href="/oversight/hq" icon="hq" tone="blue" title="HQ operations · Lanes" sub="Exceptions across every hub, lanes, examiner integrity, equipment and the audit."
        loading={!X && !ops.data} error={!X ? exc.error : null}
        metrics={<><Metric value={X ? openN : "…"} label="Open exceptions" color={openN ? "#DC2626" : "#059669"} /><Metric value={ops.data ? running : "…"} label={ops.data ? `Lanes running · ${lanes.length} used today` : "Lanes running"} /></>}
        source={<><Source kind="live_logic" text="Live inspections" /><Source kind="live_model" text="Exception models" /></>} />
    ),
    can("/oversight/regulator") && (
      <AppTile key="reg" href="/oversight/regulator" icon="regulator" tone="green" title="Regulator · Registrations" sub="National registrations, inspection fail rates, roadside emissions and EVs."
        loading={!R} error={!R ? reg.error : null}
        metrics={<><Metric value={R ? fmtN(R.registrations.total) : "…"} label="New registrations 2025" /><Metric value={pct(lastFail?.fail_rate, 1)} label="Fail rate, last month" color="#DC2626" /></>}
        source={<><Source kind="real" text="data.gov.my" /><Source kind="synthetic" text="Defects" /></>} />
    ),
    can("/oversight/sales") && (
      <AppTile key="sales" href="/oversight/sales" icon="sale" tone="purple" title="Used-vehicle sales" sub="Every listing with its whole record: inspections, odometer, claims, fault codes."
        loading={!S} error={!S ? sales.error : null}
        metrics={<><Metric value={S ? S.total : "…"} label={S ? `Listings · ${S.counts.car} cars, ${S.counts.motorcycle} motorcycles` : "Listings"} /><Metric value={S ? S.counts.flagged : "…"} label="With serious red flags" color="#DC2626" /></>}
        source={<Source kind="synthetic" text="Synthetic listings" />} />
    ),
    can("/oversight/flood") && (
      <AppTile key="flood" href="/oversight/flood" icon="flood" tone="sky" title="Flood watch" sub="River levels in every state, live, against the vehicles registered in each district."
        loading={!F} error={!F ? fw.error : null}
        metrics={<><Metric value={F ? atRisk : "…"} label={F ? `Stations at warning or danger · ${F.counts.danger} danger` : "Stations at warning or danger"} color={atRisk ? "#EA580C" : "#059669"} /><Metric value={F ? fmtN(F.live.to_inspect) : "…"} label="Vehicles at risk, to inspect" color="#2563EB" /></>}
        source={<><Source kind={F?.source?.mode === "live" ? "live_feed" : "real"} text={F?.source?.mode === "live" ? "JPS live" : "JPS snapshot"} /><Source kind="synthetic" text="Vehicles" /></>} />
    ),
  ].filter(Boolean);

  return (
    <OversightShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow mb-1.5">Oversight</div>
          <h1 className="text-[30px] font-extrabold leading-[1.08] tracking-tight sm:text-[40px] xl:text-[46px]">National oversight</h1>
          <p className="mt-2 max-w-[760px] text-[15px] text-fg-2 sm:text-[17px]">Every hub, every state, one view: operations exceptions, registrations, the used-vehicle market and flood risk, as it happens.</p>
        </div>
        <div className="card flex max-w-full items-center gap-3 px-4 py-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#1E3A8A] to-[#0F1E46]"><Icon name="globe" size={20} color="#BFDBFE" /></span>
          <div className="min-w-0 leading-tight">
            <div className="text-[15px] font-semibold">{date}</div>
            <div className="text-[12.5px] text-fg-3">{time} Malaysia time · {user ? `${tiles.length} views open to you` : "…"}</div>
          </div>
        </div>
      </div>

      <div className={`mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 ${tiles.length === 3 ? "xl:grid-cols-3" : "2xl:grid-cols-4"}`}>{tiles}</div>

      <div className={`grid grid-cols-1 gap-5 ${can("/oversight/flood") && can("/oversight/hq") ? "xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]" : ""}`}>
        {can("/oversight/flood") && (
          <Panel title="River levels now" sub={F ? `${F.total} JPS stations · ${F.counts.danger} danger, ${F.counts.warning} warning, ${F.counts.alert} alert` : "JPS water-level stations"}
            href="/oversight/flood" actionLabel="Open flood watch">
            <LiveMap compact label="River stations by status, live" points={points} className="h-[340px] sm:h-[400px]"
              legend={[{ label: "Danger", color: ST_COL.danger, shape: "pulse" }, { label: "Warning", color: ST_COL.warning, shape: "pulse" }, { label: "Alert", color: ST_COL.alert }, { label: "Normal", color: ST_COL.normal }, { label: "District at risk", color: "#EA580C", shape: "area" }]}
              overlay={<LiveBadge at={polledAt} live={F?.source?.mode === "live"} busy={st.loading} onRefresh={() => setPoll((n) => n + 1)} />} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {F && <Source kind={F.source.mode === "live" ? "live_feed" : "real"} text={F.source.mode === "live" ? `JPS Public InfoBanjir · ${F.source.fetched_at.slice(11, 16)}` : "Stored JPS snapshot"} />}
              {A.filter((a) => a.to_inspect > 0).slice(0, 4).map((a) => (
                <span key={a.state + a.district} className="pill bg-white/80 text-[12px] text-fg-2 ring-1 ring-ink-600">{a.district} <b className="ml-1 text-cyan">{a.to_inspect}</b></span>
              ))}
            </div>
          </Panel>
        )}
        {can("/oversight/hq") && (
          <Panel title="Recent HQ exceptions" sub={X ? `${openN} open of ${X.items.length}` : undefined} href="/oversight/hq" actionLabel="Open HQ operations">
            {exc.error && !X ? <ErrorState title="Exceptions could not be computed" onRetry={exc.reload}>{exc.error}</ErrorState> : !X ? <LoadingState label="Checking every hub for exceptions…" rows={4} /> : !X.items.length ? (
              <p className="text-[13.5px] text-fg-3">No exceptions: every hub is within its limits.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {X.items.slice(0, 5).map((x: any) => {
                  const s = EX_STATE[x.state.status] || EX_STATE.open;
                  return (
                    <li key={x.key}>
                      <Link href={ovHref(x.href)} className="flex gap-3 rounded-2xl bg-white/60 p-3 ring-1 ring-ink-600/70 transition hover:bg-white">
                        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.state.status !== "open" ? "#059669" : x.severity === "critical" ? "#DC2626" : "#D97706" }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <b className="block text-[13.5px] leading-snug">{x.title}</b>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-3"><SeverityBadge s={x.severity} /><StatusPill tone={s.tone}>{s.label}</StatusPill>{x.where}</span>
                        </span>
                        <Icon name="chev" size={16} color="#94A3B8" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </OversightShell>
  );
}
