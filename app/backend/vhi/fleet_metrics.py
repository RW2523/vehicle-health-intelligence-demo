"""Condition metrics tracked month by month for fleet vehicles, with their fail limits.

Limits follow the inspection thresholds used in the demo (illustrative, not an official standard).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Metric:
    key: str
    name: str
    unit: str
    limit: float
    up: bool  # True = the value rises towards the limit
    system: str
    icon: str
    action: str


SYSTEMS = ["Brakes", "Tyres", "Suspension", "Engine & emissions", "Lights & body", "ADAS & electrics"]

METRICS: dict[str, Metric] = {m.key: m for m in [
    Metric("brake_imbalance", "Front brake imbalance", "%", 30, True, "Brakes", "brake",
           "strip and service the front calipers, fit matched pads, re-test on the roller brake tester"),
    Metric("pad_thickness", "Front pad thickness", "mm", 3.0, False, "Brakes", "pad",
           "replace the front pads at the next scheduled service"),
    Metric("tread_depth", "Tread depth, worst tyre", "mm", 1.6, False, "Tyres", "tyre",
           "replace the worn tyre and check wheel alignment"),
    Metric("damping", "Rear damping (EUSAMA)", "%", 40, False, "Suspension", "spring",
           "replace both rear shock absorbers and check the bushes"),
    Metric("vibration", "Underbody vibration at idle", "mm/s", 7.1, True, "Suspension", "vib",
           "replace corroded exhaust brackets and heat-shield clips"),
    Metric("hc_idle", "HC at idle", "ppm", 600, True, "Engine & emissions", "smoke",
           "run an injector balance test and compression check before the emissions test"),
    Metric("smoke_opacity", "Smoke opacity", "%", 50, True, "Engine & emissions", "smoke",
           "service the injectors and check the DPF before the smoke test"),
    Metric("oil_loss", "Oil loss rate", "ml/1,000 km", 250, True, "Engine & emissions", "oil",
           "replace the sump gasket and check the rear main seal"),
    Metric("headlamp_output", "Headlamp output", "% of spec", 70, False, "Lights & body", "lamp",
           "restore or replace the headlamp lens and re-aim both lamps"),
    Metric("rust_area", "Corroded area, rocker / arch", "cm²", 25, True, "Lights & body", "rust",
           "treat and seal the corrosion before it reaches structural metal"),
    Metric("crack_length", "Windscreen crack length", "mm", 150, True, "Lights & body", "crack",
           "replace the windscreen, then recalibrate the ADAS camera"),
    Metric("adas_yaw", "ADAS camera yaw offset", "°", 1.0, True, "ADAS & electrics", "cam",
           "recalibrate the forward camera at a panel ADAS bay"),
    Metric("cranking_v", "Minimum cranking voltage (12 V)", "V", 9.6, False, "ADAS & electrics", "batt",
           "replace the 12 V battery at the next service"),
    Metric("cranking_v24", "Minimum cranking voltage (24 V)", "V", 19.2, False, "ADAS & electrics", "batt",
           "replace the 24 V battery pair at the next service"),
]}


def base_metrics(fuel: str, heavy: bool) -> list[str]:
    """The six metrics every fleet vehicle reports, one per subsystem."""
    engine = "smoke_opacity" if fuel == "diesel" else ("cranking_v" if fuel == "ev" else "hc_idle")
    batt = "cranking_v24" if heavy else "cranking_v"
    out = ["brake_imbalance", "tread_depth", "damping", "headlamp_output", batt]
    if engine not in out:
        out.insert(3, engine)
    else:  # EVs: no tailpipe metric, track underbody vibration instead
        out.insert(3, "vibration")
    return out
