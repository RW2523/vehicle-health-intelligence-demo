export const fmtN = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? "–" : Number(n).toLocaleString("en-MY", { maximumFractionDigits: d, minimumFractionDigits: d });

export const pct = (p: number | null | undefined, d = 0) => (p === null || p === undefined ? "–" : `${(p * 100).toFixed(d)}%`);

export const myt = (d: Date | null, opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) =>
  d ? d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", ...opts }) : "--:--:--";

export const mydate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-GB", { timeZone: "Asia/Kuala_Lumpur", weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "";

export const dmy = (iso?: string | null) => {
  if (!iso) return "–";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short" }) + " '" + String(y).slice(2);
};

export const STEP_LABEL: Record<string, string> = {
  check_in_anpr: "Check-in & ANPR",
  identity_ocr: "Identity OCR",
  emission_idle_rev: "Emissions & OBD",
  brake_roller: "Brake roller",
  suspension: "Suspension",
  side_slip: "Side slip",
  headlamp_tint: "Headlamp & tint",
  undercarriage_ai: "Undercarriage AI",
  above_carriage_ai: "Above-carriage AI",
  examiner_review: "Examiner review",
  report: "Report",
  done: "Done",
};

export const sevColor = (s: string) => (s === "high" ? "#F87171" : s === "medium" ? "#FBBF24" : "#93C5FD");
export const riskColor = (r: string) => (r === "High" ? "#EF4444" : r === "Medium" ? "#F59E0B" : "#60A5FA");
export const scoreColor = (v: number | null | undefined) => (v == null ? "#9AA8BF" : v < 50 ? "#F87171" : v < 70 ? "#FBBF24" : "#34D399");

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

/** The lane replays: the vehicle each one drives through which lane of the Alam Megah branch (BR00). */
export const LANE_SESSIONS = [
  { session: "S1", lane: "BR00-L3", label: "Lane 3", plate: "DMO 9001", car: "Scania P-Series prime mover" },
  { session: "S2", lane: "BR00-L2", label: "Lane 2", plate: "DMO 9002", car: "BYD Atto 3 (EV)" },
  { session: "S3", lane: "BR00-L1", label: "Lane 1", plate: "DMO 9003", car: "Honda Civic" },
];
export const laneOf = (session?: string | null) => LANE_SESSIONS.find((s) => s.session === session)?.lane;
export const laneSession = (lane?: string | null) => LANE_SESSIONS.find((s) => s.lane === lane);

export const STATUS_LABEL: Record<string, string> = {
  in_lane: "In the lane",
  review: "Awaiting examiner review",
  decided: "Decisions made",
  reported: "Report issued",
};
