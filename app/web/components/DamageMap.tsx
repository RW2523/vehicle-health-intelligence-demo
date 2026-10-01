"use client";
/* The damage map: every finding as a pin on the vehicle - on its photos (front and rear three-quarter views, where the
   photo's parts have been measured) and on a top-down plan that shows every side and the underbody. A pin opens the
   finding: what was found, where, by which module, its evidence image and the way to its detail. */
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DamageFinding, PLAN, UNDER, ZONE_LABEL, ZoneId } from "@/lib/zones";
import { Icon } from "./icons";
import type { Photo } from "./Photo";
import { PhotoCreditBadge } from "./Photo";
import { Source } from "./ui";

type Anchors = { side: "left" | "right"; points: Partial<Record<ZoneId, [number, number]>> };
type ViewId = "hero" | "rear" | "plan";
type View = { id: ViewId; label: string; photo?: Photo & { anchors?: Anchors | null }; anchors?: Anchors };

const SEV: Record<string, { c: string; soft: string; label: string }> = {
  high: { c: "#DC2626", soft: "#FEE2E2", label: "High" },
  medium: { c: "#D97706", soft: "#FEF3C7", label: "Medium" },
  low: { c: "#2563EB", soft: "#DBEAFE", label: "Low" },
};
const STATUS: Record<string, string> = {
  open: "Open", confirmed: "Confirmed", dismissed: "Passed", advisory: "Advisory", deferred: "Deferred", sample: "Sample image",
};
const decided = (f: DamageFinding) => f.status !== "open" && f.status !== "sample";

/** The size of a box with the given aspect ratio that fits the container's width and a maximum height. */
function useBox(ratio: number, maxH: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const width = Math.min(w, maxH * ratio);
  return { ref, width, height: width / ratio };
}

/** A top-down plan of the vehicle, front to the right, its left side at the top (viewBox 0 0 400 200). */
function Plan({ vtype }: { vtype?: string }) {
  const t = (vtype || "").toLowerCase();
  const truck = /prime|lorry|truck|bus/.test(t);
  const van = /van|mpv/.test(t);
  const pickup = /pickup/.test(t);
  const glass = "#D7E3F4";
  return (
    <svg viewBox="0 0 400 200" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="dm-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#E9EFF8" /></linearGradient>
      </defs>
      {/* the floor */}
      <rect x="4" y="18" width="392" height="164" rx="26" fill="#F1F5FB" stroke="#E2E8F0" strokeDasharray="6 6" />
      {/* wheels */}
      {(truck ? [[330, 42], [330, 158], [150, 42], [150, 158], [108, 42], [108, 158]] : [[300, 42], [300, 158], [100, 42], [100, 158]]).map(([x, y], i) => (
        <rect key={i} x={x - 22} y={y - 9} width="44" height="18" rx="6" fill="#334155" />
      ))}
      {truck ? (
        <>
          <rect x="70" y="72" width="235" height="56" rx="8" fill="#E2E8F0" stroke="#94A3B8" />
          <circle cx="150" cy="100" r="16" fill="#CBD5E1" stroke="#94A3B8" />
          <rect x="295" y="40" width="98" height="120" rx="16" fill="url(#dm-body)" stroke="#94A3B8" strokeWidth="2" />
          <rect x="360" y="52" width="22" height="96" rx="6" fill={glass} />
        </>
      ) : (
        <>
          <path d={van ? "M22 52 Q22 40 40 40 L360 40 Q386 40 388 64 L388 136 Q386 160 360 160 L40 160 Q22 160 22 148 Z"
            : "M24 60 Q24 42 50 42 L330 42 Q384 46 390 82 L390 118 Q384 154 330 158 L50 158 Q24 158 24 140 Z"}
            fill="url(#dm-body)" stroke="#94A3B8" strokeWidth="2" />
          {pickup ? (
            <>
              <rect x="34" y="54" width="130" height="92" rx="6" fill="#EEF2F7" stroke="#CBD5E1" />
              <path d="M170 56 L300 56 Q318 100 300 144 L170 144 Z" fill={glass} opacity=".85" />
              <rect x="186" y="60" width="96" height="80" rx="10" fill="#F8FAFC" />
            </>
          ) : (
            <>
              <path d={van ? "M318 50 Q352 100 318 150 L300 150 L300 50 Z" : "M262 52 Q296 100 262 148 L246 146 Q262 100 246 54 Z"} fill={glass} />
              <rect x={van ? 70 : 118} y="56" width={van ? 228 : 126} height="88" rx="14" fill="#F8FAFC" stroke="#E2E8F0" />
              {!van && <path d="M86 56 Q66 100 86 144 L104 142 Q90 100 104 58 Z" fill={glass} />}
            </>
          )}
          {/* lamps and mirrors */}
          <rect x="374" y="52" width="10" height="20" rx="4" fill="#FDE68A" /><rect x="374" y="128" width="10" height="20" rx="4" fill="#FDE68A" />
          <rect x="22" y="54" width="7" height="18" rx="3" fill="#FCA5A5" /><rect x="22" y="128" width="7" height="18" rx="3" fill="#FCA5A5" />
          <rect x={van ? 296 : 252} y="32" width="14" height="10" rx="3" fill="#94A3B8" /><rect x={van ? 296 : 252} y="158" width="14" height="10" rx="3" fill="#94A3B8" />
        </>
      )}
      {/* the underbody, seen through */}
      <rect x="60" y="70" width="270" height="60" rx="10" fill="none" stroke="#64748B" strokeOpacity=".35" strokeDasharray="4 5" />
      <text x="392" y="14" textAnchor="end" fontSize="10" fill="#94A3B8" fontWeight="600">FRONT ›</text>
      <text x="8" y="196" fontSize="9" fill="#94A3B8">left side at the top · dashed: underbody</text>
    </svg>
  );
}

/** A prime mover's parts sit elsewhere on its plan: the cab over the engine, the exhaust under the cab, the drive axles
 *  behind (x, y in the 400 × 200 plan, front to the right). */
const TRUCK_PLAN: Partial<Record<ZoneId, [number, number]>> = {
  front_bumper: [394, 100], plate_front: [394, 82], headlamp_l: [386, 58], headlamp_r: [386, 142], windscreen: [370, 100],
  bonnet: [346, 112], cabin: [322, 78], roof: [334, 132], side_l: [300, 46], side_r: [300, 154],
  wheel_fl: [330, 42], wheel_fr: [330, 158], wheel_rl: [150, 42], wheel_rr: [150, 158], exhaust: [268, 126], underbody: [200, 100],
  rear_window: [300, 100], boot: [150, 100], rear_bumper: [70, 100], plate_rear: [70, 118], tail_lamp_l: [72, 78], tail_lamp_r: [72, 122],
};

const planPoint = (z: ZoneId, vtype?: string): [number, number] => {
  if (/prime|lorry|truck|bus/i.test(vtype || "") && TRUCK_PLAN[z]) {
    const [x, y] = TRUCK_PLAN[z]!;
    return [x / 400, y / 200];
  }
  const [x, y] = PLAN[z];
  return [(400 - y) / 400, x / 200];  // the plan is drawn front-to-the-right
};

function Pin({ zone, items, x, y, active, selected, onClick }: {
  zone: ZoneId; items: DamageFinding[]; x: number; y: number; active: boolean; selected: boolean; onClick: () => void;
}) {
  const worst = items.find((f) => f.severity === "high") || items.find((f) => f.severity === "medium") || items[0];
  const sev = SEV[worst.severity] || SEV.medium;
  const allDone = items.every(decided);
  const under = UNDER.includes(zone);
  const pulse = !allDone && worst.severity === "high";
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={`${items.length > 1 ? `${items.length} findings` : items[0].title} · ${ZONE_LABEL[zone]}`}
      aria-expanded={active} className="group absolute z-10 -translate-x-1/2 -translate-y-1/2 focus:outline-none" style={{ left: `${x * 100}%`, top: `${y * 100}%` }}>
      {pulse && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: sev.c }} aria-hidden />}
      <span className={`relative flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold shadow-[0_4px_14px_-4px_rgba(15,23,42,.55)] ring-[3px] transition group-hover:scale-110 group-focus-visible:ring-blue-300 ${selected || active ? "scale-125" : ""} ${under ? "border-2 border-dashed" : ""}`}
        style={{ background: allDone ? "#FFFFFF" : sev.c, color: allDone ? sev.c : "#FFFFFF", borderColor: under ? (allDone ? sev.c : "#FFFFFF") : undefined,
          boxShadow: selected || active ? `0 0 0 4px ${sev.c}55, 0 6px 18px -6px rgba(15,23,42,.6)` : undefined, ["--tw-ring-color" as string]: allDone ? sev.c : "#FFFFFF" }}>
        {allDone && items.length === 1 ? <Icon name="check" size={15} color={sev.c} width={2.6} /> : items.length > 1 ? items.length : "!"}
      </span>
    </button>
  );
}

function Card({ items, zone, x, y, onSelect, onClose, onPick, inline = false }: {
  items: DamageFinding[]; zone: ZoneId; x: number; y: number; onSelect?: (f: DamageFinding) => void; onClose: () => void; onPick: (id: string) => void;
  inline?: boolean;
}) {
  const [cur, setCur] = useState(items[0].id);
  const f = items.find((i) => i.id === cur) || items[0];
  const sev = SEV[f.severity] || SEV.medium;
  const right = x > 0.55, below = y < 0.45;
  const conf = f.source === "live_model" && f.confidence != null ? `model ${Math.round(f.confidence * 100)}%` : f.source === "sample" ? "sample image" : f.source ? f.source.replace("_", " ") : null;
  const open = onSelect ? (
    <button className="btn btn-primary btn-sm" onClick={() => { onSelect(f); onPick(f.id); }}>Open finding<Icon name="arrow" size={13} color="#fff" /></button>
  ) : f.href ? <Link className="btn btn-primary btn-sm" href={f.href}>Open finding<Icon name="arrow" size={13} color="#fff" /></Link> : null;
  return (
    <div role="dialog" aria-label={`${ZONE_LABEL[zone]}: ${f.title}`} onClick={(e) => e.stopPropagation()}
      className={`fade-in z-20 rounded-2xl border border-white bg-white p-3 shadow-float ${inline ? "relative mt-3 w-full" : "absolute w-[min(300px,calc(100%-16px))]"}`}
      style={inline ? undefined : { left: right ? undefined : `clamp(8px, calc(${x * 100}% - 24px), calc(100% - 308px))`, right: right ? `clamp(8px, calc(${(1 - x) * 100}% - 24px), calc(100% - 308px))` : undefined,
        top: below ? `calc(${y * 100}% + 24px)` : undefined, bottom: below ? undefined : `calc(${(1 - y) * 100}% + 24px)` }}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="pill gap-1 px-2 py-0.5 text-[11px]" style={{ background: sev.soft, color: sev.c }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: sev.c }} />{sev.label}{f.fail ? " · fail item" : ""}</span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-fg-3">{ZONE_LABEL[zone]}{f.approx ? " (approx.)" : ""}</span>
        <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-ink-700" onClick={onClose} aria-label="Close"><Icon name="close" size={14} /></button>
      </div>
      {items.length > 1 && (
        <div className="mb-2 flex gap-1 overflow-x-auto pb-0.5" role="tablist" aria-label="Findings here">
          {items.map((i, k) => (
            <button key={i.id} role="tab" aria-selected={i.id === f.id} onClick={() => setCur(i.id)}
              className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ${i.id === f.id ? "bg-blue-50 text-[#1D4ED8] ring-1 ring-blue-100" : "text-fg-3 hover:bg-ink-700"}`}>{k + 1}. {i.title.slice(0, 18)}{i.title.length > 18 ? "…" : ""}</button>
          ))}
        </div>
      )}
      <b className="block text-[14px] leading-snug">{f.title}</b>
      {f.detail && <p className="mt-0.5 line-clamp-2 text-[12px] text-fg-3">{f.detail}</p>}
      {f.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={f.image} alt={`Evidence: ${f.title}`} className="mt-2 h-28 w-full rounded-xl bg-ink-700 object-cover" loading="lazy" />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-fg-3">
        {f.system && <span className="truncate">{f.system}</span>}
        {conf && <span>· {conf}</span>}
        <span className="ml-auto font-semibold text-fg-2">{STATUS[f.status] || f.status}</span>
      </div>
      {open && <div className="mt-2.5 flex justify-end">{open}</div>}
    </div>
  );
}

/** The findings grouped by the part they are on: a list beside the map that opens a part's pin. */
function ByPart({ findings, current, onPick }: { findings: DamageFinding[]; current: ZoneId | null; onPick: (z: ZoneId) => void }) {
  const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  const groups = new Map<ZoneId, DamageFinding[]>();
  for (const f of findings) groups.set(f.zone!, [...(groups.get(f.zone!) || []), f]);
  const rows = [...groups.entries()].sort((a, b) => Math.min(...a[1].map((f) => order[f.severity])) - Math.min(...b[1].map((f) => order[f.severity])));
  if (!rows.length) return <p className="hidden text-[12.5px] text-fg-3 lg:block">No finding is tied to a part of the vehicle.</p>;
  return (
    <ul className="hidden max-h-[360px] flex-col gap-1.5 overflow-y-auto pr-1 lg:flex" aria-label="Findings by part">
      {rows.map(([z, items]) => {
        const worst = items.slice().sort((a, b) => order[a.severity] - order[b.severity])[0];
        const done = items.every(decided);
        return (
          <li key={z}>
            <button onClick={() => onPick(z)} aria-pressed={current === z}
              className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${current === z ? "bg-blue-50 ring-1 ring-blue-100" : "hover:bg-white/80"}`}>
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: done ? "#FFFFFF" : SEV[worst.severity].c, boxShadow: done ? `inset 0 0 0 2px ${SEV[worst.severity].c}` : undefined }} />
              <span className="min-w-0 flex-1 leading-tight">
                <b className="block text-[13px]">{ZONE_LABEL[z]}{items.length > 1 ? ` · ${items.length}` : ""}</b>
                <span className="block truncate text-[11.5px] text-fg-3">{items.map((f) => f.title).join(" · ")}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The damage map. `onSelect` opens a finding in place (the findings page); otherwise a finding's `href` is followed. */
export function DamageMap({ plate, vtype, photos, findings, selected, onSelect, maxHeight = 420, title = "Damage map", action }: {
  plate: string; vtype?: string; photos?: { hero?: (Photo & { anchors?: Anchors | null }) | null; gallery?: (Photo & { anchors?: Anchors | null })[] } | null;
  findings: DamageFinding[]; selected?: string | null; onSelect?: (f: DamageFinding) => void; maxHeight?: number; title?: string; action?: React.ReactNode;
}) {
  const views = useMemo<View[]>(() => {
    const v: View[] = [];
    const hero = photos?.hero;
    if (hero?.anchors) v.push({ id: "hero", label: "Front", photo: hero, anchors: hero.anchors });
    const rear = photos?.gallery?.find((g) => g.view === "rear" && g.anchors);
    if (rear?.anchors) v.push({ id: "rear", label: "Rear", photo: rear, anchors: rear.anchors });
    v.push({ id: "plan", label: "Plan" });
    return v;
  }, [photos]);
  const placed = findings.filter((f) => f.zone);
  const loose = findings.filter((f) => !f.zone);
  const visibleIn = (v: View, z: ZoneId) => v.id === "plan" || !!v.anchors?.points[z];
  const best = useMemo(() => {
    const photoViews = views.filter((v) => v.id !== "plan");
    const scored = photoViews.map((v) => ({ v, n: placed.filter((f) => visibleIn(v, f.zone!)).length })).sort((a, b) => b.n - a.n);
    return scored[0] && scored[0].n > 0 && scored[0].n >= placed.length / 2 ? scored[0].v.id : "plan";
  }, [views, placed.length]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [viewId, setViewId] = useState<ViewId>(best);
  const [open, setOpen] = useState<ZoneId | null>(null);
  useEffect(() => setViewId(best), [best]);
  const view = views.find((v) => v.id === viewId) || views[views.length - 1];
  // a finding selected elsewhere (the list) shows on a view where it can be seen
  useEffect(() => {
    const f = findings.find((x) => x.id === selected);
    if (!f?.zone) return;
    if (!visibleIn(view, f.zone)) {
      const v = views.find((vv) => visibleIn(vv, f.zone!));
      if (v) setViewId(v.id);
    }
  }, [selected]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  const ratio = view.photo?.width && view.photo?.height ? view.photo.width / view.photo.height : 2;
  const box = useBox(ratio, maxHeight);
  const narrow = box.width > 0 && box.width < 520;  // a phone: the finding opens below the picture, not over it
  const groups = new Map<ZoneId, DamageFinding[]>();
  for (const f of placed) if (visibleIn(view, f.zone!)) groups.set(f.zone!, [...(groups.get(f.zone!) || []), f]);
  const hidden = placed.filter((f) => !visibleIn(view, f.zone!));
  const pos = (z: ZoneId): [number, number] => (view.id === "plan" ? planPoint(z, vtype) : (view.anchors!.points[z] as [number, number]));
  const counts = { high: findings.filter((f) => f.severity === "high" && !decided(f)).length, open: findings.filter((f) => !decided(f)).length };

  return (
    <section className="card p-4" aria-label="Damage map">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
        <span className="text-[12.5px] text-fg-3">{findings.length ? `${findings.length} finding${findings.length === 1 ? "" : "s"}${counts.open ? ` · ${counts.open} open` : ""}${counts.high ? ` · ${counts.high} high` : ""}` : "No findings"}</span>
        <span className="ml-auto flex items-center gap-2">
          {action}
          <span className="flex gap-1 rounded-full border border-white/80 bg-white/80 p-0.5 shadow-glass" role="tablist" aria-label="View">
            {views.map((v) => (
              <button key={v.id} role="tab" aria-selected={v.id === view.id} onClick={() => { setViewId(v.id); setOpen(null); }}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${v.id === view.id ? "bg-gradient-to-r from-[#3B82F6] to-[#1D4ED8] text-white shadow" : "text-fg-2 hover:bg-white"}`}>{v.label}</button>
            ))}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_250px]">
      <div ref={box.ref} className="w-full min-w-0" onClick={() => setOpen(null)}>
        <div className="relative mx-auto overflow-visible rounded-2xl" style={{ width: box.width || "100%", height: box.height || maxHeight * 0.6 }}>
          {view.photo ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={view.photo.url_960 || view.photo.url} alt={`${plate}, ${view.label.toLowerCase()} view`} className="absolute inset-0 h-full w-full rounded-2xl object-cover" />
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-t from-slate-900/25 via-transparent to-transparent" aria-hidden />
              <PhotoCreditBadge photo={view.photo} />
            </>
          ) : <Plan vtype={vtype} />}
          {[...groups.entries()].map(([z, items]) => {
            const [x, y] = pos(z);
            return <Pin key={z} zone={z} items={items} x={x} y={y} active={open === z} selected={items.some((i) => i.id === selected)}
              onClick={() => setOpen(open === z ? null : z)} />;
          })}
          {open && groups.get(open) && !narrow && (() => {
            const [x, y] = pos(open);
            return <Card key={open} items={groups.get(open)!} zone={open} x={x} y={y} onSelect={onSelect} onClose={() => setOpen(null)} onPick={() => setOpen(null)} />;
          })()}
          {view.photo && <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-fg-2 shadow-sm backdrop-blur">{view.anchors?.side === "left" ? "Left side" : "Right side"} · {view.label.toLowerCase()} view</span>}
        </div>
        {open && groups.get(open) && narrow && (
          <Card key={open} items={groups.get(open)!} zone={open} x={0} y={0} inline onSelect={onSelect} onClose={() => setOpen(null)} onPick={() => setOpen(null)} />
        )}
      </div>
      <ByPart findings={placed} current={open} onPick={(z) => {
        if (!visibleIn(view, z)) {
          const v = views.find((vv) => visibleIn(vv, z));
          if (v) setViewId(v.id);
        }
        setOpen(z);
      }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] text-fg-3">
        {(["high", "medium", "low"] as const).map((s) => <span key={s} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SEV[s].c }} />{SEV[s].label}</span>)}
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-[#64748B] bg-white" />Decided</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-dashed border-[#64748B]" />Under the vehicle</span>
        {hidden.length > 0 && (
          <button className="font-semibold text-cyan hover:underline" onClick={() => {
            const v = views.find((vv) => vv.id !== view.id && hidden.some((f) => visibleIn(vv, f.zone!)));
            if (v) setViewId(v.id);
          }}>{hidden.length} more on the other side ›</button>
        )}
        <span className="ml-auto"><Source kind="live_logic" text="Placed by part · approximate" /></span>
      </div>
      {loose.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-fg-3">Not tied to a part:</span>
          {loose.map((f) => (
            onSelect ? <button key={f.id} className="chip border-ink-500 bg-white/80 text-fg-2 hover:border-cyan/60" onClick={() => onSelect(f)}>{f.title}</button>
              : f.href ? <Link key={f.id} className="chip border-ink-500 bg-white/80 text-fg-2 hover:border-cyan/60" href={f.href}>{f.title}</Link>
                : <span key={f.id} className="chip border-ink-500 bg-white/80 text-fg-2">{f.title}</span>
          ))}
        </div>
      )}
    </section>
  );
}
