/* Where a finding is on the vehicle: each one is placed on a zone (a panel, a wheel, a lamp, the underbody…) from its
   code, title, camera and stated location. The damage map pins the zones on the vehicle's photo (where the photo's
   parts have been measured, see data/curated/images/stock/anchors.json) and on a top-down plan of the vehicle. */

export type ZoneId =
  | "front_bumper" | "plate_front" | "bonnet" | "windscreen" | "roof" | "cabin" | "headlamp_l" | "headlamp_r"
  | "wheel_fl" | "wheel_fr" | "wheel_rl" | "wheel_rr" | "side_l" | "side_r"
  | "rear_window" | "boot" | "rear_bumper" | "plate_rear" | "tail_lamp_l" | "tail_lamp_r" | "underbody" | "exhaust";

export const ZONE_LABEL: Record<ZoneId, string> = {
  front_bumper: "Front bumper", plate_front: "Front plate", bonnet: "Bonnet · engine bay", windscreen: "Windscreen",
  roof: "Roof", cabin: "Cabin", headlamp_l: "Left headlamp", headlamp_r: "Right headlamp",
  wheel_fl: "Front-left wheel", wheel_fr: "Front-right wheel", wheel_rl: "Rear-left wheel", wheel_rr: "Rear-right wheel",
  side_l: "Left side", side_r: "Right side", rear_window: "Rear window", boot: "Boot · tailgate", rear_bumper: "Rear bumper",
  plate_rear: "Rear plate", tail_lamp_l: "Left tail lamp", tail_lamp_r: "Right tail lamp", underbody: "Underbody",
  exhaust: "Exhaust",
};

/** Zones under the vehicle (drawn as a dashed "below" pin). */
export const UNDER: ZoneId[] = ["underbody", "exhaust"];

/** Positions on the top-down plan (viewBox 0 0 200 400, the front at the top, the vehicle's left on the left). */
export const PLAN: Record<ZoneId, [number, number]> = {
  plate_front: [100, 22], front_bumper: [128, 30], headlamp_l: [66, 40], headlamp_r: [134, 40], bonnet: [100, 78],
  windscreen: [100, 128], cabin: [84, 178], roof: [116, 214], side_l: [50, 196], side_r: [150, 196],
  wheel_fl: [42, 98], wheel_fr: [158, 98], wheel_rl: [42, 300], wheel_rr: [158, 300], underbody: [100, 250],
  rear_window: [100, 282], boot: [100, 330], exhaust: [128, 360], tail_lamp_l: [66, 366], tail_lamp_r: [134, 366],
  rear_bumper: [72, 378], plate_rear: [100, 386],
};

export type FindingLike = {
  code?: string | null; title?: string | null; detail?: string | null; system?: string | null; location?: string | null;
  camera?: string | null; hubs?: Record<string, number> | null;
};

const has = (s: string, ...words: string[]) => words.some((w) => s.includes(w));

function sideOf(s: string): "l" | "r" | null {
  if (/\b(left|kiri|passenger[- ]side)\b|-left\b|\bnear[- ]side\b/.test(s)) return "l";
  if (/\b(right|kanan|driver[- ]side)\b|-right\b|\boff[- ]side\b/.test(s)) return "r";
  return null;
}

function endOf(s: string): "f" | "r" | null {
  if (/\b(front|depan|bonnet|hood)\b|front-/.test(s)) return "f";
  if (/\b(rear|back|belakang|tail|boot|trunk)\b|rear-/.test(s)) return "r";
  return null;
}

/** The part a finding's code names (vhi/pipeline: "corrosion:undercarriage", "dtc:P2002", "ev:soh", "tyre:defect" …). */
function zoneByCode(code: string, side: "l" | "r" | null, end: "f" | "r" | null): { zone: ZoneId; approx: boolean } | null {
  const wheel = (e: "f" | "r", sd: "l" | "r") => `wheel_${e}${sd}` as ZoneId;
  if (/^(corrosion|undercarriage|leak)/.test(code)) return { zone: "underbody", approx: false };
  if (/^(ev:|thermal:pack|battery)/.test(code)) return { zone: "underbody", approx: true };
  if (/^(pn:|smoke|emission|opacity|lambda|co:|hc:)/.test(code)) return { zone: "exhaust", approx: true };
  if (code.startsWith("flood")) return { zone: "cabin", approx: true };
  if (code.startsWith("identity:odometer")) return { zone: "cabin", approx: false };
  if (/^identity:(engine|chassis|vin)/.test(code)) return { zone: "bonnet", approx: true };
  if (/^identity:(plate|anpr)/.test(code)) return { zone: "plate_front", approx: true };
  if (code.startsWith("dtc:")) {
    const d = code.slice(4).toUpperCase();
    if (/^P0A|^P0B|^P1A|^P3/.test(d)) return { zone: "underbody", approx: true };            // hybrid / EV battery system
    if (/^P20|^P24|^P04[0-9]|^P2BA|^P2BAD/.test(d)) return { zone: "exhaust", approx: true };  // DPF, SCR, EGR, catalyst
    return { zone: "bonnet", approx: true };                                                  // engine and network faults
  }
  if (code.startsWith("tyre")) return { zone: wheel(end || "f", side || "l"), approx: !(end && side) };
  if (code.startsWith("brake")) return { zone: wheel(end || "f", side || "r"), approx: !(end && side) };
  if (/^(suspension|damping|shock)/.test(code)) return { zone: wheel(end || "r", side || "l"), approx: !(end && side) };
  if (code.startsWith("acoustic:")) {
    if (/wheel|bearing|suspension|brake|cv_joint|strut/.test(code)) return { zone: wheel(end || "f", side || "l"), approx: true };
    if (/exhaust|muffler/.test(code)) return { zone: "exhaust", approx: true };
    return { zone: "bonnet", approx: true };
  }
  if (code.startsWith("headlamp")) return { zone: side === "l" ? "headlamp_l" : "headlamp_r", approx: !side };
  if (code.startsWith("tint")) return { zone: "windscreen", approx: true };
  return null;
}

/** The zone a finding is on, and whether it is only approximate (the finding says what, not exactly where). */
export function zoneOf(f: FindingLike): { zone: ZoneId | null; approx: boolean } {
  const code = (f.code || "").toLowerCase();
  const s = [f.code, f.title, f.location, f.camera, f.detail].filter(Boolean).join(" · ").toLowerCase();
  const side = sideOf(`${f.location || ""} ${f.title || ""} ${f.camera || ""}`.toLowerCase());
  const end = endOf(`${f.location || ""} ${f.title || ""} ${f.camera || ""}`.toLowerCase());
  const wheel = (e: "f" | "r", sd: "l" | "r") => `wheel_${e}${sd}` as ZoneId;

  // an examiner's own capture: its camera view
  const cap = code.match(/^capture:(\w+)/);
  if (cap) {
    const v = cap[1];
    const z: Record<string, ZoneId> = { front: "front_bumper", rear: "rear_bumper", left: "side_l", right: "side_r", underbody: "underbody", interior: "cabin", tyre: "wheel_fl" };
    return { zone: z[v] || null, approx: true };
  }
  // a wheel hub by axle and side: A1 is the front axle
  const hub = code.match(/^thermal:a(\d)([lr])$/);
  if (hub) return { zone: wheel(hub[1] === "1" ? "f" : "r", hub[2] as "l" | "r"), approx: false };
  if (code.startsWith("route:")) return { zone: null, approx: false };
  // the finding's code says the part first; the words only where it does not
  const byCode = zoneByCode(code, side, end);
  if (byCode) return byCode;
  if (has(s, "flood", "water ingress", "footwell", "carpet", "seat", "interior", "cabin camera", "airbag", "odometer", "dashboard", "upholstery"))
    return { zone: "cabin", approx: !has(s, "footwell", "carpet", "seat") };
  if (has(s, "12 v battery", "12v battery")) return { zone: "bonnet", approx: false };
  if (has(s, "battery", "hv isolation", "state of health", "soh", "thermal:pack", "ev:")) return { zone: "underbody", approx: true };
  if (has(s, "tyre", "tire", "tread", "sidewall", "wheel", "hub", "bearing", "brake", "disc", "pad", "suspension", "damper", "shock", "side slip", "alignment", "eusama")) {
    if (has(s, "wheel arch") && !has(s, "tyre", "tread")) return { zone: wheel(end || "r", side || "l"), approx: !side };
    const e = end || (has(s, "suspension", "damper", "shock", "eusama") ? "r" : "f");
    return { zone: wheel(e, side || (has(s, "brake", "disc") ? "r" : "l")), approx: !(end && side) };
  }
  if (has(s, "headlamp", "head lamp", "headlight", "lamp aim")) return { zone: side === "l" ? "headlamp_l" : "headlamp_r", approx: !side };
  if (has(s, "tail lamp", "taillamp", "tail light", "rear lamp", "brake light")) return { zone: side === "l" ? "tail_lamp_l" : "tail_lamp_r", approx: !side };
  if (has(s, "windscreen", "windshield", "wiper", "adas", "tint", "window film")) return { zone: "windscreen", approx: !has(s, "windscreen", "windshield") };
  if (has(s, "smoke", "particle", "pn:", "opacity", "lambda", "dpf", "exhaust", "muffler", "heat shield", "catalyst", "hc ", "co ", "emission"))
    return { zone: "exhaust", approx: !has(s, "exhaust", "muffler", "heat shield") };
  if (has(s, "undercarriage", "underbody", "corrosion", "leak", "fluid", "chassis rail", "pit camera")) return { zone: "underbody", approx: !has(s, "underbody", "undercarriage") };
  if (has(s, "dtc:", "fault code", "obd", "engine", "misfire", "knock", "coolant", "belt", "identity:engine", "chassis", "vin"))
    return { zone: "bonnet", approx: true };
  if (has(s, "plate", "anpr")) return { zone: end === "r" ? "plate_rear" : "plate_front", approx: true };
  if (has(s, "roof")) return { zone: "roof", approx: false };
  if (has(s, "rear door", "tailgate", "boot", "trunk", "cargo door")) return { zone: "boot", approx: false };
  if (has(s, "door", "fender", "panel", "sill", "skirt", "quarter", "mirror", "side")) {
    if (side) return { zone: `side_${side}` as ZoneId, approx: false };
    return { zone: end === "r" ? "rear_bumper" : end === "f" ? "front_bumper" : "side_l", approx: true };
  }
  if (has(s, "bumper", "dent", "scratch", "rust", "crack", "breakage", "body", "damage", "misalignment")) {
    if (end === "r") return { zone: "rear_bumper", approx: !has(s, "bumper") };
    if (end === "f") return { zone: "front_bumper", approx: !has(s, "bumper") };
    if (side) return { zone: `side_${side}` as ZoneId, approx: true };
    return { zone: "side_l", approx: true };
  }
  return { zone: null, approx: false };
}

export type DamageFinding = {
  id: string; title: string; severity: "high" | "medium" | "low"; status: string; zone: ZoneId | null; approx: boolean;
  detail?: string; system?: string; source?: string; confidence?: number | null; image?: string | null; fail?: boolean;
  href?: string; libraryIndex?: string;
};

/** An inspection alert as the damage map takes it. */
export function alertFinding(a: any, href?: string): DamageFinding {
  const img = a.evidence?.image;
  const { zone, approx } = zoneOf({ code: a.code, title: a.title, detail: a.detail, system: a.system, camera: img?.camera, location: a.evidence?.location });
  return {
    id: a.alert_id as string, title: a.title as string, severity: (a.severity || "medium") as "high" | "medium" | "low",
    status: a.status as string, zone, approx, detail: a.detail as string, system: a.system as string, source: a.source as string,
    confidence: a.confidence as number | null, image: (img?.annotated || img?.source_image || null) as string | null,
    fail: !!a.fail_item, href,
  };
}

/** A finding drawn on a sample inspection image (the image library) as the damage map takes it. */
export function libraryFinding(e: any, f: any, k: number): DamageFinding {
  const { zone, approx } = zoneOf({ title: f.name, location: f.location, camera: e.camera });
  const sev = f.severity === "H" ? "high" : f.severity === "M" ? "medium" : "low";
  return {
    id: `lib:${e.id}:${k}`, title: f.name as string, severity: sev as "high" | "medium" | "low", status: "sample", zone, approx,
    detail: `${f.location} · ${e.title}`, system: e.camera as string, source: "sample", confidence: null,
    image: (e.web_url || null) as string | null, fail: f.severity === "H", libraryIndex: e.id as string,
  };
}
