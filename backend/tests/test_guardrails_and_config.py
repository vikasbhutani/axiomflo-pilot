from __future__ import annotations

import pytest

from axiomflo.agent.guardrails import unverified_figures
from axiomflo.agent.instructions import AGENT_INSTRUCTION, OFF_TOPIC_REPLY
from axiomflo.config import Settings
from axiomflo.context import ContextRegistry, TrustedContext

TOOL = [{"figures": {"estimated_spend": "$1,265.63", "change": "+$108.90", "change_percent": "+69.5%"}}]


@pytest.mark.parametrize(
    "answer",
    ["You spent $1,265.63 AUD.", "Spend rose by $108.90 (+69.5%).", "Spend rose 69.5% to A$1,265.63.", "No figures here."],
)
def test_figures_from_tools_pass(answer):
    assert unverified_figures(answer, TOOL) == []


@pytest.mark.parametrize("answer", ["You spent about $1,266.", "You spent $1,265.64.", "Spend rose 70%.", "That is $5.00 per day."])
def test_new_or_rounded_figures_are_flagged(answer):
    assert unverified_figures(answer, TOOL)


def test_no_model_is_assumed():
    s = Settings.from_env({})
    assert s.model is None and s.data_source == "fixtures"
    assert "AXIOMFLO_AGENT_MODEL" in s.model_problem()
    configured = Settings.from_env({"AXIOMFLO_AGENT_MODEL": "some-model", "GOOGLE_CLOUD_PROJECT": "p", "GOOGLE_CLOUD_LOCATION": "australia-southeast2"})
    assert configured.model_problem() is None and configured.google_cloud_location == "australia-southeast2"


def test_unknown_data_source_is_rejected():
    with pytest.raises(ValueError):
        Settings.from_env({"AXIOMFLO_DATA_SOURCE": "magic"})


def test_registry_refuses_to_bind_a_session_to_another_user():
    ctx = TrustedContext("co-acme", "u-maya", "company_admin", ("team-platform",), "web", "test")
    registry = ContextRegistry()
    with pytest.raises(ValueError):
        registry.bind("co-acme:web:u-noah", "s1", ctx)
    registry.bind(ctx.session_user_id, "s1", ctx)
    assert registry.lookup("co-acme:web:u-noah", "s1") is None
    assert registry.lookup(ctx.session_user_id, "s1") is ctx


def test_context_rejects_unknown_roles_and_channels():
    with pytest.raises(ValueError):
        TrustedContext("co-acme", "u-maya", "superuser", (), "web", "test")
    with pytest.raises(ValueError):
        TrustedContext("co-acme", "u-maya", "company_admin", (), "email", "test")


def test_instructions_keep_the_assistant_on_topic():
    assert "Stay on topic" in AGENT_INSTRUCTION
    assert f'reply with exactly:\n  "{OFF_TOPIC_REPLY}"' in AGENT_INSTRUCTION
    assert "{off_topic_reply}" not in AGENT_INSTRUCTION
    assert "no web access" in AGENT_INSTRUCTION
