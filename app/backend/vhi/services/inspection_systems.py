"""PUSPAKOM's own AI inspection systems, as announced publicly (see SOURCES). VehicleSense does not replace them: it
collects their results into the inspection record next to the lane's other evidence, for the examiner to decide.

The systems are not connected in this demo, so their results arrive as a "demo feed": the stand-in image models in
vhi.ml.vision play them, and every result says so.
"""
from __future__ import annotations

SOURCES = [
    "https://www.motaauto.com/puspakom-showcases-malaysias-first-ai-assisted-inspection-technology/",
    "https://newswav.com/article/puspakom-just-unveiled-an-ai-scanner-that-cuts-vehicle-inspection-times-fro-A2608_DdMvpS",
]

SYSTEMS = {
    "undercarriage": {
        "name": "Undercarriage AI",
        "by": "PUSPAKOM with Keymag Sdn Bhd",
        "status": "in_service",
        "status_text": "In service on PUSPAKOM's Mobile Truck Service (commercial vehicles)",
        "detects": ["structural damage", "chassis corrosion", "engine and transmission oil leaks", "brake system faults",
                    "axle defects"],
        "note": "Scans the undercarriage in about 1 minute instead of about 10 by hand; the examiner makes the final call.",
    },
    "astra": {
        "name": "Project ASTRA",
        "by": "PUSPAKOM with Universiti Tun Hussein Onn Malaysia (UTHM)",
        "status": "in_development",
        "status_text": "In development: above-carriage AI inspection, announced for the next 24 months",
        "detects": ["above-carriage condition: body panels, previous repairs, lamps, cabin"],
        "note": "Above-carriage counterpart of the undercarriage scanner.",
    },
    "tyre": {
        "name": "AI tyre scan",
        "by": "PUSPAKOM",
        "status": "in_development",
        "status_text": "In development: announced for the next 24 months",
        "detects": ["tread depth", "sidewall damage"],
        "note": "Automated tread and sidewall checks in place of manual gauge readings.",
    },
    "examiner": {
        "name": "Examiner close-up",
        "by": "Lane examiner",
        "status": "manual",
        "status_text": "Photo taken by the examiner, findings marked by hand",
        "detects": [],
        "note": "Not an AI system: close-up photos kept with the inspection record.",
    },
}


def for_capture(case: dict) -> str:
    """Which system a sample capture stands for, from its categories."""
    cats = set(case.get("cats") or [])
    if "under" in cats:
        return "undercarriage"
    if "tyres" in cats:
        return "tyre"
    if case.get("group") == "close":
        return "examiner"
    return "astra"


def for_frame(kind: str, task: str | None = None) -> str:
    """Which system a lane camera frame comes from: pit frames from the undercarriage scanner, tyre frames from the
    tyre scan, body and cabin frames from ASTRA."""
    if task == "tyre" or kind == "tyre":
        return "tyre"
    return "undercarriage" if kind == "undercarriage" else "astra"


def label(system: str) -> str:
    s = SYSTEMS[system]
    return f"{s['name']} ({s['by']})"


def catalogue() -> dict:
    return {"systems": [{"id": k, **v} for k, v in SYSTEMS.items()], "sources": SOURCES,
            "feed": "Demo feed: stand-in image models play these systems' results until the systems are connected."}
