"""The agent's Upgrade Analysis matches the web app's, figure for figure and word for word.

upgrade-golden.json is written by src/lib/upgradeGolden.ts (npm run agent:fixtures) from the
TypeScript engine every Upgrade Analysis page uses.
"""
from __future__ import annotations

import json
import math

import pytest

from axiomflo.config import DEFAULT_FIXTURES_DIR
from axiomflo.reporting.snapshot import load_snapshot
from axiomflo.reporting.upgrade import estimate_upgrade, money, parse_estimate_request, pct, signed_money, summary_lines

GOLDEN = json.loads((DEFAULT_FIXTURES_DIR / "upgrade-golden.json").read_text())


def context(key: str) -> dict:
    c = GOLDEN["contexts"][key]
    cols = c["records"]["columns"]
    records = [dict(zip(cols, row)) for row in c["records"]["rows"]]
    regions = c["regions"]
    return {
        "catalogue": c["catalogue"],
        "records": records,
        "scopes": c["scopes"],
        "company_label": c["companyLabel"],
        "currency": c["currency"],
        "today": c["today"],
        "now": c["now"],
        "region_of": lambda p: regions.get(p),
    }


def diff(expected, actual, path="") -> list[str]:
    if isinstance(expected, dict):
        if not isinstance(actual, dict) or set(expected) != set(actual):
            return [f"{path}: keys {sorted(expected) if isinstance(expected, dict) else expected} != {sorted(actual) if isinstance(actual, dict) else actual}"]
        return [d for k in expected for d in diff(expected[k], actual[k], f"{path}.{k}")]
    if isinstance(expected, list):
        if not isinstance(actual, list) or len(expected) != len(actual):
            return [f"{path}: {expected!r} != {actual!r}"]
        return [d for i, (e, a) in enumerate(zip(expected, actual)) for d in diff(e, a, f"{path}[{i}]")]
    if isinstance(expected, (int, float)) and not isinstance(expected, bool) and isinstance(actual, (int, float)) and not isinstance(actual, bool):
        return [] if math.isclose(expected, actual, rel_tol=1e-12, abs_tol=1e-12) else [f"{path}: {expected!r} != {actual!r}"]
    return [] if expected == actual else [f"{path}: {expected!r} != {actual!r}"]


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=[c["name"] for c in GOLDEN["cases"]])
def test_matches_the_web_app(case):
    request = parse_estimate_request(case["body"])
    analysis = estimate_upgrade(request, **context(case["context"]))
    assert diff(case["analysis"], analysis) == []
    assert summary_lines(analysis) == case["summary"]


def test_every_recommendation_class_is_covered():
    classes = {c["analysis"]["recommendation"]["classification"] for c in GOLDEN["cases"]}
    assert classes == {"strongly_recommended", "recommended_with_validation", "conditional", "not_recommended", "insufficient_data"}


def test_formats_money_like_the_web_app():
    assert money(1234.567, "AUD") == "$1,234.57"
    assert money(-1.235, "AUD") == "-$1.24"
    assert money(0.005, "USD", True) == "USD 0.0050"
    assert signed_money(-1.235, "AUD") == "−$1.24"
    assert pct(0.125, 1) == "12.5%"
    assert money(None, "AUD") == "Not available"


@pytest.mark.parametrize("case", GOLDEN["snapshotCases"], ids=[c["name"] for c in GOLDEN["snapshotCases"]])
def test_matches_the_web_app_on_the_live_snapshot(case, snapshot_raw):
    """The live path: the upgrade block the API sends, read by load_snapshot."""
    u = load_snapshot(snapshot_raw).upgrade
    analysis = estimate_upgrade(
        parse_estimate_request(case["body"]),
        catalogue=u["catalogue"], records=u["records"], scopes=u["scopes"], company_label=u["companyLabel"],
        currency=u["currency"], today=u["today"], now=GOLDEN["snapshotNow"],
    )
    assert diff(case["analysis"], analysis) == []
    assert summary_lines(analysis) == case["summary"]


def test_live_cases_cover_every_model_in_use(snapshot_raw):
    observed = {r["modelId"] for r in load_snapshot(snapshot_raw).upgrade["records"]}
    assert {c["body"]["currentModelId"] for c in GOLDEN["snapshotCases"]} == observed
