"use client";
import Link from "next/link";
import { ReactNode, use, useRef, useState } from "react";
import { NextAction, useActiveUseCase } from "@/components/Demo";
import { IconTile, Panel, ProgressBar, Ring, StatusPill, Tone } from "@/components/glass";
import { DamageMap } from "@/components/DamageMap";
import { Icon } from "@/components/icons";
import { LiveLaneView } from "@/components/LiveLaneView";
import { ITEM_STATUS, NoInspection, PageLoading, StepNav, VIEWS, VehicleStrip, atTime, capturesOf, checklistOf, itemLabel, useInspectionParam } from "@/components/insp";
import { ucUnlessSame } from "@/components/insp";
import { useVehiclePhotos } from "@/components/Photo";
import { PlayerControls, useSessions } from "@/components/Player";
import { Shell } from "@/components/Shell";
import { Modal, PageHeader, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAssistantContext } from "@/lib/assistantContext";
import { useUser } from "@/lib/auth";
import { alertSeverity, isRequired } from "@/lib/present";
import { alertFinding } from "@/lib/zones";

/** The model's reference photo for a camera view the lane has not captured (front ← hero, sides ← side view). */
const SHOW_ISSUES = 5;
const REF_VIEW: Record<string, string[]> = { front: ["hero"], rear: ["rear"], left: ["side", "hero"], right: ["side", "hero"], interior: ["interior"], tyre: ["tyre"], underbody: ["underbody"] };

function CaptureTile({ view, label, c, canCapture, onFile, busy, refPhoto }: { view: string; label: string; c: any; canCapture: boolean; onFile: (f: File) => void; busy: boolean; refPhoto?: any }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <figure className="group relative overflow-hidden rounded-2xl border border-white/80 bg-white/70 shadow-glass">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-b from-[#EEF3FA] to-[#DFE7F2]">
        {c?.annotated ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.annotated} alt={`${label}: ${c.result}`} className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        ) : refPhoto ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={refPhoto.url_480 || refPhoto.url} alt={`${label}: reference photo of the model`} className="absolute inset-0 h-full w-full object-cover opacity-45 grayscale-[35%]" />
            <span className="absolute inset-0 flex items-center justify-center bg-white/35 pb-4 text-fg-3"><Icon name="camera" size={26} width={1.5} color="#475569" /></span>
            <span className="absolute left-2 top-2 whitespace-nowrap rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-fg-3" title="A reference photo of the model: this view is not captured yet">Reference photo</span>
          </>
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 pb-6 text-center text-fg-4">
            <Icon name="camera" size={28} width={1.4} color="#94A3B8" /><span className="text-[12px] leading-tight">No lane camera for this view</span>
          </span>
        )}
        {c?.flag && <span className="absolute left-2 top-2"><StatusPill tone="red">Flagged</StatusPill></span>}
        {canCapture && (
          <>
            <button className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-cyan shadow-md ring-1 ring-blue-100 transition hover:bg-blue-50"
              onClick={() => input.current?.click()} disabled={busy} aria-label={`${c?.annotated ? "Retake" : "Capture"} ${label}`} title={`${c?.annotated ? "Retake" : "Capture"}: the photo runs through the ${view === "tyre" ? "Tyre" : view === "underbody" ? "Undercarriage" : "Above-carriage"} AI`}>
              {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan border-t-transparent" /> : <Icon name="camera" size={17} />}
            </button>
            <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" aria-label={`Photo for ${label}`}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          </>
        )}
      </div>
      <figcaption className="flex items-center gap-2 px-3 py-2.5">
        {c?.annotated ? <Icon name="checkc" size={18} color="#10B981" width={2.2} /> : <Icon name="minusc" size={18} color="#CBD5E1" width={2} />}
        <span className="min-w-0 flex-1 leading-tight">
          <b className="block truncate text-[13.5px]">{label}</b>
          <span className="block truncate text-[11.5px] text-fg-3">{c?.annotated ? `${c.by ? "Examiner" : c.module} · ${c.result || ""}` : "Not captured"}{c?.at ? ` · ${atTime(c.at)}` : ""}</span>
        </span>
      </figcaption>
    </figure>
  );
}

export default function CapturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { L, session } = useInspectionParam(id);
  const user = useUser();
  const { active: uc } = useActiveUseCase();
  const { sessions, setPlayer } = useSessions();
  const [busy, setBusy] = useState<string | null>(null);
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [remark, setRemark] = useState("");
  const insp = L.insp;
  const refs = useVehiclePhotos(insp?.plate);
  const canAct = user?.role === "presenter" || user?.role === "examiner";
  useAssistantContext(insp ? { inspection_id: insp.inspection_id, plate: insp.plate } : {});
  if (!insp) return <Shell>{L.notFound ? <NoInspection id={id} /> : <PageLoading />}</Shell>;
  const iid = insp.inspection_id;
  const ck = checklistOf(insp, L.alerts, L.step);
  const caps = capturesOf(L.results);
  const pct = Math.round((100 * ck.done) / ck.total);
  const running = insp.status === "in_lane";
  const locked = !!insp.report;
  const open = L.alerts.filter((a) => a.status === "open");
  const issues = [...L.alerts].sort((x, y) => Number(y.status === "open") - Number(x.status === "open") || Number(isRequired(y)) - Number(isRequired(x)));
  const sess = sessions.find((s) => s.session_id === (insp.session_id || insp.session));
  const sid = session || iid;
  const ev = insp.vehicle?.fuel === "ev";

  const upload = async (view: string, f: File) => {
    setBusy(view);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch(`/api/inspections/${iid}/capture?view=${view}`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || r.statusText);
      toast(j.finding ? `${j.image.module || "AI"} flagged it: ${j.finding.title}` : `${VIEWS.find((v) => v.id === view)?.label} captured · ${j.image.label || "checked"}`, j.finding ? "err" : "ok");
      L.reload();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  };
  const saveRemark = async () => {
    try {
      await api.post(`/api/inspections/${iid}/remark`, { text: remark });
      toast("Remark saved to the inspection record", "ok");
      setRemark("");
      setRemarkOpen(false);
      L.reload();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  // the one next step, by where the inspection stands
  const openReq = open.filter(isRequired).length;
  const rep = insp.report;
  let next: { icon: string; tone: Tone; title: ReactNode; sub: ReactNode; cta: ReactNode };
  if (locked) next = { icon: "award", tone: rep.verdict === "FAIL" ? "red" : rep.verdict === "PASS" ? "green" : "amber", title: `Report issued · ${rep.verdict}`, sub: `${rep.report_id} · ${rep.kind}`,
    cta: <Link className="btn btn-primary btn-lg" href={`/report?id=${rep.report_id}`}><Icon name="doc" size={18} />View report</Link> };
  else if (running) next = { icon: "lane", tone: "amber", title: "The vehicle is in the lane", sub: "Readings and AI results arrive as each station runs.",
    cta: <Link className="btn btn-primary btn-lg" href={`/lane?lane=${insp.lane_id}`}><Icon name="eye" size={18} />Watch the lane</Link> };
  else if (open.length) next = { icon: "warn", tone: openReq ? "red" : "amber", title: `${open.length} finding${open.length === 1 ? "" : "s"} to decide`,
    sub: openReq ? `${openReq} critical: decided before the final review` : "None is critical",
    cta: <Link className="btn btn-primary btn-lg" href={`/inspection/${sid}/findings`}><Icon name="warn" size={18} />Review findings ({open.length})</Link> };
  else next = { icon: "checkc", tone: "green", title: L.alerts.length ? "Every finding has a decision" : "No anomalies: nothing to decide", sub: "The final review shows the outcome and issues the report.",
    cta: <Link className="btn btn-primary btn-lg" href={`/inspection/${sid}/review`}><Icon name="checkc" size={18} />Go to final review</Link> };

  return (
    <Shell>
      <PageHeader eyebrow="Inspection" title="Active Inspection Capture" sub="Capture vehicle images and complete the inspection checklist in real time."
        actions={<><NextAction uc={ucUnlessSame(uc, insp, locked || running ? null : open.length ? "/inspection/{id}/findings" : "/inspection/{id}/review")} here={[`/inspection/${sid}`, `/inspection/${iid}`, `/inspection/${insp.session_id}`]} /><Link className="btn" href="/inspection"><Icon name="back" size={16} />Back to Queue</Link></>} />
      <StepNav id={sid} at="capture" findings={L.alerts.length} open={open.length} />
      <section aria-label="Next step" className="card mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
        <div className="flex min-w-0 flex-1 items-center gap-3.5 sm:min-w-[260px]">
          <IconTile icon={next.icon} tone={next.tone} size={46} />
          <div className="min-w-0 leading-tight">
            <div className="text-[17px] font-bold">{next.title}</div>
            <div className="mt-0.5 text-[13px] text-fg-3">{next.sub}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 [&>a]:w-full sm:[&>a]:w-auto">
          {running && sess && canAct && <PlayerControls s={sess} onState={setPlayer} compact onFastDone={L.reload} quiet />}
          {next.cta}
        </div>
        {running && (
          // the lane progress strip: the vehicle through the lane's stations, on the replay clock
          <div className="w-full min-w-0 basis-full"><LiveLaneView L={L} player={L.player || (sess?.player?.inspection_id === iid ? sess.player : null)} compact /></div>
        )}
      </section>
      <VehicleStrip insp={insp} />
      {/* lg: capture | checklist over the issues, then progress and actions side by side; 2xl: capture | checklist | the rest.
          Cards keep their own height (items-start): a short card never stretches into empty space. */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2 lg:grid-rows-[auto_1fr_auto] 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.85fr)] 2xl:grid-rows-[auto_auto_1fr]">
        <Panel title="Image Capture" sub="Lane cameras fill these in; capture or retake any view: the photo runs through its AI module."
          action={<Source kind="sample" text="Lane frames" />} className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1 2xl:row-span-3">
          <div className="grid grid-cols-2 gap-3">
            {VIEWS.map((v) => <CaptureTile key={v.id} view={v.id} label={v.label} c={caps[v.id]} canCapture={canAct && !locked} busy={busy === v.id} onFile={(f) => upload(v.id, f)}
              refPhoto={(REF_VIEW[v.id] || []).map((k) => refs.data?.gallery?.find((g: any) => g.view === k) || (k === "hero" ? refs.data?.hero : null)).find(Boolean)} />)}
            <Link href={`/lane?lane=${insp.lane_id}`} className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-blue-200 bg-blue-50/50 p-4 text-center text-[13px] font-semibold text-[#1D4ED8] hover:bg-blue-50">
              <Icon name="lane" size={26} />Live sensors and charts<span className="text-[11.5px] font-normal text-fg-3">Brake curves, emissions, OBD, e-nose preview</span>
            </Link>
          </div>
        </Panel>
        <Panel title="Inspection Checklist" sub="Verify all items and record results." action={<span className="text-[14px] font-semibold text-cyan">{ck.done}/{ck.total} completed</span>}
          className="min-w-0 lg:col-start-2 lg:row-start-1 2xl:row-span-3">
          <ul className="flex flex-col">
            {ck.items.map((it) => {
              const s = ITEM_STATUS[it.status];
              return (
                <li key={it.id}>
                  <Link href={it.findings ? `/inspection/${sid}/findings?item=${it.id}` : it.id === "final" ? `/inspection/${sid}/review` : `/inspection/${sid}`}
                    className="flex items-center gap-3 border-b border-ink-600/60 px-1 py-2.5 last:border-0 hover:bg-white/60">
                    <Icon name={it.icon} size={20} color="#64748B" />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{it.label}</span>
                    <StatusPill tone={s.tone}>{s.label}{it.open ? ` (${it.open})` : ""}</StatusPill>
                    <Icon name="chev" size={16} color="#94A3B8" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="Inspection Progress" className="min-w-0 lg:col-start-1 lg:row-start-3 2xl:col-start-3 2xl:row-start-1">
          <div className="flex items-center gap-5">
            <Ring value={pct} size={120} stroke={12}><span className="text-[26px] font-bold">{pct}%</span></Ring>
            <div className="min-w-0 flex-1">
              <div className="text-[30px] font-bold leading-tight">{ck.done} / {ck.total}</div>
              <div className="text-[13px] text-fg-3">Inspection items completed</div>
              <ProgressBar value={pct} className="mt-3" />
            </div>
          </div>
        </Panel>
        <Panel title={<span className="flex items-center gap-2 text-[18px] font-bold">Detected Issues {L.alerts.length > 0 && <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-100 px-1.5 text-[12px] font-bold text-red-700">{L.alerts.length}</span>}</span>}
          href={L.alerts.length ? `/inspection/${sid}/findings` : undefined} actionLabel="Review all"
          className="min-w-0 lg:col-start-2 lg:row-start-2 2xl:col-start-3 2xl:row-start-2">
          {!L.alerts.length ? (
            <div className="rounded-xl bg-emerald-50 px-4 py-3 text-[13.5px] text-emerald-800 ring-1 ring-emerald-200">{running ? "No issues detected so far." : "No anomalies detected in this inspection."}</div>
          ) : (
            <ul className="flex flex-col gap-2">
              {issues.slice(0, SHOW_ISSUES).map((a) => {
                const img = a.evidence?.image?.annotated;
                const sev = alertSeverity(a);
                return (
                  <li key={a.alert_id}>
                    <Link href={`/inspection/${sid}/findings?finding=${a.alert_id}`} className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/70 p-2.5 hover:bg-white">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" className="h-12 w-14 shrink-0 rounded-xl object-cover" />
                      ) : <IconTile icon={a.system?.includes("Brake") ? "brake" : a.system?.includes("Tyre") ? "tyre" : a.system?.includes("emission") ? "smoke" : a.system?.includes("Identity") ? "user" : "warn"} tone={sev === "critical" ? "red" : "amber"} size={48} />}
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="flex items-center justify-between gap-2"><span className="truncate text-[11.5px] text-fg-3">{itemLabel(a.code || "", ev)}</span>
                          <StatusPill tone={a.status === "open" ? (sev === "critical" ? "red" : "amber") : a.status === "dismissed" ? "green" : "gray"}>{a.status === "open" ? (sev === "critical" ? "Issue" : "Pending") : a.status === "dismissed" ? "Passed" : a.status}</StatusPill></span>
                        <b className="mt-0.5 block truncate text-[13.5px]">{a.title}</b>
                        <span className="block truncate text-[12px] text-fg-3">{a.detail}</span>
                      </span>
                      <Icon name="chev" size={16} color="#94A3B8" />
                    </Link>
                  </li>
                );
              })}
              {issues.length > SHOW_ISSUES && (
                <li><Link className="flex items-center justify-center gap-1 rounded-xl bg-blue-50 py-2 text-[13px] font-semibold text-[#1D4ED8] ring-1 ring-blue-100 hover:bg-blue-100" href={`/inspection/${sid}/findings`}>
                  +{issues.length - SHOW_ISSUES} more · all {issues.length} findings<Icon name="chev" size={15} /></Link></li>
              )}
            </ul>
          )}
        </Panel>
        <Panel title="Quick Actions" sub="Remarks go on the record; the next step is at the top." className="min-w-0 lg:col-start-2 lg:row-start-3 2xl:col-start-3">
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap gap-2.5 [&>*]:min-w-[150px] [&>*]:flex-1 [&>*]:whitespace-nowrap">
              <button className="btn" disabled={!canAct || locked} onClick={() => setRemarkOpen(true)}><Icon name="edit" size={16} />Add Remark</button>
              <Link className="btn" href={`/inspection/${sid}/review`}><Icon name="doc" size={16} />Complete Inspection</Link>
            </div>
            <p className="flex items-start gap-1.5 text-[12px] text-fg-3"><Icon name="checkc" size={14} color="#10B981" className="mt-px shrink-0" />Every result and decision is saved as it happens, in the hash-chained evidence log.</p>
            {(insp.remarks || []).length > 0 && (
              <ul className="mt-1 flex flex-col gap-1.5 border-t border-ink-600/60 pt-2 text-[12.5px]">
                {insp.remarks.slice(-3).map((r: any, i: number) => <li key={i} className="rounded-lg bg-white/70 px-2.5 py-1.5"><b>{r.by}</b> · {atTime(r.at)}<div className="text-fg-2">{r.text}</div></li>)}
              </ul>
            )}
          </div>
        </Panel>
      </div>
      {L.alerts.length > 0 && (
        <div className="mt-5">
          <DamageMap plate={insp.plate} vtype={insp.owner?.vtype || insp.vehicle?.vtype} photos={refs.data} maxHeight={360}
            findings={L.alerts.map((a) => alertFinding(a, `/inspection/${sid}/findings?finding=${a.alert_id}`))} />
        </div>
      )}
      <Modal open={remarkOpen} onClose={() => setRemarkOpen(false)} title="Add a remark">
        <div className="flex w-[min(520px,calc(100vw-5rem))] flex-col gap-3">
          <textarea className="input min-h-[110px]" maxLength={500} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="What should the record say? e.g. Owner asked for the brake test to be repeated." aria-label="Remark" />
          <div className="flex justify-between text-[12px] text-fg-3"><span>Saved with the inspection and in the evidence chain.</span><span>{remark.length}/500</span></div>
          <div className="flex justify-end gap-2"><button className="btn" onClick={() => setRemarkOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={remark.trim().length < 2} onClick={saveRemark}>Save remark</button></div>
        </div>
      </Modal>
    </Shell>
  );
}
