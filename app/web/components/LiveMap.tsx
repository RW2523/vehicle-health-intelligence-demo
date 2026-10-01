"use client";
/* A live map of Malaysia on a light basemap (plain Leaflet, loaded in the browser only; see BASEMAPS). The caller passes
   plain points; the map keeps its markers and updates them in place when the points change (a poll), so zoom, pan and
   the open tooltip survive a refresh. Layer toggles, region views, zoom, the legend and the caller's overlay (a LIVE
   badge) sit beside the map, outside the image the map is announced as. */
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { useEdgeFade } from "./OversightShell";

export type MapShape = "dot" | "ring" | "pulse" | "area" | "pin" | "diamond" | "hub";
export type MapPoint = {
  id: string;
  /** the layer it belongs to (a toggle when the caller lists it in ``layers``) */
  layer: string;
  lat: number;
  lon: number;
  color: string;
  /** dot: a filled circle; ring: hollow; pulse: a dot with an animated ring (rivers at warning or danger); area: a
   *  translucent dashed circle (a district); pin: the vehicle in focus; diamond: a roadside site; hub: an inspection hub */
  shape?: MapShape;
  /** pixels: the dot, ring or area radius */
  radius?: number;
  /** tooltip heading and lines (plain text) */
  title: string;
  lines?: string[];
  /** a small label that stays on the map (pins and hubs) */
  label?: string;
  /** a softer fill for the many "normal" points */
  faint?: boolean;
};
export type MapLayer = { id: string; label: string; color: string; on?: boolean; count?: number };
export type MapView = { id: string; label: string; bounds: [[number, number], [number, number]] };
export type LegendItem = { label: string; color: string; shape?: MapShape };

/** Peninsular Malaysia and Borneo together, and each half. */
export const MY_VIEWS: MapView[] = [
  { id: "my", label: "Malaysia", bounds: [[0.85, 99.6], [7.45, 119.3]] },
  { id: "pen", label: "Peninsular", bounds: [[1.25, 99.6], [6.75, 104.4]] },
  { id: "bor", label: "Sabah & Sarawak", bounds: [[0.85, 109.5], [7.4, 119.3]] },
];
export const keyOf = (p: { layer: string; id: string }) => `${p.layer}:${p.id}`;

const OSM = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
type Basemap = { url: string; labels?: string; attribution: string; subdomains?: string; maxNativeZoom?: number };
/* CARTO's free Positron raster tiles now come back as an "API key required" picture for requests without a key, so the
   default is Esri's Light Gray Canvas (the same quiet light look, with its label layer above the district circles).
   NEXT_PUBLIC_MAP_TILES=carto switches to Positron; any other value is used as a tile URL template
   (NEXT_PUBLIC_MAP_ATTRIBUTION then says whose). */
const BASEMAPS: Record<string, Basemap> = {
  esri: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    labels: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    attribution: `Tiles © <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>, HERE, Garmin, ${OSM}`, maxNativeZoom: 16,
  },
  carto: { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", subdomains: "abcd",
    attribution: `${OSM} © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>` },
};
const TILES_ENV = process.env.NEXT_PUBLIC_MAP_TILES || "esri";
const BASEMAP: Basemap = BASEMAPS[TILES_ENV] || { url: TILES_ENV, attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || OSM };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const CSS = `
.lm-map.leaflet-container { font-family: Inter, system-ui, sans-serif; background: #DAD9DF; }
.lm-map .lm-base { filter: brightness(1.05) saturate(1.15); }
/* At a fractional zoom the scaled tiles leave hairline seams, which Leaflet's plus-lighter blending turns white:
   overlap every tile by a pixel, blend normally, over a background in the sea's colour. */
.lm-map.leaflet-container img.leaflet-tile { mix-blend-mode: normal; width: 257px !important; height: 257px !important; }
.lm-map .lm-labels { opacity: .85; }
/* each pane draws into its own SVG: let clicks through an SVG's empty area to the panes below (the paths stay clickable) */
.lm-map .leaflet-pane > svg { pointer-events: none; }
.lm-map .leaflet-control-attribution { font-size: 10px; background: rgba(255,255,255,.72); backdrop-filter: blur(6px); border-top-left-radius: 8px; color: #64748B; }
.lm-map .leaflet-control-attribution a { color: #475569; }
.leaflet-tooltip.lm-tip { border-radius: 12px; border: 1px solid rgba(255,255,255,.9); background: rgba(255,255,255,.96); box-shadow: 0 14px 34px -14px rgba(15,23,42,.45); padding: 8px 11px; color: #0F172A; font: 12px/1.4 Inter, system-ui, sans-serif; width: max-content; max-width: min(300px, calc(100vw - 48px)); white-space: normal; }
.leaflet-tooltip.lm-tip::before { display: none; }
.lm-tip b { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; margin-bottom: 2px; }
.lm-tip .lm-sw { width: 8px; height: 8px; border-radius: 99px; flex: none; }
.lm-tip div { color: #475569; }
.lm-ico { position: relative; }
.lm-ico .lm-core { position: absolute; left: 50%; top: 50%; border-radius: 99px; background: var(--c); border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(15,23,42,.08), 0 3px 8px rgba(15,23,42,.28); transform: translate(-50%,-50%); }
.lm-ico .lm-ring { position: absolute; left: 50%; top: 50%; border-radius: 99px; background: var(--c); opacity: .5; transform: translate(-50%,-50%); animation: lm-ping 1.9s cubic-bezier(0,0,.2,1) infinite; }
.lm-ico .lm-ring.lm-r2 { animation-delay: .95s; }
.lm-ico.lm-on .lm-core { box-shadow: 0 0 0 3px #0F172A, 0 3px 10px rgba(15,23,42,.4); }
@keyframes lm-ping { 0% { transform: translate(-50%,-50%) scale(1); opacity: .55 } 80%, 100% { transform: translate(-50%,-50%) scale(3.4); opacity: 0 } }
.lm-pin svg { position: absolute; left: 0; top: 0; filter: drop-shadow(0 6px 8px rgba(15,23,42,.35)); }
.lm-pin .lm-ring { left: 50%; top: 100%; width: 14px; height: 14px; }
.lm-tag { position: absolute; left: 50%; top: calc(100% + 4px); transform: translateX(-50%); white-space: nowrap; border-radius: 99px; padding: 2px 8px; font: 700 11px/1.4 Inter, system-ui, sans-serif; color: #fff; background: #0F172A; box-shadow: 0 6px 14px -6px rgba(15,23,42,.6); }
.lm-hub .lm-core { border-radius: 6px; }
.lm-hub .lm-tag { background: rgba(255,255,255,.92); color: #0F1E46; border: 1px solid #DBE4F0; font-weight: 600; }
.lm-dia .lm-core { border-radius: 2px; transform: translate(-50%,-50%) rotate(45deg); }
@media (prefers-reduced-motion: reduce) { .lm-ico .lm-ring { animation: none; opacity: .18; transform: translate(-50%,-50%) scale(2.2); } }
`;

type Item = { layer: Leaflet.Layer; p: MapPoint; kind: "circle" | "icon"; html?: string; tip: string; sig: string };

const ICON_SHAPES: MapShape[] = ["pulse", "pin", "diamond", "hub"];

function tipHtml(p: MapPoint) {
  return `<b><span class="lm-sw" style="background:${p.color}"></span>${esc(p.title)}</b>${(p.lines || []).map((l) => `<div>${esc(l)}</div>`).join("")}`;
}

function iconHtml(p: MapPoint, on: boolean) {
  const r = p.radius ?? 6;
  const c = `--c:${p.color}`;
  if (p.shape === "pin")
    return `<div class="lm-ico lm-pin${on ? " lm-on" : ""}" style="${c};width:30px;height:40px"><span class="lm-ring"></span><span class="lm-ring lm-r2"></span>`
      + `<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 39s12-13.4 12-23.2A12 12 0 0 0 3 15.8C3 25.6 15 39 15 39z" fill="${p.color}" stroke="#fff" stroke-width="2.2"/><circle cx="15" cy="15.5" r="5" fill="#fff"/></svg>`
      + (p.label ? `<span class="lm-tag">${esc(p.label)}</span>` : "") + `</div>`;
  const size = 2 * r;
  const cls = p.shape === "hub" ? "lm-hub" : p.shape === "diamond" ? "lm-dia" : "";
  const ring = p.shape === "pulse" ? `<span class="lm-ring" style="width:${size}px;height:${size}px"></span><span class="lm-ring lm-r2" style="width:${size}px;height:${size}px"></span>` : "";
  const tag = p.label ? `<span class="lm-tag">${esc(p.label)}</span>` : "";
  return `<div class="lm-ico ${cls}${on ? " lm-on" : ""}" style="${c};width:${size + 8}px;height:${size + 8}px">${ring}<span class="lm-core" style="width:${size}px;height:${size}px"></span>${tag}</div>`;
}

function circleStyle(p: MapPoint, on: boolean): Leaflet.CircleMarkerOptions {
  const r = p.radius ?? 4;
  if (p.shape === "area")
    return { radius: r, color: on ? "#0F172A" : p.color, weight: on ? 2.5 : 1.6, dashArray: on ? undefined : "5 4", fillColor: p.color, fillOpacity: on ? 0.22 : 0.12, opacity: 0.9 };
  if (p.shape === "ring")
    return { radius: on ? r + 3 : r, color: on ? "#0F172A" : p.color, weight: on ? 2.5 : 1.6, fill: true, fillColor: "#fff", fillOpacity: 0.6, opacity: 1 };
  return { radius: on ? r + 3 : r, color: on ? "#0F172A" : "#FFFFFF", weight: on ? 2.5 : p.faint ? 0.6 : 1.2, fillColor: p.color, fillOpacity: p.faint ? 0.62 : 0.95, opacity: 1 };
}

export function LiveMap({ label, points, layers = [], legend = [], views = MY_VIEWS, selected, onSelect, focus, overlay, className = "h-[440px]", compact = false, footer }: {
  /** what the map shows, for screen readers (the lists beside it carry the same data) */
  label: string;
  points: MapPoint[];
  layers?: MapLayer[];
  legend?: LegendItem[];
  views?: MapView[];
  /** the selected point, as layer:id */
  selected?: string | null;
  onSelect?: (p: MapPoint) => void;
  /** fly here whenever ``key`` changes */
  focus?: { key: string; lat: number; lon: number; zoom?: number } | null;
  /** top-right, beside the zoom buttons: the LIVE badge */
  overlay?: ReactNode;
  className?: string;
  /** a preview: no layer toggles or region views, the page does not zoom on scroll */
  compact?: boolean;
  /** under the map on a phone, and in the bottom-right corner from sm up */
  footer?: ReactNode;
}) {
  const el = useRef<HTMLDivElement>(null);
  const Lr = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const groups = useRef<Map<string, Leaflet.LayerGroup>>(new Map());
  const items = useRef<Map<string, Item>>(new Map());
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<string | null>(views[0]?.id ?? null);
  const [off, setOff] = useState<Record<string, boolean>>(() => Object.fromEntries(layers.filter((l) => l.on === false).map((l) => [l.id, true])));
  const [failed, setFailed] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  useEdgeFade(strip);

  // the map itself, once; Leaflet only exists in the browser
  useEffect(() => {
    let alive = true;
    let ro: ResizeObserver | null = null;
    (async () => {
      let Lf: typeof Leaflet;
      try {
        const mod: any = await import("leaflet");
        Lf = mod.default ?? mod;
      } catch {
        if (alive) setFailed(true);
        return;
      }
      if (!alive || !el.current) return;
      Lr.current = Lf;
      const m = Lf.map(el.current, { zoomControl: false, attributionControl: true, minZoom: 4, maxZoom: 17, zoomSnap: 0.25, zoomDelta: 0.5,
        wheelPxPerZoomLevel: 90, scrollWheelZoom: !compact, worldCopyJump: false, maxBounds: [[-12, 85], [20, 135]], maxBoundsViscosity: 0.8 });
      m.attributionControl.setPrefix(false);
      m.createPane("lm-areas").style.zIndex = "405";
      const labels = m.createPane("lm-labels");
      labels.style.zIndex = "410";
      labels.style.pointerEvents = "none";
      m.createPane("lm-dots").style.zIndex = "415";
      Lf.tileLayer(BASEMAP.url, { attribution: BASEMAP.attribution, subdomains: BASEMAP.subdomains || "abc", maxZoom: 19, maxNativeZoom: BASEMAP.maxNativeZoom, className: "lm-base" }).addTo(m);
      if (BASEMAP.labels) Lf.tileLayer(BASEMAP.labels, { pane: "lm-labels", maxZoom: 19, maxNativeZoom: BASEMAP.maxNativeZoom, className: "lm-labels" }).addTo(m);
      // a phone-width map of the whole country leaves the Peninsula a thumbnail: start there when the views offer it
      const start = (el.current.clientWidth < 640 && views.find((v) => v.id === "pen")) || views[0];
      m.fitBounds(start.bounds, { padding: [8, 8] });
      setView(start.id);
      m.getContainer().classList.add("lm-map");
      ro = new ResizeObserver(() => m.invalidateSize({ pan: false }));
      ro.observe(el.current);
      map.current = m;
      setReady(true);
    })();
    return () => {
      alive = false;
      ro?.disconnect();
      map.current?.remove();
      map.current = null;
      groups.current = new Map();
      items.current = new Map();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // markers: add the new, update the known ones in place, drop the gone
  useEffect(() => {
    const m = map.current, Lf = Lr.current;
    if (!ready || !m || !Lf) return;
    const seen = new Set<string>();
    for (const p of points) {
      if (p.lat == null || p.lon == null || Number.isNaN(p.lat)) continue;
      const key = keyOf(p);
      seen.add(key);
      const on = key === selected;
      let g = groups.current.get(p.layer);
      if (!g) {
        g = Lf.layerGroup();
        groups.current.set(p.layer, g);
        if (!off[p.layer]) g.addTo(m);
      }
      const kind: Item["kind"] = ICON_SHAPES.includes(p.shape || "dot") ? "icon" : "circle";
      const tip = tipHtml(p);
      const ex = items.current.get(key);
      const sig = JSON.stringify([p.lat, p.lon, p.color, p.radius, p.shape, p.faint, p.label, on]);
      if (ex && ex.kind === kind) {
        ex.p = p;
        if (ex.sig === sig && ex.tip === tip) continue;  // unchanged since the last poll
        ex.sig = sig;
        if (kind === "circle") {
          const c = ex.layer as Leaflet.CircleMarker;
          c.setLatLng([p.lat, p.lon]);
          const st = circleStyle(p, on);
          c.setStyle(st);
          c.setRadius(st.radius!);
          if (on) c.bringToFront();
        } else {
          const mk = ex.layer as Leaflet.Marker;
          mk.setLatLng([p.lat, p.lon]);
          const html = iconHtml(p, on);
          if (html !== ex.html) {
            mk.setIcon(makeIcon(Lf, p, html));
            ex.html = html;
          }
          mk.setZIndexOffset(p.shape === "pin" ? 2000 : on ? 1000 : 0);
        }
        if (tip !== ex.tip) {
          (ex.layer as any).setTooltipContent(tip);
          ex.tip = tip;
        }
        continue;
      }
      if (ex) g.removeLayer(ex.layer);
      let layer: Leaflet.Layer;
      let html: string | undefined;
      if (kind === "circle") {
        layer = Lf.circleMarker([p.lat, p.lon], { ...circleStyle(p, on), pane: p.shape === "area" ? "lm-areas" : "lm-dots", bubblingMouseEvents: false });
      } else {
        html = iconHtml(p, on);
        layer = Lf.marker([p.lat, p.lon], { icon: makeIcon(Lf, p, html), keyboard: false, zIndexOffset: p.shape === "pin" ? 2000 : on ? 1000 : 0});
      }
      (layer as any).bindTooltip(tip, { className: "lm-tip", direction: "top", offset: [0, kind === "icon" ? (p.shape === "pin" ? -34 : -8) : -4], opacity: 1 });
      layer.on("click", () => {
        const it = items.current.get(key);
        if (it) pick.current?.(it.p);
      });
      g.addLayer(layer);
      items.current.set(key, { layer, p, kind, html, tip, sig });
    }
    for (const [key, it] of Array.from(items.current.entries())) {
      if (seen.has(key)) continue;
      groups.current.get(it.p.layer)?.removeLayer(it.layer);
      items.current.delete(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, points, selected]);

  // layer toggles
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    groups.current.forEach((g, id) => (off[id] ? m.removeLayer(g) : !m.hasLayer(g) && g.addTo(m)));
  }, [ready, off]);

  // fly to the point in focus (a vehicle opened from the address)
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !focus) return;
    m.flyTo([focus.lat, focus.lon], focus.zoom ?? 11, { duration: 1.4 });
    setView(null);  // no region view is the current one any more
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focus?.key]);

  const fit = (id: string | null = view) => {
    const v = views.find((x) => x.id === id) || views[0];
    setView(v.id);
    map.current?.flyToBounds(v.bounds, { padding: [8, 8], duration: 0.8 });
  };

  const ctl = "flex h-9 w-9 items-center justify-center rounded-xl border border-white/90 bg-white/90 text-fg-2 shadow-glass backdrop-blur hover:bg-white";
  const hasControls = !compact && (views.length > 1 || layers.length > 0);
  const controls = (wrap: boolean) => (
    <>
      {views.length > 1 && (
        <div role="group" aria-label="Map region" className="flex shrink-0 rounded-xl border border-white/90 bg-white/90 p-0.5 shadow-glass backdrop-blur">
          {views.map((v) => (
            <button key={v.id} onClick={() => fit(v.id)} aria-pressed={view === v.id}
              className={`whitespace-nowrap rounded-[10px] px-2.5 py-1 text-[11.5px] font-semibold transition ${view === v.id ? "bg-[#0F1E46] text-white" : "text-fg-2 hover:bg-white"}`}>
              {v.label}
            </button>
          ))}
        </div>
      )}
      {layers.length > 0 && (
        <div role="group" aria-label="Map layers" className={`flex shrink-0 gap-1 ${wrap ? "flex-wrap" : ""}`}>
          {layers.map((l) => {
            const shown = !off[l.id];
            return (
              <button key={l.id} onClick={() => setOff((o) => ({ ...o, [l.id]: !o[l.id] }))} aria-pressed={shown}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold shadow-glass backdrop-blur transition ${shown ? "border-white/90 bg-white/90 text-fg" : "border-white/70 bg-white/55 text-fg-4"}`}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: shown ? l.color : "transparent", boxShadow: `inset 0 0 0 1.5px ${l.color}` }} aria-hidden />
                {l.label}{l.count != null && <span className="font-medium text-fg-3">{l.count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
  return (
    <div className="flex min-w-0 flex-col">
      {/* hoisted and de-duplicated by React: one copy however many maps the page has */}
      <style href="vhi-livemap" precedence="default">{CSS}</style>
      {hasControls && <div ref={strip} className="mb-2 flex min-w-0 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] sm:hidden [&::-webkit-scrollbar]:hidden">{controls(false)}</div>}
      <div className={`relative isolate min-w-0 overflow-hidden rounded-2xl border border-white/80 bg-[#E6EDF6] shadow-glass ${className}`}>
        <div ref={el} role="img" aria-label={label} className="absolute inset-0 z-0" />
        {!ready && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span className="rounded-full bg-white/85 px-3 py-1.5 text-[12px] text-fg-3 shadow-glass">{failed ? "The map could not load; the lists beside it show the same data." : "Loading the map…"}</span>
          </div>
        )}
        {/* top left from sm up (a strip above the map on a phone): region views and layer toggles, clear of the badge */}
        {hasControls && <div className="absolute left-2 top-2 z-10 hidden flex-wrap items-start gap-1.5 sm:flex" style={{ right: overlay ? 264 : 56 }}>{controls(true)}</div>}
        {/* the caller's badge: top left on a phone, beside the zoom buttons from sm up */}
        {overlay && <div className="absolute left-2 top-2 z-10 sm:left-auto sm:right-14">{overlay}</div>}
        {/* top right: zoom and fit */}
        <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
          <button className={ctl} onClick={() => map.current?.zoomIn()} aria-label="Zoom in"><Icon name="plus" size={16} /></button>
          <button className={ctl} onClick={() => map.current?.zoomOut()} aria-label="Zoom out"><span className="block h-[2px] w-3.5 rounded bg-current" aria-hidden /></button>
          <button className={ctl} onClick={() => fit()} aria-label="Fit the map to Malaysia" title="Fit to the region"><Icon name="globe" size={16} /></button>
        </div>
        {/* bottom left, clear of the tile attribution (a licence requirement) along the bottom edge: the legend (from sm
            up; below the map on a phone) */}
        {legend.length > 0 && (
          <div className="absolute bottom-7 left-2 z-10 hidden max-w-[calc(100%-1rem)] flex-wrap gap-x-3 gap-y-1 rounded-xl border border-white/90 bg-white/90 px-3 py-2 text-[11px] text-fg-2 shadow-glass backdrop-blur sm:flex">
            {legend.map((x) => <LegendEntry key={x.label} x={x} />)}
          </div>
        )}
        {footer && <div className="absolute bottom-7 right-2 z-10 hidden sm:block">{footer}</div>}
      </div>
      {(legend.length > 0 || footer) && (
        <div className="mt-2 flex flex-col gap-2 sm:hidden">
          {legend.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-fg-2">{legend.map((x) => <LegendEntry key={x.label} x={x} />)}</div>}
          {footer}
        </div>
      )}
    </div>
  );
}

function makeIcon(Lf: typeof Leaflet, p: MapPoint, html: string) {
  if (p.shape === "pin") return Lf.divIcon({ className: "", html, iconSize: [30, 40], iconAnchor: [15, 39] });
  const s = 2 * (p.radius ?? 6) + 8;
  return Lf.divIcon({ className: "", html, iconSize: [s, s], iconAnchor: [s / 2, s / 2] });
}

export function LegendEntry({ x }: { x: LegendItem }) {
  const s = x.shape || "dot";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {s === "pulse" ? (
        <span className="relative flex h-3 w-3 items-center justify-center" aria-hidden>
          <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full opacity-50 motion-reduce:animate-none" style={{ background: x.color }} />
          <span className="relative h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: x.color }} />
        </span>
      ) : s === "area" ? (
        <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-dashed" style={{ borderColor: x.color, background: x.color + "22" }} aria-hidden />
      ) : s === "ring" ? (
        <span className="h-2.5 w-2.5 rounded-full border-[1.5px] bg-white" style={{ borderColor: x.color }} aria-hidden />
      ) : s === "diamond" ? (
        <span className="h-2.5 w-2.5 rotate-45 rounded-[2px]" style={{ background: x.color }} aria-hidden />
      ) : s === "hub" ? (
        <span className="h-3 w-3 rounded-[4px] ring-2 ring-white" style={{ background: x.color }} aria-hidden />
      ) : s === "pin" ? (
        <svg width="10" height="13" viewBox="0 0 30 40" aria-hidden><path d="M15 39s12-13.4 12-23.2A12 12 0 0 0 3 15.8C3 25.6 15 39 15 39z" fill={x.color} /></svg>
      ) : (
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: x.color }} aria-hidden />
      )}
      {x.label}
    </span>
  );
}

/** "LIVE · updated 14:32:05": when the data was last pulled, with a button to pull it now. */
export function LiveBadge({ at, live = true, busy = false, onRefresh, title }: { at: Date | null; live?: boolean; busy?: boolean; onRefresh?: () => void; title?: string }) {
  const t = at ? at.toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/90 bg-white/95 py-1 pl-2.5 pr-1 text-[11.5px] font-semibold shadow-glass backdrop-blur" title={title} role="status">
      <span className="relative mr-0.5 flex h-2 w-2" aria-hidden>
        {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none" style={{ background: "#DC2626" }} />}
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: live ? "#DC2626" : "#D97706" }} />
      </span>
      <span className={live ? "text-[#B91C1C]" : "text-[#B45309]"}>{live ? "LIVE" : "SNAPSHOT"}</span>
      <span className="whitespace-nowrap text-fg-2">· updated <span className="font-mono tabular-nums">{t}</span></span>
      {onRefresh && (
        <button onClick={onRefresh} disabled={busy} aria-label="Refresh the map now" title="Refresh now"
          className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full text-fg-2 hover:bg-blue-50 hover:text-cyan">
          <span className={busy ? "animate-spin" : ""}><Icon name="refresh" size={13} /></span>
        </button>
      )}
    </span>
  );
}
