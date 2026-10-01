"use client";
/* Shared by the two used-vehicle sales views: Oversight > Used-vehicle sales and the owner app's Sale tab (the light
   phone mock). Labels, colours, and the placeholder shown when a vehicle has no photo. */
import { fmtN } from "@/lib/format";
import { Icon } from "./icons";

export const TRUST_COL: Record<string, string> = { ok: "#059669", warn: "#D97706", bad: "#DC2626", info: "#3B82F6" };
export const TRUST_MARK: Record<string, string> = { ok: "✓", warn: "!", bad: "!", info: "i" };
export const RESULT_COL: Record<string, string> = { PASS: "#059669", FAIL: "#DC2626", CONDITIONAL: "#D97706", REFERRED: "#3B82F6" };
export const FLAGS = [
  { id: "rollback", label: "Odometer rollback" },
  { id: "flood", label: "Flood claim" },
  { id: "rebuilt", label: "Rebuilt write-off" },
  { id: "accident", label: "Accident claims" },
  { id: "failed", label: "Failed latest inspection" },
  { id: "obd", label: "Open fault codes" },
  { id: "clean", label: "No red flags" },
];
export const PRICES = [5000, 20000, 50000, 100000];

export const rm = (n?: number | null) => (n == null ? "–" : `RM ${fmtN(n)}`);
export const isBike = (vtype?: string) => vtype === "Motorcycle";

/** The listing's photo, or its vehicle type as an icon when there is none (the curated data has no motorcycle photos). */
export function VehicleThumb({ src, vtype, className = "", light = false, icon = 22 }: { src?: string | null; vtype?: string; className?: string; light?: boolean; icon?: number }) {
  if (src)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={`${vtype || "vehicle"} photo`} className={`object-cover ${className}`} />;
  return (
    <span className={`flex flex-col items-center justify-center gap-0.5 ${light ? "bg-slate-100 text-slate-400" : "bg-ink-700 text-fg-4"} ${className}`}
      aria-label={`${vtype || "Vehicle"}: no photo on file`} role="img">
      <Icon name={isBike(vtype) ? "bike" : "car"} size={icon} />
      <span className="text-[9.5px] leading-none">{vtype}</span>
    </span>
  );
}
