export const fmtN = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? "–" : Number(n).toLocaleString("en-MY", { maximumFractionDigits: d, minimumFractionDigits: d });

export const pct = (p: number | null | undefined, d = 0) => (p === null || p === undefined ? "–" : `${(p * 100).toFixed(d)}%`);

export const myt = (d: Date | null, opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) =>
  d ? d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", ...opts }) : "--:--:--";

export const mydate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-GB", { timeZone: "Asia/Kuala_Lumpur", weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "";

/** A calendar date ("2026-10-01") as it is, or a timestamp as its date in Malaysia time. */
export const dmy = (iso?: string | null) => {
  if (!iso) return "–";
  const dateOnly = iso.length <= 10;
  const d = new Date(dateOnly ? iso + "T00:00:00" : /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", ...(dateOnly ? {} : { timeZone: "Asia/Kuala_Lumpur" }) });
};

export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short" }) + " '" + String(y).slice(2);
};

/** The lane's steps in its station order (app/backend/vhi/lane.py): 1 Identification, 2 Above-carriage, 3 Tinted glass,
 *  4 Emission, 5 Side slip, 6 Suspension, 7 Brake, 8 Undercarriage, 9 Speedometer, 10 Headlight alignment. */
export const LANE_STEPS = ["check_in_anpr", "identity_ocr", "above_carriage_ai", "tinted_glass", "emission_idle_rev", "side_slip",
  "suspension", "brake_roller", "undercarriage_ai", "speedometer", "headlight_alignment", "examiner_review", "report"];

export const STEP_LABEL: Record<string, string> = {
  check_in_anpr: "Check-in (plate camera)",
  identity_ocr: "Identification (chassis, engine, odometer)",
  above_carriage_ai: "Above-carriage",
  tinted_glass: "Tinted glass",
  emission_idle_rev: "Emission & OBD",
  side_slip: "Side slip",
  suspension: "Suspension",
  brake_roller: "Brake",
  undercarriage_ai: "Undercarriage",
  speedometer: "Speedometer",
  headlight_alignment: "Headlight alignment",
  examiner_review: "Examiner review",
  report: "Report",
  done: "Done",
  headlamp_tint: "Headlamp & tint",  // the earlier lane's combined step (older runs)
};

export const sevColor = (s: string) => (s === "high" ? "#DC2626" : s === "medium" ? "#D97706" : "#3B82F6");
export const riskColor = (r: string) => (r === "High" ? "#DC2626" : r === "Medium" ? "#D97706" : "#3B82F6");
export const scoreColor = (v: number | null | undefined) => (v == null ? "#64748B" : v < 50 ? "#DC2626" : v < 70 ? "#D97706" : "#059669");

const LLM_ENGINES: Record<string, string> = { trtllm: "TensorRT-LLM", vllm: "vLLM", ollama: "Ollama", openai: "LLM server" };

/** "trtllm:nvidia/Qwen3-30B-A3B-FP4" -> "TensorRT-LLM · Qwen3-30B-A3B-FP4"; null for the template engine. */
export const llmLabel = (backend?: string | null) => {
  if (!backend || backend === "template") return null;
  const i = backend.indexOf(":");
  const engine = i < 0 ? backend : backend.slice(0, i);
  const model = i < 0 ? "" : backend.slice(i + 1).split("/").pop();
  return [LLM_ENGINES[engine] || engine, model].filter(Boolean).join(" · ");
};

/** The next-inspection risk against its peers: "38% for vehicles 10-12 years old that pass today · mostly vehicle age". */
export function nextFailNote(nf: any): string | null {
  if (!nf || nf.peer_rate == null) return null;
  const top = (nf.drivers || []).find((d: any) => d.direction === "raises");
  return `${Math.round(nf.peer_rate * 100)}% for ${nf.peer}${top ? ` · mostly ${top.label.toLowerCase()}` : ""}`;
}

/** The AI inspection modules that image results come from (vhi/services/inspection_systems.py). */
export const SYSTEM_NAME: Record<string, string> = {
  undercarriage: "Undercarriage AI", above: "Above-carriage AI", tyre: "Tyre AI", examiner: "Examiner close-up",
};
/** Each module's AI model, by the names the inspection body uses (the backend's catalogue has the same). */
export const SYSTEM_MODEL: Record<string, string> = {
  undercarriage: "Keymag AI Undercarriage Inspection", above: "ASTRA", tyre: "AI Tyre Scan",
};
/** "Above-carriage AI · ASTRA": the module and its model, for a finding or a photo. */
export const moduleModel = (system?: string | null) =>
  system ? [SYSTEM_NAME[system] || system, SYSTEM_MODEL[system]].filter(Boolean).join(" · ") : "";

/** The lane replays: the vehicle each one drives through which lane of the Central Inspection Hub (BR00). */
export const LANE_SESSIONS = [
  { session: "S1", lane: "BR00-L3", label: "Lane 3", plate: "DMO 9001", car: "Scania P-Series prime mover" },
  { session: "S2", lane: "BR00-L2", label: "Lane 2", plate: "DMO 9002", car: "BYD Atto 3 (EV)" },
  { session: "S3", lane: "BR00-L1", label: "Lane 1", plate: "DMO 9003", car: "Honda Civic" },
  { session: "S7", lane: "BR00-L4", label: "Lane 4", plate: "DMO 9006", car: "Perodua Myvi" },
];
/** "BR00-L3" -> "Lane 3". */
export const laneLabel = (lane?: string | null) => (lane ? lane.replace(/^.*-L/, "Lane ") : "–");
export const laneOf = (session?: string | null) => LANE_SESSIONS.find((s) => s.session === session)?.lane;
export const laneSession = (lane?: string | null) => LANE_SESSIONS.find((s) => s.lane === lane);

export const STATUS_LABEL: Record<string, string> = {
  in_lane: "In the lane",
  review: "Awaiting examiner review",
  decided: "Decisions made",
  reported: "Report issued",
};

/** Inspection types (vhi/terms.py), for the few places that receive the code rather than the label. */
const INSPECTION_TYPES: Record<string, string> = {
  periodic_commercial: "Commercial Periodic Inspection", periodic_ride_hailing: "Commercial Periodic Inspection (ride-hailing)",
  ownership_transfer: "Ownership Transfer Inspection", financing: "Financing Inspection", voluntary: "Voluntary Inspection",
  special_total_loss: "Special Inspection (after a total-loss claim)", ev_health: "EV Health Check",
};
export const typeLabel = (code?: string | null) => (code ? INSPECTION_TYPES[code] || code.replaceAll("_", " ") : "–");
