"""The inspection app's Chat Bot: an operations copilot for hub staff.

It answers questions about the ten main vehicles, today's lanes and queue, live inspections and their findings, reports
and certificates, appointments, vehicle history, fleet health trends and the inspection rules. Each question goes
through rule-based intent and entity extraction (plates, nicknames such as "the Myvi" or "the truck", lanes, the
vehicle in focus from earlier turns); the matching platform data is retrieved as numbered FACTS, each with a link into
the app. The local LLM writes the answer from those facts only and cites them as [n]; without it (or when it is too
slow, or names a vehicle that is not in the facts) a template engine composes the answer from the same facts. The
reply always says which engine answered.

Conversations belong to the logged-in account and are kept in the chat_messages table under the key
"cp:<username>:<id>" (the owner assistant's keys never start with "cp:").
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import logging
import re
import secrets
from urllib.parse import quote

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import delete, func, select, text

from .. import terms
from ..api.deps import norm_plate
from ..db import engine, session_scope
from ..tables import Alert, Booking, ChatMessage, LiveInspection, Report, Vehicle
from . import booking as booking_svc
from . import fleet as fleet_svc
from . import hubday, registry, showcase
from . import reports as report_svc
from .llm import LLM, detect_lang

log = logging.getLogger("vhi.copilot")

PREFIX = "cp"
MAX_FACTS = 14
LLM_DEADLINE_S = 45.0
_pool = cf.ThreadPoolExecutor(max_workers=4, thread_name_prefix="copilot-llm")

# ---------------------------------------------------------------- entities
NICK = {"DMO 9001": "the Scania", "DMO 9002": "the BYD Atto 3", "DMO 9003": "the Civic", "DMO 9006": "the Myvi",
        "VJM 7412": "the Bezza", "WXD 2291": "the Ranger", "BHY 7783": "the Hiace", "VKR 3128": "the Vios",
        "PKE 4410": "the Innova", "JTR 5510": "the NV350"}
# nicknames, makes and models -> the main plate ("a prime mover" or "trucks" name a vehicle class, not the Scania)
ALIASES: list[tuple[re.Pattern, str]] = [(re.compile(p, re.I), plate) for p, plate in [
    (r"\bscania\b|\bp[\s-]?series\b|\bmeridian\b|\bthe\s+(?:truck|lorry|hauler|prime[\s-]?mover)\b|\blori\s+(?:itu|ini|scania)\b"
     r"|(?<!\ba\s)(?<!\bany\s)(?<!\bevery\s)(?<!\beach\s)\bprime[\s-]?mover\b(?!s)", "DMO 9001"),
    (r"\bbyd\b|\batto(?:\s?3)?\b", "DMO 9002"),
    (r"\bcivic\b|\bhonda\b", "DMO 9003"),
    (r"\bmyvi\b", "DMO 9006"),
    (r"\bbezza\b", "VJM 7412"),
    (r"\branger\b|\bford\b", "WXD 2291"),
    (r"\bhiace\b", "BHY 7783"),
    (r"\bvios\b", "VKR 3128"),
    (r"\binnova\b", "PKE 4410"),
    (r"\bnv\s?-?350\b|\burvan\b|\bnissan\b", "JTR 5510"),
]]
PLATE_RE = re.compile(r"\b([A-Za-z]{1,3})[\s-]?(\d{1,4})\b")
DIGITS_RE = re.compile(r"\b(9001|9002|9003|9006|7412|2291|7783|3128|4410|5510)\b")
NOT_PLATE = {"at", "in", "on", "to", "is", "by", "of", "or", "an", "as", "be", "do", "go", "if", "it", "me", "my", "no", "so",
             "up", "us", "we", "the", "and", "for", "are", "was", "his", "her", "its", "per", "all", "any", "can", "has", "had",
             "not", "but", "you", "how", "why", "who", "out", "our", "km", "mm", "rm", "top", "last", "lane", "br", "eu",
             "co", "hc", "pn", "ev", "v", "l", "s", "q", "di", "ke", "pada", "dari"}
LANE_RE = re.compile(r"\b(?:lane|lorong|lrg)\s*#?\s*(\d)\b|\bbr00-l(\d)\b|\bl(\d)\b", re.I)
HEAVY_RE = re.compile(r"\bprime[\s-]?movers?\b|\btrucks?\b|\blorr(?:y|ies)\b|\blori\b|\bheavy\b|\bbus(?:es)?\b|\bcommercial vehicles?\b", re.I)
LIGHT_RE = re.compile(r"\bcars?\b|\bsedans?\b|\bhatchbacks?\b|\blight vehicles?\b|\bpassenger\b|\bkereta\b|\bmpvs?\b", re.I)
PRONOUN_RE = re.compile(r"\b(?:it|its|it's|this one|that one|this vehicle|that vehicle|the vehicle|the car|same vehicle|he|she|"
                        r"they|them|their|dia|kenderaan ini|kereta ini|kenderaan itu|kereta itu)\b", re.I)
GLOBAL_RE = re.compile(r"\b(?:which|all|any|every|fleet|vehicles|today|queue|lanes?|hub|everyone|semua|mana-mana)\b", re.I)
FOLLOW_RE = re.compile(r"^\s*(?:and|what about|how about|same for|and for|bagaimana dengan|macam mana dengan|dan)\b", re.I)

MS_EXTRA = {"kenapa", "mengapa", "sejarah", "tunjukkan", "lorong", "barisan", "giliran", "laporan", "sijil", "temujanji",
            "tempahan", "minggu", "ini", "peraturan", "bunga", "tayar", "brek", "ringkaskan", "ringkasan", "siapa",
            "bagaimana", "berapakah", "adakah", "sekarang", "menunggu", "kenderaan", "pemeriksaan", "keputusan", "akan",
            "dengan", "yang", "apakah", "hab", "senarai", "terangkan", "kecekapan", "asap"}

INTENTS: dict[str, list[str]] = {
    "help": [r"\bhelp\b", r"what can you", r"what do you (?:know|do)", r"\bcapabilit", r"how (?:do|can) i use", r"^\s*(?:hi|hello|hey|helo)\b",
             r"\bbantuan\b", r"apa (?:yang )?(?:boleh|awak|anda) (?:buat|lakukan)"],
    "today": [r"\btoday\b", r"\bqueue\b", r"\bwaiting\b", r"\bbusy\b", r"\bsummar", r"\blanes?\b", r"right now", r"\bhub\b",
              r"\bin progress\b", r"\bnext (?:vehicle|up|in line)\b", r"\bhari ini\b", r"\bbarisan\b", r"\bgiliran\b", r"\blorong\b",
              r"\bringkas", r"\bsekarang\b", r"\bmenunggu\b", r"\bhow many\b", r"\bon (?:the )?l\d\b", r"\boverview\b"],
    "live": [r"\blive\b", r"\bfindings?\b", r"\bunresolved\b", r"\bpending\b", r"\bverdict\b", r"\breview\b", r"\balerts?\b",
             r"\bflag", r"\bcritical\b", r"\bdecisions?\b", r"\bpenemuan\b", r"\bopen items?\b"],
    "fail": [r"\bwhy\b", r"\bfail", r"\breasons?\b", r"went wrong", r"\bkenapa\b", r"\bmengapa\b", r"\bgagal\b", r"\bpunca\b",
             r"\bdefects?\b", r"\bproblems?\b", r"\bissues?\b", r"\bresult\b", r"\bpass(?:ed)?\b", r"\bkeputusan\b"],
    "report": [r"\breports?\b", r"\bcertificat", r"\bverif", r"\bqr\b", r"\bissued\b", r"\blaporan\b", r"\bsijil\b", r"\bsahkan\b"],
    "booking": [r"\bappointments?\b", r"\bbook", r"\bslots?\b", r"\bthis week\b", r"\bnext week\b", r"\bcheck[\s-]?in", r"\bscheduled\b",
                r"\btemu\s?janji\b", r"\btempahan\b", r"\bminggu\b", r"\bupcoming\b", r"\bdue\b"],
    "history": [r"\bhistory\b", r"\bprevious\b", r"\bpast\b", r"\bearlier\b", r"\bodometer\b", r"\bmileage\b", r"\bclaims?\b",
                r"\brollback\b", r"\bsejarah\b", r"\brekod\b", r"\btuntutan\b", r"\blast inspection", r"\bowner\b", r"\bpemilik\b",
                r"\bbefore\b", r"\brecords?\b"],
    "trend": [r"\btrends?\b", r"\btread\b", r"\bforecast", r"\bwhen will\b", r"\bwear", r"\bdegrad", r"\bpredict", r"\breach",
              r"\bbrake pads?\b", r"\bpads?\b", r"\bdamping\b", r"\bweeks? (?:left|to)\b", r"\bneeds? attention\b", r"\bhealth\b(?!\s*(?:check|certificate))",
              r"\bbunga tayar\b", r"\bramalan\b", r"\bjangkaan\b", r"\bcranking\b", r"\bbattery\b", r"\bnext fail", r"\brisk\b"],
    "fees": [r"\bhow much\b", r"\bfees?\b", r"\bprices?\b", r"\bcosts?\b", r"\bcharge", r"\bharga\b", r"\bbayaran\b", r"\bcaj\b",
             r"\bsurcharge\b"],
    "guide": [r"\bbring\b", r"\bdocuments?\b", r"\bhow long\b", r"\bduration\b", r"\bre-?inspection\b", r"\bretest\b", r"\bbawa\b",
              r"\bdokumen\b", r"\bberapa lama\b", r"\bhow (?:do|can|should) (?:i|we|you|an? \w+|the \w+)\b", r"\bhow to\b",
              r"\bself[\s-]?check\b"],
    "rules": [r"\blimits?\b", r"\brules?\b", r"\bthresholds?\b", r"\bminimum\b", r"\bmaximum\b", r"\ballowed\b", r"\blegal\b",
              r"\bstandards?\b", r"\brequire", r"\bperaturan\b", r"\bpass mark\b", r"how (?:is|are) .{0,40}(?:measured|tested|checked)",
              r"\bwhat counts as\b", r"\bat least\b"],
}
INTENT_RE = {k: [re.compile(p, re.I) for p in v] for k, v in INTENTS.items()}
TREND_STRONG = re.compile(r"\breach|\bfirst\b|\bwhen will\b|\bforecast|\btrend|\bpredict|\bweeks?\b", re.I)
RULE_STRONG = re.compile(r"\bwhat(?:'s| is| are)\b.{0,40}\blimits?\b|\blimits? (?:for|of|on)\b|\brules?\b|\bthresholds?\b|\ballowed\b|"
                         r"\blegal\b|\bminimum\b|\bmaximum\b|\bhad\b", re.I)

# ---------------------------------------------------------------- inspection rules (as the lane pipeline applies them:
# vhi/pipeline/processor.py, vhi/fleet_metrics.py, vhi/ml/analytics.CONFLICT_RULES, vhi/services/reports._verdict)
RULES: list[dict] = [
    {"id": "brake_eff", "re": r"brake efficien|braking efficien|service brake|kecekapan brek|brake (?:limit|test)|\bbrakes?\b(?!.*(?:imbalance|drag|pad))",
     "m": "brake_efficiency_pct", "unit": "%",
     "text": "Brake efficiency (roller brake tester): at least 50% for light vehicles and at least 45% for heavy vehicles (prime "
             "movers, lorries, buses). Below the minimum is a fail item."},
    {"id": "brake_imb", "re": r"imbalance|left.{0,10}right|pull(?:s|ing)? (?:to|under)", "m": "brake_imbalance_pct", "unit": "%",
     "text": "Brake imbalance (left/right difference on an axle): above 20% is raised as a finding, above 30% is a fail item."},
    {"id": "brake_drag", "re": r"\bdrag", "m": "brake_drag_pct", "unit": "%",
     "text": "Brake drag: braking force above 12% of the peak with the pedal released is raised as a finding (a sticking caliper or "
             "seized slide); on its own it is not a fail item."},
    {"id": "smoke", "re": r"smoke|opacity|asap", "m": "smoke_opacity_pct", "unit": "%",
     "text": "Smoke opacity (diesel engines): at most 50%. Above the limit is a fail item."},
    {"id": "pn", "re": r"particle|\bpn\b|\bdpf\b", "m": "pn_per_cm3", "unit": "/cm³",
     "text": "Particle number at idle (diesel): above 250,000 /cm³ is an advisory; above 1,000,000 /cm³ on a vehicle with a DPF fitted "
             "means the DPF was removed or failed, which is a fail item. Smoke opacity alone does not catch this."},
    {"id": "co", "re": r"\bco\b|carbon monoxide", "m": "co_pct", "unit": "%",
     "text": "CO at idle (petrol engines): at most 3.5%. Above the limit is a fail item."},
    {"id": "hc", "re": r"\bhc\b|hydrocarbon", "m": "hc_ppm", "unit": " ppm",
     "text": "HC at idle (petrol engines): at most 600 ppm. Above the limit is a fail item."},
    {"id": "lambda", "re": r"lambda|air.?fuel", "m": "lambda", "unit": "",
     "text": "Lambda (air-fuel ratio at high idle, catalyst petrol engines): 0.97 to 1.03, the EU roadworthiness reference "
             "(Directive 2014/45/EU) shown until the Malaysian limit is confirmed. Outside the range is a fail item."},
    {"id": "tint", "re": r"tint|\bvlt\b|window film|cermin|gelap", "m": "tint_vlt_front_pct", "unit": "%",
     "text": "Window tint, visible light transmission (VLT): windscreen at least 70%, front side windows at least 50%, rear at least "
             "30%. The lane measures the front side windows; darker than 50% is a fail item."},
    {"id": "tread", "re": r"tread|bunga tayar|tyre depth|tire depth", "m": None, "unit": "mm",
     "text": "Tyre tread depth: at least 1.6 mm on every tyre. Below 1.6 mm is a fail. Tyre AI also flags a defective tyre "
             "(bulge, cut, uneven wear) when it is at least 60% confident; the examiner confirms it."},
    {"id": "suspension", "re": r"suspension|damper|damping|shock absorber|eusama", "m": "suspension_efficiency_pct", "unit": "%",
     "text": "Suspension efficiency (EUSAMA): at least 40% on each wheel. Below the minimum is a fail item."},
    {"id": "side_slip", "re": r"side.?slip|alignment|toe", "m": "side_slip_m_per_km", "unit": " m/km",
     "text": "Side slip (wheel alignment): within ±5 m/km."},
    {"id": "headlamp", "re": r"headlamp|headlight|lamp aim|lampu", "m": "headlamp_aim_dev_pct", "unit": "%",
     "text": "Headlamp aim: deviation within 2%. Outside it is a fail item (re-aim the headlamps)."},
    {"id": "hv", "re": r"\bhv\b|isolation|high.?voltage|insulation", "m": "hv_isolation_mohm", "unit": " MΩ",
     "text": "EV high-voltage isolation: below 2.0 MΩ is an advisory, below 0.5 MΩ a fail item (demo rule). Moisture after flooding "
             "is a common cause."},
    {"id": "soh", "re": r"\bsoh\b|state of health|battery health|kesihatan bateri", "m": "ev_soh_pct", "unit": "%",
     "text": "EV battery state of health (SOH): below 80% is raised as a finding with the estimated distance until 70%. An EV with "
             "a battery or flood finding gets a conditional EV Health Certificate."},
    {"id": "corrosion", "re": r"corros|\brust|karat", "m": "corrosion_score_0_10", "unit": "/10",
     "text": "Corrosion (Undercarriage AI and cabin camera, score 0-10): 4 or more raises a finding, 7 or more is critical. HQ "
             "treats a PASS with a score of 8 or more as in conflict with the evidence."},
    {"id": "hub_temp", "re": r"hub temp|hot (?:wheel )?hub|thermal|wheel hub", "m": None, "unit": "°C",
     "text": "Wheel hub temperature after the brake test (thermal camera): above 100 °C raises a finding (dragging brake or failing "
             "bearing), above 120 °C is a fail item."},
    {"id": "odometer", "re": r"odometer|rollback|mileage tamper|clocked", "m": "odometer_km", "unit": " km",
     "text": "Odometer: a reading more than 1,000 km below the highest earlier recorded reading is flagged as a rollback (an "
             "identity and integrity finding for the examiner)."},
    {"id": "verdict", "re": r"verdict|how .{0,20}(?:decided|pass|fail)|what makes .{0,30}fail|why (?:does|do|would|is) .{0,40}fail|"
                            r"fail item|conditional|referred",
     "m": None, "unit": "",
     "text": "Verdict rules: any confirmed fail item makes the result FAIL. Identity checks that disagree send the report to a "
             "senior examiner (REFERRED) until signed off. An EV with battery or flood findings gets a CONDITIONAL certificate. "
             "Otherwise PASS, with advisories listed. Critical findings must be decided before a report can be issued."},
]
for _r in RULES:
    _r["rx"] = re.compile(_r["re"], re.I)

STEP = {"check_in_anpr": "check-in (ANPR)", "identity_ocr": "identity check", "emission_idle_rev": "emissions test",
        "brake_roller": "brake test", "suspension": "suspension test", "side_slip": "side-slip test",
        "headlamp_tint": "headlamps and tint", "undercarriage_ai": "Undercarriage AI", "above_carriage_ai": "Above-carriage AI",
        "examiner_review": "examiner review", "report": "report", "done": "finished"}
LI_STATUS = {"in_lane": "in the lane", "review": "awaiting the examiner's review", "decided": "decided, report not issued yet",
             "reported": "report issued"}
SEV = {"high": "Critical", "medium": "Attention", "low": "Normal"}
RESULT = {"PASS": "passed", "FAIL": "failed", "PASS_ADVISORY": "passed with advisories", "CONDITIONAL": "conditional",
          "REFERRED": "referred to a senior examiner"}
METRIC_RE = {"tread_depth": r"tread|tyre|tire|bunga tayar", "brake_imbalance": r"brake imbalance|imbalance|\bbrakes?\b",
             "pad_thickness": r"\bpads?\b", "damping": r"damping|damper|suspension|shock", "cranking_v": r"battery|cranking|12 ?v",
             "cranking_v24": r"battery|cranking|24 ?v", "hc_idle": r"\bhc\b|hydrocarbon|emission", "smoke_opacity": r"smoke|opacity|emission",
             "headlamp_output": r"headlamp|headlight", "adas_yaw": r"adas|camera", "rust_area": r"rust|corros",
             "vibration": r"vibration", "oil_loss": r"\boil\b", "crack_length": r"windscreen|crack"}


# ---------------------------------------------------------------- helpers
def _d(iso: str | None) -> str:
    """'2026-10-25' -> '25 Oct 2026'."""
    if not iso:
        return "-"
    try:
        return dt.date.fromisoformat(str(iso)[:10]).strftime("%-d %b %Y")
    except ValueError:
        return str(iso)[:10]


def _reasons(x: str) -> str:
    """'brake_imbalance;tyre_tread' -> 'brake imbalance; tyre tread'."""
    return "; ".join(p.strip().replace("_", " ") for p in str(x).split(";") if p.strip())


def _vhref(plate: str, tab: str | None = None) -> str:
    return f"/vehicles/{quote(plate)}" + (f"?tab={tab}" if tab else "")


def _num(v, d: int = 0) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return f"{f:,.{d}f}" if d else f"{f:,.0f}"


def _fmt(v) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return f"{f:,.0f}" if abs(f) >= 1000 else (f"{f:g}" if abs(f) >= 10 else f"{round(f, 2):g}")


class Facts:
    """Numbered facts, each with its kind, provenance and (where it makes sense) a page in the app."""

    def __init__(self, cap: int = MAX_FACTS):
        self.items: list[dict] = []
        self.cap = cap

    def add(self, text_: str, kind: str, href: str | None = None, label: str | None = None, prov: str = "live_logic") -> int | None:
        text_ = re.sub(r"\s+", " ", text_.replace("**", "")).strip()
        if not text_ or len(self.items) >= self.cap or any(f["text"] == text_ for f in self.items):
            return None
        n = len(self.items) + 1
        self.items.append({"n": n, "text": text_, "kind": kind, "href": href, "label": label, "prov": prov})
        return n


class Section:
    def __init__(self, en: str, ms: str | None = None):
        self.lead = {"en": en, "ms": ms or en}
        self.ns: list[int] = []

    def take(self, n: int | None) -> None:
        if n:
            self.ns.append(n)


def lang_of(q: str) -> str:
    lang = detect_lang(q)
    if lang == "en" and set(re.findall(r"[a-z]+", q.lower())) & MS_EXTRA:
        return "ms"
    return lang


_main_cache: dict = {}


def _main() -> list[dict]:
    if "rows" not in _main_cache:
        rows = showcase.vehicles()
        if rows:
            _main_cache["rows"] = rows
        return rows
    return _main_cache["rows"]


def _vehicle(plate: str) -> dict | None:
    m = next((v for v in _main() if v["plate"] == plate), None)
    if m:
        return m
    with session_scope() as s:
        v = s.execute(select(Vehicle).where(Vehicle.plate == plate)).scalar_one_or_none()
        if v is None:
            return None
        return {"plate": v.plate, "vehicle_id": v.vehicle_id, "make": v.make, "model": v.model, "year": v.year, "vtype": v.vtype,
                "fuel": v.fuel, "usage": v.usage, "owner_name": v.owner_name, "owner_type": v.owner_type, "fleet_id": v.fleet_id,
                "state": v.state, "odometer_km": v.odometer_km, "mvl_expiry": v.mvl_expiry, "heavy": v.heavy}


def _name(v: dict) -> str:
    return f"{v['plate']} ({v['make']} {v['model']})"


def vehicles_in(q: str) -> list[str]:
    """Plates named in a question, in the order they appear: plates written out ("DMO 9001", "dmo9001"), the main plates'
    digits, nicknames and makes ("the Myvi", "the truck", "BYD") and the owners' names."""
    found: list[tuple[int, str]] = []
    for m in PLATE_RE.finditer(q):
        letters, digits = m.group(1), m.group(2)
        plate = norm_plate(letters + digits)
        if plate in showcase.BY_PLATE:
            found.append((m.start(), plate))
        elif len(letters) >= 2 and len(digits) >= 3 and letters.lower() not in NOT_PLATE:
            with session_scope() as s:
                if s.execute(select(Vehicle.plate).where(Vehicle.plate == plate)).first():
                    found.append((m.start(), plate))
    for m in DIGITS_RE.finditer(q):
        plate = next((p for p in showcase.MAIN_PLATES if p.endswith(m.group(1))), None)
        if plate:
            found.append((m.start(), plate))
    for rx, plate in ALIASES:
        m = rx.search(q)
        if m:
            found.append((m.start(), plate))
    low = q.lower()
    for v in _main():
        name = (v.get("owner_name") or "").strip()
        if name and v.get("owner_type") == "individual":
            first = name.split()[0].lower()
            i = low.find(name.lower())
            if i < 0:
                mm = re.search(rf"\b{re.escape(first)}\b", low)
                i = mm.start() if mm else -1
            if i >= 0:
                found.append((i, v["plate"]))
    out: list[str] = []
    for _, p in sorted(found):
        if p not in out:
            out.append(p)
    return out


def lanes_in(q: str) -> list[int]:
    out = []
    for m in LANE_RE.finditer(q):
        n = int(next(g for g in m.groups() if g))
        if 1 <= n <= 8 and n not in out:
            out.append(n)
    return out


def intents_of(q: str, lang: str = "en") -> list[str]:
    hits = [k for k, rxs in INTENT_RE.items() if any(rx.search(q) for rx in rxs)]
    if lang == "ms" and re.search(r"\bhad\b", q, re.I) and "rules" not in hits:
        hits.append("rules")
    if "trend" in hits and "rules" in hits:
        # "which vehicle will reach its tread limit first" is a forecast; "what is the tread limit" is a rule
        if TREND_STRONG.search(q) and not re.search(r"\bwhat(?:'s| is| are)\b.{0,30}\blimits?\b|\brules?\b|\ballowed\b|\blegal\b", q, re.I):
            hits.remove("rules")
        elif not TREND_STRONG.search(q):
            hits.remove("trend")
    if "rules" in hits and not RULE_STRONG.search(q) and any(k in hits for k in ("fail", "live", "today", "report")):
        hits.remove("rules")
    if "live" in hits and "today" in hits and not re.search(r"today|queue|waiting|lanes?\b|hub|busy|summar|hari ini|lorong|barisan", q, re.I):
        hits.remove("today")
    if "help" in hits and len(hits) > 1:
        hits.remove("help")
    if "report" in hits and "today" in hits and not re.search(r"queue|waiting|lanes?\b|hub|busy|summar|lorong|barisan", q, re.I):
        hits.remove("today")  # "reports issued today": a date, not the hub's day
    return hits


def rules_in(q: str) -> list[dict]:
    return [r for r in RULES if r["rx"].search(q)]


# ---------------------------------------------------------------- retrieval: today at the hub
def _hub_today(branch: str) -> dict | None:
    try:
        return hubday.today(branch)
    except Exception as e:  # noqa: BLE001 - the day view must not take the whole answer down
        log.warning("hubday.today failed: %s", e)
        return None


def _day_items(branch: str, live_plates: set[str]) -> list[dict]:
    """Every vehicle in today's plan at the hub with its state now (completed with its result, on a lane, waiting...)."""
    try:
        c = hubday.clock()
        return [hubday._state(x, c["minute"]) for x in hubday.schedule(branch, c["date"]) if x["plate"] not in live_plates]
    except Exception as e:  # noqa: BLE001
        log.warning("hubday.schedule failed: %s", e)
        return []


def _lane_fact(F: Facts, ln: dict, branch: str) -> int | None:
    v = ln.get("vehicle")
    href = f"/lane?lane={branch}-L{ln['lane']}"
    label = f"Live Lane {ln['lane']}"
    if ln["live"] and v:
        return F.add(f"Lane {ln['lane']}: live inspection {v['inspection_id']} of {v['plate']} ({v['make']} {v['model']}), "
                     f"{v['inspection_type']}, {LI_STATUS.get(v['status'], v['status'])}"
                     + (f", at the {STEP.get(v['step'], v['step'])} step" if v["status"] == "in_lane" and v.get("step") else "")
                     + (f", health score {round(v['health'])}" if v.get("health") is not None else "") + ".",
                     "lane", f"/inspection/{v['inspection_id']}", f"Inspection · {v['plate']}", "live_model")
    if v:
        state = {"operation": "in operation", "preparing": "preparing"}.get(ln["state"], ln["state"])
        return F.add(f"Lane {ln['lane']}: {state} with {v['plate']} ({v['make']} {v['model']}), {v['inspection_type']}; "
                     f"{ln['note'].lower()} (started {v.get('start_at', '-')}).", "lane", href, label, "synthetic")
    return F.add(f"Lane {ln['lane']}: idle, available for the next vehicle.", "lane", href, label, "synthetic")


def today_section(F: Facts, q: str, branch: str, lanes: list[int]) -> list[Section]:
    D = _hub_today(branch)
    if D is None:
        s = Section("Today's hub view is not available right now.", "Paparan hab hari ini tidak tersedia sekarang.")
        return [s]
    k, c = D["kpis"], D["clock"]
    low = q.lower()
    out: list[Section] = []
    lane_by = {ln["lane"]: ln for ln in D["lanes"]}
    if lanes:
        for n in lanes:
            ln = lane_by.get(n)
            if ln is None:
                s = Section(f"The hub runs lanes 1-{len(D['lanes'])} today; there is no lane {n}.",
                            f"Hab ini menggunakan lorong 1-{len(D['lanes'])} hari ini; tiada lorong {n}.")
                out.append(s)
                continue
            v = ln.get("vehicle")
            what = f"{v['plate']} ({v['make']} {v['model']})" if v else "no vehicle"
            s = Section(f"Lane {n} at {c['time']}: {what}.", f"Lorong {n} pada {c['time']}: {what if v else 'tiada kenderaan'}.")
            s.take(_lane_fact(F, ln, branch))
            if ln["live"] and v:
                inspection_section(F, v["inspection_id"], s)
            elif v:
                nxt = next((x for x in D["upcoming"] if x.get("lane") == n and x["plate"] != v["plate"]), None)
                if nxt:
                    s.take(F.add(f"Next on lane {n}: {nxt['plate']} ({nxt['make']} {nxt['model']}), {nxt['inspection_type']}, "
                                 f"arrives {nxt['arrival_at']}.", "queue", _vhref(nxt["plate"]), nxt["plate"], "synthetic"))
            else:
                nxt = next((x for x in D["upcoming"] if x.get("lane") == n), None)
                if nxt:
                    s.take(F.add(f"Next on lane {n}: {nxt['plate']} ({nxt['make']} {nxt['model']}), {nxt['inspection_type']}, "
                                 f"arrives {nxt['arrival_at']}.", "queue", _vhref(nxt["plate"]), nxt["plate"], "synthetic"))
            out.append(s)
        return out
    head = (f"{D['branch']['name']} at {c['time']}" + (f" ({c['note']})" if c.get("note") else "") + f": {k['total']} vehicles on "
            f"today's plan; {k['completed']} inspected so far, of which {k['issues']} had issues ({k['fails']} failed); "
            f"{k['in_progress']} of {len(D['lanes'])} lanes in operation; {k['in_queue']} waiting.")
    s = Section(f"**{D['branch']['name']}** at {c['time']}: {k['total']} vehicles today, {k['completed']} inspected, "
                f"{k['in_queue']} waiting.",
                f"**{D['branch']['name']}** pada {c['time']}: {k['total']} kenderaan hari ini, {k['completed']} sudah diperiksa, "
                f"{k['in_queue']} menunggu.")
    s.take(F.add(head, "hub", "/", "Dashboard", "synthetic"))
    want_queue = re.search(r"queue|waiting|next|barisan|giliran|menunggu|upcoming|to come", low)
    want_issues = re.search(r"fail|issue|problem|gagal|advisor|wrong|defect|completed|done|finished|selesai", low)
    want_lanes = re.search(r"lane|lorong|busy|sibuk|in progress|right now|sekarang", low)
    generic = not (want_queue or want_issues or want_lanes)
    # which finished inspections the question is about: failures only, anything not a clean pass, or all of them
    keep = (("FAIL",) if re.search(r"fail|gagal", low) and not re.search(r"issue|problem|advisor|wrong|defect|completed|done|finished|selesai", low)
            else ("FAIL", "PASS_ADVISORY", "CONDITIONAL", "REFERRED") if not re.search(r"completed|done|finished|selesai", low)
            else ("FAIL", "PASS_ADVISORY", "CONDITIONAL", "REFERRED", "PASS"))
    if want_lanes or generic:
        idle = [ln["lane"] for ln in D["lanes"] if not ln.get("vehicle")]
        for ln in D["lanes"]:
            if ln.get("vehicle"):
                s.take(_lane_fact(F, ln, branch))
        if idle:
            s.take(F.add(f"Idle, available for the next vehicle: lane{'s' if len(idle) > 1 else ''} {', '.join(map(str, idle))}.", "lane",
                         f"/lane?lane={branch}-L{idle[0]}", f"Live Lane {idle[0]}", "synthetic"))
    if want_queue or generic:
        for x in D["queue"][:3]:
            s.take(F.add(f"Waiting: {x['plate']} ({x['make']} {x['model']}), {x['inspection_type']}, about {x['wait_min']} min "
                         f"until it starts on lane {x['lane']} at {x['start_at']}.", "queue", _vhref(x["plate"]), x["plate"], "synthetic"))
        if not D["queue"]:
            s.take(F.add("Nobody is waiting in the queue right now.", "queue", "/", "Dashboard", "synthetic"))
        later = [x for x in D["upcoming"] if x.get("status") == "scheduled"][: (3 if want_queue else 2)]
        for x in later:
            s.take(F.add(f"Still to come: {x['plate']} ({x['make']} {x['model']}), {x['inspection_type']}, arrives {x['arrival_at']}"
                         + (" (booked)" if x.get("source") == "booking" else "") + ".", "queue", _vhref(x["plate"]), x["plate"], "synthetic"))
    if want_issues or generic:
        live_plates = {li["plate"] for li in D["live"]}
        done = [x for x in _day_items(branch, live_plates) if x["status"] == "completed" and x["result"] in keep]
        for x in sorted(done, key=lambda x: (x["result"] != "FAIL", x["end"]))[: (5 if want_issues else 3)]:
            s.take(F.add(f"Completed {x['end_at']}: {x['plate']} ({x['make']} {x['model']}), {x['inspection_type']} on lane {x['lane']}: "
                         f"{RESULT.get(x['result'], x['result'])}" + (f" ({'; '.join(x['issues'])})" if x["issues"] else "") + ".",
                         "schedule", _vhref(x["plate"]), x["plate"], "synthetic"))
        for li in D["live"]:
            if li["status"] == "reported" and li.get("verdict") in keep:
                s.take(F.add(f"Live inspection {li['inspection_id']} of {li['plate']} ({li['make']} {li['model']}) on lane {li['lane']}: "
                             f"report issued, {li['verdict']}.", "inspection", f"/inspection/{li['inspection_id']}",
                             f"Inspection · {li['plate']}", "live_model"))
    out.append(s)
    return out


# ---------------------------------------------------------------- retrieval: live inspections
def _latest_li(plate: str | None = None, lane_id: str | None = None) -> str | None:
    with session_scope() as s:
        stmt = select(LiveInspection.inspection_id)
        stmt = stmt.where(LiveInspection.plate == plate) if plate else stmt.where(LiveInspection.lane_id == lane_id)
        row = s.execute(stmt.order_by(LiveInspection.started_at.desc()).limit(1)).first()
        return row[0] if row else None


def inspection_section(F: Facts, iid: str, s: Section, findings: int = 4) -> dict | None:
    """The live inspection's state, its open findings (critical first) and the verdict the rules give now."""
    from .inspection_view import verdict_preview

    with session_scope() as ss:
        li = ss.get(LiveInspection, iid)
        if li is None:
            return None
        alerts = ss.execute(select(Alert).where(Alert.inspection_id == iid).order_by(Alert.rank, Alert.created_at)).scalars().all()
        rep = ss.execute(select(Report).where(Report.inspection_id == iid)).scalar_one_or_none()
        lane = li.lane_id.split("-L")[-1]
        health = ((li.fusion or {}).get("health") or {}).get("score")
        health = health if health is not None else li.health_score
        s.take(F.add(f"Inspection {iid} of {li.plate} on lane {lane} ({li.inspection_type}), started "
                     f"{_d(li.started_at.date().isoformat())}: {LI_STATUS.get(li.status, li.status)}"
                     + (f", at the {STEP.get(li.step, li.step)} step" if li.status == "in_lane" and li.step else "")
                     + (f", health score {round(health)}/100" if health is not None else "") + ".",
                     "inspection", f"/inspection/{iid}", f"Inspection · {li.plate}", "live_model"))
        open_ = sorted([a for a in alerts if a.status == "open"], key=lambda a: (a.severity != "high", not a.fail_item, a.rank))
        for a in open_[:findings]:
            conf = f" Model confidence {a.confidence:.0%}." if a.source == "live_model" else ""
            s.take(F.add(f"Open finding, awaiting the examiner's decision ({SEV.get(a.severity, a.severity)}"
                         f"{'; fails the vehicle if confirmed' if a.fail_item else ''}): {a.title} ({a.system}). {a.detail}{conf}", "finding", f"/inspection/{iid}/findings", f"Findings · {li.plate}",
                         a.source if a.source in ("live_model", "live_logic", "simulated") else "live_logic"))
        if len(open_) > findings:
            s.take(F.add(f"{len(open_) - findings} more open finding(s) on inspection {iid}.", "finding", f"/inspection/{iid}/findings",
                         f"Findings · {li.plate}"))
        decided = [a for a in alerts if a.status != "open"]
        if rep:
            s.take(F.add(f"Report {rep.report_id} issued {_d(rep.created_at.date().isoformat())}: {rep.verdict}"
                         + (f" ({'; '.join((rep.data or {}).get('verdict_reasons', [])[:4])})" if (rep.data or {}).get("verdict_reasons") else "")
                         + ".", "report", f"/report?id={rep.report_id}", f"Report {rep.report_id}", "live_logic"))
        elif li.status != "in_lane" or alerts:
            vp = verdict_preview(li, alerts, False)
            if vp["open_required"]:
                txt = (f"No verdict yet on inspection {iid}: {vp['open_required']} critical finding(s) still need the examiner's decision "
                       f"({len(decided)} of {len(alerts)} findings decided), so the report cannot be issued yet.")
            else:
                txt = (f"Verdict if the report were issued now: {vp['verdict']}"
                       + (f" ({'; '.join(vp['reasons'][:4])})" if vp["reasons"] else "")
                       + f"; {len(decided)} of {len(alerts)} findings decided.")
            s.take(F.add(txt, "verdict", f"/inspection/{iid}/review", f"Review · {li.plate}", "live_logic"))
        return {"status": li.status, "plate": li.plate, "open": len(open_)}


def live_section(F: Facts, plates: list[str]) -> list[Section]:
    out = []
    if plates:
        for p in plates[:2]:
            iid = _latest_li(plate=p)
            s = Section(f"The latest lane inspection of **{p}**:", f"Pemeriksaan lorong terkini untuk **{p}**:")
            if iid:
                inspection_section(F, iid, s)
            else:
                s = Section(f"**{p}** has no live lane inspection on record.", f"**{p}** tiada pemeriksaan lorong langsung dalam rekod.")
                s.take(F.add(f"{p} has no live lane inspection on record; its results come from today's plan and its history.",
                             "inspection", _vhref(p), p))
            out.append(s)
        return out
    # no vehicle: every open finding across the live inspections still under review
    with session_scope() as ss:
        rows = ss.execute(select(LiveInspection).where(LiveInspection.status.in_(("in_lane", "review", "decided")))
                          .order_by(LiveInspection.started_at.desc())).scalars().all()
        latest: dict[str, LiveInspection] = {}
        for li in rows:
            latest.setdefault(li.plate, li)
        ids = [li.inspection_id for li in latest.values()]
    s = Section(f"{len(ids)} live inspection(s) are open at the lanes:", f"{len(ids)} pemeriksaan langsung masih dibuka di lorong:")
    for iid in ids[:3]:
        inspection_section(F, iid, s, findings=2)
    if not ids:
        s = Section("No live inspection is open right now.", "Tiada pemeriksaan langsung yang dibuka sekarang.")
        s.take(F.add("No live lane inspection is in the lane or awaiting review right now.", "inspection", "/inspection", "Inspections"))
    out.append(s)
    return out


# ---------------------------------------------------------------- retrieval: vehicles
def identity_fact(F: Facts, v: dict) -> int | None:
    owner = v.get("owner_name") or ("a fleet" if v.get("fleet_id") else "a company")
    fleet_name = None
    if v.get("fleet_id"):
        try:
            fleet_name = next((f["name"] for f in fleet_svc.fleets() if f["fleet_id"] == v["fleet_id"]), None)
        except Exception:  # noqa: BLE001
            fleet_name = None
    return F.add(f"{v['plate']} is a {v['year']} {v['make']} {v['model']} ({v['vtype'].lower()}, {v['fuel']}"
                 + (", heavy vehicle" if v.get("heavy") else "") + f"), "
                 + (f"in the {fleet_name} fleet" if fleet_name else f"owned by {owner}")
                 + (f"; odometer {_num(v['odometer_km'])} km" if v.get("odometer_km") else "")
                 + (f"; road tax valid to {_d(v['mvl_expiry'])}" if v.get("mvl_expiry") else "") + ".",
                 "vehicle", _vhref(v["plate"]), f"Vehicle · {v['plate']}", "synthetic")


def today_vehicle_fact(F: Facts, plate: str, branch: str) -> int | None:
    """Where the vehicle is in today's day at the hub."""
    iid = None
    with session_scope() as s:
        tz_start = hubday.now_myt().replace(hour=0, minute=0, second=0, microsecond=0).astimezone(dt.timezone.utc).replace(tzinfo=None)
        li = s.execute(select(LiveInspection).where(LiveInspection.plate == plate, LiveInspection.started_at >= tz_start)
                       .order_by(LiveInspection.started_at.desc()).limit(1)).scalar_one_or_none()
        if li:
            iid, lane, st = li.inspection_id, li.lane_id.split("-L")[-1], li.status
    if iid:
        return F.add(f"Today: live inspection {iid} on lane {lane}, {LI_STATUS.get(st, st)}.", "inspection", f"/inspection/{iid}",
                     f"Inspection · {plate}", "live_model")
    try:
        x = hubday.item(plate, branch)
    except Exception:  # noqa: BLE001
        x = None
    if not x:
        return None
    if x["status"] == "completed":
        txt = (f"Today: {x['inspection_type']} on lane {x['lane']}, finished {x['end_at']}: {RESULT.get(x['result'], x['result'])}"
               + (f" ({'; '.join(x['issues'])})" if x.get("issues") else "") + ".")
    elif x["status"] == "in_progress":
        txt = f"Today: on lane {x['lane']} now ({x['inspection_type']}), about {x.get('eta_min', '?')} min left; the result is not in yet."
    elif x["status"] == "in_queue":
        txt = f"Today: in the queue for lane {x['lane']} ({x['inspection_type']}), starting about {x['start_at']}."
    else:
        txt = f"Today: expected at {x['arrival_at']} for a {x['inspection_type']} on lane {x['lane']}."
    href = f"/lane?lane={branch}-L{x['lane']}" if x["status"] == "in_progress" else _vhref(plate)
    return F.add(txt, "schedule", href, f"Lane {x['lane']}" if x["status"] == "in_progress" else plate, "synthetic")


def _reports(plate: str, n: int = 3) -> list[dict]:
    """A vehicle's reports, newest first, with the verdict's reasons; a replay run again gives the same report again, so
    a report with the same result and findings as the newer one is left out."""
    try:
        rows = report_svc.for_plate(plate, 12)
    except Exception:  # noqa: BLE001
        return []
    with session_scope() as s:
        reasons = {r.report_id: (r.data or {}).get("verdict_reasons", []) for r in
                   s.execute(select(Report).where(Report.report_id.in_([x["report_id"] for x in rows]))).scalars()}
    out, seen = [], set()
    for r in rows:
        sig = (r["kind"].lower(), r["verdict"], r.get("health"), tuple(r.get("findings", [])))
        if sig in seen:
            continue
        seen.add(sig)
        out.append({**r, "reasons": reasons.get(r["report_id"], [])})
    return out[:n]


def report_fact(F: Facts, r: dict, plate: str, findings: bool = True) -> int | None:
    when = _d((r.get("issued_at") or r.get("created_at") or "")[:10])
    found = [f for f in r.get("findings", [])][:4] if findings else []
    reasons = r.get("reasons") or []
    return F.add(f"Report {r['report_id']} for {plate} ({r['kind']}, {when}): {r['verdict']}"
                 + (f" because of: {'; '.join(reasons[:4])}" if r["verdict"] in ("CONDITIONAL", "REFERRED") and reasons else "")
                 + (f", health score {r['health']}/100" if r.get("health") is not None else "")
                 + (f"; confirmed findings: {'; '.join(found)}" if found else "")
                 + (" (a synthetic earlier report)" if r.get("synthetic") else "") + ".",
                 "report", f"/report?id={r['report_id']}", f"Report · {plate}", "synthetic" if r.get("synthetic") else "live_logic")


def fail_section(F: Facts, plate: str, branch: str) -> Section:
    v = _vehicle(plate) or {"plate": plate}
    reps = _reports(plate, 3)
    latest = reps[0] if reps else None
    s = Section(f"Why **{plate}** failed, from its latest records:", f"Sebab **{plate}** gagal, daripada rekod terkininya:")
    if latest:
        if latest["verdict"] == "PASS":
            s = Section(f"**{plate}**'s latest report is a **PASS**.", f"Laporan terkini **{plate}** ialah **LULUS**.")
        s.take(report_fact(F, latest, plate, findings=latest["verdict"] == "PASS"))
        if latest["verdict"] in ("CONDITIONAL", "REFERRED"):
            s.take(F.add(next(r["text"] for r in RULES if r["id"] == "verdict"), "rule", None, None, "live_logic"))
        with session_scope() as ss:
            rep = ss.execute(select(Report).where(Report.report_id == latest["report_id"])).scalar_one_or_none()
            found = [f for f in (rep.data or {}).get("findings", []) if f.get("status") in ("confirmed", "advisory")] if rep else []
        fails = [f for f in found if f.get("fail_item") and f.get("status") == "confirmed"]
        for f in fails[:4]:
            s.take(F.add(f"Failed item on report {latest['report_id']} ({f.get('system', '')}): {f['title']}. {f.get('detail', '')}", "finding",
                         f"/report?id={latest['report_id']}", f"Report · {plate}", "live_logic"))
        others = [f["title"] for f in found if f not in fails]
        if others:
            s.take(F.add(f"Also confirmed on report {latest['report_id']}, not failed items on their own: {'; '.join(others[:5])}.", "finding",
                         f"/report?id={latest['report_id']}", f"Report · {plate}", "live_logic"))
    iid = _latest_li(plate=plate)
    if iid:
        with session_scope() as ss:
            li = ss.get(LiveInspection, iid)
            newer = li is not None and li.status != "reported"
            n_open = ss.scalar(select(func.count()).select_from(Alert).where(Alert.inspection_id == iid, Alert.status == "open")) if newer else 0
            lane, started = (li.lane_id.split("-L")[-1], _d(li.started_at.date().isoformat())) if li else ("", "")
            st = LI_STATUS.get(li.status, li.status) if li else ""
        if newer and latest:
            s.take(F.add(f"A newer inspection {iid} (lane {lane}, started {started}) is {st}, with {n_open} open finding(s) and no verdict yet.",
                         "inspection", f"/inspection/{iid}/findings", f"Findings · {plate}", "live_model"))
        elif newer:
            inspection_section(F, iid, s, findings=3)
    s.take(today_vehicle_fact(F, plate, branch))
    try:
        h = pd.read_sql(text("select date, inspection_type, result, fail_reasons from hist_inspections where vehicle_id = :v "
                             "and result != 'PASS' order by date desc limit 2"), engine(), params={"v": v.get("vehicle_id")})
        for r in h.itertuples():
            s.take(F.add(f"Earlier: {_d(str(r.date))} {terms.label(r.inspection_type)}: {r.result}"
                         + (f", failed on {_reasons(r.fail_reasons)}" if isinstance(r.fail_reasons, str) and r.fail_reasons else "")
                         + ".", "history", _vhref(plate), plate, "synthetic"))
    except Exception:  # noqa: BLE001
        pass
    if not s.ns:
        s = Section(f"Nothing on record shows **{plate}** failing.", f"Tiada rekod menunjukkan **{plate}** gagal.")
        s.take(F.add(f"{plate} has no failed inspection or open fail item on record.", "history", _vhref(plate), plate))
    return s


def guide_section(F: Facts, q: str, lang: str, llm: LLM | None) -> list[Section]:
    """How-to questions (verifying a certificate, documents, duration, re-inspection, self-check): the inspection guide."""
    s = Section("From the inspection guide:", "Daripada panduan pemeriksaan:")
    hit = _kb(llm, q, "ms" if lang == "ms" else "en", min_score=0.3)
    if hit:
        s.take(F.add(hit, "kb", None, None, "synthetic"))
    if re.search(r"verif|qr|certificat|sahkan|sijil", q, re.I):
        s.take(F.add("Every issued report carries a QR code. It opens the public verification page (/verify/<code>), which shows the "
                     "result, the date and whether the report is anchored, unaltered, in the SHA-256 evidence chain.", "certificate",
                     None, None, "live_logic"))
    return [s] if s.ns else []


def fees_section(F: Facts) -> list[Section]:
    s = Section("Inspection fees (illustrative demo prices):", "Bayaran pemeriksaan (harga demo):")
    for code, t in booking_svc.TYPES.items():
        s.take(F.add(f"{t['label']}: RM {t['price']:.0f}, about {t['minutes']} minutes in the lane.", "fee", "/appointments",
                     "Appointments", "mock"))
    s.take(F.add(f"Express next-day slots add RM {booking_svc.GEAR_SURCHARGE:.0f}.", "fee", "/appointments", "Appointments", "mock"))
    return [s]


def report_section(F: Facts, plates: list[str], q: str = "") -> list[Section]:
    out = []
    if plates:
        for p in plates[:2]:
            reps = _reports(p, 3)
            if not reps:
                s = Section(f"No report has been issued for **{p}** yet.", f"Tiada laporan dikeluarkan untuk **{p}** lagi.")
                s.take(F.add(f"{p} has no issued report on record.", "report", _vhref(p), p))
            else:
                s = Section(f"Reports issued for **{p}** (newest first):", f"Laporan untuk **{p}** (terkini dahulu):")
                for r in reps:
                    s.take(report_fact(F, r, p))
                r = reps[0]
                s.take(F.add(f"Certificate check for report {r['report_id']}: anyone can verify it with the QR code at /verify/{r['verify_token']} "
                             "(shows the result and the tamper-evident evidence chain).", "certificate", f"/verify/{r['verify_token']}",
                             "Verify certificate", "live_logic"))
            out.append(s)
        return out
    with session_scope() as ss:
        rows = ss.execute(select(Report).order_by(Report.created_at.desc()).limit(60)).scalars().all()
        today_only = bool(re.search(r"\btoday\b|hari ini", q, re.I))
        day = hubday.now_myt().date().isoformat()
        seen, picked = set(), []
        for r in rows:
            if r.plate in seen or (r.data or {}).get("synthetic"):
                continue
            if today_only and ((r.data or {}).get("issued_at") or "")[:10] != day:
                continue
            seen.add(r.plate)
            picked.append(report_svc.report_dict(r) | {"findings": [], "health": ((r.data or {}).get("health") or {}).get("score"),
                                                       "issued_at": (r.data or {}).get("issued_at")})
    s = Section("Reports issued today, the latest for each vehicle:" if today_only else "The latest report for each vehicle:",
                "Laporan dikeluarkan hari ini:" if today_only else "Laporan terkini bagi setiap kenderaan:")
    for r in picked[:5]:
        s.take(report_fact(F, r, r["plate"]))
    if not picked:
        s = Section("No reports have been issued today." if today_only else "No reports have been issued yet.",
                    "Belum ada laporan dikeluarkan.")
        s.take(F.add("No inspection report has been issued today." if today_only else "No inspection report has been issued yet.",
                     "report", "/inspection", "Inspections"))
    out.append(s)
    return out


def _period(q: str) -> tuple[dt.date, dt.date, str]:
    t = hubday.now_myt().date()
    low = q.lower()
    if re.search(r"\btoday\b|hari ini", low):
        return t, t, "today"
    if re.search(r"\btomorrow\b|\besok\b", low):
        return t + dt.timedelta(days=1), t + dt.timedelta(days=1), "tomorrow"
    if re.search(r"next week|minggu depan", low):
        return t + dt.timedelta(days=7), t + dt.timedelta(days=13), "next week"
    if re.search(r"this week|minggu ini|\bweek\b|minggu", low):
        return t, t + dt.timedelta(days=6), "in the next 7 days"
    return t, t + dt.timedelta(days=60), "coming up"


def booking_section(F: Facts, q: str, plates: list[str], hub_only: str | None = None) -> list[Section]:
    start, end, label = _period(q)
    out = []
    with session_scope() as ss:
        stmt = select(Booking).where(Booking.status != "cancelled")
        if plates:
            stmt = stmt.where(Booking.plate.in_(plates))
        if hub_only:
            stmt = stmt.where(Booking.branch_id == hub_only)
        rows = ss.execute(stmt.order_by(Booking.date, Booking.slot)).scalars().all()
        books = [booking_svc.booking_dict(b) for b in rows]
    # one per vehicle and day (repeated demo runs book the same day again): the one furthest along
    rank = {"checked_in": 0, "confirmed": 1, "pending_payment": 2}
    uniq: dict[tuple, dict] = {}
    for b in books:
        k = (b["plate"], b["date"])
        if k not in uniq or rank.get(b["status"], 3) < rank.get(uniq[k]["status"], 3):
            uniq[k] = b
    books = sorted(uniq.values(), key=lambda b: (b["date"], b["slot"]))
    names = {v["plate"]: f"{v['make']} {v['model']}" for v in _main()}
    window = [b for b in books if start.isoformat() <= b["date"] <= end.isoformat()]
    status = {"confirmed": "confirmed", "pending_payment": "awaiting payment", "checked_in": "checked in"}
    who = (" for " + ", ".join(plates)) if plates else ""
    s = Section(f"Appointments{who} {label} ({_d(start.isoformat())} to {_d(end.isoformat())}): {len(window)}.",
                f"Temujanji{(' untuk ' + ', '.join(plates)) if plates else ''} ({_d(start.isoformat())} hingga {_d(end.isoformat())}): {len(window)}.")
    for b in window[:7]:
        s.take(F.add(f"{b['plate']}" + (f" ({names[b['plate']]})" if b["plate"] in names else "")
                     + f": {b['type_label']} on {_d(b['date'])} at {b['slot']}, {b['branch_name']}, {status.get(b['status'], b['status'])}"
                     + (f", booked by the {b['source']}" if b.get("source") else "") + ".", "booking", "/appointments", "Appointments", "mock"))
    if not window:
        nxt = [b for b in books if b["date"] > end.isoformat()][:2]
        past = [b for b in books if b["date"] < start.isoformat()][-1:] if plates else []
        s.take(F.add(f"No appointments{who} between {_d(start.isoformat())} and {_d(end.isoformat())}.", "booking", "/appointments",
                     "Appointments", "mock"))
        for b in nxt:
            s.take(F.add(f"Next after that: {b['plate']}" + (f" ({names[b['plate']]})" if b["plate"] in names else "")
                         + f", {b['type_label']} on {_d(b['date'])} at {b['slot']}, {b['branch_name']}.", "booking", "/appointments",
                         "Appointments", "mock"))
        for b in past:
            s.take(F.add(f"Most recent: {b['plate']}, {b['type_label']} on {_d(b['date'])} at {b['slot']}, "
                         f"{status.get(b['status'], b['status'])}.", "booking", "/appointments", "Appointments", "mock"))
    elif len(window) > 7:
        s.take(F.add(f"{len(window) - 7} more appointment(s) in that period.", "booking", "/appointments", "Appointments", "mock"))
    out.append(s)
    return out


def history_section(F: Facts, plate: str) -> Section:
    s = Section(f"**{plate}**'s history on record:", f"Sejarah **{plate}** dalam rekod:")
    v = _vehicle(plate)
    if v:
        s.take(identity_fact(F, v))
    try:
        p = registry.profile(plate)
    except HTTPException:
        s.take(F.add(f"{plate} is not in the vehicle register.", "history"))
        return s
    ins = p["inspections"]
    for i in ins[-4:][::-1]:
        s.take(F.add(f"{_d(i['date'])}: {i['type']}, {i['result']}" + (f", odometer {_num(i['odometer_km'])} km" if i.get("odometer_km") else "")
                     + (f", failed on {_reasons(';'.join(i['fail_reasons']))}" if i.get("fail_reasons") else "")
                     + (f", brake efficiency {_fmt(i['brake_efficiency_pct'])}%" if i.get("brake_efficiency_pct") else "")
                     + (f", min tread {_fmt(i['tyre_tread_min_mm'])} mm" if i.get("tyre_tread_min_mm") else "") + ".",
                     "history", _vhref(plate), f"History · {plate}", "synthetic"))
    if not ins:
        s.take(F.add(f"No earlier periodic inspections of {plate} are in the inspection history.", "history", _vhref(plate),
                     f"History · {plate}", "synthetic"))
    for r in _reports(plate, 2):
        s.take(report_fact(F, r, plate))
    odo = p["odometer"]
    cur = p["vehicle"].get("odometer_km")
    if odo.get("max"):
        s.take(F.add(f"Odometer: {_num(cur)} km on the register; highest earlier reading {_num(odo['max']['km'])} km on "
                     f"{_d(odo['max']['date'])}; " + ("possible rollback flagged." if odo.get("rollback") else "no rollback."),
                     "odometer", _vhref(plate), f"History · {plate}", "synthetic"))
    claims = p["claims"]
    if claims:
        for c in claims[-3:][::-1]:
            s.take(F.add(f"Insurance claim {_d(c['date'])}: {c['type']}, RM {_num(c['amount_rm'])}" + (", total loss" if c.get("total_loss") else "")
                         + ".", "claim", _vhref(plate), f"History · {plate}", "synthetic"))
    else:
        s.take(F.add(f"No insurance claims on record for {plate}.", "claim", _vhref(plate), f"History · {plate}", "synthetic"))
    if (v or {}).get("fleet_id"):
        try:
            d = fleet_svc.vehicle_detail(plate)
            for c in d.get("checks", [])[:2]:
                s.take(F.add(f"{c['kind']} {_d(c['date'])}: {_fmt(c['value'])} {c['unit']} ({c['result'].lower()})"
                             + (f", {c['note']}" if c.get("note") else "") + ".", "trend", _vhref(plate, "health"),
                             f"Health trends · {plate}", "synthetic"))
        except Exception:  # noqa: BLE001
            pass
    return s


def trend_vehicle(F: Facts, plate: str, q: str, s: Section, only_primary: bool = False) -> bool:
    """A fleet vehicle's condition trends (fleet checks, telematics, lane visits) and when each reaches its limit."""
    v = _vehicle(plate) or {}
    if not v.get("fleet_id"):
        return False
    try:
        vv = fleet_svc._get_vehicle(plate)
        a = fleet_svc.analyse_vehicle(vv)
    except Exception as e:  # noqa: BLE001
        log.warning("fleet analysis failed for %s: %s", plate, e)
        return False
    href = _vhref(plate, "health")
    if not only_primary:
        subs = ", ".join(f"{k} {round(x)}" for k, x in a["subsystems"].items())
        s.take(F.add(f"{plate} fleet health score {a['health']}/100 (lowest subsystem scores: {subs}).", "trend", href,
                     f"Health trends · {plate}", "live_logic"))
    wanted = [m for k, m in a["metrics"].items() if q and re.search(METRIC_RE.get(k, r"$^"), q, re.I)]
    picks = wanted or ([a["primary"]] if a["primary"] else [])
    for m in picks[:2]:
        s.take(F.add(_metric_text(plate, m), "forecast", href, f"Health trends · {plate}", "live_logic"))
    return True


def _metric_text(plate: str, m: dict) -> str:
    fc = m["forecast"]
    now = m["points"][-1]["value"]
    t = (f"{plate} {m['name'].lower()}: {_fmt(now)} {m['unit']} at the last reading ({_d(m['points'][-1]['date'])}), limit "
         f"{_fmt(m['limit'])} {m['unit']}; pattern {m['pattern'].lower()}, {m['risk'].lower()} risk")
    if fc.get("date"):
        t += f"; forecast to reach the limit around {_d(fc['date'])} ({fc['weeks_label'].replace('~', 'about ')})"
    else:
        t += "; not forecast to reach the limit within a year"
    if m.get("attention"):
        t += f". Recommended: {m['action']}"
    return t + "."


def trend_section(F: Facts, q: str, plates: list[str]) -> list[Section]:
    out = []
    if plates:
        for p in plates[:2]:
            s = Section(f"Condition trends for **{p}**:", f"Trend keadaan untuk **{p}**:")
            if not trend_vehicle(F, p, q, s):
                s = Section(f"**{p}** is not a fleet vehicle, so it has no monthly condition readings; its lane results show its health.",
                            f"**{p}** bukan kenderaan armada; keputusan lorong menunjukkan kesihatannya.")
                reps = _reports(p, 1)
                with session_scope() as ss:
                    rep = ss.execute(select(Report).where(Report.report_id == reps[0]["report_id"])).scalar_one_or_none() if reps else None
                    data = dict(rep.data or {}) if rep else {}
                if data.get("health"):
                    s.take(F.add(f"{p} Vehicle Health Score {data['health'].get('score')}/100 at its latest lane inspection "
                                 f"({_d((data.get('issued_at') or '')[:10])}).", "trend", _vhref(p, "health"), f"Health · {p}", "live_model"))
                nf = data.get("next_fail")
                if nf:
                    s.take(F.add(f"{p} next-inspection fail risk {nf['p_fail_next']:.0%}"
                                 + (f" (other {nf['peer']}: {nf['peer_rate']:.0%})" if nf.get("peer_rate") is not None else "")
                                 + (f"; median time to a failure about {round(nf['months_to_failure_median'])} months" if nf.get("months_to_failure_median") else "")
                                 + ".", "forecast", _vhref(p, "health"), f"Health · {p}", "live_model"))
                ev = data.get("ev")
                if ev:
                    left = ("already at or below 70%" if not ev.get("km_to_70") or float(ev.get("pack_soh_pct") or 100) <= 70
                            else f"about {_num(ev.get('km_to_70'))} km until it reaches 70%")
                    s.take(F.add(f"{p} battery state of health {ev.get('pack_soh_pct')}% at the latest lane inspection, {left}.",
                                 "forecast", _vhref(p, "health"), f"Health · {p}", "live_model"))
                if not s.ns:
                    s.take(F.add(f"{p} has no health trend on record yet.", "trend", _vhref(p), p))
            out.append(s)
        return out
    # across the main fleet vehicles: which reaches a limit first
    rows = []
    for v in _main():
        if not v.get("fleet_id"):
            continue
        try:
            a = fleet_svc.analyse_vehicle(fleet_svc._get_vehicle(v["plate"]))
        except Exception:  # noqa: BLE001
            continue
        wanted = [m for k, m in a["metrics"].items() if re.search(METRIC_RE.get(k, r"$^"), q, re.I)]
        for m in (wanted or ([a["primary"]] if a["primary"] else [])):
            rows.append((v, m))
    rows.sort(key=lambda r: (r[1]["forecast"].get("weeks_to_limit") is None, r[1]["forecast"].get("weeks_to_limit") or 1e9,
                             -r[1]["risk_i"]))
    metric = rows[0][1]["name"].lower() if rows and len({r[1]["metric"] for r in rows}) == 1 else None
    what = metric or "each vehicle's most urgent reading"
    s = Section(f"Fleet vehicles, soonest to reach the limit first ({what}):",
                f"Kenderaan armada, yang paling awal mencapai had dahulu ({metric or 'bacaan paling mendesak'}):")
    for v, m in rows[:4]:
        s.take(F.add(_metric_text(v["plate"], m).replace(f"{v['plate']} ", f"{v['plate']} ({v['make']} {v['model']}) ", 1), "forecast",
                     _vhref(v["plate"], "health"), f"Health trends · {v['plate']}", "live_logic"))
    if not rows:
        s.take(F.add("No fleet condition readings are on record.", "trend"))
    out.append(s)
    return out


def rules_section(F: Facts, q: str, plates: list[str], llm: LLM | None) -> list[Section]:
    found = rules_in(q)
    heavy = bool(HEAVY_RE.search(q))
    light = bool(LIGHT_RE.search(q)) and not heavy
    v = _vehicle(plates[0]) if plates else None
    if v:
        heavy, light = bool(v.get("heavy")), not v.get("heavy")
    s = Section("The inspection rules that apply:", "Peraturan pemeriksaan yang berkaitan:")
    for r in found[:3]:
        s.take(F.add(r["text"], "rule", None, None, "live_logic"))
        if r["id"] == "brake_eff" and (heavy or light):
            who = (f"{v['plate']} ({v['make']} {v['model']})" if v else ("a heavy vehicle" if heavy else "a light vehicle"))
            s.take(F.add(f"For {who}: the brake efficiency minimum is {'45' if heavy else '50'}%.", "rule", None, None, "live_logic"))
        if v and r.get("m"):
            iid = _latest_li(plate=v["plate"])
            if iid:
                with session_scope() as ss:
                    li = ss.get(LiveInspection, iid)
                    val = (li.measurements or {}).get(r["m"]) if li else None
                if val is not None:
                    s.take(F.add(f"Latest measured on {v['plate']} (inspection {iid}): {_fmt(val)}{r['unit']}.", "measurement",
                                 f"/inspection/{iid}", f"Inspection · {v['plate']}", "simulated"))
    if not found:
        hit = _kb(llm, q)
        if hit:
            s.take(F.add(hit, "kb", None, None, "synthetic"))
        else:
            for r in [x for x in RULES if x["id"] in ("brake_eff", "tread", "tint", "smoke", "verdict")]:
                s.take(F.add(r["text"], "rule", None, None, "live_logic"))
            s.lead = {"en": "The main limits the lanes check:", "ms": "Had utama yang diperiksa di lorong:"}
    return [s]


def _kb(llm: LLM | None, q: str, lang: str = "en", min_score: float = 0.45) -> str | None:
    if llm is None:
        return None
    try:
        hits = llm.retriever.search(q, k=1)
    except Exception:  # noqa: BLE001
        return None
    if not hits or hits[0][1] < min_score:
        return None
    item = hits[0][0]
    return item["a"].get(lang) or item["a"]["en"]


def overview_section(F: Facts, plate: str, branch: str) -> Section:
    v = _vehicle(plate)
    if v is None:
        s = Section(f"**{plate}** is not in the register.", f"**{plate}** tiada dalam daftar.")
        return s
    s = Section(f"Here is what is on record for **{plate}** ({v['make']} {v['model']}):",
                f"Ini rekod untuk **{plate}** ({v['make']} {v['model']}):")
    s.take(identity_fact(F, v))
    s.take(today_vehicle_fact(F, plate, branch))
    reps = _reports(plate, 1)
    if reps:
        s.take(report_fact(F, reps[0], plate))
    iid = _latest_li(plate=plate)
    if iid:
        with session_scope() as ss:
            li = ss.get(LiveInspection, iid)
            pending = li is not None and li.status != "reported"
        if pending:
            inspection_section(F, iid, s, findings=2)
    trend_vehicle(F, plate, "", s, only_primary=True)
    start = hubday.now_myt().date().isoformat()
    with session_scope() as ss:
        b = ss.execute(select(Booking).where(Booking.plate == plate, Booking.status.in_(("confirmed", "pending_payment")),
                                             Booking.date >= start).order_by(Booking.date, Booking.slot).limit(1)).scalar_one_or_none()
        nb = booking_svc.booking_dict(b) if b else None
    if nb:
        s.take(F.add(f"Next appointment: {nb['type_label']} on {_d(nb['date'])} at {nb['slot']}, {nb['branch_name']}.", "booking",
                     "/appointments", "Appointments", "mock"))
    return s


# ---------------------------------------------------------------- answers
HELP = {
    "en": ("I'm the VehicleSense operations assistant. I answer from the platform's own data and show where each fact comes from. "
           "Ask me about:\n- **Today at the hub**: lanes, the queue, finished inspections and issues\n- **Live inspections**: open "
           "findings and the verdict so far\n- **Vehicles**: history, odometer, claims, reports and certificates\n- **Appointments**: "
           "by vehicle or by week\n- **Fleet health**: wear trends and when a part reaches its limit\n- **Inspection rules**: brake "
           "efficiency, tint, smoke, tread depth and more\n\nName a vehicle by plate (DMO 9001) or by name (the Myvi, the truck)."),
    "ms": ("Saya pembantu operasi VehicleSense. Saya menjawab daripada data platform sendiri dan menunjukkan sumber setiap fakta. "
           "Tanya saya tentang:\n- **Hari ini di hab**: lorong, barisan, pemeriksaan selesai dan isu\n- **Pemeriksaan langsung**: "
           "penemuan terbuka dan keputusan setakat ini\n- **Kenderaan**: sejarah, odometer, tuntutan, laporan dan sijil\n"
           "- **Temujanji**: mengikut kenderaan atau minggu\n- **Kesihatan armada**: trend haus dan bila had dicapai\n"
           "- **Peraturan pemeriksaan**: kecekapan brek, tint, asap, bunga tayar dan lain-lain\n\n"
           "Sebut kenderaan dengan nombor plat (DMO 9001) atau nama (Myvi, lori itu)."),
}
NOTHING = {"en": "I couldn't find that in the platform's data. I can answer questions about today's lanes and queue, the ten main "
                 "vehicles, inspections and findings, reports, appointments, fleet health trends and the inspection rules.",
           "ms": "Saya tidak menjumpai maklumat itu dalam data platform. Saya boleh menjawab tentang lorong dan barisan hari ini, "
                 "sepuluh kenderaan utama, pemeriksaan dan penemuan, laporan, temujanji, trend kesihatan armada dan peraturan pemeriksaan."}
NO_VEHICLE = {"en": "Which vehicle do you mean? Name it by plate (for example DMO 9001) or pick one of the vehicle chips.",
              "ms": "Kenderaan yang mana? Sebut nombor plat (contoh DMO 9001) atau pilih salah satu cip kenderaan."}
STARTERS = {
    "en": ["Summarise today at the hub", "What's on lane 3 right now?", "Why did DMO 9001 fail?", "Show the history of the Myvi",
           "Which vehicles have appointments this week?", "What is the brake efficiency limit for a prime mover?",
           "Which fleet vehicle will reach its tread limit first?"],
    "ms": ["Ringkaskan hari ini di hab", "Apa di lorong 3 sekarang?", "Kenapa DMO 9001 gagal?", "Tunjukkan sejarah Myvi",
           "Kenderaan mana ada temujanji minggu ini?", "Berapakah had kecekapan brek untuk lori?",
           "Kenderaan armada mana akan capai had bunga tayar dahulu?"],
}
SYSTEM = ("You are the VehicleSense operations assistant for vehicle inspection hub staff in Malaysia. Answer the QUESTION using "
          "ONLY the numbered FACTS.\n"
          "Rules:\n"
          "- Every sentence and every bullet ends with the number(s) of the fact(s) it uses, like [2] or [1][3].\n"
          "- Keep each fact's own words for results and verdicts (PASS, FAIL, CONDITIONAL, REFERRED, passed with advisories, awaiting "
          "review). Never group a vehicle under a result its fact does not give it. An open finding is awaiting the examiner's "
          "decision: never call it confirmed or failed.\n"
          "- Copy numbers exactly as written; do not add up, subtract or convert them.\n"
          "- Do not speculate about causes, links or consequences the FACTS do not state. Never repeat a point.\n"
          "- Never invent or round plates, readings, limits, dates, times, names or results, and never mention a vehicle that is not in "
          "the FACTS. If the FACTS do not answer the question, say plainly that it is not on record.\n"
          "- Never say the word FACTS.\n"
          "Format: the first line is ONE short sentence (at most 25 words) that answers the question. Then, when the answer covers "
          "several items (vehicles, appointments, lanes, findings, dates), one short bullet per item with its key details (date, "
          "time, reading or result), up to 6, each starting with '- '. No bullets for a single point. Use **bold** only for plates, verdicts and key numbers. At most 130 words. "
          "Answer in {lang}.")
LANG_NAME = {"en": "English", "ms": "Bahasa Melayu (Malaysian Malay)", "zh": "Simplified Chinese"}


def _template(sections: list[Section], F: Facts, lang: str) -> str:
    lg = "ms" if lang == "ms" else "en"
    parts, shown = [], 0
    for s in sections:
        lines = [s.lead[lg]]
        for n in s.ns:
            if shown >= 9:
                break
            f = F.items[n - 1]
            lines.append(f"- {f['text']} [{n}]")
            shown += 1
        parts.append("\n".join(lines))
    return "\n\n".join(parts).strip()


CITE_RE = re.compile(r"\[(\d+(?:\s*[,–-]\s*\d+)*)\]")
NUM_RE = re.compile(r"(?<![\w.])\d[\d,]*(?:[.:]\d+)?")


def _n(x: str) -> str:
    """'1,000' -> '1000', '57.0' -> '57', '07' -> '7'."""
    x = x.replace(",", "").rstrip(".")
    x = x[:-2] if x.endswith(".0") else x
    return str(int(x)) if x.isdigit() else x


def _numbers(t: str) -> set[str]:
    """The numbers a text states, also written out ('250k' -> 250000, '2.29 M' -> 2290000)."""
    out = {_n(x) for x in NUM_RE.findall(t)}
    for v, unit in re.findall(r"(\d+(?:\.\d+)?)\s?([kKM])\b", t):
        out.add(_n(f"{float(v) * (1000 if unit in 'kK' else 1_000_000):.0f}"))
    return out


def _clean_llm(answer: str, F: Facts, q: str, context: str = "") -> str | None:
    """Keep only citations of facts that exist; reject an answer that names a vehicle the facts and question do not."""
    n = len(F.items)

    def fix(m: re.Match) -> str:
        nums = [int(x) for x in re.findall(r"\d+", m.group(1))]
        ok = [x for x in nums if 1 <= x <= n]
        return "".join(f"[{x}]" for x in ok)

    answer = CITE_RE.sub(fix, answer).replace("FACTS", "records")
    known = " ".join(f["text"] for f in F.items) + " " + q + " " + context
    for w in set(re.findall(r"\b(PASS|FAIL|CONDITIONAL|REFERRED)\b", answer)):
        if w not in known:
            log.warning("LLM answer gives a %s verdict that is not in the facts; using the template", w)
            return None
    have = _numbers(known)
    for x in NUM_RE.findall(CITE_RE.sub("", answer)):
        v = _n(x)
        if v not in have and not (v.isdigit() and int(v) <= 12) and not all(p in have for p in re.split(r"[:./-]", v) if p):
            log.warning("LLM answer has %s, which is not in the facts; using the template", x)
            return None
    for m in re.finditer(r"\b([A-Z]{3})\s?(\d{4})\b", answer):
        plate = f"{m.group(1)} {m.group(2)}"
        if plate not in known and f"{m.group(1)}{m.group(2)}" not in known.replace(" ", ""):
            log.warning("LLM named %s, which is not in the facts; using the template", plate)
            return None
    return re.sub(r"\n{3,}", "\n\n", answer).strip() or None


def _trim(answer: str) -> str:
    """Drop a last line the model was cut off in the middle of (it ran out of tokens)."""
    lines = answer.rstrip().split("\n")
    if len(lines) > 1 and not re.search(r"[.!?)\]*:。]\s*$", lines[-1]):
        lines = lines[:-1]
    return "\n".join(lines)


def _ask_llm(llm: LLM, F: Facts, q: str, lang: str, context: list[str]) -> tuple[str | None, str]:
    body = "\n".join(f"[{f['n']}] {f['text']}" for f in F.items)
    msg = "\n".join(context) + f"\n\nFACTS:\n{body}\n\nQUESTION: {q}"
    fut = _pool.submit(llm.chat, SYSTEM.format(lang=LANG_NAME.get(lang, "English")), [{"role": "user", "content": msg}], 600)
    try:
        out = fut.result(timeout=LLM_DEADLINE_S)
    except cf.TimeoutError:
        log.warning("LLM did not answer within %.0f s; using the template", LLM_DEADLINE_S)
        return None, "template"
    except Exception as e:  # noqa: BLE001
        log.warning("LLM failed: %s", e)
        return None, "template"
    if not out:
        return None, "template"
    out = _clean_llm(_trim(out), F, q, " ".join(context))
    return (out, llm.status()["backend"]) if out else (None, "template")


def _suggestions(intents: list[str], plates: list[str], lang: str, lanes: list[int], q: str = "") -> list[str]:
    ms = lang == "ms"
    p = plates[0] if plates else None
    nick = NICK.get(p, p) if p else None
    out: list[str] = []
    if p:
        nick_ms = nick.replace("the ", "") if nick else p
        reps = _reports(p, 1)
        verdict = reps[0]["verdict"] if reps else None
        why = ((f"Kenapa {p} gagal?" if ms else f"Why did {p} fail?") if verdict == "FAIL" else
               (f"Kenapa {p} bersyarat?" if ms else f"Why was {p} conditional?") if verdict == "CONDITIONAL" else
               (f"Apakah keputusan terkini {p}?" if ms else f"What is {p}'s latest result?"))
        pool = [
            ("fail", why),
            ("history", f"Tunjukkan sejarah {nick_ms}" if ms else f"Show the history of {nick}"),
            ("trend", f"Bila {nick_ms} akan capai had?" if ms else f"When will {nick} reach a limit?"),
            ("booking", f"Adakah {p} ada temujanji?" if ms else f"Does {p} have an appointment?"),
            ("report", f"Tunjukkan laporan {p}" if ms else f"Show {p}'s reports"),
            ("live", f"Apa penemuan terbuka untuk {p}?" if ms else f"What are {p}'s open findings?"),
        ]
        v = _vehicle(p) or {}
        if not v.get("fleet_id"):
            pool = [x for x in pool if x[0] != "trend"]
        out = [t for k, t in pool if k not in intents][:3]
    elif lanes or "today" in intents:
        n = lanes[0] if lanes else 3
        other = 1 if n != 1 else 2
        out = (["Siapa dalam barisan?", f"Apa di lorong {other} sekarang?", "Pemeriksaan mana gagal hari ini?"] if ms else
               ["Who is waiting in the queue?", f"What's on lane {other} right now?", "Which inspections failed today?"])
    elif "trend" in intents:
        out = (["Kenderaan armada mana perlu perhatian?", "Bila Ranger akan capai had bunga tayar?", "Tunjukkan trend brek Vios"] if ms else
               ["Which fleet vehicles need attention?", "When will the Ranger reach its tread limit?", "Show the Vios brake trend"])
    elif "rules" in intents:
        out = (["Apakah had tint tingkap?", "Apakah had asap untuk diesel?", "Bagaimana keputusan ditentukan?"] if ms else
               ["What is the window tint limit?", "What is the smoke opacity limit?", "How is the verdict decided?"])
    elif "booking" in intents:
        out = (["Temujanji minggu depan?", "Ringkaskan hari ini di hab", "Adakah DMO 9001 ada temujanji?"] if ms else
               ["Any appointments next week?", "Summarise today at the hub", "Does DMO 9001 have an appointment?"])
    else:
        out = STARTERS["ms" if ms else "en"][:3]
    same = lambda t: re.sub(r"\W+", " ", t.lower()).strip() == re.sub(r"\W+", " ", q.lower()).strip()  # noqa: E731
    out = [t for t in out if not same(t)]
    for t in STARTERS["ms" if ms else "en"]:
        if len(out) >= 3:
            break
        if t not in out and not same(t):
            out.append(t)
    return out[:3]


def _links(F: Facts, answer: str) -> list[dict]:
    cited = [int(x) for x in re.findall(r"\[(\d+)\]", answer)]
    order = cited + [f["n"] for f in F.items]
    out, seen = [], set()
    for n in order:
        if not 1 <= n <= len(F.items):
            continue
        f = F.items[n - 1]
        if f["href"] and f["href"] not in seen:
            seen.add(f["href"])
            out.append({"label": f["label"] or f["href"], "href": f["href"]})
        if len(out) >= 4:
            break
    return out


# ---------------------------------------------------------------- conversations
CID_RE = re.compile(r"^[a-z0-9]{6,12}$")


def _key(user: str, cid: str) -> str:
    return f"{PREFIX}:{user}:{cid}"


def _history(key: str, limit: int = 12) -> list[ChatMessage]:
    with session_scope() as s:
        rows = s.execute(select(ChatMessage).where(ChatMessage.conversation == key).order_by(ChatMessage.id.desc()).limit(limit)).scalars().all()
        return rows[::-1]


def _focus(rows: list[ChatMessage]) -> tuple[str | None, list[str]]:
    for m in reversed(rows):
        if m.role == "assistant":
            meta = m.meta or {}
            return meta.get("vehicle"), meta.get("intents") or []
    return None, []


def chat(user: str, conversation_id: str | None, message: str, plate: str | None, llm: LLM | None, branch: str = "BR00",
         hub_only: str | None = None) -> dict:
    """Answer one question in a conversation. `branch` is the hub "today" means; `hub_only` limits the appointments to one hub
    (an examiner's own)."""
    q = re.sub(r"\s+", " ", (message or "")).strip()[:500]
    if len(q) < 2:
        raise HTTPException(400, "Write a question first.")
    cid = conversation_id if conversation_id and CID_RE.match(conversation_id) else secrets.token_hex(5)
    key = _key(user, cid)
    prev = _history(key)
    focus, prev_intents = _focus(prev)
    lang = lang_of(q)
    chip = norm_plate(plate) if plate else None
    if chip and _vehicle(chip) is None:
        chip = None
    named = vehicles_in(q)
    lanes = lanes_in(q)
    intents = intents_of(q, lang)
    if not intents and (named or lanes) and (FOLLOW_RE.search(q) or len(q.split()) <= 4) and prev_intents:
        intents = [i for i in prev_intents if i != "help"]  # "and the Civic?" asks the last question again
    plates = named or ([chip] if chip else [])
    used_focus = False
    vehicle_wanting = {"fail", "history", "report", "booking", "trend", "live"}
    if not plates and focus and not lanes:
        if PRONOUN_RE.search(q) or (set(intents) & vehicle_wanting and not GLOBAL_RE.search(q)) or (not intents and FOLLOW_RE.search(q)):
            plates, used_focus = [focus], True
    # "why does a dark tint fail?", "brake efficiency for lorries": a rule topic without a vehicle is a rules question
    if not plates and not lanes and rules_in(q) and "today" not in intents and (not intents or "fail" in intents):
        intents = ["rules"] + [i for i in intents if i not in ("fail", "rules")]
    ask_which = (not plates and not lanes and PRONOUN_RE.search(q) and intents and set(intents) <= vehicle_wanting
                 and not GLOBAL_RE.search(q))
    F = Facts()
    sections: list[Section] = []
    static: str | None = None
    try:
        if "help" in intents or (not intents and not plates and not lanes and re.search(r"^\s*(?:hi|hello|hey|helo|thanks|thank you|terima kasih)\b", q, re.I)):
            static = HELP["ms" if lang == "ms" else "en"]
        elif ask_which:
            static = NO_VEHICLE["ms" if lang == "ms" else "en"]
        else:
            if "rules" in intents:
                sections += rules_section(F, q, plates, llm)
            if lanes or ("today" in intents and not plates):
                sections += today_section(F, q, branch, lanes)
            for p in plates[:2]:
                if "fail" in intents:
                    sections.append(fail_section(F, p, branch))
                if "history" in intents:
                    sections.append(history_section(F, p))
            if plates and "live" in intents and "fail" not in intents:
                sections += live_section(F, plates)
            if not plates and "live" in intents and not lanes:
                sections += live_section(F, [])
            if "guide" in intents and not plates:
                sections += guide_section(F, q, lang, llm)
            if "fees" in intents:
                sections += fees_section(F)
            if "report" in intents and not ("guide" in intents and not plates and F.items):
                sections += report_section(F, plates, q)
            if "booking" in intents:
                sections += booking_section(F, q, plates, hub_only)
            if "trend" in intents and not ("fail" in intents and plates):
                sections += trend_section(F, q, plates)
            if not plates and "fail" in intents and "today" not in intents and not lanes and "rules" not in intents:
                sections += today_section(F, "which failed today", branch, [])
            if plates and not sections:
                for p in plates[:2]:
                    sections.append(overview_section(F, p, branch))
            if not sections and "rules" not in intents:
                hit = _kb(llm, q, "ms" if lang == "ms" else "en", min_score=0.6)
                if hit:
                    s = Section("From the inspection guide:", "Daripada panduan pemeriksaan:")
                    s.take(F.add(hit, "kb", None, None, "synthetic"))
                    sections.append(s)
                elif intents and set(intents) <= vehicle_wanting and not plates:
                    static = NO_VEHICLE["ms" if lang == "ms" else "en"]
    except Exception as e:  # noqa: BLE001 - say so rather than fail the chat
        log.exception("copilot retrieval failed: %s", e)
        static = static or ("Something went wrong while looking that up. Please try again." if lang != "ms" else
                            "Ralat semasa mencari maklumat itu. Sila cuba lagi.")
    source = "template"
    if static is not None:
        answer = static
    elif not F.items:
        answer = NOTHING["ms" if lang == "ms" else "en"]
    else:
        answer = _template(sections, F, lang)
        if llm is not None:
            now = hubday.now_myt()
            ctx = [f"NOW: {now.strftime('%a %-d %b %Y %H:%M')} (Malaysia time), hub {branch}."]
            if plates:
                v = _vehicle(plates[0])
                if v:
                    ctx.append(f"VEHICLE IN FOCUS: {_name(v)}" + (" (from the earlier question)" if used_focus else "") + ".")
            out, src = _ask_llm(llm, F, q, lang, ctx)
            if out:
                answer, source = out, src
    vehicle = plates[0] if plates else focus  # the vehicle in focus carries over until another one is named
    facts = [{k: f[k] for k in ("n", "text", "kind", "href", "prov")} for f in F.items]
    links = _links(F, answer)
    sugg = _suggestions(intents, plates, lang, lanes, q)
    with session_scope() as s:
        s.add(ChatMessage(conversation=key, role="user", text=q, lang=lang[:4], source="", meta={"plate": chip}))
        s.add(ChatMessage(conversation=key, role="assistant", text=answer, lang=lang[:4], source=source[:32],
                          meta={"facts": facts, "links": links, "suggestions": sugg, "vehicle": vehicle, "intents": intents,
                                "lanes": lanes, "focus_used": used_focus, "source": source}))
    return {"conversation_id": cid, "answer": answer, "source": source, "facts": facts, "links": links, "suggestions": sugg,
            "vehicle": vehicle, "lang": lang, "intents": intents, "focus_used": used_focus}


def _iso(t: dt.datetime | None) -> str | None:
    return t.isoformat(timespec="seconds") + "Z" if t else None


def conversations(user: str) -> list[dict]:
    like = f"{PREFIX}:{user}:%"
    with session_scope() as s:
        rows = s.execute(select(ChatMessage.conversation, func.count(ChatMessage.id), func.max(ChatMessage.created_at),
                                func.min(ChatMessage.id), func.max(ChatMessage.id))
                         .where(ChatMessage.conversation.like(like)).group_by(ChatMessage.conversation)
                         .order_by(func.max(ChatMessage.id).desc())).all()
        firsts = {}
        if rows:
            for m in s.execute(select(ChatMessage).where(ChatMessage.id.in_([r[3] for r in rows]))).scalars():
                firsts[m.conversation] = m.text
    return [{"id": conv.split(":", 2)[2], "title": _title(firsts.get(conv, "")), "updated_at": _iso(last), "count": n}
            for conv, n, last, _, _ in rows]  # the most recently used first


def _title(t: str) -> str:
    t = t.strip()
    return (t[:57] + "…") if len(t) > 58 else (t or "New conversation")


def conversation(user: str, cid: str) -> dict:
    if not CID_RE.match(cid or ""):
        raise HTTPException(404, "conversation not found")
    rows = _history(_key(user, cid), limit=400)
    if not rows:
        raise HTTPException(404, "conversation not found")
    msgs = []
    for m in rows:
        meta = m.meta or {}
        msgs.append({"role": m.role, "text": m.text, "lang": m.lang, "source": meta.get("source") or m.source or None,
                     "created_at": _iso(m.created_at),
                     "facts": meta.get("facts", []), "links": meta.get("links", []), "suggestions": meta.get("suggestions", []),
                     "vehicle": meta.get("vehicle"), "plate": meta.get("plate")})
    return {"id": cid, "title": _title(next((m.text for m in rows if m.role == "user"), "")), "messages": msgs,
            "updated_at": _iso(rows[-1].created_at), "count": len(rows)}


def delete_conversation(user: str, cid: str) -> dict:
    if not CID_RE.match(cid or ""):
        raise HTTPException(404, "conversation not found")
    with session_scope() as s:
        n = s.execute(delete(ChatMessage).where(ChatMessage.conversation == _key(user, cid))).rowcount
    if not n:
        raise HTTPException(404, "conversation not found")
    return {"deleted": cid, "messages": n}


def main_vehicles() -> list[dict]:
    """The ten main vehicles for the chat's vehicle chips."""
    return [{"plate": v["plate"], "make": v["make"], "model": v["model"], "year": v["year"], "vtype": v["vtype"], "fuel": v["fuel"],
             "nick": NICK.get(v["plate"], v["plate"]).replace("the ", ""), "fleet": bool(v.get("fleet_id")), "lane": v.get("lane")}
            for v in _main()]


def starters(lang: str = "en") -> list[str]:
    return STARTERS["ms" if lang == "ms" else "en"]
