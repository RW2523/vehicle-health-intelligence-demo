"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Donut, LineChart, Spark } from "@/components/charts";
import { Icon } from "@/components/icons";
import { Shell } from "@/components/Shell";
import { PageHeader, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { dmy, monthLabel, pct, riskColor } from "@/lib/format";
import { useFetch } from "@/lib/live";

const TYPE_COL: Record<string, string> = { Sedan: "#3B82F6", MPV: "#10B981", Van: "#F59E0B", Pickup: "#8B5CF6", Hatchback: "#94A3B8", Lorry: "#EC4899", "Prime mover": "#F43F5E", Bus: "#14B8A6", SUV: "#A3E635" };

function Select({ label, value, options, onChange }: { label: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="card flex flex-col gap-1 px-4 py-2.5">
      <span className="text-[12px] text-fg-3">{label}</span>
      <select aria-label={label} className="input py-1.5" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

function FleetOverview() {
  const sp = useSearchParams();
  const router = useRouter();
  const fleet = sp.get("fleet") || "";
  const vtype = sp.get("type") || "";
  const branch = sp.get("branch") || "";
  const months = Number(sp.get("months") || 12);
  const q = (patch: Record<string, string>) => {
    const u = new URLSearchParams(sp.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? u.set(k, v) : u.delete(k)));
    router.replace(`/fleet?${u.toString()}`);
  };
  const { data: o, reload } = useFetch<any>("/api/fleet/overview", { fleet_id: fleet, vtype, branch_id: branch, months });
  const branches = useFetch<any[]>("/api/branches");
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState(10);
  const [rf, setRf] = useState("all");
  const nSel = Object.values(sel).filter(Boolean).length;
  const book = async () => {
    const plates = Object.keys(sel).filter((k) => sel[k]);
    const res = await api.post("/api/fleet/bookings", { plates });
    toast(`${res.filter((b: any) => b.status).length} inspection(s) booked before each forecast fail date`, "ok");
    setSel({});
    reload();
  };
  const exportCsv = () => {
    if (!o) return;
    const rows = [["plate", "model", "operator", "issue", "pattern", "risk", "time_to_limit", "forecast_date"], ...o.attention.map((r: any) => [r.plate, `${r.make} ${r.model}`, r.operator, r.issue?.name, r.issue?.pattern, r.issue?.risk, r.issue?.weeks_label, r.issue?.date])];
    const blob = new Blob([rows.map((r) => r.map((x: any) => `"${x ?? ""}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fleet_attention_list.csv";
    a.click();
  };
  const att = (o?.attention || []).filter((r: any) =>
    rf === "all" ? true : rf === "acc" ? ["Accelerating", "Spike, then faster rise"].includes(r.issue?.pattern) : rf === "photo" ? r.evidence?.length > 0 : r.issue?.risk === rf);
  const fleetBranches = new Set((o?.fleets || []).map((f: any) => f.branch_id));
  return (
    <Shell context={<span className="chip hidden border-ink-500 text-fg-2 xl:inline-flex">Fleet manager view</span>}>
      <PageHeader title="Fleet intelligence" sub="Each operator's vehicles: health, emerging problems and when each one will reach its fail limit, so it is fixed before the test."
        actions={<><Source kind="synthetic" text="Synthetic fleets" /><button className="btn" onClick={exportCsv} disabled={!o}>Export CSV</button></>} />
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <Select label="Operator" value={fleet} onChange={(v) => q({ fleet: v })} options={[{ v: "", l: "All operators" }, ...(o?.fleets || []).map((f: any) => ({ v: f.fleet_id, l: f.name }))]} />
        <Select label="Vehicle type" value={vtype} onChange={(v) => q({ type: v })} options={[{ v: "", l: "All vehicle types" }, ...Object.keys(TYPE_COL).map((t) => ({ v: t, l: t }))]} />
        <Select label="Branch" value={branch} onChange={(v) => q({ branch: v })} options={[{ v: "", l: "All branches" }, ...(branches.data || []).filter((b) => fleetBranches.has(b.branch_id)).map((b) => ({ v: b.branch_id, l: b.name }))]} />
        <Select label="Date range" value={String(months)} onChange={(v) => q({ months: v })} options={[{ v: "12", l: "Last 12 months" }, { v: "6", l: "Last 6 months" }, { v: "3", l: "Last 3 months" }]} />
      </div>
      {!o ? <p className="text-fg-3">Loading fleet analysis…</p> : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              { t: "Fleet health", v: `${o.kpis.health}%`, d: `${o.kpis.health_delta >= 0 ? "▲ +" : "▼ "}${o.kpis.health_delta}%`, dc: o.kpis.health_delta >= 0 ? "#34D399" : "#F87171", sub: `${o.kpis.good} / ${o.total} vehicles in good condition`, c: "#10B981" },
              { t: "Emerging alerts", v: o.kpis.alerts, d: `▲ +${o.kpis.alerts_new}`, dc: "#F87171", sub: `${o.kpis.high_risk} high risk · need attention soon`, c: "#EF4444" },
              { t: "Avoided re-inspections", v: o.kpis.avoided, d: `+${o.kpis.avoided_from_app} from this portal`, dc: "#34D399", sub: "Fixed early, before a failed test", c: "#10B981" },
              { t: "Accelerating degradation", v: o.kpis.accelerating, d: "wear rate rising", dc: "#F87171", sub: "Monitor closely", c: "#EF4444" },
            ].map((k) => (
              <div key={k.t} className="card p-4" style={{ borderColor: k.c + "55", background: `linear-gradient(135deg, ${k.c}1A, #0F1A2E 60%)` }}>
                <div className="text-[15px] font-semibold">{k.t}</div>
                <div className="mt-1 flex items-baseline gap-3"><span className="font-display text-[34px] font-semibold">{k.v}</span><span className="text-[13px] font-bold" style={{ color: k.dc }}>{k.d}</span></div>
                <div className="text-[12.5px] text-[#B7C5DA]">{k.sub}</div>
              </div>
            ))}
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <section className="card p-4">
              <div className="mb-2 flex items-center justify-between"><h2 className="text-[17px] font-semibold">Fleet health trend</h2><Source kind="live_logic" text="Computed from monthly readings" /></div>
              <LineChart height={190} yMin={60} yMax={100} yFmt={(v) => `${v}%`}
                xLabels={o.trend.months.map((m: string, i: number) => ({ x: i, label: monthLabel(m) }))} xTickEvery={o.trend.months.length > 8 ? 2 : 1}
                series={[{ color: "#10B981", area: true, dots: true, points: o.trend.health.map((v: number, i: number) => ({ x: i, y: v })) }]} />
            </section>
            <section className="card p-4">
              <h2 className="mb-2 text-[17px] font-semibold">Fleet composition</h2>
              <div className="flex items-center gap-5">
                <Donut parts={o.composition.map((c: any) => ({ value: c.count, color: TYPE_COL[c.vtype] || "#64748B" }))} center={<><span className="font-display text-[26px] font-semibold">{o.total}</span><span className="text-[11.5px] text-[#A9BAD3]">Total vehicles</span></>} />
                <div className="flex flex-1 flex-col gap-2">
                  {o.composition.map((c: any) => (
                    <div key={c.vtype} className="grid grid-cols-[14px_1fr_40px_44px] items-center gap-2 text-[13.5px]">
                      <span className="h-3 w-3 rounded-full" style={{ background: TYPE_COL[c.vtype] || "#64748B" }} /><span>{c.vtype}</span><b className="text-right">{c.count}</b><span className="text-right text-[#A9BAD3]">{pct(c.share)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
          <section className="card mb-4 flex flex-col">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <h2 className="text-[17px] font-semibold">Vehicles needing attention</h2>
              <span className="chip border-[#EF444488] bg-[#EF4444]/10 text-[#FCA5A5]"><span className="h-1.5 w-1.5 rounded-full bg-[#EF4444]" />{o.attention.length} vehicles</span>
              <span className="text-[12.5px] text-fg-3">Sorted by time left before the fail limit</span>
              <Source kind="synthetic" />
              <div className="ml-auto flex items-center gap-1" role="group" aria-label="Filter attention list">
                {[["all", "All"], ["High", "High risk"], ["Medium", "Medium"], ["acc", "Accelerating"], ["photo", "With photos"]].map(([k, l]) => (
                  <button key={k} className={`btn btn-sm ${rf === k ? "btn-primary" : ""}`} onClick={() => { setRf(k); setShown(10); }}>{l}</button>
                ))}
              </div>
              {nSel > 0 && <button className="btn btn-primary btn-sm" onClick={book}>Book inspection for {nSel} selected</button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-[13px]">
                <thead className="border-y border-ink-600 bg-ink-850 text-[12.5px] text-[#A9BAD3]">
                  <tr><th className="w-10 px-4 py-2"></th><th>Vehicle</th><th>Issue</th><th>Trend</th><th>Evidence</th><th>Time to fail limit</th><th>Last check</th><th>Risk</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {att.slice(0, shown).map((r: any) => {
                    const c = riskColor(r.issue.risk);
                    return (
                      <tr key={r.plate} className="border-b border-[#16233B]" style={{ background: sel[r.plate] ? "rgba(34,211,238,0.06)" : undefined }}>
                        <td className="px-4"><input type="checkbox" aria-label={`Select ${r.plate}`} checked={!!sel[r.plate]} onChange={(e) => setSel((s) => ({ ...s, [r.plate]: e.target.checked }))} className="h-4 w-4 accent-cyan" /></td>
                        <td className="py-2">
                          <div className="flex items-center gap-3">
                            {r.photo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`/media/assets/${r.photo}`} alt="" className="h-11 w-16 rounded-md object-cover" />
                            ) : <span className="flex h-11 w-16 shrink-0 flex-col items-center justify-center rounded-md bg-ink-700 text-[9.5px] text-fg-4"><Icon name="car" size={18} />{r.vtype}</span>}
                            <span className="flex flex-col"><b className="text-[14px]">{r.plate}</b><span className="text-[11.5px] text-[#B7C5DA]">{r.make} {r.model}</span><span className="text-[11.5px] text-fg-3">{r.vtype} · {r.operator}</span></span>
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <Icon name={r.issue.icon} size={24} color={c} />
                            <span className="flex flex-col"><b className="text-[13.5px]">{r.issue.name}</b><span className="text-[11.5px] text-fg-3">{r.issue.value} {r.issue.unit} · limit {r.issue.limit} {r.issue.unit}</span></span>
                          </div>
                        </td>
                        <td><div className="flex items-center gap-2"><Spark values={r.issue.spark} color={c} width={56} /><span className="text-[11.5px]" style={{ color: c }}>{r.issue.pattern}</span></div></td>
                        <td>
                          {r.evidence?.length ? (
                            <div className="flex items-center gap-1.5">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={`/media/assets/${r.evidence[0]}`} alt="evidence" className="h-10 w-12 rounded object-cover" />
                              {r.evidence.length > 1 && <span className="rounded bg-ink-700 px-1.5 text-[12px] font-bold">+{r.evidence.length - 1}</span>}
                            </div>
                          ) : <span className="text-[11.5px] text-fg-4">readings only</span>}
                        </td>
                        <td><div className="flex flex-col"><b style={{ color: c }}>{r.issue.weeks_label}</b><span className="text-[11.5px] text-fg-3">{r.issue.date ? `by ${dmy(r.issue.date)}` : "drift is slow"}</span></div></td>
                        <td className="text-[12.5px] text-fg-2">{r.booked ? <span className="text-ok">Booked {dmy(r.booked.date)}</span> : dmy(r.last_check)}</td>
                        <td><span className="chip" style={{ borderColor: c, color: c, background: c + "1F" }}>{r.issue.risk}</span></td>
                        <td className="pr-4"><Link href={`/fleet/vehicle/${encodeURIComponent(r.plate)}`} className="btn btn-sm">Details ›</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-[12.5px] text-fg-3">
              <span>Showing {Math.min(shown, att.length)} of {att.length}{rf !== "all" ? ` (filtered from ${o.attention.length})` : ""}</span>
              {shown < att.length && (
                <span className="flex gap-2">
                  <button className="btn btn-sm" onClick={() => setShown((n) => n + 10)}>Show 10 more</button>
                  <button className="btn btn-sm" onClick={() => setShown(att.length)}>Show all</button>
                </span>
              )}
            </div>
          </section>
          {o.next_berkala && (
            <section className="card mb-4 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[17px] font-semibold">FLEET07 · next Berkala fail risk <span className="text-[13px] font-normal text-fg-3">({o.next_berkala.at_risk} of {o.next_berkala.vehicles.length} trucks likely to fail)</span></h2>
                <Source kind="live_model" text="Next-fail model + survival" />
              </div>
              <div className="flex flex-wrap gap-2">
                {o.next_berkala.vehicles.slice(0, 18).map((v: any) => (
                  <span key={v.plate} className="chip" style={{ borderColor: v.p_fail_next >= 0.5 ? "#EF4444" : "#2A3957", color: v.p_fail_next >= 0.5 ? "#FCA5A5" : "#C9D3E3" }}>
                    {v.plate} · {pct(v.p_fail_next)} · due {dmy(v.next_due)}
                  </span>
                ))}
              </div>
            </section>
          )}
          <section className="card grid grid-cols-1 items-center gap-4 p-4 md:grid-cols-[170px_1fr_1fr_1fr]">
            <b className="text-[15px]">Quick insights</b>
            <span className="text-[12.5px] text-[#C9D3E3]"><b className="text-fg">{o.insights.avoided} re-inspections</b> avoided by fixing issues before the test</span>
            <span className="text-[12.5px] text-[#C9D3E3]"><b className="text-fg">RM {o.insights.savings_rm.toLocaleString()}</b> estimated savings from preventive maintenance</span>
            <span className="text-[12.5px] text-[#C9D3E3]"><b className="text-fg">{o.insights.reports_sent} pattern reports</b> sent to operators from this portal</span>
          </section>
          <p className="mt-2 text-[11.5px] text-fg-4">{o.insights.method}</p>
        </>
      )}
    </Shell>
  );
}

export default function Page() {
  return <Suspense><FleetOverview /></Suspense>;
}
