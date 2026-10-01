"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Panel, StatusPill } from "@/components/glass";
import { Icon } from "@/components/icons";
import { ImageLibrary } from "@/components/ImageLibrary";
import { Shell, initials } from "@/components/Shell";
import { LoadingState, PageHeader, ProvenanceLegend, Source, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { APPS } from "@/lib/apps";
import { canOpen, logout, useUser } from "@/lib/auth";
import { fmtN, llmLabel } from "@/lib/format";
import { useFetch } from "@/lib/live";

const SECTIONS = [
  { id: "general", label: "General", icon: "user" },
  { id: "images", label: "Images", icon: "image" },
  { id: "demo", label: "Demo", icon: "play" },
  { id: "system", label: "System", icon: "sliders" },
];

function General() {
  const user = useUser();
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="flex flex-col gap-5">
        <Panel title="Account">
          {user && (
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[18px] font-bold text-white" style={{ background: "linear-gradient(135deg,#60A5FA,#1E3A8A)" }} aria-hidden>{initials(user.name)}</span>
              <div className="min-w-0 flex-1 leading-tight"><b className="block text-[17px]">{user.name}</b><span className="text-[13.5px] text-fg-3">{user.title}</span></div>
              <button className="btn btn-danger" onClick={logout}><Icon name="logout" size={16} />Log out</button>
            </div>
          )}
          <p className="mt-3 text-[12.5px] text-fg-3">One demo account per role; the API checks the role on every request. Sessions last 12 hours.</p>
        </Panel>
        <Panel title="The VehicleSense apps" sub="Each app has its own address; the switcher in the header moves between them.">
          <div className="flex flex-col gap-2.5">
            {APPS.filter((a) => canOpen(user?.role, a.roles)).map((a) => (
              <Link key={a.id} href={a.href} className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/70 px-4 py-3 hover:bg-white">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#DBEAFE] to-[#EFF6FF]"><Icon name={a.icon} size={20} color="#2563EB" /></span>
                <span className="min-w-0 flex-1 leading-tight"><b className="block">{a.full}</b><span className="block truncate text-[12.5px] text-fg-3">{a.sub}</span></span>
                <code className="hidden rounded-lg bg-[#F1F5F9] px-2 py-1 text-[12px] text-fg-2 sm:block">{a.href}</code>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
      <Panel title="What the data labels mean"><ProvenanceLegend compact /></Panel>
    </div>
  );
}

function Demo() {
  const user = useUser();
  const [busy, setBusy] = useState(false);
  const can = user?.role === "presenter" || user?.role === "hq";
  const restart = async () => {
    setBusy(true);
    try {
      const r = await api.post("/api/hub/restart");
      toast(`The hub's day starts again from now (plan anchored at ${r.anchor})`, "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Panel title="Guided demo" sub="Nine end-to-end use cases, each from the first screen to the verified result.">
        <p className="mb-4 text-[13.5px] text-fg-2">Demo control starts a use case and shows its next step in the header, on whichever app the step happens: the inspection app, the mobile app or oversight. The lane replays run from there too.</p>
        <Link className="btn btn-primary" href="/demo"><Icon name="play" size={15} color="#fff" />Open demo control</Link>
      </Panel>
      <Panel title="The hub's day" sub="The ten main vehicles at the Central Inspection Hub.">
        <p className="mb-4 text-[13.5px] text-fg-2">The day&apos;s plan starts when it is first looked at: four fleet inspections already done, the lane-replay vehicles on their lanes ready for their replays (start them from Demo control or the lane cards), and two fleet vehicles waiting behind them. Start it again before a demo. Outside opening hours it is shown at 10:30.</p>
        <button className="btn" disabled={!can || busy} onClick={restart}><Icon name="refresh" size={15} />Start the day again from now</button>
        {!can && <p className="mt-2 text-[12px] text-fg-4">Only the presenter and HQ can restart the day.</p>}
      </Panel>
    </div>
  );
}

function System() {
  const s = useFetch<any>("/api/system/status");
  const st = s.data;
  return (
    <Panel title="Live pipeline and models" action={<Source kind="live_logic" text="Pipeline status" />}>
      {!st ? <LoadingState rows={6} /> : (
        <div className="flex flex-col gap-4 text-[13.5px]">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
            {[["Database", st.database], ["Message bus", st.bus.kind], ["Bus messages", fmtN(st.bus.published)], ["Model calls", fmtN(st.processor.model_calls)],
              ["Evidence entries", fmtN(st.counts.evidence_entries)], ["Assistant / reports", llmLabel(st.llm.backend) || "Template engine"]].map(([k, v]) => (
              <div key={k as string} className="min-w-0 rounded-xl bg-white/70 px-3 py-2 ring-1 ring-ink-600"><div className="text-[11.5px] text-fg-3">{k}</div><div className="truncate font-semibold" title={String(v)}>{v}</div></div>
            ))}
          </div>
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {st.models.map((m: any) => (
              <li key={m.key} className="flex min-w-0 flex-col items-start gap-1.5 rounded-xl bg-white/70 px-3 py-2.5 ring-1 ring-ink-600">
                <span className="font-semibold leading-snug">{m.title}</span>
                <span className="flex flex-wrap items-center gap-2">{m.ready ? <StatusPill tone="green" dot>Ready</StatusPill> : <StatusPill tone="gray">Not trained</StatusPill>}<Source kind={m.runs_as} /></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function SettingsPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = SECTIONS.some((s) => s.id === sp.get("tab")) ? sp.get("tab")! : "general";
  return (
    <Shell>
      <PageHeader eyebrow="Settings" title="Settings" sub="Your account and the apps, the vehicle photos and their generation prompts, the guided demo, and the live pipeline." />
      <div className="mb-5 flex max-w-full gap-1.5 overflow-x-auto rounded-full border border-white/80 bg-white/70 p-1 shadow-glass sm:inline-flex" role="tablist" aria-label="Settings">
        {SECTIONS.map((s) => (
          <button key={s.id} role="tab" aria-selected={tab === s.id} onClick={() => router.replace(s.id === "general" ? "/settings" : `/settings?tab=${s.id}`, { scroll: false })}
            className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[13.5px] font-semibold transition ${tab === s.id ? "bg-gradient-to-r from-[#3B82F6] to-[#1D4ED8] text-white shadow" : "text-fg-2 hover:bg-white"}`}>
            <Icon name={s.icon} size={16} color={tab === s.id ? "#fff" : "#475569"} />{s.label}
          </button>
        ))}
      </div>
      {tab === "general" && <General />}
      {tab === "images" && <ImageLibrary />}
      {tab === "demo" && <Demo />}
      {tab === "system" && <System />}
    </Shell>
  );
}

export default function Settings() {
  return <Suspense><SettingsPage /></Suspense>;
}
