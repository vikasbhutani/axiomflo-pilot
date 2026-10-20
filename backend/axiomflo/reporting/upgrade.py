"""Upgrade Analysis: what moving a model dependency to a newer model would cost.

A line-for-line port of server/src/upgrade/engine.ts (and summaryLines from report.ts), so
the live assistant answers with exactly the figures the Upgrade Analysis tab shows.
tests/test_upgrade_parity.py fails if the two ever disagree on fixtures/upgrade-golden.json
(written by `npm run agent:fixtures`). Change both together.

Pure and deterministic. The caller passes usage records already limited to one company and
to what the viewer may see. Dicts use the TypeScript field names (camelCase) so a result can
be compared with the TypeScript one directly. Nothing here changes routing or models: a
projection is a modelled estimate, never a guaranteed saving.

Sums are plain left-to-right loops, not sum(): Python 3.12+ sum() compensates for rounding,
which would differ from JavaScript in the last digits.
"""
from __future__ import annotations

import math
import re
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable

UPGRADE_RULES = {
    "materialSavingsPct": 5,
    "materialMonthlySavings": 5,
    "conditionalReviewShare": 0.25,
    "strongMaxReviewShare": 0.1,
    "latencyMediumPct": 10,
    "latencyHighPct": 25,
    "retryMediumPp": 1,
    "retryHighPp": 3,
    "maxWindowDays": 92,
    "daysPerMonth": 365.25 / 12,
    "maxRules": 50,
}

DISCLAIMER = "Estimated savings are modelled from observed usage and stated assumptions. Validate quality, latency, and actual billing before production migration."
MISSING_PRICING_MESSAGE = "I can compare usage volume, but I cannot calculate a reliable cost saving because pricing for one or both models is unavailable."
QUALITY_UNKNOWN_MESSAGE = "Quality impact cannot be assessed from available data. Run an evaluation before production migration."

SCOPE_LEVELS = ("company", "team", "project", "application", "workflow", "agent", "environment")
ELIGIBILITY_LEVELS = SCOPE_LEVELS + ("model", "provider")
ENVIRONMENTS = ("production", "staging", "development")
SCOPE_LEVEL_LABELS = {
    "company": "Company",
    "team": "Team",
    "project": "Project",
    "application": "Application",
    "workflow": "Workflow",
    "agent": "Agent",
    "environment": "Environment",
}
ELIGIBILITY_LEVEL_LABELS = {**SCOPE_LEVEL_LABELS, "model": "Model", "provider": "Provider"}
FEATURE_LABELS = {
    "tool_use": "tool calling",
    "structured_output": "structured output",
    "vision": "image input",
    "long_context": "long context",
    "prompt_caching": "prompt caching",
}
CLASSIFICATION_LABELS = {
    "strongly_recommended": "Strongly recommended",
    "recommended_with_validation": "Recommended with validation",
    "conditional": "Conditional",
    "not_recommended": "Not recommended",
    "insufficient_data": "Insufficient data",
}


class UpgradeInputError(ValueError):
    """A request the caller should reject (HTTP 400 in the API)."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field


class UpgradeAccessError(PermissionError):
    """A scope the viewer isn't allowed to analyse (HTTP 403 in the API)."""

    def __init__(self, message: str = "You can’t analyse that scope.") -> None:
        super().__init__(message)


# ---------------------------------------------------------------------------
# Formatting (server/src/upgrade/format.ts: Intl en-AU and Number.toFixed)
# ---------------------------------------------------------------------------


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _round(v: float, digits: int, *, exact: bool = False) -> Decimal:
    """Rounded half away from zero. Intl rounds the shortest decimal that prints the number
    (0.075 -> 0.08); Number.toFixed rounds its exact binary value (1.005 -> 1.00)."""
    d = Decimal(v) if exact else Decimal(repr(float(v)))
    return d.quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)


def to_fixed(v: float, digits: int) -> str:
    return f"{_round(v, digits, exact=True):.{digits}f}"


def js_num(v) -> str:
    """A number as JavaScript prints it in a template string (for the values used here)."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int) or (isinstance(v, float) and v.is_integer() and abs(v) < 1e21):
        return str(int(v))
    return repr(v)


def money(value, currency: str, precise: bool = False) -> str:
    if not _finite(value):
        return "Not available"
    digits = 4 if precise else 2
    d = _round(value, digits)
    body = f"{abs(d):,.{digits}f}"
    prefix = "$" if currency == "AUD" else f"{currency} "
    return f"{'-' if d.is_signed() else ''}{prefix}{body}"


def signed_money(value: float, currency: str) -> str:
    sign = "+" if value > 0 else "−" if value < 0 else ""
    return f"{sign}{money(abs(value), currency)}"


def count(value) -> str:
    if not _finite(value):
        return "Not available"
    d = _round(value, 0)
    return f"{'-' if d.is_signed() else ''}{abs(d):,.0f}"


def pct(fraction, digits: int = 1) -> str:
    return "Not available" if not _finite(fraction) else f"{to_fixed(fraction * 100, digits)}%"


def signed_pct(fraction, digits: int = 1) -> str:
    if not _finite(fraction):
        return "Not available"
    sign = "+" if fraction > 0 else "−" if fraction < 0 else ""
    return f"{sign}{to_fixed(abs(fraction * 100), digits)}%"


def plural(n, one: str, many: str | None = None) -> str:
    return f"{count(n)} {one if n == 1 else (many or one + 's')}"


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _parse_date(value) -> date | None:
    if not isinstance(value, str) or not _DATE.fullmatch(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def add_days(day: str, days: int) -> str:
    d = _parse_date(day)
    if d is None:
        raise ValueError(f"Not a date: {day}")
    return (d + timedelta(days=days)).isoformat()


def days_inclusive(start: str, end: str) -> int:
    return (_parse_date(end) - _parse_date(start)).days + 1


def resolve_time_window(window: dict, today: str) -> dict:
    if window["kind"] in ("last_7_days", "last_30_days"):
        days = 7 if window["kind"] == "last_7_days" else 30
        start = add_days(today, -(days - 1))
        return {"from": start, "to": today, "days": days, "label": f"Last {days} days ({start} to {today})"}
    start, end = window["from"], window["to"]
    if _parse_date(start) is None or _parse_date(end) is None:
        raise UpgradeInputError("timeWindow", "Dates must be real calendar dates like 2026-09-01.")
    if start > end:
        raise UpgradeInputError("timeWindow", "The start date must be on or before the end date.")
    if start < "2020-01-01":
        raise UpgradeInputError("timeWindow", "The start date is too far in the past.")
    if end > today:
        raise UpgradeInputError("timeWindow", f"The end date can’t be after today ({today}).")
    days = days_inclusive(start, end)
    if days > UPGRADE_RULES["maxWindowDays"]:
        raise UpgradeInputError("timeWindow", f"Choose a window of {UPGRADE_RULES['maxWindowDays']} days or fewer.")
    return {"from": start, "to": end, "days": days, "label": f"{start} to {end}"}


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}")

ASSUMPTION_RANGES: dict[str, tuple[float, float] | str] = {
    "inputTokenChangePct": (-90, 500),
    "outputTokenChangePct": (-90, 500),
    "cachedTokenSharePct": (0, 100),
    "reasoningTokensPerRequest": (0, 1_000_000),
    "requestVolumeChangePct": (-90, 500),
    "candidateErrorRatePct": (0, 50),
    "latencyChangePct": (-95, 1000),
    "migrationCostEstimate": (0, 1_000_000_000),
    "qualityThreshold": (0, 100),
    "evaluationQualityScore": (0, 100),
    "businessCritical": "boolean",
}


def _only_keys(value: dict, allowed: list[str], field: str) -> None:
    extra = [k for k in value if k not in allowed]
    if extra:
        raise UpgradeInputError(field, f"Unexpected field{'' if len(extra) == 1 else 's'}: {', '.join(extra)}.")


def _number(value, field: str, bounds: tuple[float, float]):
    if not _finite(value):
        raise UpgradeInputError(field, f"{field} must be a number.")
    lo, hi = bounds
    if value < lo or value > hi:
        raise UpgradeInputError(field, f"{field} must be between {js_num(lo)} and {js_num(hi)}.")
    return value


def _id(value, field: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise UpgradeInputError(field, f"{field} is not a valid ID.")
    return value


def parse_migration_percentage(value):
    if not _finite(value):
        raise UpgradeInputError("migrationPercentage", "migrationPercentage must be a number from 0 to 100.")
    if value < 0 or value > 100:
        raise UpgradeInputError("migrationPercentage", "migrationPercentage must be between 0 and 100.")
    return value


def parse_rules(value) -> list[dict]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise UpgradeInputError("eligibilityRules", "eligibilityRules must be a list.")
    if len(value) > UPGRADE_RULES["maxRules"]:
        raise UpgradeInputError("eligibilityRules", f"Use {UPGRADE_RULES['maxRules']} eligibility rules or fewer.")
    out = []
    for i, raw in enumerate(value):
        field = f"eligibilityRules[{i}]"
        if not isinstance(raw, dict):
            raise UpgradeInputError(field, f"{field} must be an object.")
        _only_keys(raw, ["id", "level", "targetId", "decision", "reason"], field)
        level = raw.get("level")
        if level not in ELIGIBILITY_LEVELS:
            raise UpgradeInputError(field, f"{field}.level must be one of {', '.join(ELIGIBILITY_LEVELS)}.")
        if raw.get("decision") not in ("eligible", "exclude"):
            raise UpgradeInputError(field, f"{field}.decision must be eligible or exclude.")
        target = None if level == "company" else _id(raw.get("targetId"), f"{field}.targetId")
        if level == "environment" and target not in ENVIRONMENTS:
            raise UpgradeInputError(field, f"{field}.targetId must be production, staging or development.")
        reason = raw.get("reason", "")
        if not isinstance(reason, str) or len(reason) > 200:
            raise UpgradeInputError(field, f"{field}.reason must be text of 200 characters or fewer.")
        rule_id = f"rule-{i + 1}" if "id" not in raw else _id(raw["id"], f"{field}.id")
        out.append({"id": rule_id, "level": level, "targetId": target, "decision": raw["decision"], "reason": reason.strip()})
    return out


def _parse_time_window(value) -> dict:
    if not isinstance(value, dict):
        raise UpgradeInputError("timeWindow", "Choose a time window: last_7_days, last_30_days or a custom date range.")
    if value.get("kind") in ("last_7_days", "last_30_days"):
        _only_keys(value, ["kind"], "timeWindow")
        return {"kind": value["kind"]}
    if value.get("kind") != "custom":
        raise UpgradeInputError("timeWindow", "timeWindow.kind must be last_7_days, last_30_days or custom.")
    _only_keys(value, ["kind", "from", "to"], "timeWindow")
    if not isinstance(value.get("from"), str) or not isinstance(value.get("to"), str):
        raise UpgradeInputError("timeWindow", 'A custom window needs "from" and "to" dates.')
    return {"kind": "custom", "from": value["from"], "to": value["to"]}


def parse_estimate_request(body) -> dict:
    if not isinstance(body, dict):
        raise UpgradeInputError("body", "Send the analysis as a JSON object.")
    _only_keys(body, ["currentModelId", "candidateModelId", "scope", "timeWindow", "migrationPercentage", "assumptions", "eligibilityRules"], "body")
    if isinstance(body.get("currentModelId"), list) or isinstance(body.get("candidateModelId"), list):
        raise UpgradeInputError("currentModelId", "Analyse one current model and one candidate at a time; run a separate analysis for each model.")
    current = _id(body.get("currentModelId"), "currentModelId")
    candidate = _id(body.get("candidateModelId"), "candidateModelId")
    if current == candidate:
        raise UpgradeInputError("candidateModelId", "Pick a candidate model that differs from the current one.")

    scope = body.get("scope")
    if not isinstance(scope, dict):
        raise UpgradeInputError("scope", "Choose a scope.")
    _only_keys(scope, ["level", "id"], "scope")
    if scope.get("level") not in SCOPE_LEVELS:
        raise UpgradeInputError("scope", f"scope.level must be one of {', '.join(SCOPE_LEVELS)}.")
    level = scope["level"]
    scope_id = None if level == "company" else _id(scope.get("id"), "scope.id")

    assumptions: dict = {}
    raw_a = body.get("assumptions")
    if raw_a is not None:
        if not isinstance(raw_a, dict):
            raise UpgradeInputError("assumptions", "assumptions must be an object.")
        _only_keys(raw_a, list(ASSUMPTION_RANGES), "assumptions")
        for key, bounds in ASSUMPTION_RANGES.items():
            v = raw_a.get(key)
            if v is None:
                continue
            if bounds == "boolean":
                if not isinstance(v, bool):
                    raise UpgradeInputError(f"assumptions.{key}", f"assumptions.{key} must be true or false.")
                assumptions["businessCritical"] = v
            else:
                assumptions[key] = _number(v, f"assumptions.{key}", bounds)

    return {
        "currentModelId": current,
        "candidateModelId": candidate,
        "scope": {"level": level, "id": scope_id},
        "timeWindow": _parse_time_window(body.get("timeWindow")),
        "migrationPercentage": parse_migration_percentage(body.get("migrationPercentage")),
        "assumptions": assumptions,
        "eligibilityRules": parse_rules(body.get("eligibilityRules")),
    }


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------

SPECIFICITY = ["agent", "workflow", "application", "project", "team", "environment", "model", "provider", "company"]
_FIELD_OF = {
    "team": "teamId",
    "project": "projectId",
    "application": "applicationId",
    "workflow": "workflowId",
    "agent": "agentId",
    "environment": "environment",
    "model": "modelId",
    "provider": "providerId",
}


def rule_matches(rule: dict, r: dict) -> bool:
    if rule["level"] == "company":
        return True
    return r.get(_FIELD_OF[rule["level"]]) == rule["targetId"]


def classify_record(r: dict, candidate: dict, path: dict | None, rules: list[dict], region: str | None) -> dict:
    regions, envs = candidate.get("regions"), candidate.get("environments")
    if region and regions and region not in regions:
        return {"status": "ineligible", "reason": f"{candidate['displayName']} isn’t available in {region}"}
    if r.get("environment") and envs and r["environment"] not in envs:
        return {"status": "ineligible", "reason": f"{candidate['displayName']} isn’t approved for {r['environment']}"}
    if path and path["compatibility"] == "not_compatible":
        return {"status": "ineligible", "reason": "The models aren’t compatible for this task"}
    missing = [f for f in r["requiredFeatures"] if f not in candidate["features"]]
    if missing:
        return {"status": "ineligible", "reason": f"Needs {' and '.join(FEATURE_LABELS[f] for f in missing)}, which {candidate['displayName']} doesn’t support"}
    matching = sorted((rule for rule in rules if rule_matches(rule, r)), key=lambda rule: SPECIFICITY.index(rule["level"]))
    exclusion = next((rule for rule in matching if rule["decision"] == "exclude"), None)
    if exclusion:
        extra = f": {exclusion['reason']}" if exclusion["reason"] else ""
        return {"status": "ineligible", "reason": f"Excluded ({ELIGIBILITY_LEVEL_LABELS[exclusion['level']].lower()} rule){extra}"}
    if any(rule["decision"] == "eligible" for rule in matching):
        return {"status": "eligible", "reason": "Confirmed eligible"}
    return {"status": "requires_review", "reason": "Eligibility not confirmed yet" if path else "No compatibility record for this pair; eligibility not confirmed"}


# ---------------------------------------------------------------------------
# Aggregates
# ---------------------------------------------------------------------------

CATEGORIES = ("input", "cached", "output", "reasoning")


def _zero() -> dict:
    return {"input": 0, "cached": 0, "output": 0, "reasoning": 0}


def _is_costed(r: dict) -> bool:
    return r.get("cost") is not None and r.get("inputTokens") is not None and r.get("outputTokens") is not None


def _aggregate(records: list[dict]) -> dict:
    costed = [r for r in records if _is_costed(r)]
    tokens = _zero()
    cost = 0
    retries = 0
    retry_cost = 0
    for r in costed:
        cost += r["cost"]
        tokens["input"] += r["inputTokens"]
        tokens["cached"] += r["cachedInputTokens"]
        tokens["output"] += r["outputTokens"]
        tokens["reasoning"] += r["reasoningTokens"]
        if r["isRetry"]:
            retries += 1
            retry_cost += r["cost"]
    return {"requests": len(records), "costed": costed, "cost": cost, "tokens": tokens, "retries": retries, "retryCost": retry_cost}


def _avg(total, n):
    return total / n if n > 0 else None


def _scale(t: dict, k: float) -> dict:
    return {c: t[c] * k for c in CATEGORIES}


def _rates(p: dict) -> dict:
    cached = p.get("cachedInputPerMillion")
    reasoning = p.get("reasoningPerMillion")
    return {
        "input": p["inputPerMillion"],
        "cached": p["inputPerMillion"] if cached is None else cached,
        "output": p["outputPerMillion"],
        "reasoning": p["outputPerMillion"] if reasoning is None else reasoning,
    }


def _price(t: dict, p: dict) -> float:
    return (t["input"] * p["input"] + t["cached"] * p["cached"] + t["output"] * p["output"] + t["reasoning"] * p["reasoning"]) / 1_000_000


def _first(*values):
    """JavaScript's `a ?? b ?? c`."""
    for v in values:
        if v is not None:
            return v
    return None


# ---------------------------------------------------------------------------
# Projection
# ---------------------------------------------------------------------------


def _project(eligible: dict, p: float, candidate: dict, pricing: dict, a: dict) -> dict:
    n = len(eligible["costed"])
    base = n - eligible["retries"]
    current_retry_rate = eligible["retries"] / n if n > 0 else 0
    avg_t = _scale(eligible["tokens"], 1 / n) if n > 0 else _zero()
    P = _rates(pricing)
    expected = candidate["expected"]

    input_change = (a.get("inputTokenChangePct") or 0) / 100
    output_change_pct = _first(a.get("outputTokenChangePct"), expected.get("outputTokenChangePct"), 0)
    prompt = (avg_t["input"] + avg_t["cached"]) * (1 + input_change)
    current_cache_share = avg_t["cached"] / (avg_t["input"] + avg_t["cached"]) if avg_t["input"] + avg_t["cached"] > 0 else 0
    if "cachedTokenSharePct" in a:
        cache_share = a["cachedTokenSharePct"] / 100
    else:
        cache_share = 0 if pricing.get("cachedInputPerMillion") is None else current_cache_share
    per_request = {
        "input": prompt * (1 - cache_share),
        "cached": prompt * cache_share,
        "output": avg_t["output"] * (1 + output_change_pct / 100),
        "reasoning": _first(a.get("reasoningTokensPerRequest"), expected.get("reasoningTokensPerRequest"), avg_t["reasoning"]),
    }
    if "candidateErrorRatePct" in a:
        error_source, error_rate = "assumption", a["candidateErrorRatePct"] / 100
    elif expected.get("errorRatePct") is not None:
        error_source, error_rate = "model", expected["errorRatePct"] / 100
    else:
        error_source, error_rate = "unchanged", current_retry_rate
    volume = (a.get("requestVolumeChangePct") or 0) / 100

    cost_per_request = _price(per_request, P)
    at_current_tokens = _price(avg_t, P)
    migrated_requests = p * n
    first_calls = p * base * (1 + volume)
    candidate_requests = first_calls / (1 - error_rate) if error_rate < 1 else first_calls
    migrated_current_cost = p * eligible["cost"]
    migrated_projected_cost = candidate_requests * cost_per_request

    with_current_retries = first_calls / (1 - current_retry_rate) if current_retry_rate < 1 else first_calls
    volume_requests = (p * base * volume) / (1 - current_retry_rate) if current_retry_rate < 1 else p * base * volume

    def token_delta(k: str) -> float:
        return (migrated_requests * (per_request[k] - avg_t[k]) * P[k]) / 1_000_000

    def row(row_id: str, label: str, amount: float) -> dict:
        return {"id": row_id, "label": label, "amount": amount, "pctOfMigrated": amount / migrated_current_cost if migrated_current_cost > 0 else None}

    impacts = [
        row("unit_price", "Unit-price impact", migrated_requests * at_current_tokens - migrated_current_cost),
        row("input_tokens", "Input-token impact", token_delta("input")),
        row("cached_tokens", "Cached-token impact", token_delta("cached")),
        row("output_tokens", "Output-token impact", token_delta("output")),
        row("reasoning_tokens", "Reasoning-token impact", token_delta("reasoning")),
        row("request_volume", "Request-volume impact", volume_requests * cost_per_request),
        row("retries", "Retry or fallback impact", (candidate_requests - with_current_retries) * cost_per_request),
    ]
    return {
        "migratedRequests": migrated_requests,
        "candidateRequests": candidate_requests,
        "perRequest": per_request,
        "costPerRequest": cost_per_request,
        "migratedCurrentCost": migrated_current_cost,
        "migratedProjectedCost": migrated_projected_cost,
        "impacts": impacts,
        "errorRate": error_rate,
        "errorRateSource": error_source,
        "outputChangePct": output_change_pct,
    }


# ---------------------------------------------------------------------------
# The analysis
# ---------------------------------------------------------------------------


def find_model(catalogue: list[dict], model_id: str, field: str) -> dict:
    for m in catalogue:
        if m["id"] == model_id:
            return m
    raise UpgradeInputError(field, f"Unknown model: {model_id}.")


def resolve_scope(scope: dict, scopes: dict, company_label: str) -> str:
    if scope["level"] == "company":
        return company_label
    option = next((o for o in scopes.get(scope["level"]) or [] if o["id"] == scope["id"]), None)
    if option is None:
        raise UpgradeAccessError()
    return f"{option['label']} ({SCOPE_LEVEL_LABELS[scope['level']].lower()})"


def _in_scope(r: dict, scope: dict) -> bool:
    if scope["level"] == "company":
        return True
    return rule_matches({"level": scope["level"], "targetId": scope["id"]}, r)


def _side(m: dict) -> dict:
    return {"providerId": m["providerId"], "providerName": m["providerName"], "modelId": m["id"], "displayName": m["displayName"], "version": m["version"], "pricing": m.get("pricing")}


def _bucket(records: list[dict], total: int) -> dict:
    return {"requests": len(records), "share": len(records) / total if total > 0 else 0, "cost": _aggregate(records)["cost"]}


def _label_for(scopes: dict, level: str, value):
    if not value:
        return None
    option = next((o for o in scopes.get(level) or [] if o["id"] == value), None)
    return option["label"] if option else value


def estimate_upgrade(request: dict, *, catalogue: list[dict], records: list[dict], scopes: dict, company_label: str, currency: str, today: str, now: str, region_of: Callable[[str], str | None] = lambda _p: None) -> dict:
    """Runs one upgrade analysis. Raises UpgradeInputError or UpgradeAccessError."""
    current = find_model(catalogue, request["currentModelId"], "currentModelId")
    candidate = find_model(catalogue, request["candidateModelId"], "candidateModelId")
    scope_label = resolve_scope(request["scope"], scopes, company_label)
    window = resolve_time_window(request["timeWindow"], today)
    p = request["migrationPercentage"] / 100
    a = request["assumptions"]
    path = next((u for u in candidate["upgradePaths"] if u["fromModelId"] == current["id"]), None)
    region = region_of(candidate["providerId"])
    cross_provider = current["providerId"] != candidate["providerId"]
    c_regions, c_envs = candidate.get("regions"), candidate.get("environments")

    scoped = [r for r in records if window["from"] <= r["localDate"] <= window["to"] and _in_scope(r, request["scope"])]
    on_current = [r for r in scoped if r["modelId"] == current["id"]]
    decisions = [(r, classify_record(r, candidate, path, request["eligibilityRules"], region)) for r in on_current]

    def by_status(s: str) -> list[dict]:
        return [r for r, d in decisions if d["status"] == s]

    eligible_records = by_status("eligible")
    all_ = _aggregate(on_current)
    eligible = _aggregate(eligible_records)

    # ---- Eligibility breakdown
    reason_counts: dict[str, dict] = {}
    for _r, d in decisions:
        if d["status"] == "eligible":
            continue
        key = f"{d['status']}:{d['reason']}"
        entry = reason_counts.setdefault(key, {"status": d["status"], "reason": d["reason"], "requests": 0})
        entry["requests"] += 1
    workflow_statuses: dict[str, set] = {}
    for r, d in decisions:
        if not r.get("workflowId"):
            continue
        workflow_statuses.setdefault(r["workflowId"], set()).add(d["status"])
    eligibility = {
        "eligible": _bucket(eligible_records, len(on_current)),
        "ineligible": _bucket(by_status("ineligible"), len(on_current)),
        "requiresReview": _bucket(by_status("requires_review"), len(on_current)),
        "reasons": sorted(reason_counts.values(), key=lambda x: -x["requests"]),
        "mixedWorkflows": [_label_for(scopes, "workflow", w) or w for w, s in workflow_statuses.items() if len(s) > 1],
    }

    # ---- Current usage
    n = len(all_["costed"])
    succeeded = [r for r in on_current if r["requestStatus"] == "succeeded"]
    succeeded_costed = len([r for r in all_["costed"] if r["requestStatus"] == "succeeded"])
    latencies = [r["latencyMs"] for r in on_current if r.get("latencyMs") is not None]
    latency_total = 0
    for v in latencies:
        latency_total += v
    avg_latency = latency_total / len(latencies) if latencies else None
    pricing_versions = sorted({r["pricingVersion"] for r in all_["costed"] if r.get("pricingVersion")})
    usage = {
        "requests": len(on_current),
        "costedRequests": n,
        "unmeasuredRequests": len(on_current) - n,
        "successfulRequests": len(succeeded),
        "failedRequests": len(on_current) - len(succeeded),
        "retries": len([r for r in on_current if r["isRetry"]]),
        "fallbacks": len([r for r in on_current if r["isFallback"]]),
        "avgInputTokens": _avg(all_["tokens"]["input"], n),
        "avgCachedTokens": _avg(all_["tokens"]["cached"], n),
        "avgOutputTokens": _avg(all_["tokens"]["output"], n),
        "avgReasoningTokens": _avg(all_["tokens"]["reasoning"], n),
        "avgLatencyMs": avg_latency,
        "errorRate": (len(on_current) - len(succeeded)) / len(on_current) if on_current else None,
        "cost": all_["cost"],
        "costPerRequest": _avg(all_["cost"], n),
        "costPerSuccessfulRequest": all_["cost"] / succeeded_costed if succeeded_costed > 0 else None,
        "costBasis": "reconciled" if n > 0 and all(r["costStatus"] == "reconciled" for r in all_["costed"]) else "estimated",
        "pricingVersions": pricing_versions,
    }

    # ---- Data sufficiency
    notices: list[str] = []
    pricing_missing = not candidate.get("pricing") or (n == 0 and len(on_current) > 0 and not current.get("pricing"))
    insufficient = None
    if not on_current:
        insufficient = f"There’s no observed usage of {current['displayName']} in {scope_label} for {window['label']}."
    elif pricing_missing:
        insufficient = MISSING_PRICING_MESSAGE
    elif n == 0:
        insufficient = f"None of the {plural(len(on_current), 'call')} on {current['displayName']} has measured usage, so there’s no cost to compare."
    elif not eligible_records and eligibility["requiresReview"]["requests"] > 0:
        insufficient = (
            f"Eligibility hasn’t been confirmed for any of these calls, so {count(eligibility['requiresReview']['requests'])} need review and none count as savings. "
            "Confirm which calls can move (an eligibility rule), then run it again."
        )

    unmeasured = usage["unmeasuredRequests"]
    if pricing_missing and insufficient != MISSING_PRICING_MESSAGE:
        notices.append(MISSING_PRICING_MESSAGE)
    if unmeasured > 0:
        notices.append(
            f"{plural(unmeasured, 'call')} had no measured usage, so {'it has' if unmeasured == 1 else 'they have'} no cost and "
            f"{'is' if unmeasured == 1 else 'are'} left out of every amount (not counted as zero)."
        )
    providers_in_scope = {r["providerId"] for r in scoped}
    other_model_calls = len(scoped) - len(on_current)
    if len(providers_in_scope) > 1 or other_model_calls > 0:
        lead = f"This scope uses {len(providers_in_scope)} providers. " if len(providers_in_scope) > 1 else ""
        notices.append(
            f"{lead}Only {current['displayName']} calls are analysed; the other {plural(other_model_calls, 'call')} on other models stay as they are "
            "and aren’t in these figures. Run a separate analysis for each model."
        )
    if len(pricing_versions) > 1:
        notices.append(f"Pricing changed during the period ({', '.join(pricing_versions)}). Current cost uses the price in effect for each request; the candidate uses its latest price.")
    if request["migrationPercentage"] == 0:
        notices.append("The migration percentage is 0%, so no calls move and the projection equals current cost.")
    if region and c_regions and region not in c_regions:
        notices.append(f"{candidate['displayName']} isn’t available in {region}, where {candidate['providerName']} calls run today, so no calls can move there.")
    if cross_provider:
        notices.append(f"{candidate['displayName']} is from a different provider ({candidate['providerName']}), so a migration means a new API integration, not just a model ID change.")
    if eligibility["mixedWorkflows"]:
        notices.append(f"Some workflows have both eligible and ineligible or unreviewed calls ({', '.join(eligibility['mixedWorkflows'])}); only their eligible calls are counted.")
    if window["days"] < 14:
        notices.append(f"A {window['days']}-day window makes the monthly and annualised figures sensitive to one unusual week.")
    if candidate.get("pricing") and candidate["pricing"].get("conversionNote"):
        notices.append(candidate["pricing"]["conversionNote"])

    # ---- Projection
    financial = None
    projection = None
    breakdown: list[dict] = []
    if not insufficient and candidate.get("pricing"):
        projection = _project(eligible, p, candidate, candidate["pricing"], a)
        projected_cost = all_["cost"] - projection["migratedCurrentCost"] + projection["migratedProjectedCost"]
        savings = all_["cost"] - projected_cost
        per_month = UPGRADE_RULES["daysPerMonth"] / window["days"]
        monthly = savings * per_month
        one_off = a.get("migrationCostEstimate")
        financial = {
            "currentCost": all_["cost"],
            "projectedCost": projected_cost,
            "savings": savings,
            "savingsPct": (savings / all_["cost"]) * 100 if all_["cost"] > 0 else None,
            "currentMonthlyCost": all_["cost"] * per_month,
            "projectedMonthlyCost": projected_cost * per_month,
            "monthlySavings": monthly,
            "annualisedSavings": monthly * 12,
            "costPerSuccessfulRequest": {
                "current": all_["cost"] / succeeded_costed if succeeded_costed > 0 else None,
                "projected": projected_cost / succeeded_costed if succeeded_costed > 0 else None,
            },
            "oneOffMigrationCost": one_off,
            "paybackMonths": one_off / monthly if one_off is not None and monthly > 0 else None,
        }
        breakdown = _build_breakdown(all_, eligible, p, projection, current.get("pricing"), candidate["pricing"])

    candidate_projection = {
        "requests": projection["candidateRequests"] if projection else 0,
        "avgInputTokens": projection["perRequest"]["input"] if projection else None,
        "avgCachedTokens": projection["perRequest"]["cached"] if projection else None,
        "avgOutputTokens": projection["perRequest"]["output"] if projection else None,
        "avgReasoningTokens": projection["perRequest"]["reasoning"] if projection else None,
        "avgLatencyMs": None,
        "errorRate": projection["errorRate"] if projection else None,
        "projectedCost": projection["migratedProjectedCost"] if projection else None,
        "costPerRequest": projection["costPerRequest"] if projection else None,
    }

    # ---- Risks
    latency_change = _first(a.get("latencyChangePct"), candidate["expected"].get("latencyChangePct"))
    if latency_change is not None and avg_latency is not None:
        candidate_projection["avgLatencyMs"] = avg_latency * (1 + latency_change / 100)
    risks = _build_risks(current, candidate, path, usage, projection, a, latency_change, region, cross_provider, eligibility, on_current)

    # ---- Recommendation
    review_cost_share = eligibility["requiresReview"]["cost"] / all_["cost"] if all_["cost"] > 0 else 0
    reasons: list[str] = []

    def material(f: dict) -> bool:
        return f["savingsPct"] is not None and f["savingsPct"] >= UPGRADE_RULES["materialSavingsPct"] and f["monthlySavings"] >= UPGRADE_RULES["materialMonthlySavings"]

    blocking = [r for r in risks if r["level"] == "high" and r["kind"] not in ("token", "financial")]
    if insufficient or not financial or not projection:
        classification = "insufficient_data"
        reasons.append(insufficient or MISSING_PRICING_MESSAGE)
    elif not eligible_records:
        classification = "not_recommended"
        top = next((r for r in eligibility["reasons"] if r["status"] == "ineligible"), None)
        most_common = f". Most common reason: {top['reason']}" if top else ""
        reasons.append(f"None of these calls is eligible to move, so there’s nothing to save{most_common}.")
    elif financial["savings"] < 0:
        classification = "not_recommended"
        reasons.append(f"{candidate['displayName']} would cost more: about {money(-financial['monthlySavings'], currency)} more a month for this scope.")
    elif not material(financial):
        classification = "not_recommended"
        reasons.append(
            f"Projected savings are immaterial: {pct((financial['savingsPct'] or 0) / 100)} of current cost, about {money(financial['monthlySavings'], currency)} a month "
            f"(material means at least {js_num(UPGRADE_RULES['materialSavingsPct'])}% and {money(UPGRADE_RULES['materialMonthlySavings'], currency)} a month)."
        )
    elif blocking:
        classification = "not_recommended"
        for r in blocking:
            reasons.append(f"Material {r['label'].lower()}: {r['detail']}")
    else:
        conditions: list[str] = []
        if review_cost_share >= UPGRADE_RULES["conditionalReviewShare"]:
            conditions.append(f"{pct(review_cost_share, 0)} of current cost is in calls that still need review, so the saving depends on how that review goes.")
        neutral_a = {"migrationCostEstimate": a["migrationCostEstimate"]} if "migrationCostEstimate" in a else {}
        neutral = _project(eligible, p, candidate, candidate["pricing"], neutral_a)
        neutral_savings = projection["migratedCurrentCost"] - neutral["migratedProjectedCost"]
        neutral_monthly = neutral_savings * (UPGRADE_RULES["daysPerMonth"] / window["days"])
        neutral_pct = (neutral_savings / all_["cost"]) * 100 if all_["cost"] > 0 else 0
        if not (neutral_pct >= UPGRADE_RULES["materialSavingsPct"] and neutral_monthly >= UPGRADE_RULES["materialMonthlySavings"]):
            conditions.append("The saving is only material under the token, volume or retry assumptions you entered; without them it isn’t.")
        if candidate["pricing"].get("validUntil"):
            conditions.append(f"It relies on {candidate['displayName']}’s current price, which applies only until {candidate['pricing']['validUntil']}.")
        if conditions:
            classification = "conditional"
            reasons.extend(conditions)
        else:
            unclear = [r for r in risks if r["level"] != "low"]
            strong = review_cost_share < UPGRADE_RULES["strongMaxReviewShare"] and not unclear and bool(path) and path["compatibility"] == "drop_in" and not a.get("businessCritical")
            classification = "strongly_recommended" if strong else "recommended_with_validation"
            reasons.append(f"Savings are material: {pct((financial['savingsPct'] or 0) / 100)} of current cost, about {money(financial['monthlySavings'], currency)} a month.")
            if strong:
                reasons.append("Eligibility is confirmed for nearly all calls and no material quality, latency or compatibility risk is identified.")
            else:
                listed = ", ".join(r["label"].lower() for r in unclear) or "a staged rollout"
                reasons.append(f"Validate first: {listed}{', and this is business-critical work' if a.get('businessCritical') else ''}.")

    pilot = _pilot_scope([r for r, d in decisions if d["status"] == "eligible"], scopes)
    rollout = _rollout_steps(pilot, current, candidate) if classification in ("strongly_recommended", "recommended_with_validation") else None

    analysis = {
        "schemaVersion": 1,
        "status": "insufficient_data" if classification == "insufficient_data" else "complete",
        "calculatedAt": now,
        "currency": currency,
        "scope": {"level": request["scope"]["level"], "id": request["scope"]["id"], "label": scope_label},
        "period": {"from": window["from"], "to": window["to"], "days": window["days"], "label": window["label"]},
        "migrationPercentage": request["migrationPercentage"],
        "current": {**_side(current), "usage": usage},
        "candidate": {**_side(candidate), "projection": candidate_projection},
        "basis": {"current": usage["costBasis"], "usage": "observed", "projection": "modelled"},
        "eligibility": eligibility,
        "financial": financial,
        "breakdown": breakdown,
        "impacts": projection["impacts"] if projection else [],
        "risks": risks,
        "recommendation": {"classification": classification, "label": CLASSIFICATION_LABELS[classification], "reasons": reasons},
        "rolloutPlan": rollout,
        "nextStep": _next_step(classification, current, candidate, pilot, insufficient, blocking, financial),
        "calculationBasis": [],
        "notices": notices,
        "disclaimer": DISCLAIMER,
        "inputs": request,
    }
    analysis["calculationBasis"] = _calculation_basis(analysis, projection, current, candidate)
    return analysis


def _build_breakdown(all_: dict, eligible: dict, p: float, proj: dict, current_pricing: dict | None, candidate_pricing: dict) -> list[dict]:
    P = _rates(candidate_pricing)
    rest_tokens = {c: all_["tokens"][c] - eligible["tokens"][c] for c in CATEGORIES}

    def split(t: dict, observed: float) -> dict | None:
        if not current_pricing:
            return None
        C = _rates(current_pricing)
        listed = _price(t, C)
        if listed <= 0:
            return _zero()
        k = observed / listed
        return {c: (t[c] * C[c] * k) / 1e6 for c in CATEGORIES}

    rest_cost = split(rest_tokens, all_["cost"] - eligible["cost"])
    eligible_cost = split(eligible["tokens"], eligible["cost"])
    labels = {"input": "Input tokens", "output": "Output tokens", "cached": "Cached tokens", "reasoning": "Reasoning tokens"}
    rows = []
    for k in ("input", "output", "cached", "reasoning"):
        both = rest_cost is not None and eligible_cost is not None
        current_cost = rest_cost[k] + eligible_cost[k] if both else None
        projected_cost = rest_cost[k] + (1 - p) * eligible_cost[k] + (proj["candidateRequests"] * proj["perRequest"][k] * P[k]) / 1e6 if both else None
        note = None
        if k == "reasoning" and candidate_pricing.get("reasoningPerMillion") is None:
            note = "Billed as output tokens on the candidate."
        if k == "cached" and candidate_pricing.get("cachedInputPerMillion") is None:
            note = "No cache discount on the candidate; priced as input."
        if not current_pricing:
            note = "Current cost can’t be split by token type without a price list."
        rows.append({
            "id": k,
            "label": labels[k],
            "currentQuantity": all_["tokens"][k],
            "projectedQuantity": rest_tokens[k] + (1 - p) * eligible["tokens"][k] + proj["candidateRequests"] * proj["perRequest"][k],
            "currentCost": current_cost,
            "projectedCost": projected_cost,
            "note": note,
        })
    if proj["errorRateSource"] == "unchanged":
        retry_note = "Retry rate assumed unchanged."
    else:
        retry_note = f"Candidate retry rate {pct(proj['errorRate'])} ({'your assumption' if proj['errorRateSource'] == 'assumption' else 'model expectation'})."
    rows.append({
        "id": "requests",
        "label": "Requests",
        "currentQuantity": len(all_["costed"]),
        "projectedQuantity": len(all_["costed"]) - proj["migratedRequests"] + proj["candidateRequests"],
        "currentCost": all_["cost"],
        "projectedCost": all_["cost"] - proj["migratedCurrentCost"] + proj["migratedProjectedCost"],
        "note": "Totals of the token rows.",
    })
    rows.append({
        "id": "retries",
        "label": "Retries and fallbacks",
        "currentQuantity": all_["retries"],
        "projectedQuantity": all_["retries"] - p * eligible["retries"] + proj["candidateRequests"] * proj["errorRate"],
        "currentCost": all_["retryCost"],
        "projectedCost": all_["retryCost"] - p * eligible["retryCost"] + proj["candidateRequests"] * proj["errorRate"] * proj["costPerRequest"],
        "note": f"Included in the rows above. {retry_note}",
    })
    rows.append({"id": "tools", "label": "Tool or workflow costs", "currentQuantity": None, "projectedQuantity": None, "currentCost": None, "projectedCost": None, "note": "Not available: AxiomFlo doesn’t record tool or workflow charges separately."})
    return rows


def _build_risks(current, candidate, path, usage, projection, a, latency_change, region, cross_provider, eligibility, scoped) -> list[dict]:
    risks: list[dict] = []
    c_regions, c_envs = candidate.get("regions"), candidate.get("environments")

    # Quality
    score, threshold = a.get("evaluationQualityScore"), a.get("qualityThreshold")
    if score is not None and threshold is not None:
        ok = score >= threshold
        risks.append({"kind": "quality", "label": "Quality risk", "level": "low" if ok else "high", "detail": f"Your evaluation scored {js_num(score)} against a threshold of {js_num(threshold)}{'.' if ok else ', so it falls short.'}"})
    elif score is not None:
        risks.append({"kind": "quality", "label": "Quality risk", "level": "medium", "detail": f"Your evaluation scored {js_num(score)}, but no quality threshold is set to compare it with."})
    else:
        evidence = f" On record: {candidate['qualityEvidence']} That isn’t a test of your workloads." if candidate.get("qualityEvidence") else ""
        risks.append({"kind": "quality", "label": "Quality risk", "level": "unknown", "detail": f"{QUALITY_UNKNOWN_MESSAGE}{evidence}"})

    # Latency
    avg_ms = usage["avgLatencyMs"]
    if latency_change is None:
        today = f"; today’s calls average {count(avg_ms)} ms" if avg_ms is not None else ""
        risks.append({"kind": "latency", "label": "Latency risk", "level": "unknown", "detail": f"No latency expectation is on record for {candidate['displayName']}{today}. Measure it in the pilot."})
    else:
        level = "high" if latency_change > UPGRADE_RULES["latencyHighPct"] else "medium" if latency_change > UPGRADE_RULES["latencyMediumPct"] else "low"
        ms = f" (about {count(avg_ms)} ms → {count(avg_ms * (1 + latency_change / 100))} ms)" if avg_ms is not None else ""
        source = ", your assumption" if "latencyChangePct" in a else ", from the model’s published expectation"
        risks.append({"kind": "latency", "label": "Latency risk", "level": level, "detail": f"Expected response time {'falls' if latency_change <= 0 else 'rises'} by {js_num(abs(latency_change))}%{ms}{source}."})

    # Reliability
    current_retry = usage["retries"] / usage["requests"] if usage["requests"] else 0
    parts = [f"Today {pct(usage['errorRate'])} of calls fail, with {plural(usage['retries'], 'retry', 'retries')} and {plural(usage['fallbacks'], 'fallback')}."]
    reliability = "low"
    if projection:
        diff_pp = (projection["errorRate"] - current_retry) * 100
        if projection["errorRateSource"] == "unchanged":
            parts.append("The candidate’s retry rate is assumed unchanged.")
        else:
            parts.append(f"The candidate is expected to need retries on {pct(projection['errorRate'])} of calls.")
        if diff_pp > UPGRADE_RULES["retryHighPp"]:
            reliability = "high"
        elif diff_pp > UPGRADE_RULES["retryMediumPp"]:
            reliability = "medium"
    if candidate["status"] == "preview":
        parts.append("Preview models often have tighter rate limits.")
        if reliability == "low":
            reliability = "medium"
    risks.append({"kind": "reliability", "label": "Reliability risk", "level": reliability, "detail": " ".join(parts)})

    # Tokens
    token_parts: list[str] = []
    if projection:
        if (a.get("inputTokenChangePct") or 0) > 0:
            token_parts.append(f"input tokens +{js_num(a['inputTokenChangePct'])}%")
        if projection["outputChangePct"] > 0:
            token_parts.append(f"output tokens +{js_num(projection['outputChangePct'])}%")
        reasoning_now = usage["avgReasoningTokens"] or 0
        if projection["perRequest"]["reasoning"] > reasoning_now:
            token_parts.append(f"about {count(projection['perRequest']['reasoning'] - reasoning_now)} more reasoning tokens per request")
        cached_now = usage["avgCachedTokens"] or 0
        if cached_now > 0 and projection["perRequest"]["cached"] < cached_now:
            token_parts.append("fewer cached tokens")
    if token_parts:
        risks.append({"kind": "token", "label": "Token risk", "level": "medium", "detail": f"Expected: {', '.join(token_parts)}. A cheaper price per token can still cost more if the model uses more tokens."})
    else:
        risks.append({"kind": "token", "label": "Token risk", "level": "low", "detail": "No token increase is assumed, but a cheaper model can still produce more output or reasoning tokens. Compare token counts in the pilot."})

    # Compatibility
    feature_ineligible = 0
    for r in eligibility["reasons"]:
        if r["reason"].startswith("Needs "):
            feature_ineligible += r["requests"]
    compat: list[str] = []
    if not path:
        compat_level = "high"
        compat.append(f"AxiomFlo has no compatibility record for {current['displayName']} → {candidate['displayName']}. Confirm tool calling, structured output and API behaviour first.")
    elif path["compatibility"] == "not_compatible":
        compat_level = "high"
        compat.append(path["note"])
    else:
        compat_level = "low" if path["compatibility"] == "drop_in" else "medium"
        compat.append(path["note"])
    if cross_provider:
        compat.append("A different provider means a different API, SDK, error handling and tool-calling format.")
        if compat_level == "low":
            compat_level = "medium"
    if feature_ineligible:
        compat.append(f"{plural(feature_ineligible, 'call')} rely on features the candidate lacks and are ineligible.")
    if scoped and all(not r["requiredFeatures"] for r in scoped) and not any(r.get("workflowId") for r in scoped):
        compat.append("AxiomFlo can’t see which API features these calls use, so check structured output and tool calls in the pilot.")
    risks.append({"kind": "compatibility", "label": "Compatibility risk", "level": compat_level, "detail": " ".join(compat)})

    # Financial
    fin: list[str] = []
    fin_level = "low"
    pricing = candidate.get("pricing")
    if not pricing:
        fin_level = "high"
        fin.append(f"No supported price is on record for {candidate['displayName']}.")
    else:
        if pricing.get("validUntil"):
            fin_level = "medium"
            fin.append(f"{candidate['displayName']}’s price applies until {pricing['validUntil']}; after that it changes.")
        if pricing.get("conversionNote"):
            fin.append(pricing["conversionNote"])
    if len(usage["pricingVersions"]) > 1:
        fin_level = "high" if fin_level == "high" else "medium"
        fin.append("Prices changed during the period.")
    fin.append(
        "Current cost is reconciled to the provider bill." if usage["costBasis"] == "reconciled"
        else "Current cost is an estimate from list prices, not invoiced cost; minimum commitments and discounts aren’t included."
    )
    risks.append({"kind": "financial", "label": "Financial risk", "level": fin_level, "detail": " ".join(fin)})

    # Governance
    gov: list[str] = []
    gov_level = "low"
    if region and c_regions and region not in c_regions:
        gov_level = "high"
        gov.append(f"{candidate['displayName']} isn’t available in {region} (available in {', '.join(c_regions)}), which may break data-residency commitments.")
    envs: list[str] = []
    for r in scoped:
        e = r.get("environment")
        if e and e not in envs:
            envs.append(e)
    blocked = [e for e in envs if e not in c_envs] if c_envs else []
    if blocked:
        if gov_level == "low":
            gov_level = "medium"
        gov.append(f"Not approved for {' or '.join(blocked)}.")
    if candidate["status"] == "preview":
        if gov_level == "low":
            gov_level = "medium"
        gov.append("It’s a preview model, which provider terms often exclude from production use.")
    if cross_provider:
        if gov_level == "low":
            gov_level = "medium"
        gov.append(f"{candidate['providerName']} needs its own data-processing, residency and policy review.")
    if a.get("businessCritical"):
        if gov_level == "low":
            gov_level = "medium"
        gov.append("Marked business-critical, so the workflow owner must approve the change.")
    gov.append("Changing production routing always needs explicit human approval; AxiomFlo never switches models itself.")
    risks.append({"kind": "governance", "label": "Governance risk", "level": gov_level, "detail": " ".join(gov)})
    return risks


def _pilot_scope(eligible: list[dict], scopes: dict) -> dict:
    for env in ("development", "staging"):
        if any(r.get("environment") == env for r in eligible):
            return {"label": f"{env} calls", "kind": "environment"}
    by_workflow: dict[str, float] = {}
    for r in eligible:
        if r.get("workflowId"):
            by_workflow[r["workflowId"]] = by_workflow.get(r["workflowId"], 0) + (r.get("cost") or 0)
    if by_workflow:
        cheapest = sorted(by_workflow.items(), key=lambda x: x[1])[0]
        return {"label": f"the {_label_for(scopes, 'workflow', cheapest[0])} workflow", "kind": "workflow"}
    return {"label": "a small, non-critical share of eligible calls", "kind": "scope"}


def _rollout_steps(pilot: dict, current: dict, candidate: dict) -> list[str]:
    return [
        f"Select a low-risk pilot scope: {pilot['label']}{'' if pilot['kind'] == 'environment' else ' (not production-critical)'}.",
        f"Run a side-by-side evaluation of {current['displayName']} and {candidate['displayName']} on representative prompts with expected outputs.",
        "Compare cost, latency, token usage, error rate and quality score against agreed thresholds.",
        f"Move an initial 10–20% of eligible calls to {candidate['displayName']}.",
        "Monitor actual savings against this projection for 7–14 days.",
        "Expand gradually only if actual savings and quality meet the thresholds.",
        f"Keep {current['displayName']} available for rollback, and record the migration decision and who approved it.",
    ]


def _next_step(classification, current, candidate, pilot, insufficient, blocking, financial) -> str:
    if classification == "insufficient_data":
        if insufficient == MISSING_PRICING_MESSAGE:
            return f"Add a supported price for {candidate['displayName'] if not candidate.get('pricing') else current['displayName']}, then run the analysis again."
        if insufficient and insufficient.startswith("Eligibility"):
            return "Confirm which calls can move by adding an eligibility rule (for example, for development or a specific workflow), then run it again."
        return f"Pick a scope or period where {current['displayName']} is used."
    if classification == "not_recommended":
        if blocking:
            return f"Resolve the {blocking[0]['label'].lower()} before reconsidering this migration."
        if financial and financial["savings"] < 0:
            return f"Keep {current['displayName']}. Re-run this analysis if {candidate['displayName']}’s price falls."
        return f"Keep {current['displayName']}; the saving doesn’t justify the migration effort."
    if classification == "conditional":
        return 'Narrow the scope to the calls that clearly qualify, review the calls marked "requires review", or validate the assumptions, then run it again.'
    if classification == "recommended_with_validation":
        return f"Run a side-by-side evaluation on {pilot['label']} before moving any production traffic."
    return f"Move 10–20% of {pilot['label']} to {candidate['displayName']} with explicit approval, and compare actual savings with this projection for 7–14 days."


def _calculation_basis(an: dict, proj: dict | None, current: dict, candidate: dict) -> list[str]:
    c = an["currency"]
    u = an["current"]["usage"]
    lines = [
        f"Current cost: the recorded estimated cost of {plural(u['costedRequests'], current['displayName'] + ' call')} in {an['scope']['label']}, {an['period']['label']}. "
        f"Basis: observed usage, {'reconciled' if u['costBasis'] == 'reconciled' else 'estimated'} cost.",
        f"Eligible calls: {count(an['eligibility']['eligible']['requests'])} of {count(u['requests'])}. {js_num(an['migrationPercentage'])}% of them are assumed to move.",
    ]
    pricing = candidate.get("pricing")
    if proj and pricing:
        cached = pricing["inputPerMillion"] if pricing.get("cachedInputPerMillion") is None else pricing["cachedInputPerMillion"]
        pr = proj["perRequest"]
        lines.append(
            f"Each migrated call is expected to use about {count(pr['input'])} input, {count(pr['cached'])} cached, {count(pr['output'])} output and "
            f"{count(pr['reasoning'])} reasoning tokens, priced at {candidate['displayName']}’s rates: {money(pricing['inputPerMillion'], c)} input, "
            f"{money(cached, c)} cached and {money(pricing['outputPerMillion'], c)} output per million tokens ({pricing['pricingVersion']}). "
            f"That is {money(proj['costPerRequest'], c, True)} per call."
        )
        lines.append(f"Calls that don’t move keep their current cost: the other {js_num(100 - an['migrationPercentage'])}% of eligible calls, ineligible calls and calls that still need review.")
        lines.append("Projected cost = eligible calls × migration percentage × expected tokens per call × candidate price + every other call at its current cost.")
        volume = an["inputs"]["assumptions"].get("requestVolumeChangePct") or 0
        if proj["errorRateSource"] != "unchanged" or volume != 0:
            lines.append(f"Migrated calls are adjusted for a {signed_pct(volume / 100, 0)} volume change and a {pct(proj['errorRate'])} retry rate.")
    lines.append(
        f"Monthly figures scale the {an['period']['days']}-day period to an average month ({to_fixed(UPGRADE_RULES['daysPerMonth'], 2)} days). "
        "Annualised figures are the monthly figure × 12: an extrapolation, not a forecast."
    )
    one_off = an["financial"]["oneOffMigrationCost"] if an["financial"] else None
    if one_off is not None:
        lines.append(f"The one-off migration estimate ({money(one_off, c)}) is shown separately and isn’t subtracted from the savings.")
    return lines


# ---------------------------------------------------------------------------
# The assistant's response format (report.ts summaryLines)
# ---------------------------------------------------------------------------


def summary_lines(a: dict) -> list[str]:
    c = a["currency"]
    f = a["financial"]
    e = a["eligibility"]

    def model_line(m: dict) -> str:
        return f"{m['providerName']} / {m['displayName']} / {m['version']}"

    def impact_text(impact_id: str) -> str:
        i = next((x for x in a["impacts"] if x["id"] == impact_id), None)
        return f"{signed_money(i['amount'], c)} / {signed_pct(i['pctOfMigrated'])}" if i else "Not available"

    lines = [
        "**Upgrade Analysis**",
        "",
        f"**Scope:** {a['scope']['label']}",
        f"**Period:** {a['period']['label']}",
        f"**Current model:** {model_line(a['current'])}",
        f"**Candidate model:** {model_line(a['candidate'])}",
        f"**Migration assumption:** {js_num(a['migrationPercentage'])}% of eligible calls",
        "",
        "**Financial impact** (modelled projection, not a guaranteed saving)",
    ]
    if f:
        lines += [
            f"- Current estimated cost: {money(f['currentCost'], c)} (based on observed usage)",
            f"- Projected cost: {money(f['projectedCost'], c)}",
            f"- Estimated monthly saving: {money(f['monthlySavings'], c)}",
            f"- Estimated annualised saving: {money(f['annualisedSavings'], c)} (extrapolation)",
            f"- Estimated reduction: {'Not available' if f['savingsPct'] is None else pct(f['savingsPct'] / 100)}",
        ]
        if f["oneOffMigrationCost"] is not None:
            payback = f", paid back in about {to_fixed(f['paybackMonths'], 1)} months" if f["paybackMonths"] is not None else ""
            lines.append(f"- One-off migration cost (separate): {money(f['oneOffMigrationCost'], c)}{payback}")
    else:
        reasons = a["recommendation"]["reasons"]
        lines += [f"- {reasons[0] if reasons else 'Cost can’t be calculated.'}", f"- Current calls: {count(a['current']['usage']['requests'])}"]
    lines += [
        "",
        "**What changed**",
        f"- Input-token impact: {impact_text('input_tokens')}",
        f"- Output-token impact: {impact_text('output_tokens')}",
        f"- Request-volume impact: {impact_text('request_volume')}",
        f"- Retry or fallback impact: {impact_text('retries')}",
        f"- Unit-price impact: {impact_text('unit_price')}",
        "",
        "**Eligibility**",
        f"- Eligible calls: {count(e['eligible']['requests'])} / {pct(e['eligible']['share'])}",
        f"- Ineligible calls: {count(e['ineligible']['requests'])} / {pct(e['ineligible']['share'])}",
        f"- Requires review: {count(e['requiresReview']['requests'])} / {pct(e['requiresReview']['share'])}",
        "",
        "**Risks**",
        *[f"- {r['label']} ({r['level']}): {r['detail']}" for r in a["risks"]],
        "",
        f"**Recommendation:** {a['recommendation']['label']}",
        *[f"- {r}" for r in a["recommendation"]["reasons"]],
        "",
        f"**Suggested next step:** {a['nextStep']}",
    ]
    if a["rolloutPlan"]:
        lines += ["", "**Suggested rollout plan** (proposal only; nothing changes without explicit approval)", *[f"{i + 1}. {s}" for i, s in enumerate(a["rolloutPlan"])]]
    lines += ["", a["disclaimer"]]
    return lines


def upgrade_href(request: dict, rules: list[dict] | None = None) -> str:
    """The Upgrade Analysis page with these choices filled in (src/components/upgrade/params.ts),
    plus any eligibility rules to add to the workspace's own."""
    from urllib.parse import urlencode

    scope = request["scope"]
    params = [
        ("current", request["currentModelId"]),
        ("candidate", request["candidateModelId"]),
        ("scope", "company" if scope["level"] == "company" else f"{scope['level']}:{scope['id']}"),
        ("window", request["timeWindow"]["kind"]),
    ]
    if request["timeWindow"]["kind"] == "custom":
        params += [("from", request["timeWindow"]["from"]), ("to", request["timeWindow"]["to"])]
    params.append(("pct", js_num(request["migrationPercentage"])))
    params += [("rule", ":".join([r["decision"], r["level"]] + ([r["targetId"]] if r["targetId"] else []))) for r in rules or []]
    return f"/assistant/upgrade?{urlencode(params)}"
