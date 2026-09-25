"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Icon } from "@/components/icons";
import { PlayerControls, useSessions } from "@/components/Player";
import { Shell } from "@/components/Shell";
import { AlertMini, BrakeChart, ENoseChart, Frames, Instruments, OBDChart, PNChart, Timeline } from "@/components/lanebits";
import { Card, Empty, Modal, PageHeader, Pill, Source, Tabs } from "@/components/ui";
import { LANE_SESSIONS, STATUS_LABEL, fmtN } from "@/lib/format";
import { useInspection } from "@/lib/inspection";

const LANES = LANE_SESSIONS.map((l) => ({ id: l.lane, label: l.label, session: l.session, plate: l.plate }));
const STORY: Record<string, string> = {
  S1: "a tampered diesel prime mover: removed DPF, ammonia slip, a hot brake hub and a damaged tyre",
  S2: "a used EV with flood history, for sale with a bank loan: battery health, flood evidence, EV fault codes",
  S3: "a sedan changing owner whose chassis plate, odometer and engine sound disagree with its history",
};

function LaneConsole() {
  const sp = useSearchParams();
  const router = useRouter();
  const laneInfo = LANES.find((l) => l.id === sp.get("lane")) || LANES[0];
  const lane = laneInfo.id;
  const L = useInspection({ lane });
  const { sessions, setPlayer } = useSessions();
  const sess = sessions.find((x) => x.session_id === laneInfo.session);
  const [zoom, setZoom] = useState<any>(null);
  const insp = L.insp;
  const r = L.results;
  const controls = sess ? <PlayerControls s={sess} onState={setPlayer} compact onFastDone={L.reload} /> : null;
  return (
    <Shell context={<Pill color={L.connected ? "#34D399" : "#9AA8BF"}>{L.connected ? "Live" : "Connecting…"}</Pill>}>
      <PageHeader title="Lane console" sub="What the lane sees as it happens: sensor streams, AI results and alerts. The examiner decides them next."
        actions={insp ? <>{controls}<Link className="btn" href={`/examiner?session=${laneInfo.session}`}>Examiner console<Icon name="arrow" size={15} /></Link></> : null}>
        <div className="mt-3"><Tabs value={lane} onChange={(v) => router.replace(`/lane?lane=${v}`)} items={LANES.map((l) => ({ id: l.id, label: `${l.label} · ${l.session}` }))} /></div>
      </PageHeader>
      {insp && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-ink-600 bg-ink-850 px-4 py-2.5 text-[13px]">
          <b>{insp.plate}</b>
          <span className="text-fg-3">{insp.vehicle?.make} {insp.vehicle?.model}</span>
          <span className="text-fg-3">·</span>
          <span>{STATUS_LABEL[insp.status] || insp.status}</span>
          {insp.status === "in_lane" && L.player?.status === "playing" && <span className="flex items-center gap-1.5 text-ok"><span className="h-2 w-2 rounded-full bg-ok pulse-dot" />streaming</span>}
          {insp.status !== "in_lane" && !insp.report && <Link href={`/examiner?session=${laneInfo.session}`} className="text-cyan hover:underline">The lane is done: decide the alerts in the examiner console →</Link>}
          {insp.report && <Link href={`/report?id=${insp.report.report_id}`} className="text-cyan hover:underline">View the report ({insp.report.verdict}) →</Link>}
        </div>
      )}
      {!insp ? (
        <Empty title={`${laneInfo.label} is idle`} actions={controls}>
          {laneInfo.session} drives {laneInfo.plate} through this lane: {STORY[laneInfo.session]}. Start it to watch the sensors and AI live, or fast-forward to the finished result.
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card title="Check-in · ANPR" right={<Source kind="live_model" text="Live model · PaddleOCR" />}>
                {r.anpr ? (
                  <div className="flex gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.anpr.image} alt="Plate camera frame" className="h-24 w-40 rounded-lg object-cover" />
                    <div className="flex flex-col gap-1 text-[13px]">
                      <span className="font-display text-[22px] font-bold">{r.anpr.plate || "not read"}</span>
                      <span className="text-fg-3">OCR confidence {Math.round((r.anpr.conf || 0) * 100)}% · {r.anpr.camera}</span>
                      <span>{r.anpr.mysikap?.found ? "mySIKAP record found" : "No registry record"} <span className="text-fg-4">(mock mySIKAP)</span></span>
                      {r.anpr.booking ? <span className="text-ok">Booking {r.anpr.booking.booking_id} checked in {r.anpr.booking.gear ? "(GEAR)" : ""}</span> : <span className="text-fg-3">Walk-in (no booking QR)</span>}
                    </div>
                  </div>
                ) : <p className="text-[13px] text-fg-3">Waiting for the entry camera…</p>}
              </Card>
              <Card title="Identity · chassis OCR and odometer" right={<Source kind="live_model" />}>
                <div className="flex flex-col gap-2 text-[13px]">
                  {r.chassis ? (
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.chassis.image} alt="Chassis plate" className="h-12 w-44 rounded object-cover" />
                      <div>
                        <div className="font-mono text-[13px]">{r.chassis.read || "not read"}</div>
                        <div className={r.chassis.match ? "text-ok" : "text-bad"}>{r.chassis.match ? "Matches registry" : "Does not match registry"}</div>
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
            <Card title={`${insp.plate} · ${insp.vehicle?.make || ""} ${insp.vehicle?.model || ""}`} right={<><Pill color="#22D3EE">{insp.inspection_type}</Pill><Source kind="simulated" text="Lane instruments: simulated" /></>}>
              <Instruments instruments={L.instruments} results={r} />
            </Card>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card title="E-nose · 16 channels @ 2 Hz" right={<Source kind="simulated" text="Simulated sensor · UCI signatures" />}>
                <ENoseChart enose={L.enose} events={r.enose?.events || []} />
                <div className="mt-2 flex flex-wrap gap-2">
                  {(r.enose?.events || []).map((e: any, i: number) => (
                    <Pill key={i} color="#F87171">{e.condition.replaceAll("_", " ")} · {e.level} · {Math.round(e.p * 100)}%{e.fused_with ? " · fused" : ""}</Pill>
                  ))}
                </div>
              </Card>
              <Card title="Brake roller · force per wheel (kN)" right={<Source kind="simulated" />}>
                <BrakeChart brake={L.brake} />
              </Card>
              <Card title="Particle number (PN) at idle" right={<Source kind="simulated" />}>
                <PNChart pn={L.pn} />
              </Card>
              <Card title="OBD-II · engine rpm" right={<Source kind="simulated" />}>
                <OBDChart obd={L.obd} />
                {r.obd?.dtcs?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">{r.obd.dtcs.map((d: any) => <Pill key={d.code} color="#F87171">{d.code} · {d.description}</Pill>)}</div>
                )}
              </Card>
            </div>
            <Card title="Camera frames · AI results" right={<Source kind="live_model" />}>
              <Frames images={r.images || []} onOpen={setZoom} />
            </Card>
          </div>
          <div className="flex flex-col gap-4">
            <Card title="Lane steps" right={L.player ? <Pill color="#22D3EE">{L.player.status} · {L.player.speed}×</Pill> : null}>
              <Timeline timeline={insp.timeline || L.player?.timeline || []} step={L.step} t={L.player?.t} />
            </Card>
            <Card title="Lane sensors">
              <div className="flex flex-wrap gap-1.5">
                {["ANPR camera", "Chassis OCR", "OBD-II dongle", "PN counter", "Opacimeter", "E-nose (16 ch)", "Roller brake tester", "Suspension tester", "Side-slip plate", "Headlamp tester", "Tint meter", "Pit cameras", "Thermal camera", "Microphones"].map((x) => (
                  <span key={x} className="chip border-ink-500 text-fg-2"><span className="h-1.5 w-1.5 rounded-full bg-ok" />{x}</span>
                ))}
              </div>
            </Card>
            <Card title={`Live alerts (${L.alerts.length})`}>
              <div className="flex max-h-[520px] flex-col gap-2 overflow-auto">
                {L.alerts.length ? L.alerts.map((a) => <AlertMini key={a.alert_id} a={a} />) : <p className="text-[13px] text-fg-3">No alerts yet.</p>}
              </div>
            </Card>
          </div>
        </div>
      )}
      <Modal open={!!zoom} onClose={() => setZoom(null)} title={zoom ? `${zoom.kind} · ${zoom.camera}` : ""}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {zoom && <img src={zoom.annotated} alt="annotated frame" className="max-h-[70vh] rounded-lg" />}
      </Modal>
    </Shell>
  );
}

export default function Page() {
  return <Suspense><LaneConsole /></Suspense>;
}
