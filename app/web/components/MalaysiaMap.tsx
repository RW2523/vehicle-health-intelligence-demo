"use client";
/* A simple map of Malaysia to draw points on (branches, roadside sites, river stations). Plain lon/lat projection and
   approximate outlines: it places things, it is not for navigation. */
import { ReactNode } from "react";

export type BBox = { lon0: number; lon1: number; lat0: number; lat1: number };
// Peninsular + East Malaysia; the flood page also zooms in on either half
export const MALAYSIA: BBox = { lon0: 99.5, lon1: 119.5, lat0: 0.8, lat1: 7.5 };
export const PENINSULA: BBox = { lon0: 99.6, lon1: 104.5, lat0: 1.2, lat1: 6.8 };
export const BORNEO_BOX: BBox = { lon0: 109.4, lon1: 119.4, lat0: 0.8, lat1: 7.4 };

// Approximate coastline / border outlines (lon, lat) - illustrative only
const PENINSULAR: [number, number][] = [[100.13, 6.44], [100.4, 6.6], [100.8, 6.3], [101.1, 5.9], [101.6, 5.8], [102.1, 6.2], [102.35, 6.15],
  [103.1, 5.5], [103.4, 4.8], [103.45, 4.2], [103.4, 3.8], [103.8, 2.6], [104.2, 1.9], [104.25, 1.4], [103.5, 1.27], [103.0, 1.6],
  [102.5, 2.0], [101.9, 2.5], [101.3, 2.9], [101.1, 3.4], [100.7, 3.9], [100.6, 4.4], [100.35, 5.0], [100.4, 5.5], [100.3, 6.0]];
const BORNEO: [number, number][] = [[109.6, 1.9], [110.3, 1.7], [111.0, 1.6], [111.4, 2.4], [113.0, 3.1], [114.0, 4.6], [115.0, 5.0],
  [115.4, 5.3], [116.0, 6.0], [116.8, 7.0], [117.3, 6.6], [117.7, 6.4], [118.1, 5.8], [119.2, 5.2], [118.6, 4.4], [117.6, 4.2],
  [116.0, 4.3], [115.6, 4.0], [115.0, 2.5], [114.5, 1.5], [113.0, 1.2], [112.0, 1.0], [111.0, 1.0], [110.0, 0.95], [109.6, 1.5]];

export type Projection = { x: (lon: number) => number; y: (lat: number) => number; W: number; H: number };

/** The map, with the caller's layers drawn by ``children`` in map coordinates. The drawing is always ``width`` wide,
 *  so markers keep their size on screen when the map zooms in. */
export function MalaysiaMap({ label, children, bbox = MALAYSIA, width = 900, className = "" }: {
  label: string; children: (p: Projection) => ReactNode; bbox?: BBox; width?: number; className?: string;
}) {
  const W = width;
  const H = bbox === MALAYSIA ? 320 : Math.round((W * (bbox.lat1 - bbox.lat0)) / (bbox.lon1 - bbox.lon0));
  const x = (lon: number) => ((lon - bbox.lon0) / (bbox.lon1 - bbox.lon0)) * W;
  const y = (lat: number) => H - ((lat - bbox.lat0) / (bbox.lat1 - bbox.lat0)) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`w-full rounded-xl bg-ink-950 ${className}`} role="img" aria-label={label}>
      {[PENINSULAR, BORNEO].map((poly, i) => (
        <path key={i} d={"M" + poly.map(([lo, la]) => `${x(lo).toFixed(1)} ${y(la).toFixed(1)}`).join(" L") + " Z"} fill="#132038" stroke="#2A3957" />
      ))}
      {children({ x, y, W, H })}
    </svg>
  );
}
