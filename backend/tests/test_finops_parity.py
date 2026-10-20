"""The FinOps Scorecard matches the web app's on the demo workspace and the sample snapshot.

finops-golden.json is written by src/lib/finops.ts (npm run agent:fixtures).
"""
from __future__ import annotations

import json

import pytest

from axiomflo.config import DEFAULT_FIXTURES_DIR
from axiomflo.reporting.finops import build_scorecard, default_workflow_of, model_tier, price_list_rates
from axiomflo.reporting.snapshot import load_snapshot

from .test_calculation_parity import camel_to_snake, select as select_demo


@pytest.fixture(scope="module")
def finops_golden() -> dict:
    return json.loads((DEFAULT_FIXTURES_DIR / "finops-golden.json").read_text())


def options(ws):
    team_name = lambda c: (ws.team(c.record.team_id).name if ws.team(c.record.team_id) else c.record.team_code)  # noqa: E731
    return default_workflow_of(ws.applications.get, team_name), price_list_rates(ws.pricing_versions)


def select_snapshot(ws, period, scope):
    in_period = [c for c in ws.costed if c.local_date.startswith(period)]
    if scope == "company":
        return in_period
    uid = scope.split(":", 1)[1]
    return [c for c in in_period if c.record.principal_id == uid]


def close(expected, actual) -> bool:
    if expected is None or isinstance(expected, (str, list)) or (isinstance(expected, int) and isinstance(actual, int)):
        return expected == actual
    return actual is not None and actual == pytest.approx(expected, rel=0, abs=1e-9)


def compare(expected: dict, sc, where: str) -> list:
    bad = []

    def check(label, exp, act):
        if not close(exp, act):
            bad.append((where, label, exp, act))

    for key, exp in expected["economics"].items():
        check(f"economics.{key}", exp, getattr(sc.economics, camel_to_snake(key)))
    if expected["previousEconomics"] is None:
        check("previousEconomics", None, sc.previous_economics)
    else:
        for key, exp in expected["previousEconomics"].items():
            check(f"previous.{key}", exp, getattr(sc.previous_economics, camel_to_snake(key)))
    check("workflow order", [w["id"] for w in expected["workflows"]], [w.workflow.id for w in sc.workflows])
    for exp, w in zip(expected["workflows"], sc.workflows):
        check(f"workflow {w.workflow.id} label", exp["label"], w.workflow.label)
        check(f"workflow {w.workflow.id} kind", exp["kind"], w.workflow.kind)
        for key in ("requests", "spend", "inputSpend", "outputSpend"):
            check(f"workflow {w.workflow.id} {key}", exp[key], getattr(w, camel_to_snake(key)))
    check("lever order", [l["id"] for l in expected["levers"]], [l.id for l in sc.levers])
    for exp, l in zip(expected["levers"], sc.levers):
        for key in ("rank", "affectedRequests", "affectedSpend", "savings"):
            check(f"lever {l.id} {key}", exp[key], getattr(l, camel_to_snake(key)))
    check("combinedSavings", expected["combinedSavings"], sc.combined_savings)
    check("score", expected["score"], sc.score)
    check("grade", expected["grade"], sc.grade)
    for key, exp in expected["components"].items():
        check(f"component {key}", exp, sc.components[key])
    return bad


def test_demo_scorecards_match_the_web_app(acme, finops_golden):
    workflow_of, rate_of = options(acme)
    assert rate_of is not None
    rows = [r for r in finops_golden["rows"] if r["source"] == "demo"]
    assert len(rows) >= 10
    bad = []
    for row in rows:
        p = row["period"]
        prev = acme.periods[acme.periods.index(p) - 1] if acme.periods.index(p) > 0 else None
        sc = build_scorecard(select_demo(acme, p, row["scope"]), select_demo(acme, prev, row["scope"]) if prev else None, workflow_of, rate_of)
        bad += compare(row["scorecard"], sc, f"demo {row['scope']} {p}")
    assert bad == []


def test_snapshot_scorecards_match_the_real_page(snapshot_raw, finops_golden):
    ws = load_snapshot(snapshot_raw)
    workflow_of, rate_of = options(ws)
    assert rate_of is None
    rows = [r for r in finops_golden["rows"] if r["source"] == "snapshot"]
    assert len(rows) >= 6
    bad = []
    for row in rows:
        p = row["period"]
        i = ws.periods.index(p)
        sc = build_scorecard(select_snapshot(ws, p, row["scope"]), select_snapshot(ws, ws.periods[i - 1], row["scope"]) if i > 0 else None, workflow_of, rate_of)
        bad += compare(row["scorecard"], sc, f"snapshot {row['scope']} {p}")
    assert bad == []


def test_model_tiers():
    assert [model_tier(m) for m in ("claude-opus-5-5", "claude-sonnet-5-5", "gemini-3.1-pro", "claude-haiku-5-5", "gemini-3.5-flash", "other")] == [3, 2, 2, 1, 1, None]
