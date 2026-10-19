"""Read-only AxiomFlo Agent tools.

Each tool:
- takes only business arguments (period, team, provider, ...). There is deliberately no
  tenant, company or user argument; who is asking comes from the server-held context.
- returns figures calculated by axiomflo.reporting, already formatted, with the reporting
  period, timezone, currency, scope, cost status, data freshness and links to the
  supporting records in the AxiomFlo web app.
- never returns prompts, responses, credentials or anything from outside the caller's
  own tenant and visibility.

None of these tools changes anything. Control changes arrive in Milestone 5, through a
proposal and an authenticated approval page, never as a tool the model can apply.
"""
from __future__ import annotations

from typing import Callable

from google.adk.tools import ToolContext

from ..context import TrustedContext
from ..errors import InvalidArgument
from ..reporting.calculations import CostSummary, CostedRecord, cost_status_label, summarize, summarize_by
from ..reporting.dataset import Workspace
from ..reporting.service import InsufficientData, Scope, period_bounds, previous_period
from ..reporting.suggestions import build_suggestions
from .runtime import ToolRuntime

GROUP_BYS = ("provider", "team", "model")
NOT_AVAILABLE = "Not available"

NO_REASON_NOTE = (
    "These figures show what changed, not why. AxiomFlo has no record of business reasons; "
    "ask the team involved rather than assuming one."
)
UNRESOLVED_NOTE = "Requests with missing usage have no calculable cost. They are excluded from totals, not counted as $0."
ESTIMATE_NOTE = "Estimated costs are calculated from measured usage and AxiomFlo pricing tables. They are not provider invoices."


def money(value: float | None, *, precise: bool = False) -> str:
    if value is None:
        return NOT_AVAILABLE
    sign = "-" if value < 0 else ""
    return f"{sign}${abs(value):,.{4 if precise else 2}f}"


def signed_money(value: float) -> str:
    return ("+" if value >= 0 else "") + money(value)


def percent(numerator: float, denominator: float) -> str:
    if denominator == 0:
        return NOT_AVAILABLE
    return f"{numerator / denominator * 100:+.1f}%"


def share(part: float, whole: float) -> str:
    return NOT_AVAILABLE if whole == 0 else f"{part / whole * 100:.1f}%"


def summary_figures(s: CostSummary) -> dict:
    return {
        "estimated_spend": money(s.estimated_spend),
        "reconciled_spend": money(s.reconciled_spend),
        "estimated_only_spend": money(s.estimated_only_spend),
        "cost_status": cost_status_label(s),
        "requests": s.request_count,
        "requests_with_cost": s.costed_count,
        "unresolved_requests": s.unresolved_count,
        "failed_requests": s.failed_count,
        "average_cost_per_costed_request": money(s.average_cost_per_costed_request, precise=True),
        "input_tokens": s.input_tokens,
        "output_tokens": s.output_tokens,
    }


SUGGESTIONS_NOTE = (
    "AxiomFlo works these suggestions out from usage records with fixed rules. They point at places worth a look; "
    "they don't judge answer quality or know why spending changed."
)


def envelope(ws: Workspace, ctx: TrustedContext, scope: Scope, periods: list[str], **body) -> dict:
    reporting = {
        "periods": [{"period": p, "start": period_bounds(p)[0], "end": period_bounds(p)[1]} for p in periods],
        "timezone": ws.timezone,
        "currency": ws.currency,
        "data_as_of": ws.data_as_of,
    }
    currency_notes = [ws.currency_notes[p] for p in periods if p in ws.currency_notes]
    if currency_notes:
        reporting["currency_notes"] = currency_notes
    return {
        "status": "ok",
        "data_label": ws.data_label,
        "reporting": reporting,
        "scope": scope.describe(ctx.is_admin),
        **body,
    }


def make_read_only_tools(rt: ToolRuntime) -> list[Callable]:
    rep = rt.reporting

    def build_scope(ctx, ws, viewer, team=None, provider=None, model=None, cost_status=None) -> Scope:
        if cost_status and cost_status not in ("reconciled", "estimated", "unavailable"):
            raise InvalidArgument("cost_status must be reconciled, estimated or unavailable.")
        return Scope(
            workspace=ws,
            viewer=viewer,
            team=rep.resolve_team(ctx, ws, viewer, team),
            provider_id=rep.resolve_provider(ws, provider),
            model_id=rep.resolve_model(ws, model),
            cost_status=cost_status or None,
        )

    def group_key(group_by: str) -> Callable[[CostedRecord], str]:
        if group_by not in GROUP_BYS:
            raise InvalidArgument(f"group_by must be one of {', '.join(GROUP_BYS)}.")
        return {
            "provider": lambda c: c.record.provider_id,
            "team": lambda c: c.record.team_id,
            "model": lambda c: c.record.model_id,
        }[group_by]

    def group_name(ws: Workspace, group_by: str, key: str) -> str:
        if group_by == "provider":
            return ws.providers.get(key, key)
        if group_by == "team":
            t = ws.team(key)
            return t.name if t else key
        return ws.models.get(key, ("", key))[1]

    def group_scope(scope: Scope, ws: Workspace, group_by: str, key: str) -> Scope:
        if group_by == "team":
            return Scope(ws, scope.viewer, ws.team(key), scope.provider_id, scope.model_id, scope.cost_status)
        if group_by == "provider":
            return Scope(ws, scope.viewer, scope.team, key, scope.model_id, scope.cost_status)
        return Scope(ws, scope.viewer, scope.team, scope.provider_id, key, scope.cost_status)

    def reference_rows(ws: Workspace, records: list[CostedRecord], limit: int) -> tuple[list[dict], int]:
        limit = max(1, min(int(limit or 20), rt.settings.max_reference_rows))
        newest = sorted(records, key=lambda c: c.record.timestamp, reverse=True)
        rows = [
            {
                "request_id": c.record.id,
                "timestamp_utc": c.record.timestamp,
                "local_date": c.local_date,
                "team": group_name(ws, "team", c.record.team_id),
                "caller": ws.principal_name(c.record),
                "provider": group_name(ws, "provider", c.record.provider_id),
                "model": group_name(ws, "model", c.record.model_id),
                "input_tokens": c.record.input_tokens,
                "output_tokens": c.record.output_tokens,
                "estimated_cost": money(c.estimated_cost, precise=True),
                "cost_status": c.record.cost_status,
                "request_status": c.record.request_status,
                "link": rep.request_link(c),
            }
            for c in newest[:limit]
        ]
        return rows, limit

    # ------------------------------------------------------------------ tools

    def list_reporting_periods(tool_context: ToolContext) -> dict:
        """Lists the reporting periods (calendar months) that have usage data, newest last.

        Use this to work out what "this month", "last month" or a month name refers to.
        The latest period is the current reporting period.
        """

        def body(ctx, ws, viewer):
            return {
                "status": "ok",
                "data_label": ws.data_label,
                "periods": ws.periods,
                "current_period": ws.periods[-1] if ws.periods else None,
                "timezone": ws.timezone,
                "currency": ws.currency,
                "data_as_of": ws.data_as_of,
            }

        return rt.run(tool_context, "list_reporting_periods", {}, body)

    def get_cost_summary(
        period: str,
        tool_context: ToolContext,
        team: str | None = None,
        provider: str | None = None,
        model: str | None = None,
    ) -> dict:
        """Gets total estimated AI spend for one reporting period, optionally for one team, provider or model.

        Args:
          period: Calendar month as YYYY-MM, for example 2026-09.
          team: Optional team name or code.
          provider: Optional provider, for example "Gemini on Vertex AI" or "Anthropic".
          model: Optional model name.
        """

        def body(ctx, ws, viewer):
            p = rep.validate_period(ws, period)
            scope = build_scope(ctx, ws, viewer, team, provider, model)
            s = summarize(rep.select(ctx, ws, viewer, p, scope))
            return envelope(
                ws, ctx, scope, [p],
                figures=summary_figures(s),
                links=[{"label": "Supporting requests in AxiomFlo", "url": rep.usage_link(p, scope)}],
                notes=[ESTIMATE_NOTE] + ([UNRESOLVED_NOTE] if s.unresolved_count else []),
            )

        return rt.run(tool_context, "get_cost_summary", {"period": period, "team": team, "provider": provider, "model": model}, body)

    def compare_cost_periods(
        period: str,
        tool_context: ToolContext,
        previous_period_key: str | None = None,
        group_by: str = "provider",
        team: str | None = None,
    ) -> dict:
        """Compares estimated spend between two periods and shows which providers, teams or models changed most.

        Args:
          period: The later calendar month, YYYY-MM.
          previous_period_key: The earlier month, YYYY-MM. Defaults to the month before period.
          group_by: "provider", "team" or "model".
          team: Optional team name or code to limit the comparison to.
        """

        def body(ctx, ws, viewer):
            cur = rep.validate_period(ws, period)
            prev = rep.validate_period(ws, previous_period_key or previous_period(cur), allow_missing=True)
            if prev >= cur:
                raise InvalidArgument("previous_period_key must be earlier than period.")
            if prev not in ws.periods:
                raise InsufficientData(f"Not enough history to compare: {rep.coverage_message(ws, prev)}")
            key = group_key(group_by)
            scope = build_scope(ctx, ws, viewer, team)
            cur_recs = rep.select(ctx, ws, viewer, cur, scope)
            prev_recs = rep.select(ctx, ws, viewer, prev, scope)
            cur_s, prev_s = summarize(cur_recs), summarize(prev_recs)
            cur_g, prev_g = summarize_by(cur_recs, key), summarize_by(prev_recs, key)
            empty = CostSummary()
            groups = []
            for k in list(dict.fromkeys([*prev_g, *cur_g])):
                a, b = prev_g.get(k, empty), cur_g.get(k, empty)
                change = b.estimated_spend - a.estimated_spend
                groups.append(
                    (
                        change,
                        {
                            "name": group_name(ws, group_by, k),
                            "previous_spend": money(a.estimated_spend),
                            "current_spend": money(b.estimated_spend),
                            "change": signed_money(change),
                            "change_percent": percent(change, a.estimated_spend),
                            "previous_requests": a.request_count,
                            "current_requests": b.request_count,
                            "previous_average_cost_per_request": money(a.average_cost_per_costed_request, precise=True),
                            "current_average_cost_per_request": money(b.average_cost_per_costed_request, precise=True),
                            "current_unresolved_requests": b.unresolved_count,
                            "link": rep.usage_link(cur, group_scope(scope, ws, group_by, k)),
                        },
                    )
                )
            groups.sort(key=lambda g: abs(g[0]), reverse=True)
            total_change = cur_s.estimated_spend - prev_s.estimated_spend
            increases = [g for g in groups if g[0] > 0]
            largest_increase = max(increases, key=lambda g: g[0])[1]["name"] if total_change > 0 and increases else None
            return envelope(
                ws, ctx, scope, [prev, cur],
                group_by=group_by,
                totals={
                    "previous_spend": money(prev_s.estimated_spend),
                    "current_spend": money(cur_s.estimated_spend),
                    "change": signed_money(total_change),
                    "change_percent": percent(total_change, prev_s.estimated_spend),
                    "previous_requests": prev_s.request_count,
                    "current_requests": cur_s.request_count,
                    "previous_unresolved_requests": prev_s.unresolved_count,
                    "current_unresolved_requests": cur_s.unresolved_count,
                    "previous_cost_status": cost_status_label(prev_s),
                    "current_cost_status": cost_status_label(cur_s),
                },
                largest_contributor_to_increase=largest_increase,
                groups=[g[1] for g in groups],
                links=[{"label": f"Supporting requests for {cur}", "url": rep.usage_link(cur, scope)}],
                notes=[NO_REASON_NOTE, ESTIMATE_NOTE]
                + ([UNRESOLVED_NOTE] if cur_s.unresolved_count or prev_s.unresolved_count else [])
                + (["The later period is mostly estimated while the earlier one is mostly reconciled, so the later total may still change."] if cur_s.estimated_only_count > cur_s.reconciled_count and prev_s.reconciled_count > prev_s.estimated_only_count else []),
            )

        return rt.run(tool_context, "compare_cost_periods", {"period": period, "previous_period": previous_period_key, "group_by": group_by, "team": team}, body)

    def get_usage_breakdown(
        period: str,
        tool_context: ToolContext,
        group_by: str = "team",
        team: str | None = None,
        provider: str | None = None,
    ) -> dict:
        """Breaks one period's estimated spend down by team, provider or model.

        Args:
          period: Calendar month as YYYY-MM.
          group_by: "team", "provider" or "model".
          team: Optional team name or code.
          provider: Optional provider name.
        """

        def body(ctx, ws, viewer):
            p = rep.validate_period(ws, period)
            key = group_key(group_by)
            scope = build_scope(ctx, ws, viewer, team, provider)
            recs = rep.select(ctx, ws, viewer, p, scope)
            total = summarize(recs)
            rows = [
                {
                    "name": group_name(ws, group_by, k),
                    "estimated_spend": money(s.estimated_spend),
                    "share_of_spend": share(s.estimated_spend, total.estimated_spend),
                    "cost_status": cost_status_label(s),
                    "requests": s.request_count,
                    "unresolved_requests": s.unresolved_count,
                    "link": rep.usage_link(p, group_scope(scope, ws, group_by, k)),
                }
                for k, s in sorted(summarize_by(recs, key).items(), key=lambda kv: kv[1].estimated_spend, reverse=True)
            ]
            return envelope(
                ws, ctx, scope, [p],
                group_by=group_by,
                total=summary_figures(total),
                rows=rows,
                notes=[ESTIMATE_NOTE] + ([UNRESOLVED_NOTE] if total.unresolved_count else []),
            )

        return rt.run(tool_context, "get_usage_breakdown", {"period": period, "group_by": group_by, "team": team, "provider": provider}, body)

    def get_request_references(
        period: str,
        tool_context: ToolContext,
        team: str | None = None,
        provider: str | None = None,
        model: str | None = None,
        cost_status: str | None = None,
        limit: int = 20,
    ) -> dict:
        """Lists the individual requests behind a total, newest first, with links to each in AxiomFlo.

        Returns request IDs, usage and cost only, never prompt or response content.

        Args:
          period: Calendar month as YYYY-MM.
          team: Optional team name or code.
          provider: Optional provider name.
          model: Optional model name.
          cost_status: Optional "reconciled", "estimated" or "unavailable".
          limit: How many requests to return (at most 50).
        """

        def body(ctx, ws, viewer):
            p = rep.validate_period(ws, period)
            scope = build_scope(ctx, ws, viewer, team, provider, model, cost_status)
            recs = rep.select(ctx, ws, viewer, p, scope)
            rows, used_limit = reference_rows(ws, recs, limit)
            return envelope(
                ws, ctx, scope, [p],
                total_matching=len(recs),
                returned=len(rows),
                limit=used_limit,
                requests=rows,
                links=[{"label": "All matching requests in AxiomFlo", "url": rep.usage_link(p, scope)}],
            )

        return rt.run(tool_context, "get_request_references", {"period": period, "team": team, "provider": provider, "model": model, "cost_status": cost_status, "limit": limit}, body)

    def list_unresolved_records(period: str, tool_context: ToolContext, team: str | None = None, limit: int = 20) -> dict:
        """Lists requests whose cost cannot be calculated yet (for example, the provider reported no usage).

        Args:
          period: Calendar month as YYYY-MM.
          team: Optional team name or code.
          limit: How many requests to return (at most 50).
        """

        def body(ctx, ws, viewer):
            p = rep.validate_period(ws, period)
            scope = build_scope(ctx, ws, viewer, team)
            recs = [c for c in rep.select(ctx, ws, viewer, p, scope) if c.estimated_cost is None]
            rows, used_limit = reference_rows(ws, recs, limit)
            link_scope = Scope(ws, viewer, scope.team, cost_status="unavailable")
            return envelope(
                ws, ctx, scope, [p],
                total_unresolved=len(recs),
                returned=len(rows),
                limit=used_limit,
                requests=rows,
                links=[{"label": "Unresolved requests in AxiomFlo", "url": rep.usage_link(p, link_scope)}],
                notes=[UNRESOLVED_NOTE],
            )

        return rt.run(tool_context, "list_unresolved_records", {"period": period, "team": team, "limit": limit}, body)

    def get_team_controls(tool_context: ToolContext, team: str | None = None) -> dict:
        """Shows the AxiomFlo gateway controls configured for a team (allowed providers and models,
        request-per-minute limit, monthly estimated-spend alert) and whether they are enforced.

        Args:
          team: Optional team name or code. Individual Users can only see their own team.
        """

        def body(ctx, ws, viewer):
            chosen = rep.resolve_team(ctx, ws, viewer, team)
            if chosen:
                team_ids = [chosen.id]
            elif ctx.is_admin:
                team_ids = [t.id for t in ws.teams]
            else:
                team_ids = list(viewer.team_ids)
            out = []
            for policy in ws.controls:
                if policy["teamId"] not in team_ids:
                    continue
                c = policy["controls"]
                threshold = c.get("monthlyEstimatedSpendAlertAud")
                out.append(
                    {
                        "team": group_name(ws, "team", policy["teamId"]),
                        "policy_version": policy["policyVersion"],
                        "updated_at": policy["updatedAt"],
                        "enforcement": "Draft, not enforced",
                        "allowed_providers": [ws.providers.get(p, p) for p in c.get("allowedProviders", [])],
                        "allowed_models": [ws.models.get(m, ("", m))[1] for m in c.get("allowedModels", [])],
                        "requests_per_minute_limit": c.get("requestsPerMinute") if c.get("requestsPerMinute") is not None else "No limit set",
                        "monthly_estimated_spend_alert": money(threshold) if threshold is not None else "No alert set",
                    }
                )
            scope = Scope(ws, viewer, chosen)
            return envelope(
                ws, ctx, scope, [],
                team_controls=out,
                notes=[
                    "No team controls are set up in AxiomFlo yet, so requests are not being limited or blocked."
                    if not ws.is_sample
                    else "No AxiomFlo gateway is connected yet, so these controls are drafts: requests are not being limited or blocked.",
                    "These are AxiomFlo gateway settings, not provider account controls.",
                    "A spend alert is a notification, not a spending cap.",
                ],
            )

        return rt.run(tool_context, "get_team_controls", {"team": team}, body)

    def list_notification_subscriptions(tool_context: ToolContext) -> dict:
        """Lists AxiomFlo cost-update subscriptions: yours, or every subscription in the company for a Company Admin."""

        def body(ctx, ws, viewer):
            subs = ws.subscriptions if ctx.is_admin else [s for s in ws.subscriptions if s.get("ownerUserId") == viewer.id]
            rows = [
                {
                    "id": s["id"],
                    "owner": (ws.person(s["ownerUserId"]).name if ws.person(s["ownerUserId"]) else "Unknown user"),
                    "kind": s["kind"],
                    "scope": s["scope"],
                    "channel": s["channelType"],
                    "destination": s["destination"],
                    "schedule": f"{s['schedule']} ({s['timezone']})",
                    "status": s["status"],
                    "last_delivery": s.get("lastDelivery") or "Never delivered",
                }
                for s in subs
            ]
            return envelope(
                ws, ctx, Scope(ws, viewer), [],
                subscriptions=rows,
                notes=["Scheduled updates are not switched on yet, so no notifications are being sent."],
            )

        return rt.run(tool_context, "list_notification_subscriptions", {}, body)

    def get_savings_suggestions(period: str, tool_context: ToolContext, team: str | None = None) -> dict:
        """Finds places where AI spend could be lower or needs a look, worked out by AxiomFlo's own rules:
        costly models used for small jobs, spend jumps, long prompts without caching, failed requests
        that still cost money, requests with no cost yet, and missing exchange rates.

        Use this for "how can we save money?", "any recommendations?" or "anything unusual?".
        Relay each suggestion's detail as written; don't add suggestions of your own.

        Args:
          period: Calendar month as YYYY-MM, for example 2026-10.
          team: Optional team name or code.
        """

        def body(ctx, ws, viewer):
            p = rep.validate_period(ws, period)
            scope = build_scope(ctx, ws, viewer, team)
            prev = previous_period(p)
            current = rep.select(ctx, ws, viewer, p, scope)
            earlier = rep.select(ctx, ws, viewer, prev, scope) if prev in ws.periods else None

            def link(team_id=None, provider_id=None, cost_status=None) -> str:
                t = ws.team(team_id) if team_id else scope.team
                return rep.usage_link(p, Scope(ws, viewer, t, provider_id, None, cost_status))

            found = build_suggestions(
                period=p,
                previous=prev if earlier is not None else None,
                current=current,
                earlier=earlier,
                is_admin=ctx.is_admin,
                own_scope=not ctx.is_admin,
                team_name=lambda k: group_name(ws, "team", k),
                model_name=lambda k: group_name(ws, "model", k),
                person_name=ws.principal_name_of,
                money=money,
                share=share,
                percent=percent,
                usage_link=link,
                currency_note=ws.currency_notes.get(p),
                rate_missing=p in ws.rate_missing_periods,
            )
            return envelope(
                ws, ctx, scope, [p] if earlier is None else [prev, p],
                suggestions=[s.as_dict() for s in found],
                message=None if found else "Nothing stands out for this period under AxiomFlo's rules.",
                links=[{"label": "Supporting requests in AxiomFlo", "url": rep.usage_link(p, scope)}],
                notes=[SUGGESTIONS_NOTE, ESTIMATE_NOTE],
            )

        return rt.run(tool_context, "get_savings_suggestions", {"period": period, "team": team}, body)

    return [
        list_reporting_periods,
        get_cost_summary,
        compare_cost_periods,
        get_usage_breakdown,
        get_request_references,
        list_unresolved_records,
        get_team_controls,
        list_notification_subscriptions,
        get_savings_suggestions,
    ]


READ_ONLY_TOOL_NAMES = (
    "list_reporting_periods",
    "get_cost_summary",
    "compare_cost_periods",
    "get_usage_breakdown",
    "get_request_references",
    "list_unresolved_records",
    "get_team_controls",
    "list_notification_subscriptions",
    "get_savings_suggestions",
)
