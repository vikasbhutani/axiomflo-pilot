"""Read-only tools: tenant isolation, role scoping, limits and honest errors."""
from __future__ import annotations

from axiomflo.config import Settings

from .conftest import ctx_for


def golden_row(golden, scope, period):
    return next(r["summary"] for r in golden["rows"] if r["scope"] == scope and r["period"] == period)


def money(value: float) -> str:
    return f"${value:,.2f}"


# -- answers carry the required context ------------------------------------------------


def test_cost_summary_has_period_currency_scope_status_freshness_and_links(make_service, acme, golden):
    service, _ = make_service()
    out = service.call_tool(ctx_for(acme, "u-maya"), "get_cost_summary", period="2026-09")
    assert out["status"] == "ok"
    assert out["data_label"].startswith("MOCK DATA")
    assert out["reporting"]["periods"] == [{"period": "2026-09", "start": "2026-09-01", "end": "2026-09-30"}]
    assert out["reporting"]["timezone"] == "Australia/Sydney"
    assert out["reporting"]["currency"] == "AUD"
    assert out["reporting"]["data_as_of"] == acme.data_as_of
    assert out["scope"]["level"] == "company"
    assert out["figures"]["cost_status"] == "partly reconciled, partly estimated"
    assert out["figures"]["estimated_spend"] == money(golden_row(golden, "company", "2026-09")["estimatedSpend"])
    assert out["figures"]["unresolved_requests"] == golden_row(golden, "company", "2026-09")["unresolvedCount"]
    assert out["links"][0]["url"].startswith("http://localhost:5173/usage?from=2026-09-01&to=2026-09-30")
    assert any("not provider invoices" in n for n in out["notes"])


def test_provider_and_team_names_resolve_within_the_tenant(make_service, acme, golden):
    service, _ = make_service()
    maya = ctx_for(acme, "u-maya")
    gemini = service.call_tool(maya, "get_cost_summary", period="2026-09", provider="Gemini")
    assert gemini["figures"]["estimated_spend"] == money(golden_row(golden, "provider:gemini_vertex", "2026-09")["estimatedSpend"])
    team = service.call_tool(maya, "get_cost_summary", period="2026-09", team="eng-product")
    assert team["scope"]["team"] == "Product Experience"
    assert team["figures"]["estimated_spend"] == money(golden_row(golden, "team:team-product", "2026-09")["estimatedSpend"])


# -- tenant isolation and forged identifiers -------------------------------------------


def test_cross_tenant_access_is_denied(make_service, acme, globex):
    service, _ = make_service()
    # A context for a tenant with no workspace gets nothing.
    stranger = ctx_for(acme, "u-maya", tenant_id="co-unknown")
    assert service.call_tool(stranger, "get_cost_summary", period="2026-09")["error"]["code"] == "access_denied"
    # Each tenant only ever sees its own records, even with identical user IDs.
    acme_total = service.call_tool(ctx_for(acme, "u-maya"), "get_cost_summary", period="2026-09")["figures"]["requests"]
    globex_total = service.call_tool(ctx_for(globex, "u-maya"), "get_cost_summary", period="2026-09")["figures"]["requests"]
    assert globex_total == 2 * acme_total


def test_forged_tenant_and_user_arguments_are_ignored(make_service, acme):
    service, _ = make_service()
    liam = ctx_for(acme, "u-liam")
    honest = service.call_tool(liam, "get_cost_summary", period="2026-09")
    tool = service.tools["get_cost_summary"]
    # Tools have no tenant/user parameters at all, so a forged one cannot be passed through.
    for forged in ("tenant_id", "company_id", "user_id", "role"):
        assert forged not in tool.__code__.co_varnames[: tool.__code__.co_argcount]
    assert honest["scope"]["visibility"].startswith("Individual User")


def test_membership_must_be_active_and_role_must_match(make_service, acme):
    service, _ = make_service()
    unknown_user = ctx_for(acme, "u-nobody")
    assert service.call_tool(unknown_user, "get_cost_summary", period="2026-09")["error"]["code"] == "access_denied"
    # A context that claims admin for an Individual User is rejected, not trusted.
    escalated = ctx_for(acme, "u-noah", role="company_admin")
    assert service.call_tool(escalated, "get_cost_summary", period="2026-09")["error"]["code"] == "access_denied"


def test_unlinked_conversation_gets_no_data(make_service, acme):
    service, _ = make_service()
    from axiomflo.tools.runtime import DirectToolContext

    out = service.tools["get_cost_summary"](tool_context=DirectToolContext("co-acme:slack:u-maya", "never-bound"), period="2026-09")
    assert out["status"] == "error" and out["error"]["code"] == "not_linked"
    assert "figures" not in out


# -- Individual User scoping -------------------------------------------------------------


def test_individual_user_sees_only_their_own_requests(make_service, acme, golden):
    service, _ = make_service()
    noah = ctx_for(acme, "u-noah")
    out = service.call_tool(noah, "get_cost_summary", period="2026-09")
    assert out["figures"]["estimated_spend"] == money(golden_row(golden, "viewer:u-noah", "2026-09")["estimatedSpend"])
    refs = service.call_tool(noah, "get_request_references", period="2026-09", limit=50)
    assert refs["returned"] > 0
    assert {r["caller"] for r in refs["requests"]} == {"Noah Williams"}


def test_individual_user_cannot_query_another_team(make_service, acme):
    service, _ = make_service()
    noah = ctx_for(acme, "u-noah")
    for tool, args in [
        ("get_cost_summary", {"period": "2026-09", "team": "Platform Engineering"}),
        ("get_request_references", {"period": "2026-09", "team": "ENG-PLATFORM"}),
        ("get_team_controls", {"team": "team-platform"}),
    ]:
        out = service.call_tool(noah, tool, **args)
        assert out["error"]["code"] == "access_denied", tool


def test_individual_user_only_sees_own_subscriptions(make_service, acme):
    service, _ = make_service()
    assert [s["id"] for s in service.call_tool(ctx_for(acme, "u-noah"), "list_notification_subscriptions")["subscriptions"]] == ["sub-monthly-noah"]
    assert len(service.call_tool(ctx_for(acme, "u-maya"), "list_notification_subscriptions")["subscriptions"]) == 2


# -- controls are honest about enforcement -----------------------------------------------


def test_controls_are_drafts_and_never_claim_enforcement(make_service, acme):
    service, _ = make_service()
    out = service.call_tool(ctx_for(acme, "u-maya"), "get_team_controls")
    assert {c["team"] for c in out["team_controls"]} == {"Platform Engineering", "Product Experience"}
    assert all(c["enforcement"] == "Draft, not enforced" for c in out["team_controls"])
    text = str(out).lower()
    assert "enforced" not in text.replace("not enforced", "")
    assert any("not provider account controls" in n for n in out["notes"])


# -- limits and honest errors ------------------------------------------------------------


def test_result_size_is_capped(make_service, acme):
    service, _ = make_service()
    out = service.call_tool(ctx_for(acme, "u-maya"), "get_request_references", period="2026-09", limit=10_000)
    assert out["returned"] == 50 and out["limit"] == 50 and out["total_matching"] > 50
    assert "prompt" not in str(out["requests"][0]).lower()


def test_bad_periods_are_rejected_not_guessed(make_service, acme):
    service, _ = make_service()
    maya = ctx_for(acme, "u-maya")
    assert service.call_tool(maya, "get_cost_summary", period="September")["error"]["code"] == "invalid_argument"
    assert service.call_tool(maya, "get_cost_summary", period="2025-01")["error"]["code"] == "insufficient_data"


def test_comparison_without_history_says_so(make_service, acme):
    service, _ = make_service()
    out = service.call_tool(ctx_for(acme, "u-maya"), "compare_cost_periods", period="2026-08")
    assert out["error"]["code"] == "insufficient_data"
    assert "Not enough history" in out["error"]["message"]


def test_comparison_names_contributors_without_inventing_reasons(make_service, acme, golden):
    service, _ = make_service()
    out = service.call_tool(ctx_for(acme, "u-maya"), "compare_cost_periods", period="2026-09", group_by="provider")
    assert out["totals"]["previous_spend"] == money(golden_row(golden, "company", "2026-08")["estimatedSpend"])
    assert out["totals"]["current_spend"] == money(golden_row(golden, "company", "2026-09")["estimatedSpend"])
    assert out["largest_contributor_to_increase"] == "Anthropic"
    assert any("not why" in n for n in out["notes"])


def test_unresolved_records_are_listed(make_service, acme, golden):
    service, _ = make_service()
    out = service.call_tool(ctx_for(acme, "u-maya"), "list_unresolved_records", period="2026-09")
    assert out["total_unresolved"] == golden_row(golden, "company", "2026-09")["unresolvedCount"]
    assert all(r["estimated_cost"] == "Not available" for r in out["requests"])


def test_live_reporting_not_connected_is_explicitly_unavailable(make_service, acme):
    service, _ = make_service(settings=Settings(data_source="axiomflo_api"))
    out = service.call_tool(ctx_for(acme, "u-maya"), "get_cost_summary", period="2026-09")
    assert out["error"]["code"] == "unavailable"
    assert "No sample data was used" in out["error"]["message"]
    assert "data_label" not in out


def test_every_tool_call_is_audited_without_chat_content(make_service, acme):
    service, _ = make_service()
    service.call_tool(ctx_for(acme, "u-noah", channel="slack"), "get_cost_summary", period="2026-09", team="Platform Engineering")
    event = service.audit.events()[-1]
    assert (event.tool, event.tenant_id, event.actor_user_id, event.channel, event.outcome) == (
        "get_cost_summary",
        "co-acme",
        "u-noah",
        "slack",
        "access_denied",
    )
    assert event.scope == {"period": "2026-09", "team": "Platform Engineering"}
