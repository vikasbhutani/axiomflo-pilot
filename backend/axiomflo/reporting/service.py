"""Scoped, read-only reporting queries.

Every query starts from the server-supplied TrustedContext. Tenant and visibility filters
are applied here, never by the model:

- Company Admin: every record in their own company.
- Individual User: only requests they made themselves, within their own team (the same
  rule the web app uses in src/lib/permissions.ts).

Queries are fixed templates with validated parameters and hard limits; there is no way to
run arbitrary filters or SQL.
"""
from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from urllib.parse import urlencode

from ..config import DATA_SOURCE_API, Settings
from ..context import TrustedContext
from ..errors import AccessDenied, AgentToolError, InvalidArgument, ServiceUnavailable
from .calculations import CostedRecord
from .dataset import Person, Team, Workspace, WorkspaceStore

PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
COST_STATUSES = ("reconciled", "estimated", "unavailable")


class InsufficientData(AgentToolError):
    code = "insufficient_data"


@dataclass(frozen=True)
class Scope:
    """What a result covers, after access rules are applied."""

    workspace: Workspace
    viewer: Person
    team: Team | None = None
    provider_id: str | None = None
    model_id: str | None = None
    cost_status: str | None = None

    @property
    def level(self) -> str:
        if self.model_id:
            return "model"
        if self.provider_id:
            return "provider"
        if self.team:
            return "team"
        return "company"

    def describe(self, is_admin: bool) -> dict:
        ws = self.workspace
        parts = {"company": ws.company_name}
        if self.team:
            parts["team"] = self.team.name
        if self.provider_id:
            parts["provider"] = ws.providers.get(self.provider_id, self.provider_id)
        if self.model_id:
            parts["model"] = ws.models.get(self.model_id, ("", self.model_id))[1]
        if self.cost_status:
            parts["cost_status_filter"] = self.cost_status
        visibility = (
            "Company Admin: all requests in the company"
            if is_admin
            else f"Individual User: only your own requests in {ws.team(self.viewer.team_id).name if ws.team(self.viewer.team_id) else 'your team'}"
        )
        return {"level": self.level, **parts, "visibility": visibility}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


class ReportingService:
    def __init__(self, settings: Settings, store: WorkspaceStore) -> None:
        self.settings = settings
        self.store = store

    # -- access ---------------------------------------------------------------

    def workspace_for(self, ctx: TrustedContext) -> tuple[Workspace, Person]:
        if self.settings.data_source == DATA_SOURCE_API:
            # Milestone 2 connects the authenticated reporting API. Never fall back to fixtures.
            raise ServiceUnavailable(
                "AxiomFlo reporting is not connected yet, so cost data is unavailable. No sample data was used."
            )
        ws = self.store.get(ctx.tenant_id)
        if ws is None:
            raise AccessDenied("There is no AxiomFlo workspace for this account.")
        person = ws.person(ctx.user_id)
        if person is None or person.status != "active" or person.role != ctx.role:
            raise AccessDenied("This account does not have an active AxiomFlo membership for this company.")
        return ws, person

    # -- argument resolution (always within the caller's own tenant) ------------

    def resolve_team(self, ctx: TrustedContext, ws: Workspace, viewer: Person, team: str | None) -> Team | None:
        if not team:
            return None
        key = _norm(team)
        match = next((t for t in ws.teams if key in (_norm(t.id), _norm(t.code), _norm(t.name))), None)
        if match is None:
            visible = ws.teams if ctx.is_admin else [t for t in ws.teams if t.id == viewer.team_id]
            raise InvalidArgument(f"Unknown team {team!r}. Teams you can ask about: {', '.join(t.name for t in visible)}.")
        if not ctx.is_admin and match.id != viewer.team_id:
            raise AccessDenied("Individual Users can only see their own requests in their own team.")
        return match

    def resolve_provider(self, ws: Workspace, provider: str | None) -> str | None:
        if not provider:
            return None
        key = _norm(provider)
        aliases = {
            "gemini_vertex": ("gemini", "vertex", "vertex ai", "gemini on vertex ai", "google"),
            "anthropic": ("claude", "anthropic"),
        }
        for pid, name in ws.providers.items():
            if key in (_norm(pid), _norm(name)) or key in aliases.get(pid, ()):
                return pid
        raise InvalidArgument(f"Unknown provider {provider!r}. Configured providers: {', '.join(ws.providers.values())}.")

    def resolve_model(self, ws: Workspace, model: str | None) -> str | None:
        if not model:
            return None
        key = _norm(model)
        for mid, (_, name) in ws.models.items():
            if key in (_norm(mid), _norm(name)):
                return mid
        raise InvalidArgument(f"Unknown model {model!r}. Configured models: {', '.join(n for _, n in ws.models.values())}.")

    def validate_period(self, ws: Workspace, period: str, *, allow_missing: bool = False) -> str:
        period = (period or "").strip()
        if not PERIOD_RE.match(period):
            raise InvalidArgument("Periods are calendar months written as YYYY-MM, for example 2026-09.")
        if period not in ws.periods and not allow_missing:
            raise InsufficientData(self.coverage_message(ws, period))
        return period

    @staticmethod
    def coverage_message(ws: Workspace, period: str) -> str:
        if not ws.periods:
            return "There is no usage data yet."
        return f"There is no usage data for {period}. Data covers {ws.periods[0]} to {ws.periods[-1]}."

    # -- record selection -------------------------------------------------------

    def select(self, ctx: TrustedContext, ws: Workspace, viewer: Person, period: str, scope: Scope) -> list[CostedRecord]:
        out = []
        for c in ws.costed:
            r = c.record
            if not c.local_date.startswith(period):
                continue
            if not ctx.is_admin and not (r.principal_type == "user" and r.principal_id == viewer.id and r.team_id == viewer.team_id):
                continue
            if scope.team and r.team_id != scope.team.id:
                continue
            if scope.provider_id and r.provider_id != scope.provider_id:
                continue
            if scope.model_id and r.model_id != scope.model_id:
                continue
            if scope.cost_status and r.cost_status != scope.cost_status:
                continue
            out.append(c)
        return out

    # -- links to supporting records in the web app ------------------------------

    def usage_link(self, period: str, scope: Scope) -> str:
        start, end = period_bounds(period)
        params = {"from": start, "to": end}
        if scope.team:
            params["team"] = scope.team.id
        if scope.provider_id:
            params["provider"] = scope.provider_id
        if scope.cost_status:
            params["cost"] = scope.cost_status
        return f"{self.settings.web_base_url}/usage?{urlencode(params)}"

    def request_link(self, c: CostedRecord) -> str:
        return f"{self.settings.web_base_url}/usage?{urlencode({'from': c.local_date, 'to': c.local_date, 'request': c.record.id})}"


def period_bounds(period: str) -> tuple[str, str]:
    y, m = (int(x) for x in period.split("-"))
    return f"{period}-01", f"{period}-{calendar.monthrange(y, m)[1]:02d}"


def previous_period(period: str) -> str:
    y, m = (int(x) for x in period.split("-"))
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"
