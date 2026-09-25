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
