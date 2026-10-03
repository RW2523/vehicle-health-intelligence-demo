"use client";
/* AI vision (Live Lane → AI vision): the platform's three AI inspection modules on the inspection captures and the
   image library they come from; the live models run on any capture, a curated photo or an upload. */
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { IMAGE_KIND, ImageCard, ImageViewer, LibImage } from "@/components/ImageViewer";
import { Card, Pill, Source, Tabs, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { SYSTEM_NAME, llmLabel, moduleModel } from "@/lib/format";
import { useFetch } from "@/lib/live";

const FILTERS = [
  { id: "all", label: "All" }, { id: "lane", label: "Malaysia lane" }, { id: "close", label: "Close-ups" }, { id: "fleet", label: "Fleet" },
  { id: "body", label: "Body" }, { id: "under", label: "Underbody" }, { id: "interior", label: "Cabin" }, { id: "tyres", label: "Tyres & lamps" },
];
const SEV: Record<string, [string, string]> = { H: ["High · fail item", "#DC2626"], M: ["Medium · advisory", "#D97706"], L: ["Low · cosmetic", "#3B82F6"] };
const LIB_KINDS = [{ id: "all", label: "All" }, { id: "comparison", label: "Inspections" }, { id: "closeup", label: "Close-ups" }, { id: "progression", label: "Progressions" }];
const TASKS = [{ id: "damage", label: "Body damage" }, { id: "tyre", label: "Tyre" }, { id: "corrosion", label: "Corrosion" }, { id: "plate", label: "Plate OCR" }];

function outcome(c: any) {
  const h = c.findings.filter((f: any) => f.severity === "H").length, m = c.findings.filter((f: any) => f.severity === "M").length;
  if (c.cats.includes("flood")) return { label: "Refer · flood suspected", c: "#DC2626" };
  if (h) return { label: "Fail · fix and retest", c: "#DC2626" };
  if (m) return { label: "Pass with advisory", c: "#D97706" };
  return { label: "Pass · cosmetic only", c: "#059669" };
}

/** The platform's three AI inspection modules, each with its AI model and what it looks for (and, for tyres, the
 *  laser system in development). */
function Modules({ systems }: { systems: any[] }) {
  return (
    <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
      {systems.filter((s) => s.model).map((s) => (
        <div key={s.id} className="card card-pad flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 font-display text-[15.5px] font-semibold">{s.name}</div>
            <Source kind="live_model" className="shrink-0" />
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-blue-50/70 px-3 py-2 ring-1 ring-blue-100">
            <Icon name="bolt" size={15} color="#2563EB" />
            <span className="min-w-0 leading-tight"><span className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-4">AI model</span><b className="block truncate text-[14px] text-[#1D4ED8]">{s.model}</b></span>
          </div>
          <p className="mt-2 text-[12.5px] text-fg-2">{s.note}</p>
          <p className="mt-1 text-[12px] text-fg-3">Detects: {s.detects.join(", ")}.</p>
          {s.next && (
            <div className="mt-auto pt-3">
              <div className="rounded-xl border border-dashed border-ink-500 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-4">Coming next</span>
                  <Source kind="rnd" text={s.next.stage} />
                </div>
                <b className="mt-0.5 block text-[13.5px]">{s.next.model}</b>
                <span className="block text-[12px] text-fg-3">Detects {s.next.detects}.</span>
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export function VisionPanel() {
  const sp = useSearchParams();
  const router = useRouter();
  const { data } = useFetch<any>("/api/vision/captures");
  const samples = useFetch<any>("/api/vision/samples");
  const lib = useFetch<any>("/api/vision/library");
  const [view, setViewState] = useState<"cases" | "library">(sp.get("images") === "library" ? "library" : "cases");
  const [libKind, setLibKind] = useState("all");
  const [libPlate, setLibPlate] = useState("");
  const [viewer, setViewer] = useState<{ items: LibImage[]; index: number } | null>(null);
  const [filt, setFilt] = useState("all");
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<"orig" | "ai" | "cmp">("ai");
  const [split, setSplit] = useState(50);
  const [dec, setDec] = useState<Record<string, string>>({});
  const [task, setTask] = useState("damage");
  const [live, setLive] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [expl, setExpl] = useState<any>(null);
  const [explaining, setExplaining] = useState(false);
  const show = (r: any) => {
    setLive(r);
    setExpl(null);
  };
  const cases: any[] = data?.cases || [];
  const list = useMemo(() => cases.filter((c) => filt === "all" || c.group === filt || c.cats.includes(filt) || (filt === "tyres" && c.cats.includes("lamps"))), [cases, filt]);
  const cur = cases[sel];
  const images: LibImage[] = lib.data?.images || [];
  const plates = useMemo(() => [...new Set(images.flatMap((e) => e.used_by_vehicles || []))].sort(), [images]);
  const shown = images.filter((e) => (libKind === "all" || e.kind === libKind) && (!libPlate || e.used_by_vehicles?.includes(libPlate)));
  const setView = (v: "cases" | "library") => {
    setViewState(v);
    router.replace(v === "library" ? "/lane?view=vision&images=library" : `/lane?view=vision${cur ? `&case=${cur.id}` : ""}`, { scroll: false });
  };
  const openCase = (id: number) => {
    const k = cases.findIndex((c) => c.id === id);
    if (k < 0) return;
    setFilt("all");
    setSel(k);
    setMode("ai");
    show(null);
    setViewer(null);
    setViewState("cases");
    router.replace(`/lane?view=vision&case=${id}`, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  // deep links: ?case=23 selects a capture, ?img=i7 opens an image from the library
  useEffect(() => {
    const id = Number(sp.get("case"));
    if (id && cases.length) {
      const k = cases.findIndex((c) => c.id === id);
      if (k >= 0) setSel(k);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases.length]);
  useEffect(() => {
    const img = sp.get("img");
    if (img && images.length) {
      const k = images.findIndex((e) => e.id === img);
      if (k >= 0) setViewer({ items: images, index: k });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length]);
  const run = async (body: any) => {
    setBusy(true);
    try {
      show({ ...(await api.post("/api/vision/analyse", body)), req: body });
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  const upload = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await api.upload(`/api/vision/upload?task=${task}`, f);
      show({ ...r, req: { task, upload_id: r.upload_id } });
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };
  const explain = async () => {
    setExplaining(true);
    try {
      setExpl(await api.post("/api/vision/explain", live.req));
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setExplaining(false);
    }
  };
  const clip = mode === "ai" ? 100 : mode === "orig" ? 0 : split;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onChange={setView} items={[
          { id: "cases", label: `Captures · ${cases.length}` },
          { id: "library", label: `Image library · ${images.length}` },
        ]} />
        <Source kind="sample" text="Sample images · AI boxes pre-drawn" />
      </div>
      {view === "cases" && data?.systems && <Modules systems={data.systems} />}
      {view === "cases" && cur && (
        // three columns that end level: the capture list takes the row's height (its own length does not count,
        // lg:[contain:size]) and scrolls inside; the last card of the other two grows. On a phone the list is a
        // sideways strip above the image.
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[296px_minmax(0,1fr)_minmax(320px,0.9fr)]">
          <Card className="flex min-w-0 flex-col lg:[contain:size]">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button key={f.id} onClick={() => setFilt(f.id)} aria-pressed={filt === f.id}
                  className={`chip ${filt === f.id ? "border-cyan bg-cyan/10 text-fg" : "border-ink-500 text-fg-2"}`}>{f.label}</button>
              ))}
            </div>
            <div className="-mx-1 flex min-h-0 snap-x gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-1 lg:snap-none lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:px-0 lg:pb-0 lg:pr-1" aria-label="Captures">
              {list.map((c) => {
                const i = cases.indexOf(c), o = outcome(c);
                return (
                  <button key={c.id} onClick={() => { setSel(i); setMode("ai"); show(null); router.replace(`/lane?view=vision&case=${c.id}`, { scroll: false }); }}
                    aria-current={i === sel ? "true" : undefined}
                    className={`flex w-[244px] shrink-0 snap-start items-center gap-3 rounded-xl border p-2 text-left lg:w-auto ${i === sel ? "border-cyan bg-ink-750" : "border-transparent bg-ink-850"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.original_url} alt="" className="h-16 w-12 shrink-0 rounded-lg object-cover" />
                    <span className="min-w-0 flex-1 leading-snug">
                      <span className="block text-[13.5px] font-semibold">{c.title}</span>
                      <span className="block text-[12px] text-fg-3">{SYSTEM_NAME[c.system]} · {c.vehicle}</span>
                      <span className="block text-[12px]" style={{ color: o.c }}>{c.findings.length} finding{c.findings.length > 1 ? "s" : ""} · <span className="whitespace-nowrap">{o.label.split(" ·")[0]}</span></span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="relative aspect-[520/636] w-full overflow-hidden rounded-2xl border border-ink-600 bg-ink-850">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cur.original_url} alt={`${cur.title} original`} className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${clip}%`, borderRight: mode === "cmp" ? "2px solid #2563EB" : undefined }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cur.ai_url} alt={`${cur.title} with AI boxes`} className="absolute inset-0 h-full max-w-none object-cover" style={{ width: `${10000 / Math.max(clip, 0.01)}%` }} />
              </div>
              <div className="absolute left-3 top-3 flex gap-1.5">
                <span className="chip border-transparent bg-ink-950/85 text-fg"><span className="h-1.5 w-1.5 rounded-full bg-ok" />{cur.camera}</span>
                <span className="chip border-transparent bg-ink-950/85 text-cyan">{mode === "ai" ? "AI detections on" : mode === "orig" ? "Original frame" : "Drag to compare"}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Tabs value={mode} onChange={setMode} items={[{ id: "orig", label: "Original" }, { id: "ai", label: "AI overlay" }, { id: "cmp", label: "Compare" }]} />
              {mode === "cmp" && <input aria-label="Compare position" type="range" min={0} max={100} value={split} onChange={(e) => setSplit(+e.target.value)} className="flex-1 accent-cyan" />}
            </div>
            <Card title="Run the live model on this capture" right={<Source kind="live_model" />} className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Tabs size="sm" value={task} onChange={setTask} items={TASKS} />
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run({ task, capture_id: cur.id })}>{busy ? "Running…" : "Run"}</button>
                <label className="btn btn-sm">Upload photo<input type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} /></label>
              </div>
              {samples.data && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="basis-full text-[12px] text-fg-3">Real curated images:</span>
                  {(samples.data[task] || []).slice(0, 6).map((p: string, i: number) => {
                    const folder = p.split("/").slice(-2, -1)[0] || "";
                    const lab = ({ defective: "Defective tyre", perfect: "Good tyre", r_breakage: "Breakage", f_crushed: "Crushed", f_normal: "No damage",
                      corrosion_industrial_metal: "Rust", real_plate_photo: "Plate photo" } as Record<string, string>)[folder] || folder.replaceAll("_", " ");
                    return (
                      <button key={p} title={p} className="flex items-center gap-1.5 rounded-lg border border-ink-500 bg-ink-850 p-1 pr-2 text-[11.5px] text-fg-2 hover:border-cyan" onClick={() => run({ task, data_path: p })}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/media/data/${p}`} alt="" className="h-8 w-10 rounded object-cover" />
                        {lab} {i + 1}
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2 xl:col-span-1 xl:[&>*:last-child]:flex-1">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="label">{SYSTEM_NAME[cur.system]} · {cur.group === "lane" ? "Malaysia lane" : cur.group === "close" ? "close-up" : "fleet inspection"}</div>
                  <h2 className="font-display text-[22px] font-semibold">{cur.title}</h2>
                  <p className="text-[13px] text-fg-3">{cur.vehicle} · {cur.camera}</p>
                </div>
                <Source kind="sample" className="shrink-0" />
              </div>
              {cur.source_image && images.length > 0 && (
                <button className="mt-2 text-left text-[12.5px] text-cyan hover:underline"
                  onClick={() => setViewer({ items: images, index: Math.max(0, images.findIndex((e) => e.id === cur.source_image.library_id)) })}>
                  View the full inspection image · image {cur.source_image.library_id} ({cur.source_image.width}×{cur.source_image.height}) →
                </button>
              )}
              <div className="mt-3 rounded-xl border px-4 py-3" style={{ borderColor: outcome(cur).c + "77", background: outcome(cur).c + "12" }}>
                <b style={{ color: outcome(cur).c }}>{outcome(cur).label}</b>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {cur.findings.map((f: any, k: number) => {
                  const key = `${cur.id}-${k}`, d = dec[key];
                  return (
                    <div key={key} className="rounded-xl border border-ink-600 bg-ink-850 p-3" style={{ opacity: d === "dismissed" ? 0.55 : 1 }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[14.5px] font-semibold">{k + 1}. {f.name}</span>
                        <Pill color={SEV[f.severity][1]}>{SEV[f.severity][0]}</Pill>
                      </div>
                      <div className="text-[12.5px] text-fg-3">{f.location}</div>
                      <p className="mt-1 text-[12.5px] text-fg-2">{data.rules[f.name] || ""}</p>
                      {d ? (
                        <div className="mt-2 text-[12.5px]" style={{ color: d === "confirmed" ? "#059669" : "#64748B" }}>
                          {d === "confirmed" ? "Confirmed by examiner" : "Dismissed by examiner"} · <button className="text-cyan" onClick={() => setDec((x) => { const y = { ...x }; delete y[key]; return y; })}>Undo</button>
                        </div>
                      ) : (
                        <div className="mt-2 flex gap-2">
                          <button className="btn btn-sm btn-primary" onClick={() => setDec((x) => ({ ...x, [key]: "confirmed" }))}>Confirm</button>
                          <button className="btn btn-sm" onClick={() => setDec((x) => ({ ...x, [key]: "dismissed" }))}>Dismiss</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 rounded-xl border border-ink-600 bg-ink-850 p-3 text-[13px]"><div className="label mb-1 text-cyan">Next step</div>{cur.next_step}</div>
            </Card>
            {live && (
              <Card title="Live model result" right={<Source kind={live.runs_as === "live logic" ? "live_logic" : "live_model"} />}>
                <div className="flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={live.annotated_url} alt="model output" className="h-44 w-44 rounded-xl object-cover" />
                  <div className="text-[13px]">
                    {live.task === "plate" ? (
                      <><div className="font-display text-[22px] font-bold">{live.result.plate || "not read"}</div><div className="text-fg-3">OCR confidence {Math.round(live.result.conf * 100)}%</div></>
                    ) : live.task === "corrosion" ? (
                      <><div className="font-display text-[22px] font-bold">{live.result.corrosion_score}/10</div><div className="text-fg-3">{live.result.level} · {live.result.boxes.length} region(s) · rust share {(live.result.rust_share * 100).toFixed(1)}%</div></>
                    ) : (
                      <>
                        <div className="font-display text-[18px] font-bold">{live.result.label}</div>
                        <div className="text-fg-3">{Math.round(live.result.p * 100)}% · {moduleModel(live.task === "tyre" ? "tyre" : "above")} · validation accuracy {Math.round((live.result.val_accuracy || 0) * 100)}%</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(live.result.probs || {}).map(([k, v]: any) => <Pill key={k} color="#2563EB">{k} {Math.round(v * 100)}%</Pill>)}</div>
                      </>
                    )}
                  </div>
                </div>
                {live.vlm?.reachable && (
                  <div className="mt-3 border-t border-ink-600 pt-3">
                    {expl ? (
                      <>
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <span className="label">In plain words</span>
                          <Source kind="llm" text={`Vision-language model · ${llmLabel(expl.model)}`} />
                        </div>
                        <p className="text-[13px] leading-relaxed text-fg-2">{expl.text}</p>
                      </>
                    ) : (
                      <button className="btn btn-sm" disabled={explaining} onClick={explain}>
                        {explaining ? "Asking the vision-language model…" : "Explain in plain words (vision-language model on the GPU)"}
                      </button>
                    )}
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
      {view === "library" && (
        <section aria-label="Image library">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Tabs size="sm" value={libKind} onChange={setLibKind} items={LIB_KINDS.map((k) => ({ ...k, label: `${k.label} · ${images.filter((e) => k.id === "all" || e.kind === k.id).length}` }))} />
            <label className="flex items-center gap-2 text-[12.5px] text-fg-3">Vehicle
              <select aria-label="Vehicle" className="input py-1.5" value={libPlate} onChange={(e) => setLibPlate(e.target.value)}>
                <option value="">All vehicles</option>
                {plates.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <span className="text-[12.5px] text-fg-3">{shown.length} image{shown.length === 1 ? "" : "s"} · click one to open it with its findings</span>
          </div>
          {shown.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {shown.map((e, k) => <ImageCard key={e.id} e={e} onOpen={() => setViewer({ items: shown, index: k })} />)}
            </div>
          ) : <p className="text-[13px] text-fg-3">{lib.data ? "No images match these filters." : "Loading the image library…"}</p>}
          <p className="mt-4 text-[12px] text-fg-4">{IMAGE_KIND.comparison}s, close-ups and month-by-month progressions from the demo image set, de-duplicated and mapped to the app captures and fleet vehicles (data/curated/images/vehiclesense_demo/manifest.json).</p>
        </section>
      )}
      <ImageViewer items={viewer?.items || []} index={viewer ? viewer.index : null} onIndex={(index) => setViewer((v) => (v ? { ...v, index } : v))}
        onClose={() => setViewer(null)} onOpenCase={openCase} />
    </>
  );
}

