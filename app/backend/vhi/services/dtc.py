"""OBD-II diagnostic trouble code descriptions (curated SAE dictionary + the extended codes the demo uses)."""
from __future__ import annotations

import csv
from functools import lru_cache

from ..config import get_settings

# SAE J2012 generic definitions for codes missing from the curated P0/P1 dictionary.
EXTRA = {
    "P2002": ("Diesel particulate filter efficiency below threshold (bank 1)", "Engine & emissions", "high"),
    "P20EE": ("SCR NOx catalyst efficiency below threshold (bank 1)", "Engine & emissions", "high"),
    "P2BAD": ("NOx exceedance - root cause unknown", "Engine & emissions", "high"),
    "U0100": ("Lost communication with ECM/PCM 'A'", "EV battery & electrics", "medium"),
    "P0AA6": ("Hybrid/EV battery voltage system isolation fault", "EV battery & electrics", "high"),
    "P0300": ("Random/multiple cylinder misfire detected", "Engine & emissions", "medium"),
}


@lru_cache(maxsize=1)
def dictionary() -> dict[str, str]:
    p = get_settings().data_dir / "sensors/obd/dtc_codes.csv"
    out: dict[str, str] = {}
    if p.exists():
        with open(p, newline="", encoding="utf-8", errors="ignore") as f:
            for row in csv.reader(f):
                if len(row) >= 2:
                    out[row[0].strip()] = row[1].strip()
    return out


def describe(code: str) -> dict:
    code = code.strip().upper()
    if code in EXTRA:
        d, system, sev = EXTRA[code]
        return {"code": code, "description": d, "system": system, "severity": sev, "source": "SAE J2012"}
    d = dictionary().get(code)
    system = "EV battery & electrics" if code.startswith(("U", "P0A", "P0B")) else "Engine & emissions"
    return {"code": code, "description": d or "Manufacturer-specific code", "system": system,
            "severity": "medium", "source": "curated OBD dictionary" if d else "unknown"}
