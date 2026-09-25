"use client";
/* Small SVG chart kit (no chart library): line / multi-line with forecast band, bars, sparkline, donut, scatter. */
import { ReactNode, useEffect, useRef, useState } from "react";

/** Measures its own width so charts draw at real pixel size (crisp text, no stretching). */
function useWidth(initial = 600) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(120, Math.round(e[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

type Pt = { x: number; y: number };

function scale(d0: number, d1: number, r0: number, r1: number) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

function niceTicks(lo: number, hi: number, n = 4) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return [lo];
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

export type Series = { name?: string; color: string; points: Pt[]; dashed?: boolean; width?: number; dots?: boolean; area?: boolean };

export function LineChart({
  series, height = 220, xLabels, yMin, yMax, hlines = [], vlines = [], bands = [], markers = [], yFmt = (v: number) => String(v), xTickEvery = 1, children,
}: {
  series: Series[]; height?: number; xLabels?: { x: number; label: string; color?: string }[]; yMin?: number; yMax?: number;
  hlines?: { y: number; color: string; label?: string; dashed?: boolean }[]; vlines?: { x: number; color: string; label?: string }[];
  bands?: { points: { x: number; lo: number; hi: number }[]; color: string }[];
  markers?: { x: number; y: number; color: string; r?: number; ring?: boolean; label?: string; square?: boolean }[];
  yFmt?: (v: number) => string; xTickEvery?: number; children?: ReactNode;
}) {
  const [ref, W] = useWidth();
  const H = height, L = 48, R = 16, T = 12, B = 28;
  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p.x).concat(bands.flatMap((b) => b.points.map((p) => p.x)), vlines.map((v) => v.x));
  let ys = all.map((p) => p.y).concat(hlines.map((h) => h.y), bands.flatMap((b) => b.points.flatMap((p) => [p.lo, p.hi])), markers.map((m) => m.y));
  ys = ys.filter((v) => Number.isFinite(v));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let lo = yMin ?? Math.min(...ys), hi = yMax ?? Math.max(...ys);
  const pad = (hi - lo) * 0.08 || 1;
  if (yMin === undefined) lo -= pad;
  if (yMax === undefined) hi += pad;
  const sx = scale(x0, x1, L, W - R), sy = scale(lo, hi, H - B, T);
  const path = (pts: Pt[]) => pts.filter((p) => Number.isFinite(p.y)).map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join("");
  const ticks = niceTicks(lo, hi);
  return (
    <div ref={ref} className="w-full">
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} stroke="#1F2B44" />
          <text x={L - 8} y={sy(t) + 4} textAnchor="end" fontSize="11" fill="#8EA3C2">{yFmt(t)}</text>
        </g>
      ))}
      {bands.map((b, i) => (
        <path key={i} fill={b.color} d={`${b.points.map((p, k) => `${k ? "L" : "M"}${sx(p.x)} ${sy(p.hi)}`).join("")}${[...b.points].reverse().map((p) => `L${sx(p.x)} ${sy(p.lo)}`).join("")}Z`} />
      ))}
      {hlines.map((h, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={sy(h.y)} y2={sy(h.y)} stroke={h.color} strokeWidth="2" strokeDasharray={h.dashed ? "6 5" : undefined} />
          {h.label && <text x={W - R - 4} y={sy(h.y) - 6} textAnchor="end" fontSize="12" fontWeight="700" fill={h.color}>{h.label}</text>}
        </g>
      ))}
      {vlines.map((v, i) => (
        <g key={i}>
          <line x1={sx(v.x)} x2={sx(v.x)} y1={T} y2={H - B} stroke={v.color} strokeDasharray="3 4" />
          {v.label && <text x={sx(v.x) + 4} y={T + 10} fontSize="11" fill="#8EA3C2">{v.label}</text>}
        </g>
      ))}
      {series.map((s, i) => (
        <g key={i}>
          {s.area && s.points.length > 1 && (
            <path d={`${path(s.points)}L${sx(s.points[s.points.length - 1].x)} ${H - B}L${sx(s.points[0].x)} ${H - B}Z`} fill={s.color} opacity="0.12" />
          )}
          <path d={path(s.points)} fill="none" stroke={s.color} strokeWidth={s.width ?? 2.2} strokeDasharray={s.dashed ? "7 5" : undefined} vectorEffect="non-scaling-stroke" />
          {s.dots && s.points.map((p, k) => <circle key={k} cx={sx(p.x)} cy={sy(p.y)} r="3.5" fill={s.color} />)}
        </g>
      ))}
      {markers.map((m, i) =>
        m.square ? (
          <rect key={i} x={sx(m.x) - 6} y={sy(m.y) + 10} width="12" height="9" fill={m.color} />
        ) : (
          <g key={i}>
            <circle cx={sx(m.x)} cy={sy(m.y)} r={m.r ?? 8} fill={m.ring ? "none" : m.color} stroke={m.color} strokeWidth="2.5" />
            {m.label && (
              <g>
                <circle cx={sx(m.x)} cy={sy(m.y) - 22} r="10" fill={m.color} />
                <text x={sx(m.x)} y={sy(m.y) - 18} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">{m.label}</text>
              </g>
            )}
          </g>
        ),
      )}
      {(xLabels || []).filter((_, i) => i % xTickEvery === 0).map((l, i) => (
        <text key={i} x={sx(l.x)} y={H - 8} textAnchor="middle" fontSize="11" fill={l.color || "#8EA3C2"}>{l.label}</text>
      ))}
      {children}
    </svg>
    </div>
  );
}

export function Bars({ values, labels, height = 160, color = "#60A5FA", highlight, fmt = (v: number) => String(v), secondary, secondaryColor = "#EF4444" }: {
  values: number[]; labels?: string[]; height?: number; color?: string; highlight?: number; fmt?: (v: number) => string;
  secondary?: number[]; secondaryColor?: string;
}) {
  const [ref, W] = useWidth();
  const H = height, B = 24, T = 16;
  const mx = Math.max(...values, ...(secondary || []), 1);
  const bw = W / Math.max(1, values.length);
  const every = Math.max(1, Math.ceil(values.length / Math.max(1, W / 46)));
  return (
    <div ref={ref} className="w-full">
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img">
      {values.map((v, i) => {
        const h = ((H - B - T) * v) / mx;
        return (
          <g key={i}>
            <rect x={i * bw + bw * 0.18} y={H - B - h} width={bw * 0.64} height={h} rx="3" fill={highlight === i ? "#22D3EE" : color} opacity={highlight === undefined || highlight === i ? 1 : 0.75} />
            {secondary && <line x1={i * bw + bw * 0.1} x2={i * bw + bw * 0.9} y1={H - B - ((H - B - T) * secondary[i]) / mx} y2={H - B - ((H - B - T) * secondary[i]) / mx} stroke={secondaryColor} strokeWidth="3" />}
            {labels && i % every === 0 && <text x={i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#8EA3C2">{labels[i]}</text>}
            <title>{`${labels ? labels[i] + ": " : ""}${fmt(v)}`}</title>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

export function Spark({ values, color = "#22D3EE", width = 70, height = 26 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (!values?.length) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const sx = scale(0, values.length - 1, 2, width - 2), sy = scale(lo, hi === lo ? lo + 1 : hi, height - 3, 3);
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={values.map((v, i) => `${i ? "L" : "M"}${sx(i)} ${sy(v)}`).join("")} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

export function Donut({ parts, size = 150, center }: { parts: { value: number; color: string }[]; size?: number; center?: ReactNode }) {
  const r = size / 2 - 14, c = 2 * Math.PI * r;
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1F2B44" strokeWidth="22" />
        {parts.map((p, i) => {
          const d = (p.value / total) * c;
          const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth="22" strokeDasharray={`${d} ${c}`} strokeDashoffset={-acc} />;
          acc += d;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{center}</div>
    </div>
  );
}

export function Scatter({ points, height = 240, xLabel, yLabel, xFmt = (v: number) => String(v), yFmt = (v: number) => String(v), vline, hline }: {
  points: { x: number; y: number; color: string; r?: number; label?: string; title?: string }[]; height?: number; xLabel?: string; yLabel?: string;
  xFmt?: (v: number) => string; yFmt?: (v: number) => string; vline?: number; hline?: number;
}) {
  const [ref, W] = useWidth();
  const H = height, L = 52, R = 16, T = yLabel ? 30 : 12, B = 36;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x0 = Math.min(...xs, vline ?? Infinity), x1 = Math.max(...xs, vline ?? -Infinity);
  const y0 = Math.min(...ys, hline ?? Infinity), y1 = Math.max(...ys, hline ?? -Infinity);
  const px = (x1 - x0) * 0.06 || 1, py = (y1 - y0) * 0.08 || 1;
  const sx = scale(x0 - px, x1 + px, L, W - R), sy = scale(y0 - py, y1 + py, H - B, T);
  return (
    <div ref={ref} className="w-full">
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img">
      {niceTicks(y0 - py, y1 + py).map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} stroke="#1F2B44" />
          <text x={L - 8} y={sy(t) + 4} textAnchor="end" fontSize="11" fill="#8EA3C2">{yFmt(t)}</text>
        </g>
      ))}
      {niceTicks(x0 - px, x1 + px, 6).map((t) => (
        <text key={t} x={sx(t)} y={H - 18} textAnchor="middle" fontSize="11" fill="#8EA3C2">{xFmt(t)}</text>
      ))}
      {vline !== undefined && <line x1={sx(vline)} x2={sx(vline)} y1={T} y2={H - B} stroke="#EF4444" strokeDasharray="5 5" />}
      {hline !== undefined && <line x1={L} x2={W - R} y1={sy(hline)} y2={sy(hline)} stroke="#EF4444" strokeDasharray="5 5" />}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={sx(p.x)} cy={sy(p.y)} r={p.r ?? 5} fill={p.color} opacity="0.9"><title>{p.title}</title></circle>
          {p.label && (sx(p.x) > W - R - 60
            ? <text x={sx(p.x) - 9} y={sy(p.y) + 4} textAnchor="end" fontSize="12" fontWeight="700" fill={p.color}>{p.label}</text>
            : <text x={sx(p.x) + 9} y={sy(p.y) + 4} fontSize="12" fontWeight="700" fill={p.color}>{p.label}</text>)}
        </g>
      ))}
      {xLabel && <text x={(L + W - R) / 2} y={H - 3} textAnchor="middle" fontSize="11" fill="#6F7E98">{xLabel}</text>}
      {yLabel && <text x={L} y={13} fontSize="11" fill="#6F7E98">{yLabel}</text>}
    </svg>
    </div>
  );
}
