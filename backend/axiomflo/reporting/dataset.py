"""Loads a tenant's workspace data.

Milestone 1 reads the labelled sample fixtures exported from the web app
(`npm run agent:fixtures`). Milestone 2 replaces this with the authenticated AxiomFlo
reporting API; until then that source reports "unavailable" rather than falling back.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from zoneinfo import ZoneInfo

from datetime import datetime

from .calculations import CostedRecord, PricingRate, PricingVersion, UsageRecord, cost_record

MOCK_DATA_LABEL = "MOCK DATA: AxiomFlo demo workspace (sample records, illustrative prices)"


@dataclass(frozen=True)
class Team:
    id: str
    name: str
    code: str


@dataclass(frozen=True)
class Person:
    id: str
    name: str
    role: str
    team_id: str
    status: str


@dataclass
class Workspace:
    tenant_id: str
    company_name: str
    currency: str
    timezone: str
    data_label: str
    teams: list[Team]
    people: list[Person]
    applications: dict[str, str]  # id -> name
    providers: dict[str, str]  # id -> display name
    models: dict[str, tuple[str, str]]  # id -> (provider id, display name)
    pricing_versions: list[PricingVersion]
    records: list[UsageRecord]
    controls: list[dict] = field(default_factory=list)
    subscriptions: list[dict] = field(default_factory=list)

    @cached_property
    def costed(self) -> list[CostedRecord]:
        tz = ZoneInfo(self.timezone)
        out = []
        for r in self.records:
            local_date = datetime.fromisoformat(r.timestamp.replace("Z", "+00:00")).astimezone(tz).date().isoformat()
            out.append(cost_record(r, local_date, self.pricing_versions))
        return out

    @cached_property
    def periods(self) -> list[str]:
        """Reporting periods (calendar months in the reporting timezone) with data, oldest first."""
        return sorted({c.local_date[:7] for c in self.costed})

    @cached_property
    def data_as_of(self) -> str | None:
        """Freshness: timestamp of the newest record (UTC)."""
        return max((r.timestamp for r in self.records), default=None)

    def team(self, team_id: str) -> Team | None:
        return next((t for t in self.teams if t.id == team_id), None)

    def person(self, user_id: str) -> Person | None:
        return next((p for p in self.people if p.id == user_id), None)

    def principal_name(self, record: UsageRecord) -> str:
        if record.principal_type == "user":
            p = self.person(record.principal_id)
            return p.name if p else "Unknown user"
        return self.applications.get(record.principal_id, "Unknown application")


def _load_json(path: Path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_fixture_workspace(fixtures_dir: Path) -> Workspace:
    raw = _load_json(fixtures_dir / "demo-workspace.json")
    company = raw["company"]
    workspace = Workspace(
        tenant_id=company["id"],
        company_name=company["name"],
        currency=company["reportingCurrency"],
        timezone=company["reportingTimezone"],
        data_label=MOCK_DATA_LABEL,
        teams=[Team(t["id"], t["name"], t["code"]) for t in raw["teams"]],
        people=[Person(u["id"], u["name"], u["role"], u["teamId"], u["status"]) for u in raw["users"]],
        applications={a["id"]: a["name"] for a in raw["applications"]},
        providers={p["id"]: p["name"] for p in raw["providers"]},
        models={m["id"]: (m["providerId"], m["displayName"]) for m in raw["models"]},
        pricing_versions=[
            PricingVersion(
                v["id"],
                v["label"],
                v["effectiveFrom"],
                v["currency"],
                tuple(PricingRate(r["modelId"], r["inputPerMillion"], r["outputPerMillion"]) for r in v["rates"]),
            )
            for v in raw["pricingVersions"]
        ],
        records=[
            UsageRecord(
                id=r["id"],
                timestamp=r["timestamp"],
                principal_type=r["principal"]["type"],
                principal_id=r["principal"]["id"],
                team_id=r["teamId"],
                team_code=r["teamCode"],
                provider_id=r["providerId"],
                model_id=r["modelId"],
                input_tokens=r["inputTokens"],
                output_tokens=r["outputTokens"],
                request_status=r["requestStatus"],
                cost_status=r["costStatus"],
            )
            for r in raw["usageRecords"]
        ],
    )
    controls = fixtures_dir / "controls.json"
    if controls.exists():
        extra = _load_json(controls)
        workspace.controls = [c for c in extra.get("teamControls", []) if c.get("tenantId") == workspace.tenant_id]
        workspace.subscriptions = [s for s in extra.get("subscriptions", []) if s.get("tenantId") == workspace.tenant_id]
    return workspace


class WorkspaceStore:
    """Tenant ID -> workspace. A tenant only ever receives its own workspace."""

    def __init__(self, workspaces: list[Workspace]) -> None:
        self._by_tenant = {w.tenant_id: w for w in workspaces}

    def get(self, tenant_id: str) -> Workspace | None:
        return self._by_tenant.get(tenant_id)
