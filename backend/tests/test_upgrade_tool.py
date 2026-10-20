"""list_upgrade_options and estimate_upgrade: the Upgrade Analysis as agent tools, on the
inputs the API sent for one member, never anyone else's."""
from __future__ import annotations

import asyncio
import copy
import inspect
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest

from axiomflo.agent.instructions import AGENT_INSTRUCTION
from axiomflo.agent.service import AgentService
from axiomflo.config import Settings
from axiomflo.reporting.snapshot import load_snapshot
from axiomflo.reporting.upgrade import DISCLAIMER
from axiomflo.tools.upgrade import make_upgrade_tools

from .conftest import ScriptedModel, as_viewer, ctx_for, snapshot_ctx

API = Settings(data_source="axiomflo_api")
FLASH = {"current_model": "Gemini 3.5 Flash", "candidate_model": "gemini-3.8-flash", "time_window": "last_30_days", "migration_percentage": 100}


def call(raw: dict, name: str, **args) -> dict:
    ws = load_snapshot(raw)
    return AgentService(API).call_tool(snapshot_ctx(ws), name, snapshot=ws, **args)


def test_options_list_models_in_use_and_their_candidates(snapshot_raw):
    out = call(snapshot_raw, "list_upgrade_options")
    assert out["status"] == "ok"
    assert {m["model"] for m in out["current_models"]} == {"claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5", "gemini-3.1-pro", "gemini-3.5-flash"}
    flash = next(m for m in out["current_models"] if m["model"] == "gemini-3.5-flash")
    assert flash["candidates"][0]["compatibility"] == "drop_in"
    assert out["teams"] == ["Platform Engineering", "Product Experience"]
    assert out["records_from"] == "2026-08-01" and out["today"] == "2026-10-19"
    assert "$" not in str(out["current_models"])  # choices only, no savings figures


def test_estimate_relays_the_tab_summary_with_the_disclaimer(snapshot_raw):
    out = call(snapshot_raw, "estimate_upgrade", **FLASH, all_calls_eligible=True)
    assert out["status"] == "ok"
    assert out["summary"].startswith("**Upgrade Analysis**")
    assert "**Migration assumption:** 100% of eligible calls" in out["summary"]
    assert out["summary"].endswith(DISCLAIMER)
    assert out["eligible_calls"] == 62 and out["calls_requiring_review"] == 0
    q = parse_qs(urlparse(out["link"]["url"]).query)
    assert q == {"current": ["gemini-3.5-flash"], "candidate": ["gemini-3.8-flash"], "scope": ["company"], "window": ["last_30_days"], "pct": ["100"], "rule": ["eligible:company"]}


def test_unconfirmed_calls_count_as_requiring_review_not_savings(snapshot_raw):
    out = call(snapshot_raw, "estimate_upgrade", **FLASH)
    assert out["eligible_calls"] == 0 and out["calls_requiring_review"] == 62
    assert "rule" not in parse_qs(urlparse(out["link"]["url"]).query)


def test_excluded_teams_and_team_scope(snapshot_raw):
    out = call(snapshot_raw, "estimate_upgrade", **FLASH, all_calls_eligible=True, excluded_teams=["Product Experience"])
    assert parse_qs(urlparse(out["link"]["url"]).query)["rule"] == ["eligible:company", "exclude:team:team-product"]
    team = call(snapshot_raw, "estimate_upgrade", **FLASH, scope="Platform Engineering", all_calls_eligible=True)
    assert "**Scope:** Platform Engineering" in team["summary"]


def test_the_migration_percentage_must_come_from_the_person():
    tool = make_upgrade_tools(SimpleNamespace(reporting=None))[1]
    assert inspect.signature(tool).parameters["migration_percentage"].default is inspect.Parameter.empty
    assert "Assuming 100% of eligible calls migrate. Continue?" in AGENT_INSTRUCTION


def test_rejects_bad_choices_plainly(snapshot_raw):
    assert call(snapshot_raw, "estimate_upgrade", **{**FLASH, "migration_percentage": 120})["error"]["code"] == "invalid_argument"
    assert call(snapshot_raw, "estimate_upgrade", **{**FLASH, "candidate_model": "gpt-9"})["error"]["code"] == "invalid_argument"
    early = call(snapshot_raw, "estimate_upgrade", **{**FLASH, "time_window": "custom", "from_date": "2026-07-01", "to_date": "2026-07-31"})
    assert early["error"]["code"] == "invalid_argument" and "2026-08-01" in early["error"]["message"]


def test_members_can_only_analyse_their_own_teams(snapshot_raw):
    raw = as_viewer(snapshot_raw, "uid-chloe", "individual_user", ["team-product"])
    raw["upgrade"] = copy.deepcopy(raw["upgrade"])
    raw["upgrade"]["scopes"] = {"team": [{"id": "team-product", "label": "Product Experience"}]}
    out = call(raw, "estimate_upgrade", **FLASH, scope="Platform Engineering")
    assert out["status"] == "error" and "Product Experience" in out["error"]["message"]


def test_inputs_made_for_one_person_never_answer_another(snapshot_raw):
    ws = load_snapshot(snapshot_raw)
    other = ctx_for(ws, "uid-chloe", role="individual_user")
    with pytest.raises(ValueError, match="person it was made for"):
        AgentService(API).call_tool(other, "estimate_upgrade", snapshot=ws, **FLASH)


def test_without_upgrade_inputs_it_points_to_the_tab(snapshot_raw, make_service, acme):
    raw = {k: v for k, v in snapshot_raw.items() if k != "upgrade"}
    out = call(raw, "list_upgrade_options")
    assert out["error"]["code"] == "unavailable" and "/assistant/upgrade" in out["error"]["message"]
    service, _ = make_service()
    assert service.call_tool(ctx_for(acme, "u-maya"), "estimate_upgrade", **FLASH)["error"]["code"] == "unavailable"


def test_the_agent_relays_the_estimate_with_verified_figures(snapshot_raw):
    ws = load_snapshot(snapshot_raw)
    model = ScriptedModel(
        steps=[
            {"call": "list_upgrade_options", "args": {}},
            {"call": "estimate_upgrade", "args": {**FLASH, "all_calls_eligible": True}},
            {"text": lambda results: results[-1]["summary"] + "\n\n" + results[-1]["link"]["url"]},
        ],
        requests=[],
    )
    answer = asyncio.run(AgentService(API, model=model).ask(snapshot_ctx(ws), "Can we upgrade Gemini 3.5 Flash?", snapshot=ws))
    summary = AgentService(API).call_tool(snapshot_ctx(ws), "estimate_upgrade", snapshot=ws, **FLASH, all_calls_eligible=True)["summary"]
    assert answer.status == "ok" and summary in answer.text  # no figure withheld
    assert "Estimated monthly saving: $1.00" in answer.text and "withheld" not in answer.text.lower()
    assert DISCLAIMER in answer.text
