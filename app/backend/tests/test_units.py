"""Unit tests for pure logic: degradation, plate grammar, topic matching, hash chain."""
import datetime as dt

from vhi.bus import topic_matches
from vhi.fleet_metrics import METRICS
from vhi.ml.degradation import Point, analyse
from vhi.ml.ocr import parse_plate
from vhi.seed.fleet import HEROES, month_date
from vhi.services.evidence import chain_hash, sha256_text


def _run(h):
    pts = [Point(i, month_date(i), float(x), h.get("events", {}).get(i, "")) for i, x in enumerate(h["v"])]
    return analyse(pts, METRICS[h["metric"]], h["kmpm"], dt.date(2026, 9, 25))


def test_degradation_patterns_match_design():
    expected = {"VKR 3128": ("Accelerating", "High"), "WXD 2291": ("Accelerating", "High"),
                "BHY 7783": ("Spike, then faster rise", "Medium"), "VCC 8841": ("Steady wear", "Medium"),
                "PKE 4410": ("Step change", "Medium"), "BPR 7730": ("New damage, growing", "Medium"),
                "WVA 1209": ("Steady wear", "Low")}
    for h in HEROES:
        if h["plate"] in expected:
            r = _run(h)
            assert (r["pattern"], r["risk"]) == expected[h["plate"]], h["plate"]


def test_degradation_forecast_and_context():
    r = _run(next(h for h in HEROES if h["plate"] == "VKR 3128"))
    assert 3 <= r["forecast"]["weeks_to_limit"] <= 6
    assert r["forecast"]["range_weeks"][0] < r["forecast"]["weeks_to_limit"] < r["forecast"]["range_weeks"][1]
    a = next(x for x in r["anomalies"] if x["kind"] == "rate_change")
    assert "non-panel workshop" in a["context"]


def test_degradation_repair_resets_series():
    pts = [Point(i, month_date(i), v) for i, v in enumerate([6, 5.4, 4.8, 4.1, 3.5, 2.9, 2.3, 8.0, 7.6, 7.3, 6.9, 6.6])]
    r = analyse(pts, METRICS["tread_depth"], 3000, dt.date(2026, 9, 25))
    assert any(a["kind"] == "repair" for a in r["anomalies"]) and r["risk"] == "Low"


def test_plate_grammar():
    assert parse_plate("DM0 9001") == "DMO 9001"
    assert parse_plate("QTD6957") == "QTD 6957"
    assert parse_plate("W1234A") == "W 1234A"
    assert parse_plate("12345") is None


def test_topics():
    assert topic_matches("lane/#", "lane/BR00-L3/enose")
    assert topic_matches("lane/+/enose", "lane/BR00-L3/enose")
    assert not topic_matches("lane/+/obd", "lane/BR00-L3/enose")


def test_chain_hash_depends_on_everything():
    base = chain_hash("0" * 64, "t", "k", "i", sha256_text("{}"))
    assert base != chain_hash("1" + "0" * 63, "t", "k", "i", sha256_text("{}"))
    assert base != chain_hash("0" * 64, "t", "k", "i", sha256_text('{"a":1}'))


def test_every_hero_primary_issue_is_its_designed_metric(client):
    for h in HEROES:
        d = client.get(f"/api/fleet/vehicles/{h['plate']}").json()
        assert d["primary"]["metric"] == h["metric"], h["plate"]
