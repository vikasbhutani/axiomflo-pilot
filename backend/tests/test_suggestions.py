"""Savings suggestions: worked out by fixed rules, scoped like every other figure."""
from __future__ import annotations

import asyncio
import copy

from axiomflo.agent.service import AgentService
from axiomflo.config import Settings
from axiomflo.reporting.snapshot import load_snapshot
from axiomflo.reporting.suggestions import is_premium_model

from .conftest import ScriptedModel, as_viewer, ctx_for, snapshot_ctx

API = Settings(data_source="axiomflo_api")


def suggestions(raw: dict, period: str = "2026-10", **args) -> dict:
    ws = load_snapshot(raw)
    return AgentService(API).call_tool(snapshot_ctx(ws), "get_savings_suggestions", snapshot=ws, period=period, **args)


def by_kind(out: dict) -> dict:
    return {s["kind"]: s for s in out["suggestions"]}


def test_admin_sees_every_rule_that_applies(snapshot_raw):
    out = suggestions(snapshot_raw)
    kinds = [s["kind"] for s in out["suggestions"]]
    assert kinds == ["spend_jump", "prompt_caching", "premium_model_small_jobs", "failed_requests_cost", "unresolved_costs", "exchange_rate"]
    found = by_kind(out)
    jump = found["spend_jump"]
    assert jump["figures"]["scope"] == "Product Experience"
    assert jump["figures"]["current_spend"] == "$10.71" and jump["figures"]["previous_spend"] == "$3.33"
    assert "Gemini 3.1 Pro" in jump["detail"] and "Chloe Chen" in jump["detail"] and "not why" in jump["detail"]
    small = found["premium_model_small_jobs"]
    assert small["figures"]["model"] == "Claude Opus 5.5" and small["figures"]["team"] == "Platform Engineering"
    assert "doesn't mean the same quality" in small["detail"]
    assert "team=team-platform" in small["link"]["url"]
    assert found["unresolved_costs"]["figures"]["unresolved_requests"] == 17
    assert "October 2026 has no exchange rate" in found["exchange_rate"]["detail"]


def test_suggestions_never_name_a_replacement_model(snapshot_raw):
    detail = by_kind(suggestions(snapshot_raw))["premium_model_small_jobs"]["detail"]
    assert not any(name in detail for name in ("Haiku", "Flash", "Sonnet"))


def test_individual_users_get_suggestions_about_their_own_requests_only(snapshot_raw):
    out = suggestions(as_viewer(snapshot_raw, "uid-chloe", "individual_user", ["team-product"], filter_records=False))
    found = by_kind(out)
    assert found["spend_jump"]["detail"].startswith("Your spend was")
    # Chloe makes no Claude requests, so the Claude-only rules have nothing of hers to find.
    assert "prompt_caching" not in found and "premium_model_small_jobs" not in found
    # Never another person's name.
    assert all("Ben" not in s["detail"] and "Ava" not in s["detail"] for s in out["suggestions"])


def test_quiet_month_says_nothing_stands_out(snapshot_raw):
    raw = copy.deepcopy(snapshot_raw)
    raw["exchangeRates"].append({"month": "2026-08", "rate": 1.5, "currency": "AUD"})
    raw["usage"] = [raw["usage"][0]]
    raw["usage"][0]["records"] = [r for r in raw["usage"][0]["records"] if r["modelId"] == "gemini-3.5-flash" and r["costStatus"] != "unavailable" and r["requestStatus"] == "succeeded"]
    out = suggestions(raw, period="2026-08")
    assert out["suggestions"] == []
    assert out["message"] == "Nothing stands out for this period under AxiomFlo's rules."


def test_small_amounts_are_not_worth_a_suggestion(snapshot_raw):
    raw = copy.deepcopy(snapshot_raw)
    for month in raw["usage"]:
        for r in month["records"]:
            if r["estimatedCostUsd"] is not None:
                r["estimatedCostUsd"] /= 1000
    kinds = {s["kind"] for s in suggestions(raw)["suggestions"]}
    assert kinds == {"unresolved_costs", "exchange_rate"}


def test_premium_models_are_matched_by_id():
    assert is_premium_model("claude-opus-5-5") and is_premium_model("gemini-3.1-pro") and is_premium_model("claude-fable-5-1")
    assert not is_premium_model("claude-haiku-5-5") and not is_premium_model("gemini-3.5-flash") and not is_premium_model("claude-sonnet-5-5")


def test_suggestions_also_run_on_the_demo_workspace(make_service, acme):
    service, _ = make_service()
    out = service.call_tool(ctx_for(acme, "u-maya"), "get_savings_suggestions", period="2026-09")
    assert out["status"] == "ok" and out["data_label"].startswith("MOCK DATA")


def test_the_agent_relays_suggestions_with_verified_figures(snapshot_raw):
    ws = load_snapshot(snapshot_raw)

    def relay(results):
        return " ".join(s["detail"] for s in results[-1]["suggestions"][:2])

    model = ScriptedModel(steps=[{"call": "get_savings_suggestions", "args": {"period": "2026-10"}}, {"text": relay}], requests=[])
    answer = asyncio.run(AgentService(API, model=model).ask(snapshot_ctx(ws), "Any recommendations?", snapshot=ws))
    assert answer.status == "ok" and "$10.71" in answer.text


def test_an_invented_saving_is_withheld(snapshot_raw):
    ws = load_snapshot(snapshot_raw)
    model = ScriptedModel(
        steps=[{"call": "get_savings_suggestions", "args": {"period": "2026-10"}}, {"text": "Switch everything to Haiku and save $250.00 a month."}],
        requests=[],
    )
    answer = asyncio.run(AgentService(API, model=model).ask(snapshot_ctx(ws), "How do we save money?", snapshot=ws))
    assert answer.status == "withheld"
