"""The platform's AI inspection modules: an undercarriage scanner, above-carriage cameras and a tyre scanner, each with
its own image model (vhi.ml.vision). Every image result says which module found it, in the lane console and on the AI
vision page, next to the examiner's close-up photos kept with the record.
"""
from __future__ import annotations

SYSTEMS = {
    "undercarriage": {
        "name": "Undercarriage AI",
        "detects": ["underbody and chassis corrosion"],
        "model": "corrosion segmentation, calibrated on rust vs clean photos",
        "note": "Pit cameras scan the underside while the vehicle crosses the pit.",
    },
    "above": {
        "name": "Above-carriage AI",
        "detects": ["body damage and previous repairs", "cabin corrosion, a sign of flooding"],
        "model": "YOLO11 image classifier (normal / breakage / crushed) and corrosion segmentation",
        "note": "Cameras around and inside the vehicle.",
    },
    "tyre": {
        "name": "Tyre AI",
        "detects": ["tyre cracks, uneven wear and damage"],
        "model": "YOLO11 image classifier (good / defective)",
        "note": "A tyre scanner images each wheel as it rolls through.",
    },
    "examiner": {
        "name": "Examiner close-up",
        "detects": [],
        "model": None,
        "note": "Close-up photos taken by the examiner, findings marked by hand.",
    },
}


def for_capture(case: dict) -> str:
    """Which module a sample capture comes from, from its categories."""
    cats = set(case.get("cats") or [])
    if "under" in cats:
        return "undercarriage"
    if "tyres" in cats:
        return "tyre"
    if case.get("group") == "close":
        return "examiner"
    return "above"


def for_frame(kind: str, task: str | None = None) -> str:
    """Which module a lane camera frame comes from: pit frames from the undercarriage scanner, tyre frames from the
    tyre scanner, body and cabin frames from the above-carriage cameras."""
    if task == "tyre" or kind == "tyre":
        return "tyre"
    return "undercarriage" if kind == "undercarriage" else "above"


def label(system: str) -> str:
    return SYSTEMS[system]["name"]


def catalogue() -> dict:
    return {"systems": [{"id": k, **v} for k, v in SYSTEMS.items()]}
