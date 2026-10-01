/* One place for how the apps present state: provenance (where a value comes from), severity, examiner decisions,
   the inspection workflow and the verdict. Backend values are mapped here, never changed. */

/** Provenance: the eight labels every panel uses, each with a plain explanation (tooltip and legend). */
export type Provenance = "live_feed" | "real" | "live_model" | "live_logic" | "simulated" | "synthetic" | "sample" | "mock" | "rnd";

export const PROVENANCE: Record<Provenance, { label: string; color: string; help: string }> = {
  live_feed: { label: "LIVE FEED", color: "#34D399", help: "Read live from a public data source (with the time it was fetched)." },
  real: { label: "PUBLIC DATA", color: "#6EE7B7", help: "Real public data, stored as a snapshot (not live)." },
  live_model: { label: "LIVE MODEL", color: "#22D3EE", help: "Computed now by a trained AI model running on this server." },
  live_logic: { label: "LIVE LOGIC", color: "#A78BFA", help: "Computed now by transparent rules, limits or calculations." },
  simulated: { label: "SIMULATED", color: "#FBBF24", help: "Sensor readings replayed from a scripted demo session, not a real lane." },
  synthetic: { label: "SYNTHETIC", color: "#FB923C", help: "Generated demo records: fictional vehicles, owners, history and claims." },
  sample: { label: "SAMPLE", color: "#F472B6", help: "Sample photos or recordings from public datasets." },
  mock: { label: "MOCK", color: "#9AA8BF", help: "Stands in for an integration: recorded only, nothing is sent, charged or booked outside the demo." },
  rnd: { label: "FUTURE R&D", color: "#C084FC", help: "A research option shown as a preview: not active in this demo and not in any result." },
};
export const PROVENANCE_ORDER: Provenance[] = ["live_feed", "real", "live_model", "live_logic", "simulated", "synthetic", "sample", "mock", "rnd"];

// other names the API and older panels use for the same kinds
const ALIAS: Record<string, [Provenance, string?]> = {
  llm: ["live_model", "Local LLM"], template: ["live_logic", "Template"], "live logic": ["live_logic"], "live model": ["live_model"],
  public: ["real"], public_record: ["real"], future: ["rnd"],
};
// words that repeat the label, dropped from a badge's detail text ("Synthetic history" -> "SYNTHETIC · history")
const SAME: Record<Provenance, string[]> = {
  live_feed: ["live feed", "live", "real"], real: ["real public data", "public data", "real"], live_model: ["live model"],
  live_logic: ["live logic"], simulated: ["simulated sensor", "simulated"], synthetic: ["synthetic data", "synthetic"],
  sample: ["sample images", "sample image", "sample"], mock: ["mock ui", "mock"], rnd: ["future r&d"],
};

export function provenance(kind: string, text?: string): { kind: Provenance; detail: string } {
  let k = kind as Provenance;
  let detail = text || "";
  if (!(k in PROVENANCE)) {
    const a = ALIAS[kind];
    k = a ? a[0] : "live_logic";
    if (!detail && a?.[1]) detail = a[1];
  }
  for (const w of SAME[k]) {
    const esc = w.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&");
    detail = detail.replace(new RegExp(`^${esc}(\\s*[·:,–-]\\s*|\\s+|$)`, "i"), "").replace(new RegExp(`(\\s*[·:,–-]\\s*|\\s+)${esc}$`, "i"), "");
  }
  detail = detail.trim();
  return { kind: k, detail: detail ? detail[0].toUpperCase() + detail.slice(1) : "" };
}

/** Severity: Normal / Attention / Critical everywhere. A high alert is Critical (it must be decided before the report). */
export type Severity = "normal" | "attention" | "critical";
export const SEVERITY: Record<Severity, { label: string; color: string; rank: number }> = {
  critical: { label: "Critical", color: "#F87171", rank: 0 },
  attention: { label: "Attention", color: "#FBBF24", rank: 1 },
  normal: { label: "Normal", color: "#34D399", rank: 2 },
};
export const alertSeverity = (a: { severity?: string }): Severity => (a.severity === "high" ? "critical" : a.severity === "medium" ? "attention" : "normal");
export const scoreSeverity = (v: number | null | undefined): Severity | null => (v == null ? null : v < 50 ? "critical" : v < 70 ? "attention" : "normal");
/** Findings the backend requires a decision on before the report can be issued. */
export const isRequired = (a: { severity?: string }) => a.severity === "high";

/** The examiner's decision on a finding. */
export const DECISION: Record<string, { label: string; color: string }> = {
  open: { label: "To review", color: "#9AA8BF" },
  confirmed: { label: "Confirmed", color: "#34D399" },
  dismissed: { label: "Dismissed", color: "#C9D3E3" },
  deferred: { label: "Deferred", color: "#FBBF24" },
};

export const VERDICT: Record<string, { color: string; help: string }> = {
  PASS: { color: "#34D399", help: "Passed: no failed item was confirmed." },
  FAIL: { color: "#F87171", help: "Did not pass: at least one confirmed failed item must be fixed." },
  CONDITIONAL: { color: "#FBBF24", help: "EV Health Certificate with conditions: EV findings were confirmed." },
  REFERRED: { color: "#60A5FA", help: "Referred: identity checks need a senior examiner's sign-off." },
};

/** Where an inspection is in its workflow (derived from the stored state; the backend decides). */
export type Workflow = "waiting" | "running" | "review" | "decision" | "senior" | "report_ready" | "complete";
export const WORKFLOW: Record<Workflow, { label: string; color: string }> = {
  waiting: { label: "Not started", color: "#6F7E98" },
  running: { label: "Running", color: "#22D3EE" },
  review: { label: "Awaiting review", color: "#FBBF24" },
  decision: { label: "Decision pending", color: "#A78BFA" },
  senior: { label: "Senior review", color: "#60A5FA" },
  report_ready: { label: "Report ready", color: "#34D399" },
  complete: { label: "Complete", color: "#34D399" },
};

export function workflowOf(insp: any, alerts: any[] = [], complete = false): Workflow {
  if (!insp) return "waiting";
  if (insp.report || insp.status === "reported") return complete ? "complete" : "report_ready";
  if (insp.status === "in_lane") return "running";
  if (alerts.some((a) => a.status === "open" && isRequired(a))) return "review";
  if (insp.route === "senior") return "senior";
  return "decision";
}

/** Model confidence is only meaningful for a trained model's output (not for a limit check or a rule). */
export const hasModelConfidence = (a: { source?: string; confidence?: number }) => a.source === "live_model" && typeof a.confidence === "number";
