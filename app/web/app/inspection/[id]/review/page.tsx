"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { NextAction, refreshUseCase, useActiveUseCase } from "@/components/Demo";
import { IconTile, Panel, Ring, StatusPill, Tone } from "@/components/glass";
import { Icon } from "@/components/icons";
import { ITEM_STATUS, NoInspection, PageLoading, StepNav, atTime, checklistOf, fuelLabel, useInspectionParam } from "@/components/insp";
import { ucFor } from "@/components/insp";
import { Shell } from "@/components/Shell";
import { PageHeader, Source, toast } from "@/components/ui";
import { VehicleArt } from "@/components/VehicleArt";
import { VehicleImage } from "@/components/VehicleImage";
import { api } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { dmy, fmtN, laneLabel, llmLabel } from "@/lib/format";
import { isRequired } from "@/lib/present";

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
  if (rep) issueBtn = <Link className="btn btn-primary btn-lg w-full justify-start" href={`/report?id=${rep.report_id}`}><Icon name="award" size={18} />Certificate issued · open report</Link>;
  else if (running) issueBtn = <button className="btn btn-primary btn-lg w-full justify-start" disabled><Icon name="clock" size={18} />Lane still running</button>;
  else if (openReq) issueBtn = <Link className="btn btn-primary btn-lg w-full justify-start" href={`/inspection/${sid}/findings`}><Icon name="warn" size={18} />Decide {openReq} critical finding{openReq > 1 ? "s" : ""} first</Link>;
  else if (needSenior && !isSenior && !routed) issueBtn = <button className="btn btn-primary btn-lg w-full justify-start" disabled={!!busy || !canAct} onClick={refer}><Icon name="user" size={18} />Refer to the senior examiner</button>;
  else if (needSenior && !isSenior) issueBtn = <button className="btn btn-primary btn-lg w-full justify-start" disabled><Icon name="user" size={18} />Waiting for the senior examiner</button>;
  else issueBtn = <button className="btn btn-primary btn-lg w-full justify-start" disabled={!!busy || !canAct} onClick={issue}><Icon name="award" size={18} />{busy === "issue" ? "Issuing…" : needSenior ? "Sign off and issue certificate" : "Issue Certificate"}</button>;

  const action = (label: string, icon: string, onClick: (() => void) | undefined, disabled: boolean, note?: string, href?: string) => {
    const body = (<><Icon name={icon} size={18} color="#2563EB" /><span className="flex-1 text-left">{label}{note && <span className="block text-[11.5px] font-normal text-fg-3">{note}</span>}</span><Icon name="chev" size={15} color="#94A3B8" /></>);
    return href ? <Link href={href} className="flex items-center gap-3 rounded-xl border border-white/80 bg-white/70 px-3.5 py-2.5 text-[14px] font-medium hover:bg-white">{body}</Link>
      : <button onClick={onClick} disabled={disabled} className="flex items-center gap-3 rounded-xl border border-white/80 bg-white/70 px-3.5 py-2.5 text-[14px] font-medium hover:bg-white disabled:opacity-50">{body}</button>;
  };

  return (
    <Shell>
      <div className="mb-2"><Link href={`/inspection/${sid}`} className="inline-flex items-center gap-1 text-[14px] text-fg-2 hover:text-cyan"><Icon name="back" size={16} />Back to Inspection</Link></div>
      <PageHeader eyebrow="Inspection" title="Final Review and Approval" sub="Review all results and advisory items, then complete the inspection."
        actions={<>
          {user?.role === "presenter" && !rep && (
            <label className="flex items-center gap-2 text-[13px] text-fg-3">Acting as
              <select aria-label="Examiner" className="input w-auto py-1.5" value={examiner} onChange={(e) => setExaminer(e.target.value)}>
                <option value="VE011">Arjun Ismail · Examiner</option><option value="VE001">Priya Hassan · Senior Examiner</option>
              </select>
            </label>
          )}
          <NextAction uc={ucFor(uc, insp)} here={[`/inspection/${sid}/review`, `/inspection/${insp.inspection_id}/review`]} />
        </>} />
      <StepNav id={sid} at="review" findings={L.alerts.length} open={openAll} />

      <section className="card mb-5 grid grid-cols-1 items-center gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto]" aria-label="Outcome"
        style={{ background: `linear-gradient(110deg, ${b.color}14, rgba(255,255,255,0.8) 45%)` }}>
        <div className="flex items-center gap-4 sm:gap-5">
          <span className="flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-full sm:h-[84px] sm:w-[84px]" style={{ background: `${b.color}1A`, boxShadow: `inset 0 0 0 1px ${b.color}40` }}>
            <Icon name={b.icon} size={36} color={b.color} width={2.6} />
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
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 border-ink-600/60 text-[14px] lg:border-l lg:pl-6 [&>dt]:whitespace-nowrap">
          <dt className="text-fg-3">Inspection No.</dt><dd className="font-semibold">{insp.inspection_id}</dd>
          <dt className="text-fg-3">Inspection Date</dt><dd className="font-semibold">{dmy(insp.started_at)}, {atTime(insp.started_at)}</dd>
          <dt className="text-fg-3">Inspection Type</dt><dd className="max-w-[260px] font-semibold">{insp.inspection_type}</dd>
        </dl>
      </section>

      {/* two columns that keep their own heights: what was inspected and found (left), the decision and what follows (right) */}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Vehicle Summary" href={`/vehicles/${encodeURIComponent(insp.plate)}`} actionLabel="Vehicle record">
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
          <Panel title={<span className="flex items-center gap-2 text-[18px] font-bold">{fails.length ? "Failed and Advisory Findings" : "Advisory Findings"} ({fails.length + advis.length})</span>}
            sub={fails.length ? "Failed items must be fixed; advisory items do not affect the result." : pending ? "Findings decided as failed or advisory are listed here." : "Minor issues noted. Not critical and do not affect the pass result."}
            href={`/inspection/${sid}/findings`} actionLabel="View details">
            {!(fails.length + advis.length) ? (
              pending ? <p className="rounded-xl bg-white/70 px-4 py-3 text-[13.5px] text-fg-3 ring-1 ring-ink-600">Nothing decided as failed or advisory yet.</p>
                : <p className="rounded-xl bg-emerald-50 px-4 py-3 text-[13.5px] text-emerald-800 ring-1 ring-emerald-200">No failed or advisory items.</p>
            ) : (
              <ol className="flex flex-col">
                {[...fails, ...advis].map((a, i) => (
                  <li key={a.alert_id} className="flex items-center gap-3 border-b border-ink-600/50 py-2.5 last:border-0">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-[12px] font-bold ring-1 ring-ink-600">{i + 1}</span>
                    <IconTile icon={a.system?.includes("Tyre") ? "tyre" : a.system?.includes("Brake") ? "brake" : a.system?.includes("Lights") ? "lamp" : "warn"} tone={a.fail_item ? "red" : "amber"} size={36} />
                    <span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-[13.5px]">{a.title}</b><span className="block truncate text-[12px] text-fg-3">{a.evidence?.recommendation ? `${a.evidence.recommendation} · ` : ""}{a.reason || a.detail}</span></span>
                    <StatusPill tone={a.fail_item && a.status === "confirmed" ? "red" : "amber"}>{a.fail_item && a.status === "confirmed" ? "Fail" : "Advisory"}</StatusPill>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Certificate Status">
            <div className={`mb-4 flex items-center gap-4 rounded-2xl p-4 ring-1 ${rep ? "bg-emerald-50 ring-emerald-200" : ready && verdict !== "FAIL" ? "bg-emerald-50/70 ring-emerald-200" : verdict === "FAIL" ? "bg-red-50 ring-red-100" : "bg-amber-50 ring-amber-200"}`}>
              <IconTile icon={rep ? "award" : ready ? "doc" : "clock"} tone={rep || (ready && verdict !== "FAIL") ? "green" : verdict === "FAIL" ? "red" : "amber"} size={56} />
              <div>
                <div className="text-[20px] font-bold" style={{ color: rep ? "#047857" : verdict === "FAIL" ? "#B91C1C" : ready ? "#047857" : "#B45309" }}>
                  {rep ? "Issued" : verdict === "FAIL" && ready ? "Re-inspection required" : ready ? "Ready to Issue" : "Not ready yet"}
                </div>
                <div className="text-[13px] text-fg-2">
                  {rep ? `${rep.kind} · ${dmy(rep.created_at)}` : verdict === "FAIL" && ready ? "Issue the report; a certificate follows a passed re-inspection." : ready ? "Every critical finding is decided. The certificate can be issued now." : running ? "The lane is still running." : `${openReq} critical finding${openReq === 1 ? "" : "s"} to decide.`}
                </div>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-[14px] [&>dt]:whitespace-nowrap">
              <dt className="text-fg-3">Certificate type</dt><dd className="font-semibold">{verdict === "CONDITIONAL" ? "EV Health Certificate (conditional)" : insp.fusion?.report_kind || insp.inspection_type}</dd>
              <dt className="text-fg-3">Validity</dt><dd>{verdict === "FAIL" ? "None until a passed re-inspection" : "12 months from issue (demo assumption)"}</dd>
              <dt className="text-fg-3">Remarks</dt><dd>{advis.length ? `With ${advis.length} advisory item${advis.length > 1 ? "s" : ""}` : fails.length ? `${fails.length} failed item${fails.length > 1 ? "s" : ""}` : "None"}</dd>
              <dt className="text-fg-3">Examiner</dt><dd>{insp.examiner?.name}{insp.examiner?.senior ? " (Senior Examiner)" : ""}</dd>
            </dl>
          </Panel>
          <Panel title="Actions">
            <div className="flex flex-col gap-2.5">
              {issueBtn}
              {action(sent ? "Report sent to the owner" : "Send Report to Owner", "send", send, !rep || sent || !canAct || busy === "send", "Mock: recorded only")}
              {(verdict === "FAIL" || verdict === "REFERRED") && action(rebook ? `Re-inspection ${dmy(rebook.date)} ${rebook.slot}` : "Schedule Reinspection", "calendar", reinspect, !rep || !!rebook || !canAct || busy === "rebook", rebook ? rebook.branch_name : "First free slot from tomorrow")}
              {action("Finish Inspection", "checkc", () => router.push("/"), !rep, "Back to the dashboard")}
            </div>
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
                {rep ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link className="btn btn-sm" href={`/report?id=${rep.report_id}`}><Icon name="eye" size={15} />Preview Report</Link>
                    <Link className="btn btn-sm" href={`/verify/${rep.verify_token}`}><Icon name="checkc" size={15} />Public verification</Link>
                  </div>
                ) : <Source kind="live_logic" text="Hash chain on issue" className="mt-3" />}
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
      <p className="mt-4 text-[12px] text-fg-4">{laneLabel(insp.lane_id)} · {insp.branch_name} · decisions and the report are hash-chained in the evidence log.</p>
    </Shell>
  );
}
