"""Cost answers must match the web app's reporting calculations exactly.

golden-totals.json is written by the TypeScript code (npm run agent:fixtures). The web
app's own test (src/lib/agentFixtures.test.ts) fails if the fixtures go stale.
"""
from __future__ import annotations

import re

import pytest

from axiomflo.reporting.calculations import summarize
from axiomflo.reporting.service import ReportingService, Scope
from axiomflo.config import Settings

from .conftest import ctx_for


def camel_to_snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def select(acme, period: str, scope_key: str):
    in_period = [c for c in acme.costed if c.local_date.startswith(period)]
    if scope_key == "company":
        return in_period
    if scope_key.startswith("viewer:"):
        user_id = scope_key.split(":", 1)[1]
        ctx = ctx_for(acme, user_id)
        viewer = acme.person(user_id)
        return ReportingService(Settings(), None).select(ctx, acme, viewer, period, Scope(acme, viewer))
    filters = dict(part.split(":", 1) for part in scope_key.split("|"))
    return [
        c
        for c in in_period
        if c.record.team_id == filters.get("team", c.record.team_id)
        and c.record.provider_id == filters.get("provider", c.record.provider_id)
        and c.record.model_id == filters.get("model", c.record.model_id)
    ]


def test_golden_file_covers_every_scope(golden, acme):
    assert golden["periods"] == acme.periods
    assert golden["currency"] == acme.currency == "AUD"
    assert golden["timezone"] == acme.timezone == "Australia/Sydney"
    assert len(golden["rows"]) >= 30


def test_every_total_matches_the_web_app(golden, acme):
    mismatches = []
    for row in golden["rows"]:
        ours = summarize(select(acme, row["period"], row["scope"])).as_dict()
        for key, expected in row["summary"].items():
            actual = ours[camel_to_snake(key)]
            if expected is None or isinstance(expected, int):
                ok = actual == expected
            else:
                ok = actual == pytest.approx(expected, rel=0, abs=1e-9)
            if not ok:
                mismatches.append((row["scope"], row["period"], key, expected, actual))
    assert mismatches == []


def test_missing_costs_are_never_counted_as_zero(acme):
    s = summarize(acme.costed)
    assert s.unresolved_count > 0
    assert s.costed_count + s.unresolved_count == s.request_count
    assert s.estimated_spend == pytest.approx(sum(c.estimated_cost for c in acme.costed if c.estimated_cost is not None))
    assert all(c.estimated_cost is None for c in acme.costed if c.record.input_tokens is None)
