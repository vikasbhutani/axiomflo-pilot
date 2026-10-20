"""Builds a Workspace from a usage snapshot sent by the AxiomFlo API.

For each question about real data, the API (which has already verified the person and
their membership) sends the records that person may see, using the same report routes as
the web app's real pages. The agent never reads the database itself. The contract is in
docs/agent/usage-snapshot.md; fixtures/sample-snapshot.json is an example.

Money follows src/reports/realData.ts exactly, so totals match the real pages:
- each record carries the gateway's USD estimate;
- it is shown in the reporting currency at the month's exchange rate, else the latest
  earlier month's, else the earliest one's;
- with no usable rate at all, amounts stay in USD and the answer says so;
- a missing cost is never zero.
"""
from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

from ..context import ROLES
from ..errors import AgentToolError
from .calculations import CostedRecord, UsageRecord
from .dataset import SCOPE_OWN_REQUESTS, SOURCE_SNAPSHOT, Person, Team, Workspace

SNAPSHOT_VERSION = 1
SNAPSHOT_DATA_LABEL = "AxiomFlo usage records from the gateway (costs estimated from provider list prices)"
PROVIDER_NAMES = {"anthropic": "Anthropic (Claude API)", "gemini_vertex": "Gemini on Vertex AI"}
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
MAX_MONTHS = 6

_CLAUDE_RE = re.compile(r"^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$")
_GEMINI_RE = re.compile(r"^gemini-[a-z0-9.-]+$")


class InvalidSnapshot(AgentToolError):
    code = "invalid_snapshot"


def model_display_name(model_id: str) -> str:
    """Same rule as the web app: "claude-sonnet-5-5" -> "Claude Sonnet 5.5"."""
    m = _CLAUDE_RE.match(model_id)
    if m:
        family, major, minor = m.group(1), m.group(2), m.group(3)
        return f"Claude {family[0].upper()}{family[1:]} {major}{'.' + minor if minor else ''}"
    if _GEMINI_RE.match(model_id):
        return " ".join(p if p[:1].isdigit() else p[:1].upper() + p[1:] for p in model_id.split("-"))
    return model_id


def rate_for(month: str, rates: list[dict]) -> dict | None:
    """The month's own rate, else the latest earlier one, else the earliest one."""
    ordered = sorted(rates, key=lambda r: r["month"])
    if not ordered:
        return None
    earlier = [r for r in ordered if r["month"] <= month]
    return earlier[-1] if earlier else ordered[0]


def _month_name(month: str) -> str:
    return datetime.strptime(month, "%Y-%m").strftime("%B %Y")


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise InvalidSnapshot(f"The usage snapshot is malformed: {message}.")


def _tokens(value) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def load_snapshot(raw: dict) -> Workspace:
    _require(isinstance(raw, dict) and raw.get("snapshotVersion") == SNAPSHOT_VERSION, f"snapshotVersion must be {SNAPSHOT_VERSION}")
    company, viewer = raw.get("company") or {}, raw.get("viewer") or {}
    _require(isinstance(company.get("id"), str) and company["id"], "company.id is missing")
    _require(isinstance(viewer.get("uid"), str) and viewer["uid"], "viewer.uid is missing")
    _require(viewer.get("role") in ROLES, "viewer.role is unknown")
    reporting_currency = company.get("reportingCurrency") or "USD"
    tz = ZoneInfo(company.get("reportingTimezone") or "Australia/Sydney")

    usage = raw.get("usage")
    _require(isinstance(usage, list) and 0 < len(usage) <= MAX_MONTHS, f"usage must hold 1 to {MAX_MONTHS} months")
    months = [u.get("month") for u in usage]
    _require(all(isinstance(m, str) and MONTH_RE.match(m) for m in months) and len(set(months)) == len(months), "usage months must be distinct YYYY-MM values")

    same_currency = reporting_currency == "USD"
    usable_rates = [
        r for r in raw.get("exchangeRates") or []
        if isinstance(r, dict) and r.get("currency") == reporting_currency and isinstance(r.get("rate"), (int, float)) and r["rate"] > 0 and isinstance(r.get("month"), str)
    ]
    usd_fallback = not same_currency and not usable_rates
    currency = "USD" if same_currency or usd_fallback else reporting_currency

    teams = [Team(t["id"], t["name"], t["code"]) for t in raw.get("teams") or [] if isinstance(t, dict) and t.get("id")]
    names: dict[str, str] = {}
    precosted: list[CostedRecord] = []
    records: list[UsageRecord] = []
    for month_usage in usage:
        for uid, p in (month_usage.get("people") or {}).items():
            if isinstance(p, dict):
                names[uid] = p.get("name") or p.get("email") or "Unknown person"
        for r in month_usage.get("records") or []:
            try:
                record = UsageRecord(
                    id=r["id"],
                    timestamp=r["timestamp"],
                    principal_type=r["principal"]["type"],
                    principal_id=r["principal"]["id"],
                    team_id=r["teamId"],
                    team_code=r["teamCode"],
                    provider_id=r["providerId"],
                    model_id=r["modelId"],
                    input_tokens=_tokens(r.get("inputTokens")),
                    output_tokens=_tokens(r.get("outputTokens")),
                    request_status=r["requestStatus"],
                    cost_status=r["costStatus"],
                    cache_write_tokens=_tokens(r.get("cacheWriteTokens")),
                    cache_read_tokens=_tokens(r.get("cacheReadTokens")),
                )
                local_date = datetime.fromisoformat(record.timestamp.replace("Z", "+00:00")).astimezone(tz).date().isoformat()
            except (KeyError, TypeError, ValueError) as e:
                raise InvalidSnapshot(f"The usage snapshot is malformed: a record could not be read ({type(e).__name__}).") from None
            usd = r.get("estimatedCostUsd")
            usd = usd if isinstance(usd, (int, float)) and not isinstance(usd, bool) and usd >= 0 else None
            rate = None if same_currency or usd_fallback else rate_for(local_date[:7], usable_rates)
            cost = None if usd is None else usd if rate is None else usd * rate["rate"]
            records.append(record)
            precosted.append(CostedRecord(record, local_date, cost, r.get("priceVersion") if cost is not None else None))

    # Records can name a team the viewer isn't assigned to any more; show its code.
    known = {t.id for t in teams}
    for r in records:
        if r.team_id not in known:
            teams.append(Team(r.team_id, r.team_code, r.team_code))
            known.add(r.team_id)

    viewer_person = Person(
        id=viewer["uid"],
        name=viewer.get("name") or viewer.get("email") or names.get(viewer["uid"]) or "You",
        role=viewer["role"],
        team_ids=tuple(t for t in viewer.get("teamIds") or [] if isinstance(t, str)),
        status=viewer.get("status") or "active",
    )
    people = [viewer_person] + [Person(uid, name, "unknown", (), "active") for uid, name in names.items() if uid != viewer_person.id]

    notes: dict[str, str] = {}
    rate_missing: list[str] = []
    for month in months:
        if same_currency:
            continue
        if usd_fallback:
            notes[month] = f"No USD to {reporting_currency} exchange rate is set, so amounts are shown in USD."
            rate_missing.append(month)
            continue
        used = rate_for(month, usable_rates)
        if used["month"] == month:
            notes[month] = f"USD estimates converted at {used['rate']} {reporting_currency} per USD, the rate set for {_month_name(month)}."
        else:
            rate_missing.append(month)
            notes[month] = (
                f"{_month_name(month)} has no exchange rate of its own, so USD estimates are converted at "
                f"{used['rate']} {reporting_currency} per USD, the rate set for {_month_name(used['month'])}."
            )

    models = {r.model_id: (r.provider_id, model_display_name(r.model_id)) for r in records}
    return Workspace(
        tenant_id=company["id"],
        company_name=company.get("name") or "Your company",
        currency=currency,
        timezone=str(tz),
        data_label=SNAPSHOT_DATA_LABEL,
        teams=teams,
        people=people,
        applications={},
        providers=dict(PROVIDER_NAMES),
        models=models,
        pricing_versions=[],
        records=records,
        source=SOURCE_SNAPSHOT,
        individual_scope=SCOPE_OWN_REQUESTS,
        precosted=precosted,
        loaded_periods=months,
        currency_notes=notes,
        rate_missing_periods=tuple(rate_missing),
        snapshot_viewer_id=viewer_person.id,
        upgrade=_upgrade_block(raw.get("upgrade")),
    )


def _upgrade_block(raw) -> dict | None:
    """The Upgrade Analysis inputs, with records expanded from columns and rows. Older API
    versions don't send them, so a missing block just means the analysis isn't available."""
    if raw is None:
        return None
    try:
        _require(isinstance(raw, dict) and raw.get("version") == 1, "upgrade.version must be 1")
        for key in ("today", "from", "currency", "companyLabel"):
            _require(isinstance(raw.get(key), str), f"upgrade.{key} is missing")
        _require(isinstance(raw.get("catalogue"), list), "upgrade.catalogue is missing")
        teams = (raw.get("scopes") or {}).get("team")
        _require(isinstance(teams, list), "upgrade.scopes.team is missing")
        columns, rows = raw["records"]["columns"], raw["records"]["rows"]
        _require(isinstance(columns, list) and isinstance(rows, list), "upgrade.records is malformed")
        records = [dict(zip(columns, row, strict=True)) for row in rows]
    except (KeyError, TypeError, ValueError) as e:
        raise InvalidSnapshot(f"The usage snapshot is malformed: the upgrade inputs could not be read ({type(e).__name__}).") from None
    return {**raw, "records": records, "scopes": {"team": teams}, "defaultRules": raw.get("defaultRules") or [], "notes": raw.get("notes") or []}
