"use client";
/* Photos of the ten main vehicles and of the scenes (vhi/services/images.py on the API): your upload if there is one,
   else a stock photo from Wikimedia Commons (a representative photo of the model, credited), else the vehicle
   illustration. */
import { MouseEvent, useEffect, useRef, useState } from "react";
import { useFetch } from "@/lib/live";
import { VehicleArt } from "./VehicleArt";

export type Photo = {
  url: string;
  url_960: string;
  url_480: string;
  /** "Photo: Jane Doe · CC BY-SA 4.0 · Wikimedia Commons", or "Your upload" */
  credit: string;
  author?: string | null;
  license?: string | null;
  license_url?: string | null;
  page_url?: string | null;
  kind: "stock" | "uploaded";
  view: string;
  label: string;
  /** a photo of the model, not of the actual vehicle */
  representative: boolean;
  width?: number | null;
  height?: number | null;
};

export type VehiclePhotos = { plate: string; paint: string | null; paint_hex: string | null; vtype?: string | null; hero: Photo | null; gallery: Photo[] };
export type PhotoSize = "480" | "960" | "1600";

const SRC: Record<PhotoSize, (p: Photo) => string> = { "480": (p) => p.url_480, "960": (p) => p.url_960, "1600": (p) => p.url };
const SRCSET: Record<PhotoSize, (p: Photo) => string> = {
  "480": (p) => `${p.url_480} 1x, ${p.url_960} 2x`,
  "960": (p) => `${p.url_960} 1x, ${p.url} 2x`,
  "1600": (p) => p.url,
};

/** The credit button (ⓘ) in a photo's corner: author, licence and a link to the source page. */
export function PhotoCredit({ photo, className = "" }: { photo: Photo; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  // the photo often sits inside a link: the button must not follow it
  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const source = (e: MouseEvent) => {
    stop(e);
    if (photo.page_url) window.open(photo.page_url, "_blank", "noopener,noreferrer");
  };
  return (
    <span ref={ref} className={`absolute bottom-1.5 right-1.5 z-[1] flex flex-col items-end ${className}`}>
      {open && (
        <span role="dialog" aria-label="Photo credit" onClick={stop}
          className="mb-1.5 w-max max-w-[min(260px,calc(100vw-48px))] cursor-default rounded-xl bg-[#0F172A]/90 px-3 py-2 text-left text-[11.5px] font-medium leading-snug text-white shadow-lg backdrop-blur">
          <span className="block">{photo.credit}</span>
          {photo.representative && <span className="mt-0.5 block text-white/70">Representative photo of the model, not the actual vehicle.</span>}
          {photo.page_url && (
            <button type="button" onClick={source} className="mt-1 font-semibold text-[#93C5FD] underline-offset-2 hover:underline">
              View source and licence ↗
            </button>
          )}
        </span>
      )}
      <button type="button" aria-label="Photo credit" aria-expanded={open} title={photo.credit}
        onClick={(e) => (stop(e), setOpen((o) => !o))}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0F172A]/55 text-[13px] font-bold leading-none text-white shadow-sm ring-1 ring-white/40 backdrop-blur transition hover:bg-[#0F172A]/80">
        i
      </button>
    </span>
  );
}

/** A vehicle's photo, cropped to fill its box (give the size with className). Without a photo - or if it fails to
 *  load - the vehicle illustration is drawn instead. */
export function VehiclePhoto({ plate, vtype, photo, className = "", size = "960", credit = false, alt }: {
  plate: string; vtype?: string | null; photo?: Photo | null; className?: string; size?: PhotoSize; credit?: boolean; alt?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const label = alt || `${plate}${photo ? ` · ${photo.label}` : ""}`;
  if (!photo || failed === photo.url)
    return <VehicleArt vtype={vtype} seed={plate} className={className} title={label} />;
  return (
    <span className={`relative block overflow-hidden bg-[#E8EEF7] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={SRC[size](photo)} srcSet={SRCSET[size](photo)} alt={label} loading="lazy" decoding="async" draggable={false}
        onError={() => setFailed(photo.url)} className="absolute inset-0 h-full w-full object-cover" />
      {credit && <PhotoCredit photo={photo} />}
    </span>
  );
}

/** A main vehicle's hero photo, gallery and paint (empty for other vehicles). */
export function useVehiclePhotos(plate: string | null | undefined) {
  return useFetch<VehiclePhotos>(plate ? `/api/images/vehicle/${encodeURIComponent(plate)}` : null);
}

/** The scene photos: hub, lane, pit, flood, tyre and login (null where there is none). */
export function useScenes() {
  return useFetch<Record<string, Photo | null>>("/api/images/scenes");
}

/** A scene photo (hub, lane, pit, flood, tyre, login) filling its box; a soft gradient while it loads or if there is
 *  none. */
export function ScenePhoto({ id, className = "", size = "1600", credit = false, alt }: {
  id: string; className?: string; size?: PhotoSize; credit?: boolean; alt?: string;
}) {
  const { data } = useScenes();
  const [failed, setFailed] = useState(false);
  const photo = data?.[id];
  return (
    <span className={`relative block overflow-hidden bg-gradient-to-br from-[#DCE7F7] via-[#EEF3FA] to-[#C9D8EE] ${className}`}>
      {photo && !failed && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SRC[size](photo)} srcSet={SRCSET[size](photo)} alt={alt || photo.label} loading="lazy" decoding="async" draggable={false}
            onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
          {credit && <PhotoCredit photo={photo} />}
        </>
      )}
    </span>
  );
}
