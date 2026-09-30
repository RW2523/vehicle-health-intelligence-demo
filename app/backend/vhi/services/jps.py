"""JPS Public InfoBanjir (publicinfobanjir.water.gov.my): river levels and rainfall for every state, read from the
same HTML tables the public site shows. Fetched in parallel with httpx; ``http_get`` is the one place that touches
the network, so tests replace it."""
from __future__ import annotations

import datetime as dt
import html
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

BASE = "https://publicinfobanjir.water.gov.my"
WL_URL = BASE + "/aras-air/data-paras-air/aras-air-data/?state={code}&district=ALL&station=ALL&lang=en"
RF_URL = (BASE + "/wp-content/themes/shapely/agency/searchresultrainfall.php?state={code}&district=ALL&station=ALL"
          "&loginStatus=0&language=1")
HIST_URL = BASE + "/wp-content/themes/enlighten/query/getwaterlevellast7dayslead.php?extra=&station={graph}"
PAGE_URL = BASE + "/aras-air/data-paras-air/?state={code}&lang=en"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# The state select on the JPS page (its "Mockup/Pengujian" test entry left out), named as the vehicles table names them.
STATES = {"PLS": "Perlis", "KDH": "Kedah", "PNG": "Pulau Pinang", "PRK": "Perak", "SEL": "Selangor",
          "WLH": "W.P. Kuala Lumpur", "PTJ": "W.P. Putrajaya", "NSN": "Negeri Sembilan", "MLK": "Melaka",
          "JHR": "Johor", "PHG": "Pahang", "TRG": "Terengganu", "KEL": "Kelantan", "SRK": "Sarawak", "SAB": "Sabah",
          "WLP": "W.P. Labuan"}

_client: httpx.Client | None = None


def http_get(url: str) -> str:
    global _client
    if _client is None:
        _client = httpx.Client(headers={"User-Agent": UA}, follow_redirects=True,
                               timeout=httpx.Timeout(25.0, connect=8.0), limits=httpx.Limits(max_connections=6))
    r = _client.get(url)
    r.raise_for_status()
    return r.text


def _text(cell: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", cell)).strip()


def _num(s: str) -> float | None:
    try:
        v = float(s.replace(",", ""))
    except (ValueError, AttributeError):
        return None
    return None if v <= -9999 else v


def _when(s: str) -> str | None:
    """"01/10/2026 00:45" (Malaysia time) -> "2026-10-01T00:45"."""
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M"):
        try:
            return dt.datetime.strptime(s.strip(), fmt).isoformat(timespec="minutes")
        except ValueError:
            pass
    return None


ROW = re.compile(r"<tr\s+class='item'>(.*?)</tr>", re.S)
CELL = re.compile(r"<td([^>]*)>(.*?)</td>", re.S)


def parse_levels(page: str, code: str) -> list[dict]:
    """One state's water-level table: No. | Station ID | Station Name | District | Main Basin | Sub River Basin |
    Last Updated | Water Level (m) | Normal | Alert | Warning | Danger."""
    out = []
    for row in ROW.findall(page):
        cells = [_text(c) for _, c in CELL.findall(row)]
        if len(cells) < 12:
            continue
        graph = re.search(r"stationid=([^'\"&]+)", row)
        # The Station ID column is blank or repeated for some stations; the id of the station's graph page is unique.
        key = graph.group(1) if graph else cells[1] or f"{code}:{cells[2]}"
        out.append({
            "id": key, "station_no": cells[1], "graph": graph.group(1) if graph else None, "name": cells[2], "district": cells[3],
            "state": STATES[code], "code": code, "basin": cells[4], "river": cells[5], "updated": _when(cells[6]),
            "level": _num(cells[7]), "normal": _num(cells[8]), "alert": _num(cells[9]), "warning": _num(cells[10]),
            "danger": _num(cells[11]),
        })
    return out


def parse_rain(page: str, code: str) -> list[dict]:
    """One state's rainfall table: No. | Station ID | Station | District | Last Updated | six days of daily rainfall |
    rainfall since midnight | the last hour. -9999 means no reading."""
    days = [d for d in (_when(x + " 00:00") for x in re.findall(r"<th[^>]*>\s*(\d{2}/\d{2}/\d{4})\s*</th>", page)) if d]
    today = re.search(r"from Midnight \((\d{2}/\d{2}/\d{4})\)", page)
    if today:
        days.append(_when(today.group(1) + " 00:00"))
    days = [d[:10] for d in days]
    out = []
    for chunk in page.split("<td data-th='No'>")[1:]:
        cells = [_text(c) for _, c in CELL.findall("<td data-th='No'>" + chunk)]
        if len(cells) < 12:
            continue
        vals = [_num(c) for c in cells[5:12]]
        updated = _when(cells[4])
        daily = dict(zip(days, vals)) if len(days) == 7 else {}
        if daily and (not updated or updated[:10] < days[-1]):
            daily[days[-1]] = None  # a gauge that has not reported today repeats its last day under "since midnight"
        out.append({"id": cells[1], "name": cells[2], "district": cells[3], "state": STATES[code], "code": code,
                    "updated": updated, "daily": daily, "hour": _num(cells[12]) if len(cells) > 12 else None})
    return out


def rain_by_district(gauges: list[dict]) -> list[dict]:
    """Rain gauges summed up per district: the wettest gauge's total for each day, and the wettest day."""
    out: dict[tuple[str, str], dict] = {}
    for g in gauges:
        d = out.setdefault((g["code"], g["district"]), {"state": g["state"], "code": g["code"], "district": g["district"],
                                                        "gauges": 0, "daily": {}, "max_mm": None, "max_day": None,
                                                        "max_gauge": None, "hour_mm": None, "updated": None})
        d["gauges"] += 1
        for day, mm in g["daily"].items():
            if mm is None:
                continue
            d["daily"][day] = max(mm, d["daily"].get(day, 0.0))
            if d["max_mm"] is None or mm > d["max_mm"]:
                d.update(max_mm=mm, max_day=day, max_gauge=g["name"])
        if g.get("hour") is not None:
            d["hour_mm"] = max(g["hour"], d["hour_mm"] or 0.0)
        if g.get("updated") and (d["updated"] is None or g["updated"] > d["updated"]):
            d["updated"] = g["updated"]
    return list(out.values())


def fetch_all(workers: int = 6) -> dict:
    """Every state's river levels and rainfall, fetched in parallel. States that fail are listed in ``errors``."""
    jobs = {(code, kind): (WL_URL if kind == "levels" else RF_URL).format(code=code)
            for code in STATES for kind in ("levels", "rain")}
    stations: list[dict] = []
    rain: list[dict] = []
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(http_get, url): key for key, url in jobs.items()}
        for f in as_completed(futs):
            code, kind = futs[f]
            try:
                page = f.result()
                rows = parse_levels(page, code) if kind == "levels" else parse_rain(page, code)
            except Exception as e:  # noqa: BLE001 - one state failing must not lose the others
                errors[f"{code}:{kind}"] = f"{type(e).__name__}: {str(e)[:100]}"
                continue
            (stations if kind == "levels" else rain).extend(rows)
    order = list(STATES)
    stations.sort(key=lambda s: (order.index(s["code"]), s["district"], s["name"]))
    rain = sorted(rain_by_district(rain), key=lambda d: (order.index(d["code"]), d["district"]))
    return {"fetched_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).replace(tzinfo=None).isoformat(timespec="seconds"),
            "stations": stations, "rain": rain, "errors": errors,
            "source": BASE + "/aras-air/data-paras-air/ (all states) and /hujan/data-hujan/"}


REGISTRY_URL = "https://api.data.gov.my/flood-warning"


def _norm(name: str) -> str:
    n = re.sub(r"\(.*?(\)|$)", " ", (name or "").lower()).replace("sungai", "sg").replace(" at ", " di ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", n).split())


def station_coords(stations: list[dict], registry: list[dict], centre, max_deg: float = 1.3) -> dict[str, list[float]]:
    """Coordinates for the JPS stations from the JPS station list that data.gov.my publishes (its readings are stale,
    its station positions mostly are not): matched on the graph id, the station code, then the name within the state.
    Positions shared by several stations (placeholders) or far from the station's district are dropped."""
    reg = [r for r in registry if r.get("latitude") and r.get("longitude")]
    shared: dict[tuple, set] = {}
    for r in reg:
        shared.setdefault((round(r["latitude"], 4), round(r["longitude"], 4)), set()).add(r.get("station_name"))
    reg = [r for r in reg if len(shared[(round(r["latitude"], 4), round(r["longitude"], 4))]) < 3]
    by_id = {r["station_id"]: r for r in reg}
    by_code = {r["station_code"]: r for r in reg if r.get("station_code")}
    by_name: dict[tuple[str, str], dict] = {}
    for r in reg:
        by_name.setdefault(((r.get("state") or "").upper(), _norm(r.get("station_name"))), r)
    out = {}
    for s in stations:
        state = {"W.P. Kuala Lumpur": "WILAYAH PERSEKUTUAN KUALA LUMPUR", "W.P. Labuan": "WILAYAH PERSEKUTUAN LABUAN",
                 "W.P. Putrajaya": "WILAYAH PERSEKUTUAN PUTRAJAYA"}.get(s["state"], s["state"].upper())
        n = _norm(s["name"])
        r = (by_id.get(s.get("graph")) or by_code.get(s.get("station_no")) or by_code.get(s.get("graph"))
             or by_name.get((state, n)))
        if r is None and len(n.split()) >= 2:  # "Sg. Kuah di Kuah (F2)" is "Sg. Kuah" in the list
            r = next((c for (st, cn), c in by_name.items() if st == state and len(cn.split()) >= 2
                      and (n.startswith(cn + " ") or cn.startswith(n + " "))), None)
        if r is None:
            continue
        lat, lon = float(r["latitude"]), float(r["longitude"])
        c = centre(s["state"], s["district"])
        if c is None or ((lat - c[0]) ** 2 + (lon - c[1]) ** 2) ** 0.5 <= max_deg:
            out[s["id"]] = [round(lat, 5), round(lon, 5)]
    return out


def station_history(graph: str) -> list[dict]:
    """A station's last 7 days from the JPS graph page (5-minute readings), thinned to one per hour."""
    data = json.loads(http_get(HIST_URL.format(graph=graph)))
    out, seen = [], set()
    for v in data.get("values", []):
        t = _when(v.get("dt", ""))
        lvl = _num(str(v.get("clean")))
        if not t or lvl is None or t[:13] in seen:
            continue
        seen.add(t[:13])
        out.append({"t": t, "level": lvl})
    return out


SNAPSHOT, STATIONS = "jps_water_levels.json", "jps_stations.json"


def write_snapshots(folder: Path, data: dict | None = None, registry: list[dict] | None = None) -> dict:
    """Refresh the committed snapshots the demo falls back to offline (``python -m vhi.services.jps``): every state's
    river levels and rainfall, and the station positions."""
    from ..seed.floodwatch import centre

    data = data or fetch_all()
    if registry is None:
        registry = httpx.get(REGISTRY_URL, params={"limit": 3000}, headers={"User-Agent": UA}, timeout=40).json()
    snap = {"source": data["source"], "captured": data["fetched_at"],
            "note": "Real JPS Public InfoBanjir readings, used when the site cannot be reached.",
            **{k: data[k] for k in ("fetched_at", "stations", "rain", "errors")}}
    coords = station_coords(data["stations"], registry, centre)
    pos = {"source": REGISTRY_URL, "captured": data["fetched_at"][:10],
           "note": "Station positions from the JPS station list on data.gov.my, matched to the InfoBanjir stations by "
                   "id or name; placeholder positions and positions far from the station's district left out.",
           "coords": coords}
    (folder / SNAPSHOT).write_text(json.dumps(snap, separators=(",", ":"), ensure_ascii=False))
    (folder / STATIONS).write_text(json.dumps(pos, separators=(",", ":")))
    return {"stations": len(data["stations"]), "rain_districts": len(data["rain"]), "with_position": len(coords),
            "errors": data["errors"]}


if __name__ == "__main__":
    from ..config import get_settings

    print(write_snapshots(get_settings().assets_dir / "web_snapshots"))
