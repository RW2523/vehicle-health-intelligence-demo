"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useActiveUseCase } from "@/components/Demo";
import { VehicleHealthSummary } from "@/components/Health";
import { InspectionContextBar } from "@/components/InspectionContextBar";
import { Icon } from "@/components/icons";
import { AlertMini, BrakeChart, ENoseChart, Frames, Instruments, OBDChart, PNChart, Timeline } from "@/components/lanebits";
import { LiveLaneView } from "@/components/LiveLaneView";
import { useVehiclePhotos } from "@/components/Photo";
import { PlayerControls, useSessions } from "@/components/Player";
import { Shell } from "@/components/Shell";
import { VisionPanel } from "@/components/VisionPanel";
import { Card, LoadingState, Modal, PageHeader, Pill, Source, Tabs } from "@/components/ui";
import { useAssistantContext } from "@/lib/assistantContext";
import { useUser } from "@/lib/auth";
import { LANE_SESSIONS, SYSTEM_NAME, fmtN } from "@/lib/format";
import { useInspection } from "@/lib/inspection";

const LANES = LANE_SESSIONS.map((l) => ({ id: l.lane, label: l.label, session: l.session, plate: l.plate, car: l.car }));
const STORY: Record<string, string> = {
  S1: "a Commercial Periodic Inspection: particle number, brakes, tyres and the undercarriage",
  S2: "an EV Health Check with an ownership transfer and financing inspection: battery health, flood evidence and EV fault codes",
  S3: "an Ownership Transfer Inspection: plate, chassis number, odometer and engine sound are checked against its history",
  S7: "a Voluntary Inspection: every lane step, for a car in good condition",
};
/** The body type of each replay vehicle (its illustration while its photo loads). */
const VTYPE: Record<string, string> = { S1: "Prime mover", S2: "SUV", S3: "Sedan", S7: "Hatchback" };

function LaneConsole() {
  const sp = useSearchParams();
  const router = useRouter();
  const user = useUser();
  const vision = sp.get("view") === "vision";
  const laneInfo = LANES.find((l) => l.id === sp.get("lane")) || LANES[0];
  const lane = laneInfo.id;
  const L = useInspection({ lane });
  const { sessions, setPlayer } = useSessions();
  const { active: uc } = useActiveUseCase();
  const sess = sessions.find((x) => x.session_id === laneInfo.session);
  const [zoom, setZoom] = useState<any>(null);
  const insp = L.insp;
  const r = L.results;
  const presenter = user?.role === "presenter" || user?.role === "examiner";
  const controls = sess && presenter ? <PlayerControls s={sess} onState={setPlayer} compact onFastDone={L.reload} quiet={!!L.insp} /> : null;
  const loading = !insp && !L.notFound;
  const running = insp?.status === "in_lane";
  const timeline = insp?.timeline || L.player?.timeline || [];
  const lastStep = L.step === "done" || (!running && !!insp);
  // the replay clock: the lane channel's player, else the session list's (it keeps the last state after a reload)
  const sessPlayer = sess?.player && insp && sess.player.inspection_id === insp.inspection_id ? sess.player : null;
  const refs = useVehiclePhotos(!vision && L.notFound ? laneInfo.plate : null);
  // the floating assistant answers "what's on this lane?" about this lane and its inspection
  useAssistantContext(vision ? {} : { lane_id: lane, plate: insp?.plate || laneInfo.plate, inspection_id: insp?.inspection_id || null,
                                      label: `${laneInfo.label}${insp ? ` · ${insp.plate}` : ""}` });

  let cta = null;
  if (insp?.report) cta = <Link className="btn btn-primary" href={`/report?id=${insp.report.report_id}`}>View the report ({insp.report.verdict})<Icon name="arrow" size={15} /></Link>;
  else if (insp && !running) cta = <Link className="btn btn-primary" href={`/inspection/${laneInfo.session}/findings`}>Review AI findings<Icon name="arrow" size={15} /></Link>;

  const nMeasured = Object.keys(r.instruments || {}).length + (r.brakes ? 1 : 0) + (r.pn ? 1 : 0);
  const nAi = (r.images || []).length + (r.acoustic || []).length + (r.anpr ? 1 : 0) + (r.chassis ? 1 : 0);

  return (
    <Shell context={<Pill color={L.connected ? "#059669" : "#64748B"}>{L.connected ? "Live" : "Connecting…"}</Pill>}>
      <PageHeader eyebrow="Live Lane" title={vision ? "AI vision" : "Lane console"}
        sub={vision ? "The platform's AI inspection modules (undercarriage, above-carriage and tyre) on inspection captures and the image library. Run the live models on any capture, a curated photo or your own upload."
          : "What the lane sees as it happens: what it has found first, then the evidence, then the raw readings."}>
        <div className="mt-3 flex max-w-full flex-wrap items-center gap-3">
          <div className="flex shrink-0 gap-1 rounded-full border border-white/80 bg-white/70 p-1 shadow-glass" role="tablist" aria-label="Live Lane view">
            {[{ id: "lane", label: "Sensors & lane", icon: "lane" }, { id: "vision", label: "AI vision", icon: "vision" }].map((x) => {
              const on = (x.id === "vision") === vision;
              return (
                <button key={x.id} role="tab" aria-selected={on} onClick={() => router.replace(x.id === "vision" ? "/lane?view=vision" : `/lane?lane=${lane}`, { scroll: false })}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-[13.5px] font-semibold transition ${on ? "bg-gradient-to-r from-[#3B82F6] to-[#1D4ED8] text-white shadow" : "text-fg-2 hover:bg-white"}`}>
                  <Icon name={x.icon} size={16} color={on ? "#fff" : "#475569"} />{x.label}
                </button>
              );
            })}
          </div>
          {!vision && <div className="max-w-full overflow-x-auto"><Tabs value={lane} onChange={(v) => router.replace(`/lane?lane=${v}`)} items={LANES.map((l) => ({ id: l.id, label: `${l.label} · ${l.plate}` }))} /></div>}
        </div>
      </PageHeader>
      {vision ? <VisionPanel /> : loading ? (
        <div className="card card-pad"><LoadingState label="Loading the latest inspection on this lane…" rows={4} /></div>
      ) : (
        <>
          {/* the vehicle moving through the lane's stations, the readings of the one it is at, and new findings */}
          <LiveLaneView L={L} player={L.player || sessPlayer} sessionControls={controls}
            idle={insp ? undefined : {
              plate: laneInfo.plate, vtype: VTYPE[laneInfo.session], photo: refs.data?.hero || null,
              title: `${laneInfo.plate} has not entered ${laneInfo.label.toLowerCase()} yet`,
              note: <>{laneInfo.plate} ({laneInfo.car}) comes in for {STORY[laneInfo.session]}. {presenter ? "Start the replay to watch the sensors and AI live, or fast-forward to the finished result." : "The presenter starts the replay."}</>,
            }} />
          {insp && <InspectionContextBar insp={insp} alerts={L.alerts} uc={uc} here="/lane" cta={cta} />}
          {insp && <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-4">
              <Card title="What the lane has found" right={<Source kind="live_model" text="Models + rules, live" />}>
                {L.fusion && <div className="mb-4"><VehicleHealthSummary fusion={L.fusion} fuel={insp.vehicle?.fuel} compact /></div>}
                {L.alerts.length ? (
                  <div className="flex flex-col gap-2">
                    {L.alerts.slice(0, 6).map((a) => <AlertMini key={a.alert_id} a={a} />)}
                    {L.alerts.length > 6 && <Link className="text-[12.5px] text-cyan hover:underline" href={`/inspection/${laneInfo.session}/findings`}>and {L.alerts.length - 6} more in the examiner workspace →</Link>}
                  </div>
                ) : (
                  <div className="rounded-xl border border-ok/40 bg-ok/5 px-4 py-3 text-[13.5px]">
                    <b className="text-ok">{running ? "No anomalies detected so far." : "No anomalies detected in this inspection."}</b>{" "}
                    <span className="text-fg-3">{nMeasured} measurement{nMeasured === 1 ? "" : "s"} checked against their limits and {nAi} AI check{nAi === 1 ? "" : "s"} run{running ? " so far" : ""}.</span>
                  </div>
                )}
              </Card>
              <Card title="Measurements against their limits" right={<Source kind="simulated" text="Lane instruments" />}>
                <Instruments instruments={L.instruments} results={r} />
              </Card>
              <Card title="AI vision · above-carriage, undercarriage and tyre" right={<Source kind="live_model" />}>
                <Frames images={r.images || []} onOpen={setZoom} done={lastStep} />
              </Card>
              {/* in the lane's order: emission (station 4) before the brake (station 7) */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {(L.pn.length > 0 || insp.vehicle?.fuel === "diesel") ? (
                  <Card title="Particle number (PN) at idle" right={<Source kind="simulated" />}>
                    <PNChart pn={L.pn} />
                  </Card>
                ) : (
                  <Card title="Exhaust gas" right={<Source kind="simulated" />}>
                    <p className="text-[13px] text-fg-3">{insp.vehicle?.fuel === "ev" ? "An EV has no exhaust: the battery and high-voltage checks replace the emission test." : "Petrol engine: CO, HC and lambda are measured (see the measurements above); the particle counter is for diesel engines."}</p>
                  </Card>
                )}
                <Card title="Brake roller · force per wheel (kN)" right={<Source kind="simulated" />}>
                  <BrakeChart brake={L.brake} />
                </Card>
              </div>
              <details className="card card-pad group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                  <span className="h-title">Technical details · OBD, e-nose preview, lane sensors</span>
                  <span className="text-[12px] text-fg-3 group-open:hidden">Expand</span>
                </summary>
                <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2"><b className="text-[13px]">OBD-II · engine rpm</b><Source kind="simulated" /></div>
                    <OBDChart obd={L.obd} />
                    {r.obd?.dtcs?.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">{r.obd.dtcs.map((d: any) => <Pill key={d.code} color="#DC2626">{d.code} · {d.description}</Pill>)}</div>
                    ) : r.obd && <p className="mt-2 text-[12.5px] text-ok">No fault codes stored.</p>}
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2"><b className="text-[13px]">E-nose · research preview</b><Source kind={r.enose?.rnd === false ? "simulated" : "rnd"} text={r.enose?.rnd === false ? "Simulated sensor" : "Not in the result"} /></div>
                    <ENoseChart enose={L.enose} events={r.enose?.events || []} height={170} />
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(r.enose?.events || []).map((e: any, i: number) => (
                        <Pill key={i} color={r.enose?.rnd ? "#9333EA" : "#DC2626"}>{e.condition.replaceAll("_", " ")} · {e.level} · {Math.round(e.p * 100)}%{e.fused_with ? " · fused" : ""}</Pill>
                      ))}
                    </div>
                    {r.enose?.rnd !== false && <p className="mt-2 text-[12px] text-fg-3">A gas-sensor array is a future R&D option, not current lane equipment. Its simulated signals raise no alerts and do not change the score or the result.</p>}
                  </div>
                  <div className="lg:col-span-2">
                    <b className="text-[13px]">Lane sensors</b>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {["Plate camera", "Chassis OCR", "OBD-II dongle", "PN counter", "Opacimeter", "Gas analyser (CO, HC, λ)", "Roller brake tester", "Suspension tester", "Side-slip plate", "Headlamp tester", "Tint meter", "Pit cameras", "Thermal camera", "Microphones"].map((x) => (
                        <span key={x} className="chip border-ink-500 text-fg-2"><span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />{x}</span>
                      ))}
                      <span className="chip border-ink-500 text-fg-3" title="Future R&D option, not current lane equipment"><span className="h-1.5 w-1.5 rounded-full bg-[#9333EA]" aria-hidden />E-nose (R&D)</span>
                    </div>
                  </div>
                </div>
              </details>
            </div>
            {/* stays in view beside the long left column; scrolls on its own only if it is taller than the window */}
            <div className="flex min-w-0 flex-col gap-4 self-start xl:sticky xl:top-4 xl:-m-3 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:p-3 xl:[scrollbar-width:thin]">
              <Card title="Lane steps" right={L.player ? <span className="text-[12px] text-fg-3">{L.player.status} · {L.player.speed}×</span> : null}>
                <Timeline timeline={timeline} step={L.step} />
              </Card>
              <Card title="Check-in and identity" right={<Source kind="live_model" text="OCR" />}>
                <div className="flex flex-col gap-3 text-[13px]">
                  {r.anpr ? (
                    <div className="flex gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.anpr.image} alt="Plate camera frame" className="h-16 w-28 shrink-0 rounded-lg bg-[#0F172A] object-contain" />
                      <div className="min-w-0">
                        <div className="font-display text-[18px] font-bold">{r.anpr.plate || "not read"}</div>
                        <div className="text-[12px] text-fg-3">Plate read {Math.round((r.anpr.conf || 0) * 100)}% · {r.anpr.registry?.found ? "registry record found" : "no registry record"} <span className="text-fg-4">(mock registry)</span></div>
                        <div className={`text-[12px] ${r.anpr.booking ? "text-ok" : "text-fg-3"}`}>{r.anpr.booking ? `Booking ${r.anpr.booking.booking_id} checked in${r.anpr.booking.gear ? " (Express slot)" : ""}` : "Walk-in: no booking code"}</div>
                      </div>
                    </div>
                  ) : <span className="text-fg-3">Waiting for the plate camera…</span>}
                  {r.chassis ? (
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.chassis.image} alt="Chassis number plate" className="h-10 w-32 shrink-0 rounded bg-[#E8EEF7] object-contain" />
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[12.5px]">{r.chassis.read || "not read"}</div>
                        <div className={r.chassis.match ? "text-ok" : "text-bad"}>{r.chassis.match ? "Matches the registry" : "Does not match the registry"}</div>
                      </div>
                    </div>
                  ) : <span className="text-fg-3">Waiting for the chassis OCR…</span>}
                  {r.odometer && (
                    <div className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-2">
                      <div>Odometer <b>{fmtN(r.odometer.reading_km)} km</b>{r.odometer.overridden && <span className="text-warn"> (edited)</span>}</div>
                      {r.odometer.max_recorded_km && (
                        <div className={r.odometer.rollback_km ? "text-bad" : "text-fg-3"}>
                          Highest on record {fmtN(r.odometer.max_recorded_km)} km ({r.odometer.max_recorded_date}){r.odometer.rollback_km ? ` · ${fmtN(r.odometer.rollback_km)} km lower` : ""}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>}
        </>
      )}
      <Modal open={!!zoom} onClose={() => setZoom(null)} title={zoom ? `${SYSTEM_NAME[zoom.system] || zoom.kind} · ${zoom.camera}` : ""}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {zoom && <img src={zoom.annotated} alt="annotated frame" className="max-h-[70vh] rounded-lg" />}
      </Modal>
    </Shell>
  );
}

export default function Page() {
  return <Suspense><LaneConsole /></Suspense>;
}
