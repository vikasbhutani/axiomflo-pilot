"""Read-only Upgrade Analysis tools for the AxiomFlo Agent.

They run the same estimate as the Upgrade Analysis tab (axiomflo.reporting.upgrade is a
port of src/lib/upgrade/engine.ts, checked by tests/test_upgrade_parity.py) on the inputs
the API sent with this question: the model catalogue, the member's own scopes and the usage
records they may see. Nothing here saves an analysis, changes routing or switches a model.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Callable

from google.adk.tools import ToolContext

from ..errors import AccessDenied, InvalidArgument, ServiceUnavailable
from ..reporting import upgrade as up
from ..reporting.dataset import Workspace
from .runtime import ToolRuntime

NOT_AVAILABLE_MESSAGE = (
    "Upgrade Analysis isn't available in this conversation because AxiomFlo didn't send the model "
    "catalogue with this question. Use the Upgrade Analysis tab beside this chat (/assistant/upgrade)."
)
WINDOWS = ("last_7_days", "last_30_days", "custom")
MIGRATION_QUESTION = "Assuming 100% of eligible calls migrate. Continue?"
APPROVAL_NOTE = "AxiomFlo never switches models itself. Changing production routing needs explicit human approval."


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9.]+", " ", s.lower()).strip()


def _upgrade_inputs(ctx, ws: Workspace) -> dict:
    u = ws.upgrade
    if u is None:
        raise ServiceUnavailable(NOT_AVAILABLE_MESSAGE)
    # The inputs were built for one member's visibility; never answer anyone else with them.
    if ws.snapshot_viewer_id != ctx.user_id:
        raise AccessDenied("These upgrade inputs were prepared for another person.")
    return u


def _observed_models(u: dict) -> list[str]:
    ids = {r["modelId"] for r in u["records"]}
    return [m["id"] for m in u["catalogue"] if m["id"] in ids]


def _find_model(u: dict, name: str, field: str) -> dict:
    key = _norm(name or "")
    for m in u["catalogue"]:
        if key in (_norm(m["id"]), _norm(m["displayName"])):
            return m
    raise InvalidArgument(f"Unknown {field} {name!r}. Call list_upgrade_options to see the models you can compare.")


def _resolve_scope(u: dict, scope: str | None) -> dict:
    if not scope or _norm(scope) in ("company", "all", "all teams", "everyone", _norm(u["companyLabel"])):
        return {"level": "company", "id": None}
    key = _norm(scope)
    for t in u["scopes"]["team"]:
        if key in (_norm(t["id"]), _norm(t["label"])):
            return {"level": "team", "id": t["id"]}
    teams = ", ".join(t["label"] for t in u["scopes"]["team"]) or "none"
    raise InvalidArgument(f"Unknown scope {scope!r}. You can analyse the company or one of your teams: {teams}.")


def _rules(u: dict, all_calls_eligible: bool, excluded_teams: list[str] | None) -> list[dict]:
    rules = [dict(r) for r in u["defaultRules"]]
    if all_calls_eligible:
        rules.append({"id": "chat-all", "level": "company", "targetId": None, "decision": "eligible", "reason": ""})
    for i, name in enumerate(excluded_teams or []):
        team = _resolve_scope(u, name)
        if team["level"] != "team":
            raise InvalidArgument("excluded_teams must name teams, not the company.")
        rules.append({"id": f"chat-exclude-{i}", "level": "team", "targetId": team["id"], "decision": "exclude", "reason": "Excluded in the assistant chat"})
    return rules


def make_upgrade_tools(rt: ToolRuntime) -> list[Callable]:
    rep = rt.reporting

    def list_upgrade_options(tool_context: ToolContext) -> dict:
        """What an Upgrade Analysis can compare for this person: the models their calls use today,
        the priced models each could move to (with how compatible the move is), the scopes they may
        analyse (the company or their teams), the dates the records cover, and the currency.

        Call this first when someone asks about upgrading or migrating to another model, so you
        ask only about choices that exist. It returns no savings figures.
        """

        def body(ctx, ws, viewer):
            u = _upgrade_inputs(ctx, ws)
            by_id = {m["id"]: m for m in u["catalogue"]}
            current = []
            for mid in _observed_models(u):
                m = by_id[mid]
                calls = sum(1 for r in u["records"] if r["modelId"] == mid)
                options = [
                    {"model": c["id"], "name": c["displayName"], "provider": c["providerName"], "compatibility": p["compatibility"], "note": p["note"], "preview": c["status"] == "preview"}
                    for c in u["catalogue"]
                    if c["pricing"]
                    for p in c["upgradePaths"]
                    if p["fromModelId"] == mid
                ]
                options.sort(key=lambda o: {"drop_in": 0, "needs_changes": 1}.get(o["compatibility"], 2))
                current.append({"model": mid, "name": m["displayName"], "provider": m["providerName"], "calls_in_records": calls, "priced": m["pricing"] is not None, "candidates": options})
            return {
                "status": "ok",
                "data_label": ws.data_label,
                "today": u["today"],
                "records_from": u["from"],
                "currency": u["currency"],
                "company_scope": u["companyLabel"],
                "teams": [t["label"] for t in u["scopes"]["team"]],
                "time_windows": ["last_7_days", "last_30_days", f"custom (from {u['from']} to {u['today']})"],
                "current_models": current,
                "eligibility_rules": len(u["defaultRules"]),
                "migration_question": MIGRATION_QUESTION,
                "notes": u["notes"] + [APPROVAL_NOTE],
            }

        return rt.run(tool_context, "list_upgrade_options", {}, body)

    def build_request(u: dict, a: dict) -> tuple[dict, dict]:
        """Checks the person's choices and turns them into an engine request."""
        if a["time_window"] not in WINDOWS:
            raise InvalidArgument(f"time_window must be one of {', '.join(WINDOWS)}.")
        window = {"kind": a["time_window"]}
        if a["time_window"] == "custom":
            window.update({"from": a["from_date"], "to": a["to_date"]})
        assumptions = {
            k: v
            for k, v in {
                "outputTokenChangePct": a["output_token_change_pct"],
                "requestVolumeChangePct": a["request_volume_change_pct"],
                "migrationCostEstimate": a["migration_cost"],
                "evaluationQualityScore": a["evaluation_quality_score"],
                "qualityThreshold": a["quality_threshold"],
                "businessCritical": True if a["business_critical"] else None,
            }.items()
            if v is not None
        }
        body = {
            "currentModelId": _find_model(u, a["current_model"], "current_model")["id"],
            "candidateModelId": _find_model(u, a["candidate_model"], "candidate_model")["id"],
            "scope": _resolve_scope(u, a["scope"]),
            "timeWindow": window,
            "migrationPercentage": a["migration_percentage"],
            "eligibilityRules": _rules(u, a["all_calls_eligible"], a["excluded_teams"]),
            "assumptions": assumptions,
        }
        try:
            request = up.parse_estimate_request(body)
            resolved = up.resolve_time_window(request["timeWindow"], u["today"])
        except up.UpgradeInputError as e:
            raise InvalidArgument(str(e)) from None
        if resolved["from"] < u["from"]:
            raise InvalidArgument(f"The usage records sent with this question start on {u['from']}. Choose a window from then to {u['today']}.")
        return request, resolved

    def assumption_lines(u: dict, request: dict, w: dict) -> list[str]:
        by_id = {m["id"]: m for m in u["catalogue"]}
        scope = request["scope"]
        team = next((t["label"] for t in u["scopes"]["team"] if t["id"] == scope["id"]), None)
        rules = request["eligibilityRules"]
        excluded = [t["label"] for r in rules if r["decision"] == "exclude" for t in u["scopes"]["team"] if t["id"] == r["targetId"]]
        a = request["assumptions"]
        fmt = lambda v: up.js_num(v)
        lines = [
            f"Current model: {by_id[request['currentModelId']]['displayName']}",
            f"Candidate model: {by_id[request['candidateModelId']]['displayName']}",
            f"Scope: {u['companyLabel'] if scope['level'] == 'company' else team}",
            f"Period: {w['from']} to {w['to']}",
            f"Migration: {fmt(request['migrationPercentage'])}% of eligible calls",
            "Eligibility: every call confirmed eligible" if any(r["level"] == "company" and r["decision"] == "eligible" for r in rules)
            else "Eligibility: not confirmed, so calls count as “requires review”, not savings",
        ]
        if excluded:
            lines.append(f"Staying on the current model: {', '.join(excluded)}")
        labels = {
            "outputTokenChangePct": ("Output-token change", "%"),
            "requestVolumeChangePct": ("Request-volume change", "%"),
            "evaluationQualityScore": ("Evaluation score", "/100"),
            "qualityThreshold": ("Quality threshold", "/100"),
        }
        for k, (label, unit) in labels.items():
            if a.get(k) is not None:
                lines.append(f"{label}: {fmt(a[k])}{unit}")
        if a.get("migrationCostEstimate") is not None:
            lines.append(f"One-off migration cost: {up.money(a['migrationCostEstimate'], u['currency'])}")
        if a.get("businessCritical"):
            lines.append("Business-critical: yes")
        lines.append("Anything not listed uses the model’s expectations and today’s observed usage.")
        return lines

    def tool_args(**a) -> dict:
        return {k: a[k] for k in ("current_model", "candidate_model", "scope", "time_window", "migration_percentage")}

    def preview_upgrade_assumptions(
        current_model: str,
        candidate_model: str,
        time_window: str,
        migration_percentage: float,
        tool_context: ToolContext,
        scope: str | None = None,
        from_date: str | None = None,
        to_date: str | None = None,
        all_calls_eligible: bool = False,
        excluded_teams: list[str] | None = None,
        output_token_change_pct: float | None = None,
        request_volume_change_pct: float | None = None,
        migration_cost: float | None = None,
        evaluation_quality_score: float | None = None,
        quality_threshold: float | None = None,
        business_critical: bool = False,
    ) -> dict:
        """Checks the choices for an Upgrade Analysis and returns them as assumption lines for the
        person to confirm. No savings figures. Takes the same arguments as estimate_upgrade.

        Call it before you ask the person to confirm, and list `assumptions` exactly as written.
        """
        a = dict(locals())

        def body(ctx, ws, viewer):
            u = _upgrade_inputs(ctx, ws)
            request, window = build_request(u, a)
            return {
                "status": "ok",
                "data_label": ws.data_label,
                "assumptions": assumption_lines(u, request, window),
                "confirm_question": "Shall I run it?",
                "migration_question": MIGRATION_QUESTION,
            }

        return rt.run(tool_context, "preview_upgrade_assumptions", tool_args(**a), body)

    def estimate_upgrade(
        current_model: str,
        candidate_model: str,
        time_window: str,
        migration_percentage: float,
        tool_context: ToolContext,
        scope: str | None = None,
        from_date: str | None = None,
        to_date: str | None = None,
        all_calls_eligible: bool = False,
        excluded_teams: list[str] | None = None,
        output_token_change_pct: float | None = None,
        request_volume_change_pct: float | None = None,
        migration_cost: float | None = None,
        evaluation_quality_score: float | None = None,
        quality_threshold: float | None = None,
        business_critical: bool = False,
    ) -> dict:
        """Models what moving calls from one model to another would cost, from observed usage and
        stated assumptions: current and projected cost, monthly and annualised saving, what drives
        the change, eligibility, risks, a recommendation and a suggested next step. Read-only: it
        never switches models or changes routing.

        Only call it after the person has confirmed the assumptions from
        preview_upgrade_assumptions, including the migration percentage. Relay `summary` as
        written; it already ends with the disclaimer.

        Args:
          current_model: Model used today (ID or name from list_upgrade_options).
          candidate_model: Model to move to (ID or name from list_upgrade_options).
          time_window: last_7_days, last_30_days or custom.
          migration_percentage: Share of eligible calls that would move, 0 to 100.
          scope: "company" (default) or one of the person's team names.
          from_date: First day (YYYY-MM-DD) when time_window is custom.
          to_date: Last day (YYYY-MM-DD) when time_window is custom.
          all_calls_eligible: True only if the person said these calls are confirmed eligible to
            move. Otherwise unconfirmed calls count as "requires review", not savings.
          excluded_teams: Teams the person said must not move.
          output_token_change_pct: Assumed change in output tokens, in percent.
          request_volume_change_pct: Assumed change in request volume once migrated, in percent.
          migration_cost: One-off migration cost in the reporting currency.
          evaluation_quality_score: Score (0 to 100) from the person's own side-by-side evaluation.
          quality_threshold: Minimum acceptable evaluation score (0 to 100).
          business_critical: True if the person said these calls are business-critical.
        """
        a = dict(locals())

        def body(ctx, ws, viewer):
            u = _upgrade_inputs(ctx, ws)
            request, _window = build_request(u, a)
            try:
                analysis = up.estimate_upgrade(
                    request,
                    catalogue=u["catalogue"],
                    records=u["records"],
                    scopes=u["scopes"],
                    company_label=u["companyLabel"],
                    currency=u["currency"],
                    today=u["today"],
                    now=datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                )
            except up.UpgradeInputError as e:
                raise InvalidArgument(str(e)) from None
            except up.UpgradeAccessError as e:
                raise AccessDenied(str(e)) from None
            rules = [r for r in request["eligibilityRules"] if r["id"].startswith("chat-")]
            return {
                "status": "ok",
                "data_label": ws.data_label,
                "summary": "\n".join(up.summary_lines(analysis)),
                "recommendation": analysis["recommendation"]["label"],
                "eligible_calls": analysis["eligibility"]["eligible"]["requests"],
                "calls_requiring_review": analysis["eligibility"]["requiresReview"]["requests"],
                "notices": analysis["notices"],
                "links": [{"label": "Open in Upgrade Analysis", "url": rep.settings.web_base_url + up.upgrade_href(request, rules=rules)}],
                "notes": [APPROVAL_NOTE, "Saving this analysis is done in the Upgrade Analysis tab."],
                "disclaimer": up.DISCLAIMER,
            }

        return rt.run(tool_context, "estimate_upgrade", tool_args(**a), body)

    return [list_upgrade_options, preview_upgrade_assumptions, estimate_upgrade]


UPGRADE_TOOL_NAMES = ("list_upgrade_options", "preview_upgrade_assumptions", "estimate_upgrade")
