"""get_finops_scorecard: the scorecard as an agent tool, scoped like every other figure."""
from __future__ import annotations

import asyncio

from axiomflo.agent.service import AgentService
from axiomflo.config import Settings
from axiomflo.reporting.snapshot import load_snapshot

from .conftest import ScriptedModel, as_viewer, ctx_for, snapshot_ctx

API = Settings(data_source="axiomflo_api")
LEVERS = {"Model right-sizing", "Prompt caching", "Batch processing", "Context trimming", "Output limits"}


def scorecard(raw: dict, period: str = "2026-10", **args) -> dict:
    ws = load_snapshot(raw)
    return AgentService(API).call_tool(snapshot_ctx(ws), "get_finops_scorecard", snapshot=ws, period=period, **args)


def test_demo_scorecard_ranks_five_levers_with_assumptions(make_service, acme):
    service, _ = make_service()
    out = service.call_tool(ctx_for(acme, "u-maya"), "get_finops_scorecard", period="2026-09")
    assert out["status"] == "ok" and out["data_label"].startswith("MOCK DATA")
    assert {l["lever"] for l in out["levers"]} == LEVERS
    assert [l["rank"] for l in out["levers"]] == [1, 2, 3, 4, 5]
    assert all(l["assumption"] and l["what_to_do"] and l["estimated_savings"].startswith("$") for l in out["levers"])
    assert out["figures"]["score"].endswith("/100") and out["figures"]["grade"] in "ABCDE"
    assert out["figures"]["previous_period"]["period"] == "2026-08"
    assert "CI code-review bot" in {w["workflow"] for w in out["workflows"]}
    assert out["links"][0]["url"].endswith("/scorecard")


def test_individual_users_score_their_own_requests_only(make_service, acme):
    service, _ = make_service()
    admin = service.call_tool(ctx_for(acme, "u-maya"), "get_finops_scorecard", period="2026-09")
    own = service.call_tool(ctx_for(acme, "u-noah"), "get_finops_scorecard", period="2026-09")
    assert own["figures"]["requests"] < admin["figures"]["requests"]
    assert own["figures"]["active_people"] == 1
    assert [w["workflow"] for w in own["workflows"]] == ["Interactive use · Product Experience"]


def test_snapshot_scorecard_uses_real_data_rules(snapshot_raw):
    out = scorecard(snapshot_raw)
    assert out["status"] == "ok"
    assert {l["lever"] for l in out["levers"]} == LEVERS
    sizing = next(l for l in out["levers"] if l["lever"] == "Model right-sizing")
    assert sizing["model_moves"][0]["from"] == "Claude Opus 5.5"
    assert any("five times input tokens" in n for n in out["notes"])
    assert "month=2026-10" in out["links"][0]["url"]


def test_snapshot_scorecard_for_an_individual_never_counts_other_people(snapshot_raw):
    out = scorecard(as_viewer(snapshot_raw, "uid-chloe", "individual_user", ["team-product"], filter_records=False))
    assert out["figures"]["active_people"] == 1


def test_the_agent_relays_the_scorecard_with_verified_figures(snapshot_raw):
    ws = load_snapshot(snapshot_raw)

    def relay(results):
        f = results[-1]["figures"]
        top = results[-1]["levers"][0]
        return f"Your FinOps score is {f['score']}. Up to {f['combined_savings']} ({f['combined_savings_share']}) could be saved; the biggest lever is {top['lever']} at {top['estimated_savings']}."

    model = ScriptedModel(steps=[{"call": "get_finops_scorecard", "args": {"period": "2026-10"}}, {"text": relay}], requests=[])
    answer = asyncio.run(AgentService(API, model=model).ask(snapshot_ctx(ws), "How can we cut our AI costs?", snapshot=ws))
    assert answer.status == "ok" and "FinOps score" in answer.text
