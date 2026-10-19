"""Real data: a usage snapshot from the AxiomFlo API gives the same totals as the real pages.

sample-snapshot-golden.json is written by the web app's own code (src/reports/realData.ts
and src/lib/calculations.ts), via `npm run agent:fixtures`.
"""
from __future__ import annotations

import asyncio
import copy

import pytest

from axiomflo.agent.service import AgentService
from axiomflo.config import Settings
from axiomflo.reporting.calculations import summarize
from axiomflo.reporting.snapshot import InvalidSnapshot, load_snapshot, model_display_name

from .conftest import ScriptedModel, as_viewer, snapshot_ctx
from .test_calculation_parity import camel_to_snake

API = Settings(data_source="axiomflo_api")


def select(ws, period: str, scope_key: str):
    in_period = [c for c in ws.costed if c.local_date.startswith(period)]
    if scope_key == "company":
        return in_period
    kind, value = scope_key.split(":", 1)
    field = {"team": "team_id", "provider": "provider_id", "model": "model_id", "viewer": "principal_id"}[kind]
    return [c for c in in_period if getattr(c.record, field) == value]


def test_every_total_matches_the_real_pages(snapshot_raw, snapshot_golden):
    ws = load_snapshot(snapshot_raw)
    assert ws.periods == snapshot_golden["periods"]
    assert ws.currency == snapshot_golden["currency"] == "AUD"
    mismatches = []
    for row in snapshot_golden["rows"]:
        ours = summarize(select(ws, row["period"], row["scope"])).as_dict()
        for key, expected in row["summary"].items():
            actual = ours[camel_to_snake(key)]
            ok = actual == expected if expected is None or isinstance(expected, int) else actual == pytest.approx(expected, rel=0, abs=1e-9)
            if not ok:
                mismatches.append((row["scope"], row["period"], key, expected, actual))
    assert len(snapshot_golden["rows"]) >= 30
    assert mismatches == []


def test_model_names_match_the_web_app(snapshot_golden):
    assert {k: model_display_name(k) for k in snapshot_golden["modelNames"]} == snapshot_golden["modelNames"]


def test_month_without_a_rate_uses_the_latest_earlier_rate(snapshot_raw):
    ws = load_snapshot(snapshot_raw)
    assert ws.rate_missing_periods == ("2026-10",)
    assert "1.51 AUD per USD, the rate set for September 2026" in ws.currency_notes["2026-10"]
    usd = next(r for r in snapshot_raw["usage"][2]["records"] if r["estimatedCostUsd"] is not None)
    ours = next(c for c in ws.costed if c.record.id == usd["id"])
    assert ours.estimated_cost == usd["estimatedCostUsd"] * 1.51


def test_no_rate_at_all_keeps_amounts_in_usd(snapshot_raw):
    raw = copy.deepcopy(snapshot_raw)
    raw["exchangeRates"] = [{"month": "2026-09", "rate": 0.66, "currency": "EUR"}]  # wrong currency: ignored
    ws = load_snapshot(raw)
    assert ws.currency == "USD"
    assert set(ws.rate_missing_periods) == set(ws.periods)
    assert all("shown in USD" in n for n in ws.currency_notes.values())
    usd = snapshot_raw["usage"][0]["records"][0]
    assert next(c for c in ws.costed if c.record.id == usd["id"]).estimated_cost == usd["estimatedCostUsd"]


def test_missing_costs_stay_missing(snapshot_raw):
    ws = load_snapshot(snapshot_raw)
    missing = [c for c in ws.costed if c.record.cost_status == "unavailable"]
    assert missing and all(c.estimated_cost is None for c in missing)


def test_loaded_months_without_requests_are_still_valid(snapshot_raw):
    raw = copy.deepcopy(snapshot_raw)
    raw["usage"][2]["records"] = []
    ws = load_snapshot(raw)
    service = AgentService(API)
    out = service.call_tool(snapshot_ctx(ws), "get_cost_summary", snapshot=ws, period="2026-10")
    assert out["status"] == "ok" and out["figures"]["requests"] == 0


def test_months_outside_the_snapshot_say_what_is_available(snapshot_raw):
    ws = load_snapshot(snapshot_raw)
    out = AgentService(API).call_tool(snapshot_ctx(ws), "get_cost_summary", snapshot=ws, period="2026-03")
    assert out["error"]["code"] == "insufficient_data"
    assert "2026-08 to 2026-10" in out["error"]["message"]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: r.update(snapshotVersion=99),
        lambda r: r["viewer"].update(role="superuser"),
        lambda r: r.update(usage=[]),
        lambda r: r["usage"][0].update(month="August"),
        lambda r: r["usage"][0]["records"][0].pop("teamId"),
        lambda r: r["usage"][0]["records"][0].update(timestamp="yesterday"),
    ],
)
def test_malformed_snapshots_are_refused(snapshot_raw, mutate):
    raw = copy.deepcopy(snapshot_raw)
    mutate(raw)
    with pytest.raises(InvalidSnapshot):
        load_snapshot(raw)


def test_real_data_never_comes_from_fixtures(make_service, acme):
    service, _ = make_service(settings=API)
    from .conftest import ctx_for

    out = service.call_tool(ctx_for(acme, "u-maya"), "get_cost_summary", period="2026-09")
    assert out["error"]["code"] == "unavailable" and "No sample data was used" in out["error"]["message"]


def test_a_snapshot_only_serves_the_person_and_company_it_was_made_for(snapshot_raw):
    ws = load_snapshot(snapshot_raw)
    service = AgentService(API)
    other_person = snapshot_ctx(ws).__class__(ws.tenant_id, "uid-ben", "individual_user", ("team-platform",), "web", "test")
    with pytest.raises(ValueError):
        service.call_tool(other_person, "get_cost_summary", snapshot=ws, period="2026-10")
    other_company = snapshot_ctx(ws).__class__("another-co", "uid-ava", "company_admin", (), "web", "test")
    with pytest.raises(ValueError):
        service.call_tool(other_company, "get_cost_summary", snapshot=ws, period="2026-10")


def test_a_snapshot_lasts_for_one_request_only(snapshot_raw):
    ws = load_snapshot(snapshot_raw)
    service = AgentService(API)
    ctx = snapshot_ctx(ws)
    assert service.call_tool(ctx, "get_cost_summary", snapshot=ws, period="2026-10")["status"] == "ok"
    assert service.call_tool(ctx, "get_cost_summary", period="2026-10")["error"]["code"] == "unavailable"


def test_role_in_the_snapshot_must_match_the_verified_role(snapshot_raw):
    ws = load_snapshot(snapshot_raw)
    ctx = snapshot_ctx(ws).__class__(ws.tenant_id, "uid-ava", "individual_user", ("team-platform",), "web", "test")
    out = AgentService(API).call_tool(ctx, "get_cost_summary", snapshot=ws, period="2026-10")
    assert out["error"]["code"] == "access_denied"


@pytest.mark.parametrize("filter_records", [True, False])
def test_individual_users_only_see_their_own_requests(snapshot_raw, snapshot_golden, filter_records):
    raw = as_viewer(snapshot_raw, "uid-chloe", "individual_user", ["team-product"], filter_records=filter_records)
    ws = load_snapshot(raw)
    out = AgentService(API).call_tool(snapshot_ctx(ws), "get_cost_summary", snapshot=ws, period="2026-10")
    expected = next(r for r in snapshot_golden["rows"] if r["scope"] == "viewer:uid-chloe" and r["period"] == "2026-10")["summary"]
    assert out["figures"]["requests"] == expected["requestCount"]
    assert out["scope"]["visibility"] == "Individual User: only your own requests"


def test_individual_users_cannot_ask_about_another_team(snapshot_raw):
    ws = load_snapshot(as_viewer(snapshot_raw, "uid-chloe", "individual_user", ["team-product"], filter_records=False))
    out = AgentService(API).call_tool(snapshot_ctx(ws), "get_cost_summary", snapshot=ws, period="2026-10", team="Platform Engineering")
    assert out["error"]["code"] == "access_denied"


def test_the_agent_answers_from_the_snapshot_and_says_which_rate_it_used(snapshot_raw):
    ws = load_snapshot(snapshot_raw)
    model = ScriptedModel(
        steps=[
            {"call": "get_cost_summary", "args": {"period": "2026-10"}},
            {"text": lambda r: f"October 2026 estimated spend is {r[-1]['figures']['estimated_spend']} AUD. {r[-1]['reporting']['currency_notes'][0]}"},
        ],
        requests=[],
    )
    service = AgentService(API, model=model)
    answer = asyncio.run(service.ask(snapshot_ctx(ws), "What did we spend this month?", snapshot=ws))
    assert answer.status == "ok" and not answer.is_mock
    assert "$25.61" in answer.text and "rate set for September 2026" in answer.text


def test_the_model_cannot_label_real_figures_as_sample_data(snapshot_raw):
    ws = load_snapshot(snapshot_raw)
    model = ScriptedModel(
        steps=[
            {"call": "get_savings_suggestions", "args": {"period": "2026-10"}},
            {"text": "[Sample data] Nothing stands out for this period."},
        ],
        requests=[],
    )
    answer = asyncio.run(AgentService(API, model=model).ask(snapshot_ctx(ws), "How can we lower our AI spend?", snapshot=ws))
    assert answer.status == "ok" and not answer.is_mock
    assert answer.text == "Nothing stands out for this period."
