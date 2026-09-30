"""Flood watch: a synthetic district (and an approximate position) for every vehicle.

The synthetic vehicles only carry a state. Flood watch needs to know which river-level stations are near a vehicle,
so each vehicle gets a district of its state - drawn deterministically from its vehicle id, weighted by rough
population - and a position a few kilometres around the district's main town. Showcase-fleet vehicles (no state)
take their fleet's home branch. All of it is synthetic and labelled so in the apps.
"""
from __future__ import annotations

import hashlib
import logging

from sqlalchemy import select

from ..db import session_scope
from ..tables import Branch, Fleet, Vehicle, VehicleLocation

log = logging.getLogger("vhi.seed")

# District -> (lat, lon of its main town, rough population weight), named as JPS Public InfoBanjir names them.
# Approximate: good enough to place a district on a national map, not to navigate.
DISTRICTS: dict[str, dict[str, tuple[float, float, float]]] = {
    "Perlis": {"Kangar": (6.44, 100.20, 2), "Arau": (6.43, 100.27, 1), "Padang Besar": (6.66, 100.32, 0.5)},
    "Kedah": {"Kota Setar": (6.12, 100.37, 4), "Kuala Muda": (5.65, 100.49, 5), "Kubang Pasu": (6.43, 100.43, 2.5),
              "Kulim": (5.37, 100.56, 3), "Baling": (5.68, 100.92, 1.5), "Pendang": (5.99, 100.48, 1),
              "Yan": (5.80, 100.38, 0.7), "Sik": (5.81, 100.74, 0.7), "Padang Terap": (6.26, 100.62, 0.7),
              "Pokok Sena": (6.17, 100.52, 0.6), "Bandar Baharu": (5.13, 100.50, 0.5), "Langkawi": (6.33, 99.84, 1)},
    "Pulau Pinang": {"Timur Laut Pulau Pinang": (5.41, 100.32, 5.5), "Barat Daya Pulau Pinang": (5.33, 100.22, 2.5),
                     "Seberang Perai Utara": (5.47, 100.40, 3.5), "Seberang Perai Tengah": (5.36, 100.46, 4),
                     "Seberang Perai Selatan": (5.18, 100.48, 2)},
    "Perak": {"Kinta": (4.60, 101.09, 9), "Larut Matang dan Selama": (4.85, 100.74, 3.5), "Manjung": (4.22, 100.70, 2.5),
              "Kerian": (5.01, 100.54, 2), "Hilir Perak": (4.03, 101.03, 2), "Kuala Kangsar": (4.77, 100.94, 1.6),
              "Kampar": (4.31, 101.15, 1), "Muallim": (3.73, 101.50, 0.7), "Perak Tengah": (4.34, 100.93, 1),
              "Hulu Perak": (5.43, 101.13, 0.9), "Bagan Datuk": (3.99, 100.78, 0.7)},
    "Selangor": {"Petaling": (3.10, 101.58, 20), "Hulu Langat": (3.03, 101.79, 14), "Klang": (3.04, 101.45, 10),
                 "Gombak": (3.25, 101.64, 9), "Sepang": (2.85, 101.70, 3), "Kuala Langat": (2.82, 101.50, 3),
                 "Hulu Selangor": (3.56, 101.64, 2.5), "Kuala Selangor": (3.34, 101.25, 2.5),
                 "Sabak Bernam": (3.68, 100.99, 1.2)},
    "W.P. Kuala Lumpur": {"Kuala Lumpur": (3.14, 101.69, 1)},
    "W.P. Putrajaya": {"Putrajaya": (2.93, 101.69, 1)},
    "W.P. Labuan": {"Labuan": (5.28, 115.24, 1)},
    "Negeri Sembilan": {"Seremban": (2.73, 101.94, 7), "Port Dickson": (2.52, 101.80, 1.2), "Jempol": (2.81, 102.41, 1.2),
                        "Kuala Pilah": (2.74, 102.25, 0.7), "Tampin": (2.47, 102.23, 0.9), "Rembau": (2.59, 102.09, 0.5),
                        "Jelebu": (2.94, 102.07, 0.4)},
    "Melaka": {"Melaka Tengah": (2.20, 102.25, 5), "Alor Gajah": (2.38, 102.21, 2), "Jasin": (2.31, 102.43, 1.5)},
    "Johor": {"Johor Bahru": (1.49, 103.74, 15), "Kulai": (1.66, 103.60, 3), "Batu Pahat": (1.85, 102.93, 4.5),
              "Muar": (2.05, 102.57, 3), "Kluang": (2.03, 103.32, 3), "Pontian": (1.49, 103.39, 1.7),
              "Kota Tinggi": (1.73, 103.90, 2), "Segamat": (2.51, 102.82, 2), "Tangkak": (2.27, 102.55, 1.5),
              "Mersing": (2.43, 103.84, 0.8)},
    "Pahang": {"Kuantan": (3.81, 103.33, 5.5), "Temerloh": (3.45, 102.42, 1.7), "Bentong": (3.52, 101.91, 1.2),
               "Maran": (3.59, 102.77, 1.2), "Raub": (3.79, 101.86, 1), "Lipis": (4.18, 102.05, 0.9),
               "Jerantut": (3.94, 102.36, 0.9), "Pekan": (3.49, 103.39, 1.1), "Rompin": (2.81, 103.49, 1.1),
               "Bera": (3.23, 102.45, 1), "Cameron Highlands": (4.47, 101.38, 0.4)},
    "Terengganu": {"Kuala Terengganu": (5.33, 103.14, 2.5), "Kuala Nerus": (5.39, 103.08, 2), "Kemaman": (4.23, 103.42, 2),
                   "Dungun": (4.76, 103.42, 1.6), "Besut": (5.74, 102.52, 1.5), "Marang": (5.21, 103.21, 1),
                   "Hulu Terengganu": (5.07, 103.01, 0.8), "Setiu": (5.52, 102.74, 0.6)},
    "Kelantan": {"Kota Bharu": (6.13, 102.24, 5.5), "Pasir Mas": (6.05, 102.14, 2), "Tumpat": (6.20, 102.17, 1.7),
                 "Bachok": (6.07, 102.39, 1.4), "Pasir Puteh": (5.83, 102.40, 1.2), "Tanah Merah": (5.81, 102.15, 1.3),
                 "Machang": (5.77, 102.22, 1), "Kuala Krai": (5.53, 102.20, 1.1), "Gua Musang": (4.88, 101.97, 0.9),
                 "Jeli": (5.70, 101.84, 0.4)},
    "Sarawak": {"Kuching": (1.55, 110.35, 7), "Miri": (4.40, 113.99, 3.5), "Sibu": (2.29, 111.83, 2.7),
                "Bintulu": (3.17, 113.04, 2.2), "Samarahan": (1.46, 110.49, 1.7), "Serian": (1.17, 110.57, 1),
                "Sri Aman": (1.24, 111.46, 0.7), "Sarikei": (2.13, 111.52, 0.6), "Mukah": (2.90, 112.09, 0.5),
                "Kapit": (2.02, 112.94, 0.6), "Betong": (1.41, 111.53, 0.6), "Limbang": (4.75, 115.01, 0.5)},
    "Sabah": {"Kota Kinabalu": (5.98, 116.07, 5), "Tawau": (4.25, 117.89, 4), "Sandakan": (5.84, 118.12, 4),
              "Penampang": (5.92, 116.11, 1.3), "Putatan": (5.89, 116.06, 0.6), "Lahad Datu": (5.03, 118.33, 2),
              "Keningau": (5.34, 116.16, 1.8), "Papar": (5.73, 115.93, 1.4), "Tuaran": (6.18, 116.23, 1.1),
              "Kota Belud": (6.35, 116.43, 1), "Beaufort": (5.35, 115.75, 0.7), "Kudat": (6.88, 116.84, 0.8),
              "Ranau": (5.95, 116.66, 1), "Beluran": (5.89, 117.55, 1), "Kinabatangan": (5.58, 117.84, 1.5),
              "Tambunan": (5.67, 116.36, 0.4), "Tongod": (5.35, 116.95, 0.4)},
}
# JPS districts that are not places of registration: their stations count for the district the water flows into.
AREA_OF = {("W.P. Kuala Lumpur", "Bentong (WPKL)"): "Kuala Lumpur", ("W.P. Kuala Lumpur", "Gombak (WPKL)"): "Kuala Lumpur",
           ("W.P. Kuala Lumpur", "Hulu Langat (WPKL)"): "Kuala Lumpur", ("Kedah", "Pulau Langkawi"): "Langkawi"}


def area_of(state: str, district: str) -> str:
    return AREA_OF.get((state, district), district)


def centre(state: str, district: str) -> tuple[float, float] | None:
    d = DISTRICTS.get(state, {}).get(area_of(state, district))
    return (d[0], d[1]) if d else None


def unit(key: str) -> float:
    """A stable number in [0, 1) from a string: the same vehicle always lands in the same place."""
    return int(hashlib.sha256(key.encode()).hexdigest()[:12], 16) / 16 ** 12


def place(vehicle_id: str, state: str, near: tuple[float, float] | None = None) -> tuple[str, float, float] | None:
    ds = DISTRICTS.get(state)
    if not ds:
        return None
    if near is not None:  # a fleet vehicle: the district of its home branch
        name = min(ds, key=lambda d: (ds[d][0] - near[0]) ** 2 + (ds[d][1] - near[1]) ** 2)
    else:
        total = sum(w for _, _, w in ds.values())
        x, acc, name = unit(vehicle_id + ":district") * total, 0.0, next(iter(ds))
        for d, (_, _, w) in ds.items():
            acc += w
            if x < acc:
                name = d
                break
    lat, lon, _ = ds[name]
    # within ~6 km of the main town
    return name, round(lat + (unit(vehicle_id + ":lat") - 0.5) * 0.11, 4), round(lon + (unit(vehicle_id + ":lon") - 0.5) * 0.11, 4)


def seed_vehicle_locations() -> int:
    """Give every vehicle without a location one. Idempotent: only fills the missing ones."""
    with session_scope() as s:
        have = set(s.execute(select(VehicleLocation.vehicle_id)).scalars())
        branch_of = {f.fleet_id: f.branch_id for f in s.execute(select(Fleet)).scalars()}
        branches = {b.branch_id: b for b in s.execute(select(Branch)).scalars()}
        rows = []
        for v in s.execute(select(Vehicle)).scalars():
            if v.vehicle_id in have:
                continue
            state, near = v.state, None
            b = branches.get(branch_of.get(v.fleet_id or "", ""))
            if not state and b is not None:
                state, near = b.state, (b.lat, b.lon) if b.lat else None
            p = place(v.vehicle_id, state, near)
            if p is None:
                continue
            rows.append(dict(vehicle_id=v.vehicle_id, state=state, district=p[0], lat=p[1], lon=p[2]))
        if rows:
            s.bulk_insert_mappings(VehicleLocation, rows)
    if rows:
        log.info("vehicle locations (synthetic districts): %d", len(rows))
    return len(rows)
