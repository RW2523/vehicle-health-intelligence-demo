"""Live public data fetcher for the PUSPAKOM VHI demo (run on the DGX Spark while it has internet).

Pulls every 15 minutes, writes timestamped JSON/parquet into ./cache/, and keeps the latest copy as ./latest/<feed>.json
so the demo keeps working offline. All sources are public Malaysian open data or public GitHub mirrors.

    pip install requests pandas pyarrow
    python fetch_live.py            # one pass
    python fetch_live.py --loop     # every 15 min
"""
import os, sys, json, time, datetime as dt, subprocess
import requests

API = "https://api.data.gov.my"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE, LATEST = os.path.join(HERE, "cache"), os.path.join(HERE, "latest")
os.makedirs(CACHE, exist_ok=True); os.makedirs(LATEST, exist_ok=True)

# Weather locations near demo branches (MET Malaysia location names used by the API)
BRANCH_TOWNS = ["Shah Alam", "Petaling", "Gombak", "Kuala Lumpur", "Klang", "Seremban", "Melaka", "Johor Bahru",
                "Kluang", "Ipoh", "Seberang Perai", "Alor Setar", "Kuantan", "Kota Bharu", "Kuala Terengganu",
                "Kuching", "Miri", "Kota Kinabalu"]

FEEDS = {
    "fuelprice": (f"{API}/data-catalogue", {"id": "fuelprice", "limit": 60, "sort": "-date"}),
    "weather_warning": (f"{API}/weather/warning", {"limit": 50}),
    "flood_warning": (f"{API}/flood-warning", {"limit": 2000}),  # JPS water-level stations (check timestamps: upstream can be stale)
}
# Large open-data files (parquet) published by data.gov.my; refreshed daily. Verify URLs in the data.gov.my catalogue.
PARQUET = {
    "registrations_car_2025": "https://storage.data.gov.my/transportation/cars_2025.parquet",
    "registrations_car_2026": "https://storage.data.gov.my/transportation/cars_2026.parquet",
}

def save(name, data):
    ts = dt.datetime.now().strftime("%Y%m%dT%H%M%S")
    payload = {"feed": name, "fetched_at": ts, "data": data}
    json.dump(payload, open(os.path.join(CACHE, f"{name}_{ts}.json"), "w"))
    json.dump(payload, open(os.path.join(LATEST, f"{name}.json"), "w"))

def fetch_json(url, params):
    r = requests.get(url, params=params, timeout=30); r.raise_for_status(); return r.json()

def one_pass():
    ok = {}
    for name, (url, params) in FEEDS.items():
        try: save(name, fetch_json(url, params)); ok[name] = True
        except Exception as e: ok[name] = f"ERR {e}"
    wx = {}
    for town in BRANCH_TOWNS:
        try: wx[town] = fetch_json(f"{API}/weather/forecast", {"contains": f"{town}@location__location_name", "limit": 7})
        except Exception as e: wx[town] = f"ERR {e}"
    save("weather_forecast_branches", wx); ok["weather_forecast_branches"] = True
    for name, url in PARQUET.items():
        dst = os.path.join(CACHE, f"{name}.parquet")
        if os.path.exists(dst) and time.time() - os.path.getmtime(dst) < 86400: continue
        try:
            r = requests.get(url, timeout=300); r.raise_for_status(); open(dst, "wb").write(r.content); ok[name] = True
        except Exception as e: ok[name] = f"ERR {e}"
    # Copart salvage sample repo is refreshed daily on GitHub (damage type incl. WATER/FLOOD, year, mileage, repair cost)
    repo = os.path.join(CACHE, "copart-dataset")
    try:
        if os.path.exists(repo): subprocess.run(["git", "-C", repo, "pull", "-q"], check=True, timeout=300)
        else: subprocess.run(["git", "clone", "-q", "--depth", "1", "https://github.com/rebrowser/copart-dataset.git", repo], check=True, timeout=600)
        ok["copart_daily"] = True
    except Exception as e: ok["copart_daily"] = f"ERR {e}"
    print(dt.datetime.now().isoformat(timespec="seconds"), ok)

if __name__ == "__main__":
    one_pass()
    while "--loop" in sys.argv:
        time.sleep(900); one_pass()
