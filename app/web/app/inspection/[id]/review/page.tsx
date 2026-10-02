"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode, use, useState } from "react";
import { NextAction, refreshUseCase, useActiveUseCase } from "@/components/Demo";
import { IconTile, Panel, Ring, StatusPill, Tone } from "@/components/glass";
import { Icon } from "@/components/icons";
import { ITEM_STATUS, NoInspection, PageLoading, StepNav, atTime, checklistOf, fuelLabel, useInspectionParam } from "@/components/insp";
import { ucFor, ucUnlessSame } from "@/components/insp";
import { Shell } from "@/components/Shell";
import { PageHeader, Source, toast } from "@/components/ui";
import { VehicleArt } from "@/components/VehicleArt";
import { VehicleImage } from "@/components/VehicleImage";
import { api } from "@/lib/api";
import { useAssistantContext } from "@/lib/assistantContext";
import { useUser } from "@/lib/auth";
import { dmy, fmtN, laneLabel, llmLabel, scoreColor } from "@/lib/format";
import { SEVERITY, isRequired, scoreSeverity } from "@/lib/present";

const BANNER: Record<string, { word: string; tone: Tone; color: string; text: string; icon: string }> = {
  PASS: { word: "Passed", tone: "green", color: "#059669", text: "The vehicle meets the inspection requirements", icon: "check" },
  FAIL: { word: "Failed", tone: "red", color: "#DC2626", text: "At least one item fails: it must be fixed and re-inspected", icon: "close" },
  CONDITIONAL: { word: "Conditional", tone: "amber", color: "#D97706", text: "EV Health Certificate with conditions: EV findings were confirmed", icon: "warn" },
  REFERRED: { word: "Referred", tone: "blue", color: "#2563EB", text: "Identity checks need a senior examiner's sign-off before a certificate", icon: "user" },
};
const PENDING = { word: "Pending", tone: "amber" as Tone, color: "#B45309", text: "", icon: "clock" };

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { L, session } = useInspectionParam(id);
  const user = useUser();
  const { active: uc } = useActiveUseCase();
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setExaminer] = useState("VE011");
  const [sent, setSent] = useState(false);
  const [rebook, setRebook] = useState<any>(null);
  const insp = L.insp;
  useAssistantContext(insp ? { inspection_id: insp.inspection_id, plate: insp.plate } : {});
  if (!insp) return <Shell>{L.notFound ? <NoInspection id={id} /> : <PageLoading />}</Shell>;
  const sid = session || insp.inspection_id;
  const examiner = user?.examiner_id || picked;
  const isSenior = user?.examiner_id ? !!user.senior : examiner === "VE001";
  const canAct = (user?.role === "presenter" || user?.role === "examiner");
  const ck = checklistOf(insp, L.alerts, L.step);
  const rep = insp.report;
  const pv = insp.verdict_preview || {};
  const openReq = L.alerts.filter((a) => a.status === "open" && isRequired(a)).length;
  const openAll = L.alerts.filter((a) => a.status === "open").length;
  const verdict: string = rep?.verdict || pv.verdict || "PASS";
  const needSenior = insp.route === "senior" && !rep;
  const routed = insp.examiner?.id === "VE001";
  const running = insp.status === "in_lane";
  const ready = !running && openReq === 0 && !rep;
  const pending = !rep && (running || openReq > 0);  // the outcome is not known yet: no green or red verdict
  const b = pending ? PENDING : BANNER[verdict] || BANNER.PASS;
  const advis = L.alerts.filter((a) => a.status === "advisory" || (a.status === "confirmed" && !a.fail_item));
  const fails = L.alerts.filter((a) => a.status === "confirmed" && a.fail_item);
  const v = insp.vehicle || {};
  const o = insp.owner || {};
  const pct = Math.round((100 * ck.done) / ck.total);
  const booking = insp.booking;

  const issue = async () => {
    setBusy("issue");
    try {
      const r = await api.post(`/api/inspections/${insp.inspection_id}/report`, { examiner_id: examiner, senior_signed: isSenior });
      toast(`Certificate issued: ${r.verdict}`, "ok");
      refreshUseCase();
      await L.reload();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  };
  const refer = async () => {
    setBusy("refer");
    try {
      await api.post(`/api/inspections/${insp.inspection_id}/route-senior`, { examiner_id: examiner, senior_id: "VE001", note: "Identity checks disagree" });
      if (!user?.examiner_id) setExaminer("VE001");
      toast("Referred to the senior examiner, Priya Hassan", "ok");
      refreshUseCase();
      await L.reload();
    } finally {
      setBusy(null);
    }
  };
  const send = async () => {
    setBusy("send");
    try {
      await api.post(`/api/inspections/${insp.inspection_id}/send-report`);
      setSent(true);
      toast("Report sent to the owner (mock: recorded, no message leaves the demo)", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  };
  const reinspect = async () => {
    setBusy("rebook");
    try {
      const bk = await api.post(`/api/inspections/${insp.inspection_id}/reinspection`);
      setRebook(bk);
      toast(`Re-inspection booked: ${dmy(bk.date)} ${bk.slot} at ${bk.branch_name}`, "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  };

  let issueBtn;
  if (rep) issueBtn = null;
  else if (running) issueBtn = <button className="btn btn-primary btn-lg w-full" disabled><Icon name="clock" size={18} />Lane still running</button>;
  else if (openReq) issueBtn = <Link className="btn btn-primary btn-lg w-full" href={`/inspection/${sid}/findings`}><Icon name="warn" size={18} />Decide {openReq} critical finding{openReq > 1 ? "s" : ""} first</Link>;
  else if (needSenior && !isSenior && !routed) issueBtn = <button className="btn btn-primary btn-lg w-full" disabled={!!busy || !canAct} onClick={refer}><Icon name="user" size={18} />Refer to the senior examiner</button>;
  else if (needSenior && !isSenior) issueBtn = <button className="btn btn-primary btn-lg w-full" disabled><Icon name="user" size={18} />Waiting for the senior examiner</button>;
  else issueBtn = <button className="btn btn-primary btn-lg w-full" disabled={!!busy || !canAct} onClick={issue}><Icon name="award" size={18} />{busy === "issue" ? "Issuing…" : needSenior ? "Sign off and issue certificate" : "Issue Certificate"}</button>;
  const issueNote = running ? "The outcome is known once every lane step has finished."
    : openReq ? "The final review opens once every critical finding has a decision."
    : needSenior && !isSenior ? (routed ? "Referred: the senior examiner signs this report off." : "Identity checks disagree: a senior examiner signs this report off.")
    : !canAct ? "Only an examiner can issue the report."
    : verdict === "FAIL" ? "Issues the FAIL report with its QR code; a certificate follows a passed re-inspection."
    : "Creates the report, its QR code and its entry in the evidence chain.";

  const hs: number | null = insp.fusion?.health?.score ?? insp.health_score ?? null;
  const sev = scoreSeverity(hs);
  const decidedN = L.alerts.length - openAll;
  const reportStatus = rep ? "Issued" : verdict === "FAIL" && ready ? "Re-inspection required" : ready ? "Ready to Issue" : "Not ready yet";
  const reportSub = rep ? `${rep.report_id} · ${dmy(rep.created_at)} ${atTime(rep.created_at)}` : running ? "The lane is still running" : openReq ? `${openReq} critical finding${openReq === 1 ? "" : "s"} to decide` : needSenior && !isSenior ? "Needs the senior examiner" : "Every critical finding is decided";
  const ucx = ucFor(uc, insp);
  const here = [`/inspection/${sid}/review`, `/inspection/${insp.inspection_id}/review`, `/inspection/${insp.session_id}/review`];
  const plateQ = encodeURIComponent(insp.plate);
  const passport = `/mobile/vehicle?plate=${plateQ}`;
  // the use case's next step may already be one of the links below: show it once
  const nextHref = ucx && !ucx.complete ? ucx.next?.href : null;
  const individual = o.type === "individual";
  const keyFindings = [...L.alerts.filter((a) => a.status === "open" && isRequired(a)), ...fails, ...advis];
  const SHOW_KEY = 6;
  const fact = (k: string, val: ReactNode, sub?: ReactNode) => (
    <div className="min-w-0 rounded-xl bg-white/75 px-3.5 py-2.5 ring-1 ring-ink-600/70">
      <dt className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-fg-3">{k}</dt>
      <dd className="mt-0.5 text-[15px] font-bold leading-snug">{val}</dd>
      {sub && <dd className="truncate text-[12px] text-fg-3">{sub}</dd>}
    </div>
  );

  return (
    <Shell>
      <div className="mb-2"><Link href={`/inspection/${sid}`} className="inline-flex items-center gap-1 text-[14px] text-fg-2 hover:text-cyan"><Icon name="back" size={16} />Back to Inspection</Link></div>
      <PageHeader eyebrow="Inspection" title="Final Review and Approval" sub="The outcome these decisions lead to, the key findings, and issuing the report."
        actions={<>
          {user?.role === "presenter" && !rep && (
            <label className="flex items-center gap-2 text-[13px] text-fg-3">Acting as
              <select aria-label="Examiner" className="input w-auto py-1.5" value={examiner} onChange={(e) => setExaminer(e.target.value)}>
                <option value="VE011">Arjun Ismail · Examiner</option><option value="VE001">Priya Hassan · Senior Examiner</option>
              </select>
            </label>
          )}
          {!rep && <NextAction uc={ucUnlessSame(uc, insp, openReq && !running ? "/inspection/{id}/findings" : null)} here={here} />}
        </>} />
      <StepNav id={sid} at="review" findings={L.alerts.length} open={openAll} />

      {/* the completion point: who, when, the outcome, and the one action (then what follows it) */}
      <section className="card mb-5 p-4 sm:p-5" aria-label="Outcome" style={{ background: `linear-gradient(110deg, ${b.color}14, rgba(255,255,255,0.82) 45%)` }}>
        <div className="flex min-w-0 items-center gap-3.5 border-b border-ink-600/60 pb-4">
          <Link href={`/vehicles/${plateQ}`} className="block h-[60px] w-[92px] shrink-0 overflow-hidden rounded-xl bg-gradient-to-b from-[#F1F5FB] to-[#E3EAF5] sm:h-[72px] sm:w-[112px]" aria-label={`${insp.plate}: vehicle record`}>
            {insp.photo ? <VehicleImage plate={insp.plate} vtype={o.vtype} photo={insp.photo} size="480" className="h-full w-full" /> : <VehicleArt vtype={o.vtype} seed={insp.plate} className="h-full w-full" />}
          </Link>
          <div className="min-w-0 leading-tight">
            <div className="flex flex-wrap items-baseline gap-x-2.5"><span className="whitespace-nowrap text-[22px] font-extrabold tracking-tight sm:text-[24px]">{insp.plate}</span><span className="text-[14px] text-fg-2">{[v.make, v.model, v.year || o.year].filter(Boolean).join(" ")}</span></div>
            <div className="mt-1 text-[13px] text-fg-2">{insp.inspection_type}</div>
            <div className="mt-0.5 text-[12.5px] text-fg-3">Inspected {dmy(insp.started_at)}, {atTime(insp.started_at)} · {laneLabel(insp.lane_id)} · <span className="font-mono text-[11.5px]">{insp.inspection_id}</span></div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 items-center gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full sm:h-[72px] sm:w-[72px]" style={{ background: `${b.color}1A`, boxShadow: `inset 0 0 0 1px ${b.color}40` }}>
              <Icon name={b.icon} size={32} color={b.color} width={2.6} />
            </span>
            <div className="min-w-0">
              {pending ? (
                <h2 className="text-[26px] font-extrabold tracking-tight sm:text-[32px]" style={{ color: b.color }}>Decision pending</h2>
              ) : (
                <h2 className="text-[26px] font-extrabold tracking-tight sm:text-[32px]">Inspection <span style={{ color: b.color }}>{b.word}</span>{!rep && <span className="ml-2 align-middle text-[13px] font-semibold text-fg-3">(if issued now)</span>}</h2>
              )}
              <p className="mt-1 max-w-[620px] text-[14.5px] text-fg-2">
                {running ? "The lane is still running: the outcome is known once every step has finished." : openReq ? `${openReq} critical finding${openReq > 1 ? "s" : ""} still need${openReq > 1 ? "" : "s"} a decision. The outcome follows from those decisions.` : `${b.text}${advis.length ? `, with ${advis.length} advisory item${advis.length > 1 ? "s" : ""}` : ""}.`}
              </p>
            </div>
          </div>
          {!rep && (
            <div className="flex min-w-0 flex-col gap-1.5">
              {issueBtn}
              <p className="text-[12px] leading-snug text-fg-3">{issueNote}</p>
            </div>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {fact("Health score", hs != null ? <><span style={{ color: scoreColor(hs) }}>{Math.round(hs)}</span><span className="text-[13px] font-semibold text-fg-3"> / 100</span></> : <span className="text-fg-3">Not scored yet</span>,
            sev ? SEVERITY[sev].label : running ? "Scored when the lane finishes" : undefined)}
          {fact("Findings", L.alerts.length ? `${decidedN} of ${L.alerts.length} decided` : "None", L.alerts.length ? `${fails.length} fail · ${advis.length} advisory${openAll ? ` · ${openAll} open` : ""}` : "Nothing to decide")}
          {fact("Examiner", <span className="block truncate">{insp.examiner?.name || "–"}{insp.examiner?.senior ? " (Senior Examiner)" : ""}</span>, insp.examiner?.senior ? "Senior sign-off" : needSenior ? "Senior sign-off needed" : undefined)}
          {fact("Report status", <span style={{ color: rep ? "#047857" : verdict === "FAIL" && ready ? "#B91C1C" : ready ? "#047857" : "#B45309" }}>{reportStatus}</span>, reportSub)}
        </dl>

        {rep && (
          <div className="mt-4 rounded-2xl bg-emerald-50/90 p-4 ring-1 ring-emerald-200" role="status">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <Link href={`/report?id=${rep.report_id}`} className="inline-flex items-center gap-2 text-[17px] font-bold text-[#047857] hover:underline">
                  <Icon name="award" size={20} />Certificate issued · open report<Icon name="arrow" size={16} />
                </Link>
                <p className="mt-0.5 text-[13px] text-fg-2">{rep.kind} · {rep.report_id} · anyone can check it with the QR code.</p>
              </div>
              {verdict === "FAIL" && (rebook ? (
                <div className="flex items-center gap-2.5 rounded-xl bg-white/90 px-3.5 py-2.5 text-[13.5px] ring-1 ring-emerald-200">
                  <Icon name="calendar" size={18} color="#047857" /><span><b>Re-inspection booked</b> · {dmy(rebook.date)} {rebook.slot}<span className="block text-[12px] text-fg-3">{rebook.branch_name}</span></span>
                </div>
              ) : (
                <button className="btn btn-primary btn-lg shrink-0" disabled={!canAct || busy === "rebook"} onClick={reinspect}><Icon name="calendar" size={18} />{busy === "rebook" ? "Booking…" : "Schedule Reinspection"}</button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-emerald-200/80 pt-3">
              {ucx && <NextAction uc={ucx} here={here} />}
              <Link className="btn" href={`/report?id=${rep.report_id}`}><Icon name="doc" size={15} />View Report</Link>
              <Link className="btn" href={`/verify/${rep.verify_token}`}><Icon name="qr" size={15} />Verify by QR</Link>
              {nextHref?.split(/[?#]/)[0] !== `/vehicles/${plateQ}` && <Link className="btn" href={`/vehicles/${plateQ}`}><Icon name="car" size={15} />View Vehicle Record</Link>}
              {individual && nextHref !== passport && <Link className="btn" href={passport}><Icon name="owner" size={15} />Open Owner Passport</Link>}
              <button className="btn" disabled={sent || !canAct || busy === "send"} onClick={send}><Icon name="send" size={15} />{sent ? "Report sent to the owner" : busy === "send" ? "Sending…" : "Send Report to Owner"}</button>
              {verdict === "REFERRED" && (
                <button className="btn" disabled={!!rebook || !canAct || busy === "rebook"} onClick={reinspect}><Icon name="calendar" size={15} />{rebook ? `Re-inspection booked · ${dmy(rebook.date)} ${rebook.slot}` : "Schedule Reinspection"}</button>
              )}
              <button className="ml-auto text-[13px] font-semibold text-fg-3 hover:text-cyan" onClick={() => router.push("/")}>Finish Inspection</button>
            </div>
            <p className="mt-2 text-[11.5px] text-fg-3">Sending is a mock: it is recorded, no message leaves the demo.</p>
          </div>
        )}
      </section>

      {/* what was found and inspected (left), the certificate and the record (right) */}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title={<span className="flex items-center gap-2 text-[18px] font-bold">Key findings ({keyFindings.length})</span>}
            sub={pending && openReq ? "Critical findings still to decide come first, then failed and advisory items." : fails.length ? "Failed items must be fixed; advisory items do not affect the result." : "Minor issues noted. Not critical and do not affect the pass result."}
            href={L.alerts.length ? `/inspection/${sid}/findings` : undefined} actionLabel={`All ${L.alerts.length} findings`}>
            {!keyFindings.length ? (
              pending ? <p className="rounded-xl bg-white/70 px-4 py-3 text-[13.5px] text-fg-3 ring-1 ring-ink-600">Nothing decided as failed or advisory yet.</p>
                : <p className="rounded-xl bg-emerald-50 px-4 py-3 text-[13.5px] text-emerald-800 ring-1 ring-emerald-200">{L.alerts.length ? "No failed or advisory items." : "No anomalies: every measurement is within its limit and the AI modules found nothing."}</p>
            ) : (
              <ol className="flex flex-col">
                {keyFindings.slice(0, SHOW_KEY).map((a, i) => {
                  const isOpen = a.status === "open";
                  const isFail = a.fail_item && a.status === "confirmed";
                  return (
                    <li key={a.alert_id}>
                      <Link href={`/inspection/${sid}/findings?finding=${a.alert_id}`} className="flex items-center gap-3 border-b border-ink-600/50 py-2.5 hover:bg-white/60">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-[12px] font-bold ring-1 ring-ink-600">{i + 1}</span>
                        <IconTile icon={a.system?.includes("Tyre") ? "tyre" : a.system?.includes("Brake") ? "brake" : a.system?.includes("Lights") ? "lamp" : "warn"} tone={isOpen ? "purple" : a.fail_item ? "red" : "amber"} size={36} />
                        <span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-[13.5px]">{a.title}</b><span className="block truncate text-[12px] text-fg-3">{a.evidence?.recommendation ? `${a.evidence.recommendation} · ` : ""}{a.reason || a.detail}</span></span>
                        <StatusPill tone={isOpen ? "purple" : isFail ? "red" : "amber"}>{isOpen ? "To decide" : isFail ? "Fail" : "Advisory"}</StatusPill>
                      </Link>
                    </li>
                  );
                })}
                {keyFindings.length > SHOW_KEY && <li className="pt-2.5 text-[13px]"><Link className="font-semibold text-cyan hover:underline" href={`/inspection/${sid}/findings`}>+{keyFindings.length - SHOW_KEY} more</Link></li>}
              </ol>
            )}
          </Panel>
          <Panel title={`Inspection Checklist (${ck.done === ck.total ? "Completed" : `${ck.done} of ${ck.total}`})`} href={`/inspection/${sid}`} actionLabel="View full checklist">
            <div className="grid grid-cols-1 items-center gap-5 md:grid-cols-[150px_minmax(0,1fr)]">
              <div className="justify-self-center md:justify-self-start"><Ring value={pct} size={140} stroke={14} color={pct === 100 ? "#10B981" : "#2563EB"}><span className="text-[26px] font-bold">{ck.done} / {ck.total}</span><span className="text-[11.5px] text-fg-3">Items completed</span></Ring></div>
              <ul className="grid grid-cols-1 gap-x-6 2xl:grid-cols-2">
                {ck.items.map((it) => (
                  <li key={it.id} className="flex min-w-0 items-center gap-2.5 border-b border-ink-600/50 py-2 text-[13.5px] 2xl:[&:nth-last-child(-n+2)]:border-0 [&:last-child]:border-0">
                    <Icon name={it.icon} size={17} color="#64748B" />
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {it.findings > 0 && <span className="whitespace-nowrap text-[12px] text-fg-3" title={`${it.findings - it.open} of ${it.findings} findings decided`}>{it.findings - it.open}/{it.findings}</span>}
                    <StatusPill tone={ITEM_STATUS[it.status].tone}>{ITEM_STATUS[it.status].label}</StatusPill>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
          <Panel title="Vehicle Summary" href={`/vehicles/${plateQ}`} actionLabel="Vehicle record">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-[200px_minmax(0,1fr)]">
              <div className="flex h-[150px] items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-b from-[#F1F5FB] to-[#E3EAF5]">{insp.photo ? <VehicleImage plate={insp.plate} vtype={o.vtype} photo={insp.photo} className="h-full w-full" /> : <VehicleArt vtype={o.vtype} seed={insp.plate} className="h-[130px] w-[190px]" />}</div>
              <div className="min-w-0 text-[14px]">
                <dl className="grid grid-cols-[minmax(96px,auto)_minmax(0,1fr)] content-start gap-x-5 gap-y-1.5 [&>dt]:whitespace-nowrap">
                  <dt className="text-fg-3">Vehicle No.</dt><dd className="font-bold">{insp.plate}</dd>
                  <dt className="text-fg-3">Vehicle Type</dt><dd>{o.vtype || "–"}</dd>
                  <dt className="text-fg-3">Make / Model</dt><dd>{v.make} {v.model}</dd>
                  <dt className="text-fg-3">Year</dt><dd>{v.year || o.year}</dd>
                  <dt className="text-fg-3">Fuel Type</dt><dd>{fuelLabel(v.fuel || o.fuel) || "–"}</dd>
                  <dt className="text-fg-3">Odometer</dt><dd>{fmtN(insp.measurements?.odometer_km ?? o.odometer_km)} km</dd>
                </dl>
                <div className="mt-3 border-t border-ink-600/60 pt-3">
                  <div className="mb-1.5 flex items-center gap-2 font-bold"><Icon name="user" size={17} />Owner Details</div>
                  <dl className="grid grid-cols-[minmax(96px,auto)_minmax(0,1fr)] gap-x-5 gap-y-1.5 [&>dt]:whitespace-nowrap">
                    <dt className="text-fg-3">Name</dt><dd>{o.name || "–"}</dd>
                    <dt className="text-fg-3">Registered in</dt><dd>{o.state || "–"}</dd>
                    <dt className="text-fg-3">Road tax until</dt><dd>{dmy(o.mvl_expiry)}</dd>
                  </dl>
                  <p className="mt-2 text-[11.5px] text-fg-4">Identity and contact details are not stored in this demo.</p>
                </div>
              </div>
            </div>
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Certificate Details">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-[14px] [&>dt]:whitespace-nowrap">
              <dt className="text-fg-3">Certificate type</dt><dd className="font-semibold">{verdict === "CONDITIONAL" ? "EV Health Certificate (conditional)" : insp.fusion?.report_kind || insp.inspection_type}</dd>
              <dt className="text-fg-3">Validity</dt><dd>{verdict === "FAIL" ? "None until a passed re-inspection" : "12 months from issue (demo assumption)"}</dd>
              <dt className="text-fg-3">Remarks</dt><dd>{advis.length ? `With ${advis.length} advisory item${advis.length > 1 ? "s" : ""}` : fails.length ? `${fails.length} failed item${fails.length > 1 ? "s" : ""}` : "None"}</dd>
              <dt className="text-fg-3">Examiner</dt><dd>{insp.examiner?.name}{insp.examiner?.senior ? " (Senior Examiner)" : ""}</dd>
              <dt className="text-fg-3">Hub</dt><dd>{insp.branch_name} · {laneLabel(insp.lane_id)}</dd>
            </dl>
            {!rep && <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-[12.5px] text-fg-3 ring-1 ring-ink-600">Once issued: send the report to the owner{verdict === "FAIL" || verdict === "REFERRED" ? ", schedule the re-inspection" : ""}, and anyone can verify it by its QR code.</p>}
          </Panel>
          <Panel title="Digital Report Preview" href={rep ? `/report?id=${rep.report_id}` : undefined} actionLabel="View full report">
            <div className="flex flex-wrap items-center gap-5">
              <div className="relative h-[150px] w-[120px] shrink-0 overflow-hidden rounded-xl bg-white p-2.5 shadow-lg ring-1 ring-ink-600">
                <div className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-cyan" /><span className="text-[7px] font-bold">VehicleSense</span></div>
                <div className="mt-1 text-[6.5px] font-bold uppercase tracking-wide">Vehicle inspection report</div>
                <VehicleArt vtype={o.vtype} seed={insp.plate} className="mx-auto my-1.5 h-[34px] w-[80px]" />
                {[70, 90, 60, 80].map((w, i) => <div key={i} className="mb-1 h-1 rounded bg-ink-700" style={{ width: `${w}%` }} />)}
                {rep ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/reports/${rep.report_id}/qr.svg`} alt="" className="absolute bottom-2 right-2 h-9 w-9" />
                ) : <span className="absolute bottom-2 right-2 h-9 w-9 rounded bg-ink-700" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold">Inspection Report</div>
                <div className="text-[14px] text-fg-2">{rep ? rep.report_id : "Not issued yet"}</div>
                <div className="text-[12.5px] text-fg-3">{rep ? `${rep.kind} · ${llmLabel(rep.summary_source) ? "summary by the local LLM" : "template summary"}` : "Generated, hash-chained and QR-verifiable when issued"}</div>
              </div>
            </div>
          </Panel>
          <Panel title="Payment & Receipt" action={<Source kind="mock" text="Mock gateway" />}>
            {booking ? (
              <div className="text-[14px]">
                <div className="flex justify-between gap-3 py-1"><span className="flex min-w-0 items-center gap-2 text-fg-2"><Icon name="doc" size={16} className="shrink-0" />{booking.type_label}</span><span className="shrink-0 whitespace-nowrap">RM {booking.price_rm.toFixed(2)}</span></div>
                {booking.gear && <div className="flex justify-between py-1 text-fg-2"><span className="pl-6">Express slot</span><span>incl.</span></div>}
                <div className="mt-2 flex justify-between border-t border-ink-600/60 pt-2 text-[17px] font-bold"><span>Total Paid</span><span className="whitespace-nowrap">RM {booking.price_rm.toFixed(2)}</span></div>
                <div className="mt-3 flex items-center gap-3 rounded-2xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
                  <IconTile icon="check" tone="green" size={40} />
                  <div className="leading-tight"><b className="text-emerald-700">Paid</b><div className="text-[12px] text-fg-2">{booking.payment_ref} · booked {dmy(booking.date)} {booking.slot}</div></div>
                </div>
              </div>
            ) : (
              <div className="text-[13.5px] text-fg-2">
                <div className="flex items-center gap-3 rounded-2xl bg-white/70 p-3 ring-1 ring-ink-600"><IconTile icon="card" tone="gray" size={40} /><div className="leading-tight"><b>Walk-in</b><div className="text-[12px] text-fg-3">Paid at the counter: not recorded in this demo.</div></div></div>
                <p className="mt-2 text-[12px] text-fg-4">Vehicles booked in the owner app show their (mock) payment here.</p>
              </div>
            )}
          </Panel>
        </div>
      </div>
      {/* the proof, kept quiet: where the decisions are recorded and where each finding's data comes from */}
      <details className="mt-5 rounded-2xl bg-white/60 px-4 py-3 ring-1 ring-ink-600/70">
        <summary className="cursor-pointer text-[13.5px] font-semibold text-fg-2">Proof: evidence chain and data sources</summary>
        <div className="mt-3 flex flex-col gap-2.5 text-[13px] text-fg-2">
          <p className="flex flex-wrap items-center gap-2"><Source kind="live_logic" text="Hash chain" />Every decision, remark and the report are appended to the hash-chained evidence log as they happen.</p>
          {rep?.chain_hash && <div><div className="text-[12px] text-fg-3">Report anchor (SHA-256)</div><div className="break-all font-mono text-[11.5px]">{rep.chain_hash}</div></div>}
          {L.alerts.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5">Findings come from: {Array.from(new Set(L.alerts.map((a) => a.source))).map((k) => <Source key={k} kind={k} />)}</p>
          )}
          <Link href="/oversight/hq#audit" className="text-cyan hover:underline">Open the audit log →</Link>
        </div>
      </details>
      <p className="mt-4 text-[12px] text-fg-4">{laneLabel(insp.lane_id)} · {insp.branch_name} · decisions and the report are hash-chained in the evidence log.</p>
    </Shell>
  );
}
