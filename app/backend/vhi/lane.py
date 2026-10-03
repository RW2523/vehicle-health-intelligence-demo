"""The inspection lane: the ten stations a vehicle passes through, in order, and the lane steps that make them up.

1 Identification, 2 Above-carriage, 3 Tinted glass, 4 Emission, 5 Side slip, 6 Suspension, 7 Brake, 8 Undercarriage,
9 Speedometer, 10 Headlight alignment; then the examiner's review and the report. The lane replays (the session files'
``lane_timeline``), the inspection checklist, the hub's day and the assistant all follow this order.
"""
from __future__ import annotations

# station id, label, what it checks, its lane steps
STATIONS: list[tuple[str, str, str, list[str]]] = [
    ("identification", "Identification", "Registration, chassis and engine numbers, and the odometer", ["check_in_anpr", "identity_ocr"]),
    ("above_carriage", "Above-carriage", "Body, cabin and the visible condition of the vehicle", ["above_carriage_ai"]),
    ("tinted_glass", "Tinted glass", "Visible light transmittance of the windscreen and windows", ["tinted_glass"]),
    ("emission", "Emission", "Smoke or exhaust gases against the legal limits, and the OBD fault codes", ["emission_idle_rev"]),
    ("side_slip", "Side slip", "Alignment of the front wheels", ["side_slip"]),
    ("suspension", "Suspension", "Performance of the suspension system", ["suspension"]),
    ("brake", "Brake", "Brake efficiency and imbalance on the roller tester", ["brake_roller"]),
    ("undercarriage", "Undercarriage", "Condition of the undercarriage and the tyres", ["undercarriage_ai"]),
    ("speedometer", "Speedometer", "The speedometer reading against the actual road speed", ["speedometer"]),
    ("headlight", "Headlight alignment", "Headlight intensity and beam alignment", ["headlight_alignment"]),
]

# every lane step in order, with when it runs in a lane replay (seconds from the start; 480 s in all)
TIMELINE: list[tuple[str, int, int]] = [
    ("check_in_anpr", 0, 15), ("identity_ocr", 15, 40), ("above_carriage_ai", 40, 80), ("tinted_glass", 80, 95),
    ("emission_idle_rev", 95, 185), ("side_slip", 185, 200), ("suspension", 200, 240), ("brake_roller", 240, 300),
    ("undercarriage_ai", 300, 360), ("speedometer", 360, 380), ("headlight_alignment", 380, 400),
    ("examiner_review", 400, 460), ("report", 460, 480),
]
STEPS: list[str] = [s for s, _, _ in TIMELINE]

STEP_LABEL: dict[str, str] = {
    "check_in_anpr": "check-in (plate camera)", "identity_ocr": "identification (chassis, engine, odometer)",
    "above_carriage_ai": "above-carriage check", "tinted_glass": "tinted glass test", "emission_idle_rev": "emission test",
    "side_slip": "side-slip test", "suspension": "suspension test", "brake_roller": "brake test",
    "undercarriage_ai": "undercarriage check", "speedometer": "speedometer test", "headlight_alignment": "headlight alignment",
    "examiner_review": "examiner review", "report": "report", "done": "finished",
    "headlamp_tint": "headlamps and tint",  # the earlier lane's combined step (older runs)
}


def station_of_step(step: str) -> int | None:
    """The station number (1-10) a lane step belongs to; None for check-in's neighbours outside the ten (examiner, report)."""
    for i, (_, _, _, steps) in enumerate(STATIONS, 1):
        if step in steps:
            return i
    return None
