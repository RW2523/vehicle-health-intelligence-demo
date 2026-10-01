"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ReactNode, Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import { NextAction, refreshUseCase, useActiveUseCase } from "@/components/Demo";
import { IconTile, Panel, StatusPill, Tone } from "@/components/glass";
import { Icon } from "@/components/icons";
import { Evidence, InspectionAssistant, NoInspection, PageLoading, StepNav, checklistOf, itemLabel, itemOf, measureOf, ruleFor, useInspectionParam } from "@/components/insp";
import { ucFor } from "@/components/insp";
import { Shell } from "@/components/Shell";
import { Modal, PageHeader, Source, toast } from "@/components/ui";
import { VehicleArt } from "@/components/VehicleArt";
import { VehicleImage } from "@/components/VehicleImage";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { DECISION, alertSeverity, hasModelConfidence, isRequired } from "@/lib/present";

const SEV_PILL: Record<string, { label: string; tone: Tone }> = { critical: { label: "Critical", tone: "red" }, attention: { label: "Attention", tone: "amber" }, normal: { label: "Minor", tone: "gray" } };
const RECS = ["Repair", "Replace part(s)", "Adjust / re-aim", "Re-test after repair", "Clean and re-measure", "Monitor", "No action needed"];
const STATUS_PILL: Record<string, { label: string; tone: Tone }> = {
  open: { label: "To review", tone: "purple" }, confirmed: { label: "Confirmed", tone: "amber" }, dismissed: { label: "Passed", tone: "green" },
  advisory: { label: "Advisory", tone: "amber" }, deferred: { label: "Deferred", tone: "gray" },
};
// the limit each finding is checked against: the demo's reference values (vhi/pipeline/processor.py), not an official regulation
const RULES: Record<string, string> = {
  "pn:": "Particle number at idle: a working diesel particulate filter keeps it below 250,000 /cm³; above 1,000,000 /cm³ with a filter fitted reads as a removed or failed filter.",
  "brake:efficiency": "Service brake efficiency on the roller tester: at least 50% (45% for heavy vehicles).",
  "brake:imbalance": "Left/right braking force on one axle: more than 20% is advisory, more than 30% fails.",
  "brake:drag": "Braking force with the pedal released: above 12% of the peak indicates a dragging brake.",
  "thermal:": "Wheel hub temperature after the brake test: above 100 °C is flagged, above 120 °C fails.",
  "emissions:co_pct": "Petrol exhaust at idle: CO at most 3.5%.", "emissions:hc_ppm": "Petrol exhaust at idle: HC at most 600 ppm.",
  "emissions:lambda": "Lambda (air-fuel ratio) at high idle within 0.97–1.03 (EU roadworthiness reference, shown until the local limit is confirmed).",
  "ev:hv_isolation": "High-voltage isolation to chassis: below 2 MΩ is advisory, below 0.5 MΩ fails.",
  "suspension": "Suspension (damping) efficiency: at least 40% per wheel.", "headlamp": "Headlamp aim deviation: at most 2%.",
  "tint": "Front side window visible light transmission: at least 50%.", "tyre:": "Tyre AI flags cracks, uneven wear or damage; the examiner confirms by measuring the tread (1.6 mm minimum for passenger cars).",
  "corrosion:": "Corrosion score from the pit or cabin cameras: 4/10 and above is flagged, 7/10 and above is high.",
  "identity:": "Identity: the plate, chassis number, odometer and engine sound must match the registry and the vehicle's history.",
  "dtc:": "Stored OBD fault codes are recorded and explained; emission-related codes count against the emissions check.",
};
const ruleText = (code: string) => Object.entries(RULES).find(([k]) => code.startsWith(k))?.[1] || "This finding comes from an AI module or a rule of the inspection pipeline; the examiner decides it.";

/** The finding categories in one row that scrolls sideways when it does not fit: a fade at an edge says there is more,
 *  and the selected one is brought into view (only the row scrolls, never the page). */
function FadeRow({ children, label, active }: { children: ReactNode; label: string; active: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  const measure = () => {
    const el = ref.current;
    if (el) setEdge({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(() => {
    const el = ref.current;
    const cur = el?.querySelector<HTMLElement>("[aria-selected='true']");
    if (el && cur && el.scrollWidth > el.clientWidth) el.scrollLeft = cur.offsetLeft - (el.clientWidth - cur.offsetWidth) / 2;
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="card relative min-w-0 flex-1 overflow-hidden p-0">
      <div ref={ref} onScroll={measure} role="tablist" aria-label={label} className="relative flex flex-nowrap items-center gap-1 overflow-x-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</div>
      {edge.l && <span className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-white via-white/80 to-white/0" aria-hidden />}
      {edge.r && <span className="pointer-events-none absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-white via-white/80 to-white/0" aria-hidden />}
    </div>
  );
}

function Findings({ id }: { id: string }) {
  const sp = useSearchParams();
  const { L, session } = useInspectionParam(id);
  const user = useUser();
  const { active: uc } = useActiveUseCase();
  const [tab, setTab] = useState<string>(sp.get("item") || "all");
  const [sel, setSel] = useState<string | null>(sp.get("finding"));
  const [action, setAction] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [rec, setRec] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<"rule" | "ask" | "remark" | null>(null);
  const [remark, setRemark] = useState("");
  const [picked, setExaminer] = useState("VE011");
  const photo = useRef<HTMLInputElement>(null);
  const insp = L.insp;
  const examiner = user?.examiner_id || picked;
  const isSenior = user?.examiner_id ? !!user.senior : examiner === "VE001";
  const readOnly = user?.role === "viewer" || user?.role === "hq" || !!insp?.report;
  const ev = insp?.vehicle?.fuel === "ev";
  const ordered = useMemo(() => [...L.alerts].sort((x, y) =>
    Number(x.status !== "open") - Number(y.status !== "open") || Number(isRequired(y)) - Number(isRequired(x)) || Number(y.fail_item) - Number(x.fail_item) || (x.rank || 99) - (y.rank || 99)), [L.alerts]);
  const shown = tab === "all" ? ordered : ordered.filter((a) => itemOf(a.code, ev) === tab);
  const cur = ordered.find((a) => a.alert_id === sel) || shown[0] || null;
  const idx = cur ? shown.findIndex((a) => a.alert_id === cur.alert_id) : -1;
  // keep the finding in focus once shown: findings still arriving or reordering must not swap it under the examiner
  useEffect(() => {
    if (!sel && cur) setSel(cur.alert_id);
  }, [sel, cur?.alert_id]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cur) return;
    setNotes(cur.status !== "open" ? cur.reason || "" : "");
    setRec(cur.evidence?.recommendation || "");
    setAction(null);
  }, [cur?.alert_id]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!insp) return L.notFound ? <NoInspection id={id} /> : <PageLoading />;
  const sid = session || insp.inspection_id;
  const ck = checklistOf(insp, L.alerts, L.step);
  const tabs = ck.items.filter((i) => i.findings > 0);
  const open = L.alerts.filter((a) => a.status === "open");
  const ruleRec = cur ? (cur.fail_item ? "fail" : "advisory") : null;
  const chosen = action || (cur && cur.status !== "open" ? (cur.status === "dismissed" ? "pass" : cur.status === "advisory" ? "advisory" : cur.status === "confirmed" ? (cur.fail_item ? "fail" : "advisory") : null) : null);
  const needReason = cur && chosen && (chosen === "pass" || (chosen === "advisory" && cur.fail_item) || (chosen === "fail" && !cur.fail_item));
  const m = cur ? measureOf(cur, L) : null;
  const rule = cur ? ruleFor(cur, L.fusion?.health) : null;
  const imgs = cur ? [cur.evidence?.image?.annotated, cur.evidence?.image?.source_image].filter(Boolean) : [];

  const save = async () => {
    if (!cur || !chosen) return;
    if (needReason && notes.trim().length < 3) {
      toast("Write the reason in the inspector's notes: this changes how the rules count the finding.", "err");
      return;
    }
    setBusy(true);
    try {
      const reason = notes.trim();
      const d = await api.post(`/api/inspections/alerts/${cur.alert_id}/decision`, { action: chosen, reason, examiner_id: examiner, recommendation: rec });
      L.setAlerts((xs) => xs.map((x) => (x.alert_id === d.alert_id ? { ...x, ...d } : x)));
      toast(`${cur.title}: ${chosen === "pass" ? "passed" : chosen === "advisory" ? "advisory" : "fail item"}`, "ok");
      refreshUseCase();
      const next = ordered.find((a) => a.status === "open" && a.alert_id !== cur.alert_id && (tab === "all" || itemOf(a.code, ev) === tab));
      if (next) setSel(next.alert_id);
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  const confirmRest = async () => {
    setBusy(true);
    for (const a of open) await api.post(`/api/inspections/alerts/${a.alert_id}/decision`, { action: "confirm", examiner_id: examiner }).catch(() => {});
    await L.reload();
    refreshUseCase();
    setBusy(false);
    toast(`Decided the ${open.length} remaining finding${open.length === 1 ? "" : "s"} as the rules recommend`, "ok");
  };
  const route = async () => {
    setBusy(true);
    try {
      await api.post(`/api/inspections/${insp.inspection_id}/route-senior`, { examiner_id: examiner, senior_id: "VE001", note: "Identity checks disagree" });
      if (!user?.examiner_id) setExaminer("VE001");
      toast(user?.examiner_id ? "Referred to the senior examiner, Priya Hassan" : "Referred to the senior examiner (now acting as Priya Hassan)", "ok");
      L.reload();
      refreshUseCase();
    } finally {
      setBusy(false);
    }
  };
  const uploadPhoto = async (f: File) => {
    const view = cur?.code.startsWith("tyre") ? "tyre" : cur?.code.includes("undercarriage") ? "underbody" : cur?.code.includes("cabin") ? "interior" : "rear";
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch(`/api/inspections/${insp.inspection_id}/capture?view=${view}`, { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) return toast(j.detail || "Upload failed", "err");
    toast(`Photo added (${view}) · ${j.image.label || j.image.result || "checked"}`, "ok");
    L.reload();
  };
  const saveRemark = async () => {
    await api.post(`/api/inspections/${insp.inspection_id}/remark`, { text: remark }).then(() => { toast("Remark saved", "ok"); setRemark(""); setModal(null); }).catch((e) => toast(e.message, "err"));
  };
  const v = insp.vehicle || {};
  const routed = insp.examiner?.id === "VE001";

  const statusBtn = (k: string, title: string, sub: string, icon: string, tone: Tone) => {
    const on = chosen === k;
    return (
      <button key={k} disabled={readOnly || !cur} onClick={() => setAction(k)} aria-pressed={on}
        className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${on ? "border-transparent bg-white shadow-lg ring-2" : "border-white/80 bg-white/60 hover:bg-white"}`}
        style={on ? { ["--tw-ring-color" as any]: tone === "green" ? "#34D399" : tone === "amber" ? "#FBBF24" : "#F87171" } : undefined}>
        <IconTile icon={icon} tone={tone} size={46} />
        <span className="min-w-0 leading-tight">
          <b className="block text-[15px]" style={{ color: tone === "green" ? "#047857" : tone === "amber" ? "#B45309" : "#B91C1C" }}>{title}</b>
          <span className="block text-[12px] text-fg-3">{sub}</span>
          {ruleRec === k && <span className="mt-0.5 block text-[11px] font-semibold text-cyan">The rules recommend this</span>}
        </span>
      </button>
    );
  };

  return (
    <>
      <div className="mb-2"><Link href={`/inspection/${sid}`} className="inline-flex items-center gap-1 text-[14px] text-fg-2 hover:text-cyan"><Icon name="back" size={16} />Back to Inspection</Link></div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <PageHeader eyebrow="Inspection" title="Defect Review and Findings" sub="Review captured images, decide each defect, and record findings for this vehicle." />
        <div className="card mb-6 flex w-full min-w-0 items-center gap-3 p-3 sm:w-auto sm:gap-4 sm:pr-5">
          <div className="flex h-[64px] w-[96px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-b from-[#F1F5FB] to-[#E3EAF5] sm:h-[78px] sm:w-[130px]">{insp.photo ? <VehicleImage plate={insp.plate} vtype={insp.owner?.vtype} photo={insp.photo} size="480" className="h-full w-full" /> : <VehicleArt vtype={insp.owner?.vtype} seed={insp.plate} className="h-[56px] w-[90px] sm:h-[70px] sm:w-[124px]" />}</div>
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-[13px] sm:gap-x-5 [&>dd]:truncate [&>dt]:whitespace-nowrap">
            <dt className="text-fg-3">Vehicle No.</dt><dd className="font-bold">{insp.plate}</dd>
            <dt className="text-fg-3">Make / Model</dt><dd title={`${v.make} ${v.model}`}>{v.make} {v.model}</dd>
            <dt className="text-fg-3">Year</dt><dd>{v.year || insp.owner?.year}</dd>
            <dt className="text-fg-3">Inspection</dt><dd className="sm:max-w-[220px]" title={insp.inspection_type}>{insp.inspection_type}</dd>
          </dl>
        </div>
      </div>
      <StepNav id={sid} at="findings" findings={L.alerts.length} open={open.length} />
      {user?.role === "presenter" && !insp.report && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-fg-3">Acting as
          <select aria-label="Examiner" className="input w-auto py-1.5" value={examiner} onChange={(e) => setExaminer(e.target.value)}>
            <option value="VE011">Arjun Ismail · Examiner</option><option value="VE001">Priya Hassan · Senior Examiner</option>
          </select>
          <NextAction uc={ucFor(uc, insp)} here={[`/inspection/${sid}/findings`, `/inspection/${insp.inspection_id}/findings`]} />
        </div>
      )}
      {insp.route === "senior" && !insp.report && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-blue-50/80 px-4 py-3 text-[13.5px] ring-1 ring-blue-200" role="status">
          <span><b className="text-[#1D4ED8]">Senior review required.</b> Identity checks disagree, so only a senior examiner can sign this report off.{isSenior ? " You are acting as the senior examiner." : routed ? " It has been referred to the senior examiner." : ""}</span>
          {!isSenior && !routed && !readOnly && open.filter(isRequired).length === 0 && <button className="btn btn-primary btn-sm" disabled={busy} onClick={route}>Refer to the senior examiner</button>}
        </div>
      )}
      {!L.alerts.length ? (
        <div className="card p-8 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200"><Icon name="check" size={30} color="#10B981" width={2.5} /></div>
          <h2 className="text-[22px] font-bold">{insp.status === "in_lane" ? "No findings so far" : "No anomalies detected in this inspection"}</h2>
          <p className="mt-1 text-[14px] text-fg-3">{insp.status === "in_lane" ? "Findings appear here as the lane raises them." : "Every measurement is within its limit and the AI modules found nothing to decide."}</p>
          {insp.status !== "in_lane" && <Link className="btn btn-primary mt-4" href={`/inspection/${sid}/review`}>Go to final review<Icon name="arrow" size={15} /></Link>}
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 2xl:flex-row 2xl:items-center">
            {/* one row of categories, named like the checklist items; it scrolls sideways when it does not fit */}
            <FadeRow label="Finding categories" active={tab}>
              <button role="tab" aria-selected={tab === "all"} onClick={() => { setTab("all"); setSel(null); }}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-[14px] font-semibold transition ${tab === "all" ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow" : "text-fg-2 hover:bg-white"}`}>
                <Icon name="layers" size={17} />All Findings<span className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[12px] ${tab === "all" ? "bg-white text-[#1D4ED8]" : "bg-ink-700"}`}>{L.alerts.length}</span>
              </button>
              {tabs.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setSel(null); }}
                  className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-[14px] font-medium transition ${tab === t.id ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow" : "text-fg-2 hover:bg-white"}`}>
                  <span className="hidden 2xl:inline-flex"><Icon name={t.icon} size={17} /></span>{t.label}<span className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[12px] font-bold ${tab === t.id ? "bg-white text-[#1D4ED8]" : t.open ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{t.findings}</span>
                </button>
              ))}
            </FadeRow>
            {open.length > 1 && !readOnly && <button className="btn shrink-0 self-end 2xl:self-auto" disabled={busy} onClick={confirmRest}>Decide the {open.length} remaining as the rules recommend</button>}
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)_330px]">
            <div className="flex max-h-[80vh] flex-col gap-3 overflow-y-auto pr-1" role="listbox" aria-label="Findings">
              {shown.map((a) => {
                const s = SEV_PILL[alertSeverity(a)];
                const on = cur?.alert_id === a.alert_id;
                const img = a.evidence?.image?.annotated;
                return (
                  <button key={a.alert_id} role="option" aria-selected={on} onClick={() => setSel(a.alert_id)}
                    className={`flex items-center gap-3 rounded-2xl border p-2.5 text-left transition ${on ? "border-blue-300 bg-white shadow-lg ring-2 ring-blue-100" : "border-white/80 bg-white/65 hover:bg-white"}`}>
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" className="h-[84px] w-[92px] shrink-0 rounded-xl object-cover" />
                    ) : <span className="flex h-[84px] w-[92px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-[#F1F5FB] to-[#E3EAF5]"><Icon name={a.system?.includes("Brake") ? "brake" : a.system?.includes("Tyre") ? "tyre" : a.system?.includes("emission") ? "smoke" : a.system?.includes("EV") ? "batt" : a.system?.includes("Identity") ? "user" : "warn"} size={32} color="#64748B" /></span>}
                    <span className="min-w-0 flex-1 leading-tight">
                      <b className="block text-[14.5px] leading-snug">{a.title}</b>
                      <span className="mt-0.5 block truncate text-[12.5px] text-fg-3">{itemLabel(a.code || "", ev)}</span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5"><StatusPill tone={s.tone}>{s.label}</StatusPill>{a.status !== "open" && <StatusPill tone={STATUS_PILL[a.status]?.tone || "gray"}>{STATUS_PILL[a.status]?.label || a.status}</StatusPill>}</span>
                    </span>
                    <Icon name="chev" size={16} color="#94A3B8" />
                  </button>
                );
              })}
              {!shown.length && <p className="text-[13px] text-fg-3">No findings in this category.</p>}
            </div>
            {cur && (
              <section className="card min-w-0 p-4 lg:p-5" aria-label="Finding in focus">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="hidden sm:block"><IconTile icon={cur.system?.includes("Tyre") ? "tyre" : cur.system?.includes("Brake") ? "brake" : "warn"} tone="gray" size={44} /></span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[21px] font-bold leading-tight tracking-tight">{cur.title}</h2>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-fg-3">{itemLabel(cur.code || "", ev)}<StatusPill tone={SEV_PILL[alertSeverity(cur)].tone}>{SEV_PILL[alertSeverity(cur)].label}</StatusPill>{cur.fail_item && <StatusPill tone="red">Fail item</StatusPill>}<Source kind={cur.source} /></div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
                    <button className="btn btn-sm" aria-label="Previous finding" disabled={idx <= 0} onClick={() => setSel(shown[idx - 1].alert_id)}><Icon name="back" size={15} /></button>
                    <span className="whitespace-nowrap px-1 text-[13px] text-fg-2">{idx + 1} of {shown.length}</span>
                    <button className="btn btn-sm" aria-label="Next finding" disabled={idx >= shown.length - 1} onClick={() => setSel(shown[idx + 1].alert_id)}><Icon name="chev" size={15} /></button>
                  </div>
                </div>
                {imgs.length > 0 && (
                  <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imgs[0]} alt={`AI result: ${cur.title}`} className="h-[220px] w-full rounded-2xl bg-ink-950 object-cover sm:h-[260px]" />
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-col">
                      {imgs[1] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imgs[1]} alt="Original capture" className="h-[126px] w-full rounded-xl object-cover" />
                      )}
                      <div className="flex h-[126px] flex-col justify-center rounded-xl bg-white/70 px-3 text-[12px] text-fg-3 ring-1 ring-ink-600">
                        <b className="text-fg-2">{cur.evidence?.image?.camera || "Lane camera"}</b>{cur.evidence?.image?.model}
                        {hasModelConfidence(cur) && <span>Model confidence {Math.round(cur.confidence * 100)}%</span>}
                      </div>
                    </div>
                  </div>
                )}
                <div className="mb-4 rounded-2xl bg-white/70 p-3.5 ring-1 ring-ink-600">
                  <div className="label mb-1">Why was this flagged?</div>
                  <p className="text-[14.5px] leading-relaxed">{cur.detail}</p>
                </div>
                {m && (
                  <div className="mb-4">
                    <div className="mb-2 flex items-center gap-2 text-[15px] font-bold"><Icon name="sliders" size={17} />Measurement Details</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="rounded-xl bg-white/80 p-3 ring-1 ring-ink-600"><div className="text-[12px] text-fg-3">Measured</div><div className="text-[20px] font-bold">{m.observed}</div><StatusPill tone={cur.fail_item ? "red" : "amber"}>{m.status}</StatusPill></div>
                      <div className="rounded-xl bg-white/80 p-3 ring-1 ring-ink-600"><div className="text-[12px] text-fg-3">Limit</div><div className="text-[15px] font-semibold leading-snug">{m.limit}</div><span className="text-[11.5px] text-fg-4">Demo reference</span></div>
                      <div className="rounded-xl bg-white/80 p-3 ring-1 ring-ink-600"><div className="text-[12px] text-fg-3">Difference</div><div className={`text-[17px] font-bold ${cur.fail_item ? "text-bad" : "text-[#B45309]"}`}>{m.delta || "–"}</div>{rule && <span className="text-[11.5px] text-fg-3">Health score −{rule.points}</span>}</div>
                    </div>
                  </div>
                )}
                <div className="mb-2 flex items-center gap-2 text-[15px] font-bold"><Icon name="doc" size={17} />Finding Details</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
                  <label className="flex flex-col gap-1 text-[12.5px] text-fg-3">Inspector&apos;s Notes{needReason && <span className="text-bad"> · required: this changes how the finding counts</span>}
                    <textarea className="input min-h-[92px] text-[13.5px]" maxLength={500} disabled={readOnly} value={notes} onChange={(e) => setNotes(e.target.value)}
                      placeholder="What you checked and why you decided as you did" />
                    <span className="self-end text-[11.5px]">{notes.length}/500</span>
                  </label>
                  <label className="flex flex-col gap-1 text-[12.5px] text-fg-3">Recommendation
                    <select className="input" disabled={readOnly} value={rec} onChange={(e) => setRec(e.target.value)} aria-label="Recommendation">
                      <option value="">Choose…</option>{RECS.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </label>
                </div>
                <p className={`mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] ${cur.fail_item ? "bg-red-50 text-red-800 ring-1 ring-red-100" : "bg-blue-50 text-[#1D4ED8] ring-1 ring-blue-100"}`}>
                  <Icon name="info" size={16} />{cur.fail_item ? "This item will result in a FAIL if it is confirmed and not rectified." : "This finding is advisory under the rules: it is noted on the report but does not fail the vehicle."}
                </p>
                <details className="mt-4 rounded-xl bg-white/60 px-3 py-2 ring-1 ring-ink-600">
                  <summary className="cursor-pointer text-[13.5px] font-semibold">All evidence for this finding</summary>
                  <div className="mt-3"><Evidence a={cur} L={L} /></div>
                </details>
              </section>
            )}
            {cur && (
              <div className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2 lg:col-span-2 2xl:col-span-1 2xl:flex 2xl:flex-col">
                <Panel title="Inspection Item Status">
                  <div className="flex flex-col gap-2.5">
                    {statusBtn("pass", "Mark as Pass", "Item meets the requirements", "check", "green")}
                    {statusBtn("advisory", "Mark as Advisory", "Minor issue, monitor or rectify soon", "clock", "amber")}
                    {statusBtn("fail", "Fail Item", "Does not meet the requirements", "close", "red")}
                  </div>
                  {cur.status !== "open" && <p className="mt-2 text-[12px] text-fg-3">Decided: <b style={{ color: DECISION[cur.status]?.color }}>{STATUS_PILL[cur.status]?.label}</b> by {cur.decided_by}{cur.reason ? ` · “${cur.reason}”` : ""}</p>}
                </Panel>
                <div className="flex min-w-0 flex-col gap-4">
                  <Panel title="Capture & Media">
                    <div className="grid grid-cols-2 gap-2.5">
                      <button className="flex flex-col items-center gap-1 rounded-2xl bg-white/70 p-3 text-center ring-1 ring-ink-600 hover:bg-white" disabled={readOnly} onClick={() => photo.current?.click()}>
                        <Icon name="camera" size={22} color="#2563EB" /><b className="text-[13px]">Retake Photo</b><span className="text-[11px] text-fg-3">Runs the AI module again</span>
                      </button>
                      <button className="flex flex-col items-center gap-1 rounded-2xl bg-white/70 p-3 text-center ring-1 ring-ink-600 hover:bg-white" disabled={readOnly} onClick={() => photo.current?.click()}>
                        <Icon name="image" size={22} color="#2563EB" /><b className="text-[13px]">Add Photo</b><span className="text-[11px] text-fg-3">From device or library</span>
                      </button>
                      <input ref={photo} type="file" accept="image/*" className="hidden" aria-label="Photo for this finding" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ""; }} />
                    </div>
                  </Panel>
                  <Panel title="Quick Actions">
                    <div className="flex flex-col">
                      {[["Add Remark", "doc", () => setModal("remark")], ["Link to Regulation", "link", () => setModal("rule")], ["Ask about this finding", "chat", () => setModal("ask")]].map(([l, ic, f]) => (
                        <button key={l as string} onClick={f as () => void} disabled={l === "Add Remark" && readOnly} className="flex items-center gap-3 border-b border-ink-600/60 px-1 py-2.5 text-left text-[14px] last:border-0 hover:text-cyan">
                          <Icon name={ic as string} size={18} color="#475569" /><span className="flex-1">{l as string}</span><Icon name="chev" size={15} color="#94A3B8" />
                        </button>
                      ))}
                    </div>
                  </Panel>
                </div>
                {!readOnly && (
                  <div className="grid grid-cols-2 gap-2.5 md:col-span-2 2xl:col-span-1">
                    <button className="btn btn-lg" onClick={() => { setAction(null); setNotes(cur.status !== "open" ? cur.reason || "" : ""); }}>Cancel</button>
                    <button className="btn btn-primary btn-lg" disabled={!chosen || busy || (!action && cur.status !== "open")} onClick={save}><Icon name="doc" size={16} />{busy ? "Saving…" : "Save Finding"}</button>
                  </div>
                )}
                {!open.length && <Link className="btn btn-primary btn-lg md:col-span-2 2xl:col-span-1" href={`/inspection/${sid}/review`}>All decided · final review<Icon name="arrow" size={15} /></Link>}
              </div>
            )}
          </div>
        </>
      )}
      <Modal open={modal === "rule"} onClose={() => setModal(null)} title="The rule behind this finding">
        <div className="max-w-[560px] text-[14px] leading-relaxed">
          <p>{cur ? ruleText(cur.code) : ""}</p>
          <p className="mt-3 text-[12.5px] text-fg-3">Limits are the demo&apos;s reference values used by the inspection pipeline. They are not a statement of the official regulation.</p>
        </div>
      </Modal>
      <Modal open={modal === "ask"} onClose={() => setModal(null)} title="Ask about this inspection">
        <div className="w-[min(760px,calc(100vw-5rem))]"><InspectionAssistant iid={insp.inspection_id} alertId={cur?.alert_id} /></div>
      </Modal>
      <Modal open={modal === "remark"} onClose={() => setModal(null)} title="Add a remark">
        <div className="flex w-[min(520px,calc(100vw-5rem))] flex-col gap-3">
          <textarea className="input min-h-[110px]" maxLength={500} value={remark} onChange={(e) => setRemark(e.target.value)} aria-label="Remark" placeholder="Saved with the inspection and in the evidence chain" />
          <div className="flex justify-end gap-2"><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={remark.trim().length < 2} onClick={saveRemark}>Save remark</button></div>
        </div>
      </Modal>
    </>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Shell><Suspense><Findings id={id} /></Suspense></Shell>;
}
