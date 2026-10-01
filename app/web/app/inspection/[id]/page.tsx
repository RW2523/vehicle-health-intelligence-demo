"use client";
import Link from "next/link";
import { use, useRef, useState } from "react";
import { NextAction, useActiveUseCase } from "@/components/Demo";
import { IconTile, Panel, ProgressBar, Ring, StatusPill } from "@/components/glass";
import { Icon } from "@/components/icons";
import { ITEM_STATUS, NoInspection, PageLoading, StepNav, VIEWS, VehicleStrip, atTime, capturesOf, checklistOf, useInspectionParam } from "@/components/insp";
import { ucFor } from "@/components/insp";
import { useVehiclePhotos } from "@/components/Photo";
import { PlayerControls, useSessions } from "@/components/Player";
import { Shell } from "@/components/Shell";
import { Modal, PageHeader, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { STEP_LABEL } from "@/lib/format";
import { alertSeverity, isRequired } from "@/lib/present";

/** The model's reference photo for a camera view the lane has not captured (front ← hero, sides ← side view). */
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
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-white/35 text-fg-3">
              <Icon name="camera" size={26} width={1.5} color="#475569" /><span className="rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-semibold">Reference · not captured</span>
            </span>
          </>
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-fg-4">
            <Icon name="camera" size={30} width={1.4} color="#94A3B8" /><span className="text-[12px]">No lane camera for this view</span>
          </span>
        )}
        {c?.flag && <span className="absolute left-2 top-2"><StatusPill tone="red">Flagged</StatusPill></span>}
      </div>
      <figcaption className="flex items-center gap-2.5 px-3 py-2.5">
        {c?.annotated ? <Icon name="checkc" size={20} color="#10B981" width={2.2} /> : <Icon name="minusc" size={20} color="#CBD5E1" width={2} />}
        <span className="min-w-0 flex-1 leading-tight">
          <b className="block truncate text-[13.5px]">{label}</b>
          <span className="block truncate text-[11.5px] text-fg-3">{c?.annotated ? `${c.by ? "Examiner" : c.module} · ${c.result || ""}` : "Not captured"}{c?.at ? ` · ${atTime(c.at)}` : ""}</span>
        </span>
        {canCapture && (
          <>
            <button className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-cyan ring-1 ring-blue-100 transition hover:bg-blue-100"
              onClick={() => input.current?.click()} disabled={busy} aria-label={`${c?.annotated ? "Retake" : "Capture"} ${label}`} title={`${c?.annotated ? "Retake" : "Capture"}: the photo runs through the ${view === "tyre" ? "Tyre" : view === "underbody" ? "Undercarriage" : "Above-carriage"} AI`}>
              {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan border-t-transparent" /> : <Icon name="camera" size={17} />}
            </button>
            <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" aria-label={`Photo for ${label}`}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          </>
        )}
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
  if (!insp) return <Shell>{L.notFound ? <NoInspection id={id} /> : <PageLoading />}</Shell>;
  const iid = insp.inspection_id;
  const ck = checklistOf(insp, L.alerts, L.step);
  const caps = capturesOf(L.results);
  const pct = Math.round((100 * ck.done) / ck.total);
  const running = insp.status === "in_lane";
  const locked = !!insp.report;
  const open = L.alerts.filter((a) => a.status === "open");
  const issues = [...L.alerts].sort((x, y) => Number(y.status === "open") - Number(x.status === "open") || Number(isRequired(y)) - Number(isRequired(x)));
  const timeline = insp.timeline || L.player?.timeline || [];
  const stepIdx = timeline.findIndex((x: any) => x.step === L.step);
  const sess = sessions.find((s) => s.session_id === (insp.session_id || insp.session));
  const sid = session || iid;

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

  let primary;
  if (locked) primary = <Link className="btn btn-primary btn-lg w-full" href={`/inspection/${sid}/review`}><Icon name="award" size={18} />Report issued · view approval</Link>;
  else if (running) primary = <Link className="btn btn-primary btn-lg w-full" href={`/lane?lane=${insp.lane_id}`}><Icon name="eye" size={18} />Watch the live sensors</Link>;
  else if (open.length) primary = <Link className="btn btn-primary btn-lg w-full" href={`/inspection/${sid}/findings`}><Icon name="warn" size={18} />Review findings ({open.length})</Link>;
  else primary = <Link className="btn btn-primary btn-lg w-full" href={`/inspection/${sid}/review`}><Icon name="checkc" size={18} />Go to final review</Link>;

  return (
    <Shell>
      <PageHeader eyebrow="Inspection" title="Active Inspection Capture" sub="Capture vehicle images and complete the inspection checklist in real time."
        actions={<><NextAction uc={ucFor(uc, insp)} here={[`/inspection/${sid}`, `/inspection/${iid}`]} /><Link className="btn" href="/inspection"><Icon name="back" size={16} />Back to Queue</Link></>} />
      <StepNav id={sid} at="capture" findings={L.alerts.length} open={open.length} />
      <VehicleStrip insp={insp} />
      {running && (
        <div className="card mb-5 flex flex-wrap items-center gap-4 px-4 py-3" aria-live="polite">
          <span className="flex items-center gap-2 text-[14px] font-semibold">
            {L.player?.status === "playing" && <span className="h-2.5 w-2.5 rounded-full bg-ok pulse-dot" aria-hidden />}
            {stepIdx >= 0 ? `Lane step ${stepIdx + 1} of ${timeline.length}: ${STEP_LABEL[L.step] || L.step}` : "Waiting for the vehicle"}
          </span>
          <div className="min-w-[160px] flex-1"><ProgressBar value={stepIdx >= 0 ? (100 * (stepIdx + 1)) / timeline.length : 3} /></div>
          {sess && canAct && <PlayerControls s={sess} onState={setPlayer} compact onFastDone={L.reload} quiet />}
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.85fr)]">
        <Panel title="Image Capture" sub="Lane cameras fill these in; capture or retake any view: the photo runs through its AI module."
          action={<Source kind="sample" text="Lane frames" />}>
          <div className="grid grid-cols-2 gap-3">
            {VIEWS.map((v) => <CaptureTile key={v.id} view={v.id} label={v.label} c={caps[v.id]} canCapture={canAct && !locked} busy={busy === v.id} onFile={(f) => upload(v.id, f)}
              refPhoto={(REF_VIEW[v.id] || []).map((k) => refs.data?.gallery?.find((g: any) => g.view === k) || (k === "hero" ? refs.data?.hero : null)).find(Boolean)} />)}
            <Link href={`/lane?lane=${insp.lane_id}`} className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-blue-200 bg-blue-50/50 p-4 text-center text-[13px] font-semibold text-[#1D4ED8] hover:bg-blue-50">
              <Icon name="lane" size={26} />Live sensors and charts<span className="text-[11.5px] font-normal text-fg-3">Brake curves, emissions, OBD, e-nose preview</span>
            </Link>
          </div>
        </Panel>
        <Panel title="Inspection Checklist" sub="Verify all items and record results." action={<span className="text-[14px] font-semibold text-cyan">{ck.done}/{ck.total} completed</span>}>
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
        <div className="grid min-w-0 grid-cols-1 gap-5 lg:col-span-2 lg:grid-cols-3 2xl:col-span-1 2xl:flex 2xl:flex-col">
          <Panel title="Inspection Progress">
            <div className="flex items-center gap-5">
              <Ring value={pct} size={128} stroke={13}><span className="text-[28px] font-bold">{pct}%</span></Ring>
              <div className="min-w-0 flex-1">
                <div className="text-[30px] font-bold leading-tight">{ck.done} / {ck.total}</div>
                <div className="text-[13px] text-fg-3">Inspection items completed</div>
                <ProgressBar value={pct} className="mt-3" />
              </div>
            </div>
          </Panel>
          <Panel title={<span className="flex items-center gap-2 text-[18px] font-bold">Detected Issues {L.alerts.length > 0 && <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-100 px-1.5 text-[12px] font-bold text-red-700">{L.alerts.length}</span>}</span>}>
            {!L.alerts.length ? (
              <div className="rounded-xl bg-emerald-50 px-4 py-3 text-[13.5px] text-emerald-800 ring-1 ring-emerald-200">{running ? "No issues detected so far." : "No anomalies detected in this inspection."}</div>
            ) : (
              <ul className="flex max-h-[360px] flex-col gap-2 overflow-y-auto pr-1">
                {issues.slice(0, 8).map((a) => {
                  const img = a.evidence?.image?.annotated;
                  const sev = alertSeverity(a);
                  return (
                    <li key={a.alert_id}>
                      <Link href={`/inspection/${sid}/findings?finding=${a.alert_id}`} className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/70 p-2.5 hover:bg-white">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="" className="h-14 w-16 shrink-0 rounded-xl object-cover" />
                        ) : <IconTile icon={a.system?.includes("Brake") ? "brake" : a.system?.includes("Tyre") ? "tyre" : a.system?.includes("emission") ? "smoke" : a.system?.includes("Identity") ? "user" : "warn"} tone={sev === "critical" ? "red" : "amber"} size={52} />}
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="flex items-center justify-between gap-2"><span className="truncate text-[11.5px] text-fg-3">{a.system}</span>
                            <StatusPill tone={a.status === "open" ? (sev === "critical" ? "red" : "amber") : a.status === "dismissed" ? "green" : "gray"}>{a.status === "open" ? (sev === "critical" ? "Issue" : "Pending") : a.status === "dismissed" ? "Passed" : a.status}</StatusPill></span>
                          <b className="mt-0.5 block truncate text-[13.5px]">{a.title}</b>
                          <span className="block truncate text-[12px] text-fg-3">{a.detail}</span>
                        </span>
                        <Icon name="chev" size={16} color="#94A3B8" />
                      </Link>
                    </li>
                  );
                })}
                {issues.length > 8 && <Link className="text-center text-[13px] font-semibold text-cyan" href={`/inspection/${sid}/findings`}>All {issues.length} findings →</Link>}
              </ul>
            )}
          </Panel>
          <Panel title="Quick Actions" sub="Use these actions to proceed with the inspection.">
            <div className="flex flex-col gap-2.5">
              {primary}
              <div className="grid grid-cols-2 gap-2.5">
                <button className="btn" disabled={!canAct || locked} onClick={() => setRemarkOpen(true)}><Icon name="edit" size={16} />Add Remark</button>
                <Link className="btn" href={`/inspection/${sid}/review`}><Icon name="doc" size={16} />Complete Inspection</Link>
              </div>
              <p className="flex items-center gap-1.5 text-[12px] text-fg-3"><Icon name="checkc" size={14} color="#10B981" />Every result and decision is saved as it happens, in the hash-chained evidence log.</p>
              {(insp.remarks || []).length > 0 && (
                <ul className="mt-1 flex flex-col gap-1.5 border-t border-ink-600/60 pt-2 text-[12.5px]">
                  {insp.remarks.slice(-3).map((r: any, i: number) => <li key={i} className="rounded-lg bg-white/70 px-2.5 py-1.5"><b>{r.by}</b> · {atTime(r.at)}<div className="text-fg-2">{r.text}</div></li>)}
                </ul>
              )}
            </div>
          </Panel>
        </div>
      </div>
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
