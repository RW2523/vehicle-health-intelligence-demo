/* The three apps of the platform, each on its own address: the inspection app (the hub's daily work), the mobile app
   (the vehicle owner's phone) and oversight (HQ, the regulator, used-vehicle sales and flood watch). */

export type AppId = "main" | "mobile" | "oversight";
export type AppDef = { id: AppId; href: string; name: string; full: string; sub: string; icon: string; roles: string[] };

export const APPS: AppDef[] = [
  { id: "main", href: "/", name: "Inspection", full: "VehicleSense Inspection", sub: "Lanes, inspections, vehicles, appointments", icon: "clipboard",
    roles: ["examiner", "hq", "regulator", "fleet"] },
  { id: "mobile", href: "/mobile", name: "Mobile", full: "VehicleSense Mobile", sub: "The owner's phone: self-check, booking, passport", icon: "owner",
    roles: ["owner"] },
  { id: "oversight", href: "/oversight", name: "Oversight", full: "VehicleSense Oversight", sub: "HQ, regulator, used-vehicle sales, flood watch", icon: "globe",
    roles: ["hq", "regulator"] },
];

/** The app a path belongs to (the public QR pages are part of the mobile app). */
export function appOf(path: string): AppId {
  if (/^\/(mobile|checkin|verify)(\/|$)/.test(path)) return "mobile";
  if (/^\/oversight(\/|$)/.test(path)) return "oversight";
  return "main";
}
