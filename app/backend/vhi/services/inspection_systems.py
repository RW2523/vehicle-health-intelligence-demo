"""The platform's AI inspection modules: an undercarriage scanner, above-carriage cameras and a tyre scanner, each with
its own AI model (run by vhi.ml.vision). Every image result says which module and model found it, in the lane console,
on the AI vision page and in the findings, next to the examiner's close-up photos kept with the record.

The model names are the ones the inspection body uses: Keymag's AI undercarriage inspection and ASTRA for the
above-carriage. The laser tyre inspection system is at proof of concept, so it is shown as coming next.
"""
from __future__ import annotations

SYSTEMS = {
    "undercarriage": {
        "name": "Undercarriage AI",
        "detects": ["underbody and chassis corrosion"],
        "model": "Keymag AI Undercarriage Inspection",
        "note": "Pit cameras scan the underside while the vehicle crosses the pit.",
    },
    "above": {
        "name": "Above-carriage AI",
        "detects": ["body damage and previous repairs", "cabin corrosion, a sign of flooding"],
        "model": "ASTRA",
        "note": "Cameras around and inside the vehicle.",
    },
    "tyre": {
        "name": "Tyre AI",
        "detects": ["tyre cracks, uneven wear and damage"],
        "model": "AI Tyre Scan",
        "note": "A tyre scanner images each wheel as it rolls through.",
        # the next tyre model: in development, so it is labelled as such wherever it is named
        "next": {"model": "Laser Tyre Inspection System", "detects": "tread depth and tyre integrity, measured automatically by laser",
                 "stage": "Proof of concept"},
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


def model_label(system: str | None) -> str | None:
    """The module and its AI model, as a finding or a photo names them: "Above-carriage AI · ASTRA"."""
    s = SYSTEMS.get(system or "")
    if not s or not s.get("model"):
        return s["name"] if s else None
    return f"{s['name']} · {s['model']}"


def catalogue() -> dict:
    return {"systems": [{"id": k, **v} for k, v in SYSTEMS.items()]}
