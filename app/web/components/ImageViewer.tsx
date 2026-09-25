"use client";
/* Full-screen viewer for the demo inspection images: the picture with its findings beside it, fit or actual size,
   previous / next (arrow keys) with a thumbnail strip, and links to the vehicles and the AI vision case it belongs to. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { Pill, Source } from "./ui";

export const IMAGE_KIND: Record<string, string> = {
  comparison: "Inspection: original vs AI analysis",
  closeup: "Close-up",
  progression: "Same spot, month by month",
};
export const SEVERITY: Record<string, [string, string]> = { H: ["High · fail item", "#F87171"], M: ["Medium · advisory", "#FBBF24"], L: ["Low · cosmetic", "#93C5FD"] };

export type LibImage = {
  id: string;
  kind: string;
  title: string;
  web_url: string;
  full_url?: string;
  width?: number;
  height?: number;
  findings?: { name: string; location: string; severity: string }[] | number;
  used_by_vehicles?: string[];
  app_capture?: { capture_id: number } | null;
  vehicle?: string | null;
  camera?: string | null;
  source_files?: string[];
};

export function ImageViewer({ items, index, onIndex, onClose, onOpenCase }: {
  items: LibImage[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  onOpenCase?: (captureId: number) => void;
}) {
  const [actual, setActual] = useState(false);
  const open = index !== null && index >= 0 && index < items.length;
  const i = index ?? 0;
  useEffect(() => setActual(false), [index]);
  useEffect(() => {
    if (!open) return;
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
      else if (ev.key === "ArrowRight" && i < items.length - 1) onIndex(i + 1);
      else if (ev.key === "ArrowLeft" && i > 0) onIndex(i - 1);
    };
    window.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
    };
  }, [open, i, items.length, onClose, onIndex]);
  if (!open) return null;
  const e = items[i];
  const findings = Array.isArray(e.findings) ? e.findings : [];
  return (
    <div role="dialog" aria-modal="true" aria-label={`Image ${e.id} · ${e.title}`} className="fixed inset-0 z-50 flex flex-col bg-ink-950/95 backdrop-blur-sm">
      <header className="flex items-center gap-3 border-b border-ink-600 px-4 py-2.5">
        <span className="chip shrink-0 border-ink-500 text-fg-3">{i + 1} / {items.length}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[15px] font-semibold">{e.id} · {e.title}</div>
          <div className="truncate text-[12px] text-fg-3">{IMAGE_KIND[e.kind] || e.kind}{e.camera ? ` · ${e.camera}` : ""}{e.width ? ` · ${e.width}×${e.height}` : ""}</div>
        </div>
        <button className="btn btn-sm hidden sm:inline-flex" onClick={() => setActual((a) => !a)} aria-pressed={actual}>{actual ? "Fit to screen" : "Actual size"}</button>
        {e.full_url && <a className="btn btn-sm hidden md:inline-flex" href={e.full_url} target="_blank" rel="noreferrer">Full resolution</a>}
        <button className="btn btn-sm" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className={`relative flex min-h-0 flex-1 overflow-auto p-3 ${actual ? "" : "items-center justify-center"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={actual && e.full_url ? e.full_url : e.web_url} alt={e.title} onClick={() => setActual((a) => !a)}
            className={actual ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in rounded-lg object-contain"} />
          {i > 0 && (
            <button className="btn absolute left-3 top-1/2 -translate-y-1/2 bg-ink-900/80" onClick={() => onIndex(i - 1)} aria-label="Previous image">
              <Icon name="arrow" size={18} className="rotate-180" />
            </button>
          )}
          {i < items.length - 1 && (
            <button className="btn absolute right-3 top-1/2 -translate-y-1/2 bg-ink-900/80" onClick={() => onIndex(i + 1)} aria-label="Next image">
              <Icon name="arrow" size={18} />
            </button>
          )}
        </div>
        <aside className="max-h-[38vh] w-full shrink-0 overflow-y-auto border-t border-ink-600 p-4 lg:max-h-none lg:w-[340px] lg:border-l lg:border-t-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="label">{e.kind === "progression" ? "What changed" : `Findings (${findings.length})`}</span>
            <Source kind="sample" text="Sample image" />
          </div>
          {e.kind === "progression" ? (
            <p className="text-[13px] leading-relaxed text-fg-2">The same spot photographed at successive inspections, left to right. The vehicle history shows the matching readings and the forecast.</p>
          ) : findings.length ? (
            <ol className="flex flex-col gap-2">
              {findings.map((f, k) => (
                <li key={k} className="rounded-xl border border-ink-600 bg-ink-850 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <b className="text-[13.5px]">{k + 1}. {f.name}</b>
                    {SEVERITY[f.severity] && <Pill color={SEVERITY[f.severity][1]}>{SEVERITY[f.severity][0]}</Pill>}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-fg-3">{f.location}</div>
                </li>
              ))}
            </ol>
          ) : <p className="text-[13px] text-fg-3">No findings are drawn on this image.</p>}
          {(e.used_by_vehicles?.length || e.app_capture) ? (
            <div className="mt-4 flex flex-col gap-2">
              <span className="label">Where the app uses it</span>
              <div className="flex flex-wrap gap-2">
                {e.used_by_vehicles?.map((v) => (
                  <Link key={v} className="btn btn-sm" href={`/fleet/vehicle/${encodeURIComponent(v)}`} onClick={onClose}>{v} history<Icon name="arrow" size={13} /></Link>
                ))}
                {e.app_capture && (onOpenCase
                  ? <button className="btn btn-sm btn-primary" onClick={() => onOpenCase(e.app_capture!.capture_id)}>Open the case in AI vision</button>
                  : <Link className="btn btn-sm" href={`/vision?case=${e.app_capture.capture_id}`} onClick={onClose}>AI vision case #{e.app_capture.capture_id}<Icon name="arrow" size={13} /></Link>)}
              </div>
            </div>
          ) : null}
          {e.source_files?.length ? <p className="mt-4 break-all text-[11.5px] text-fg-4">Original file{e.source_files.length > 1 ? "s" : ""}: {e.source_files.join(" · ")}</p> : null}
          <p className="mt-2 text-[11.5px] text-fg-4">The boxes and labels are drawn on the sample image; they are not live model output. Use AI vision to run the live models on it.</p>
        </aside>
      </div>
      {items.length > 1 && (
        <nav aria-label="All images" className="flex shrink-0 gap-2 overflow-x-auto border-t border-ink-600 p-2">
          {items.map((it, k) => (
            <button key={it.id} onClick={() => onIndex(k)} aria-label={`Image ${it.id}`} aria-current={k === i ? "true" : undefined}
              className={`h-14 shrink-0 overflow-hidden rounded-md border-2 ${k === i ? "border-cyan" : "border-transparent opacity-60 hover:opacity-100"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.web_url} alt="" loading="lazy" className="h-full w-auto" />
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

/** A clickable thumbnail card for one library image. */
export function ImageCard({ e, onOpen, compact = false }: { e: LibImage; onOpen: () => void; compact?: boolean }) {
  const n = Array.isArray(e.findings) ? e.findings.length : e.findings ?? 0;
  return (
    <button onClick={onOpen} aria-label={`Library image ${e.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-850 text-left transition hover:border-cyan/70">
      <span className={`block w-full overflow-hidden bg-ink-950 ${e.kind === "progression" ? "aspect-[3/1]" : "aspect-[4/3]"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={e.web_url} alt={e.title} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
      </span>
      <span className={`flex flex-col gap-1.5 ${compact ? "p-2.5" : "p-3"}`}>
        <span className="text-[12.5px] font-semibold leading-snug">{e.id} · {e.title}</span>
        <span className="flex flex-wrap items-center gap-1">
          <span className="chip border-ink-500 text-[11px] text-fg-3">{IMAGE_KIND[e.kind]?.split(":")[0] || e.kind}</span>
          {e.kind !== "progression" && n > 0 && <span className="chip border-[#F97316]/70 bg-[#F97316]/10 text-[11px] text-[#FDBA74]">{n} finding{n > 1 ? "s" : ""}</span>}
          {!compact && e.used_by_vehicles?.map((v) => <span key={v} className="chip border-ink-500 text-[11px] text-cyan">{v}</span>)}
        </span>
      </span>
    </button>
  );
}
