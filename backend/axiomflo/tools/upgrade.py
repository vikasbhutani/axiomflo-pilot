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
                "notes": u["notes"] + [APPROVAL_NOTE],
            }

        return rt.run(tool_context, "list_upgrade_options", {}, body)

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

        Only call it after the person has confirmed every choice and assumption, including the
        migration percentage. Relay `summary` as written; it already ends with the disclaimer.

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
        scope_args = {"current_model": current_model, "candidate_model": candidate_model, "scope": scope, "time_window": time_window, "migration_percentage": migration_percentage}

        def body(ctx, ws, viewer):
            u = _upgrade_inputs(ctx, ws)
            if time_window not in WINDOWS:
                raise InvalidArgument(f"time_window must be one of {', '.join(WINDOWS)}.")
            window = {"kind": time_window}
            if time_window == "custom":
                window.update({"from": from_date, "to": to_date})
            assumptions = {
                k: v
                for k, v in {
                    "outputTokenChangePct": output_token_change_pct,
                    "requestVolumeChangePct": request_volume_change_pct,
                    "migrationCostEstimate": migration_cost,
                    "evaluationQualityScore": evaluation_quality_score,
                    "qualityThreshold": quality_threshold,
                    "businessCritical": True if business_critical else None,
                }.items()
                if v is not None
            }
            body_ = {
                "currentModelId": _find_model(u, current_model, "current_model")["id"],
                "candidateModelId": _find_model(u, candidate_model, "candidate_model")["id"],
                "scope": _resolve_scope(u, scope),
                "timeWindow": window,
                "migrationPercentage": migration_percentage,
                "eligibilityRules": _rules(u, all_calls_eligible, excluded_teams),
                "assumptions": assumptions,
            }
            try:
                request = up.parse_estimate_request(body_)
                resolved = up.resolve_time_window(request["timeWindow"], u["today"])
                if resolved["from"] < u["from"]:
                    raise InvalidArgument(f"The usage records sent with this question start on {u['from']}. Choose a window from then to {u['today']}.")
                a = up.estimate_upgrade(
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
                "summary": "\n".join(up.summary_lines(a)),
                "recommendation": a["recommendation"]["label"],
                "eligible_calls": a["eligibility"]["eligible"]["requests"],
                "calls_requiring_review": a["eligibility"]["requiresReview"]["requests"],
                "notices": a["notices"],
                "link": {"label": "Open in Upgrade Analysis", "url": rep.settings.web_base_url + up.upgrade_href(request, rules=rules)},
                "notes": [APPROVAL_NOTE, "Saving this analysis is done in the Upgrade Analysis tab."],
                "disclaimer": up.DISCLAIMER,
            }

        return rt.run(tool_context, "estimate_upgrade", scope_args, body)

    return [list_upgrade_options, estimate_upgrade]


UPGRADE_TOOL_NAMES = ("list_upgrade_options", "estimate_upgrade")
