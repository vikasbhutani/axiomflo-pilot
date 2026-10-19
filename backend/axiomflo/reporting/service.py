"""Scoped, read-only reporting queries.

Every query starts from the server-supplied TrustedContext. Tenant and visibility filters
are applied here, never by the model:

- Company Admin: every record in their own company.
- Individual User: only requests they made themselves. In the demo workspace that is also
  limited to their own team (src/lib/permissions.ts); with real data it matches the API,
  which shows all of a person's own requests. The API has already applied this before
  sending a snapshot; it is applied again here as a second line of defence.

Queries are fixed templates with validated parameters and hard limits; there is no way to
run arbitrary filters or SQL.
"""
from __future__ import annotations

import calendar
import re
import threading
from dataclasses import dataclass
from urllib.parse import urlencode

from ..config import DATA_SOURCE_API, Settings
from ..context import TrustedContext
from ..errors import AccessDenied, AgentToolError, InvalidArgument, ServiceUnavailable
from .calculations import CostedRecord
from .dataset import SCOPE_OWN_REQUESTS, Person, Team, Workspace, WorkspaceStore

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
        if is_admin:
            visibility = "Company Admin: all requests in the company"
        elif ws.individual_scope == SCOPE_OWN_REQUESTS:
            visibility = "Individual User: only your own requests"
        else:
            own_team = ws.team(self.viewer.team_id)
            visibility = f"Individual User: only your own requests in {own_team.name if own_team else 'your team'}"
        return {"level": self.level, **parts, "visibility": visibility}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


class TurnWorkspaces:
    """Real data for one question: request ID -> the snapshot the API sent with it.

    A snapshot lives for exactly one turn, like the trusted context it was sent with.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._by_request: dict[str, Workspace] = {}

    def bind(self, ctx: TrustedContext, ws: Workspace) -> None:
        if ws.tenant_id != ctx.tenant_id:
            raise ValueError("A snapshot can only be used for its own company.")
        if ws.snapshot_viewer_id != ctx.user_id or ws.person(ctx.user_id) is None:
            raise ValueError("A snapshot can only be used by the person it was made for.")
        with self._lock:
            self._by_request[ctx.request_id] = ws

    def lookup(self, ctx: TrustedContext) -> Workspace | None:
        with self._lock:
            return self._by_request.get(ctx.request_id)

    def release(self, ctx: TrustedContext) -> None:
        with self._lock:
            self._by_request.pop(ctx.request_id, None)


class ReportingService:
    def __init__(self, settings: Settings, store: WorkspaceStore | None, turns: TurnWorkspaces | None = None) -> None:
        self.settings = settings
        self.store = store
        self.turns = turns or TurnWorkspaces()

    # -- access ---------------------------------------------------------------

    def workspace_for(self, ctx: TrustedContext) -> tuple[Workspace, Person]:
        if self.settings.data_source == DATA_SOURCE_API:
            # Real data only ever comes from the snapshot sent with this question. Never fall back to fixtures.
            ws = self.turns.lookup(ctx)
            if ws is None:
                raise ServiceUnavailable("AxiomFlo didn't send any usage data with this question, so cost data is unavailable. No sample data was used.")
        else:
            ws = self.store.get(ctx.tenant_id) if self.store else None
        if ws is None or ws.tenant_id != ctx.tenant_id:
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
            visible = ws.teams if ctx.is_admin else [t for t in ws.teams if t.id in viewer.team_ids]
            raise InvalidArgument(f"Unknown team {team!r}. Teams you can ask about: {', '.join(t.name for t in visible)}.")
        if not ctx.is_admin and match.id not in viewer.team_ids:
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
        if not ws.is_sample:
            return (
                f"The assistant can look at {ws.periods[0]} to {ws.periods[-1]}, so {period} isn't available here. "
                "The Overview and Monthly Showback pages cover other months."
            )
        return f"There is no usage data for {period}. Data covers {ws.periods[0]} to {ws.periods[-1]}."

    # -- record selection -------------------------------------------------------

    def select(self, ctx: TrustedContext, ws: Workspace, viewer: Person, period: str, scope: Scope) -> list[CostedRecord]:
        out = []
        for c in ws.costed:
            r = c.record
            if not c.local_date.startswith(period):
                continue
            if not ctx.is_admin:
                if not (r.principal_type == "user" and r.principal_id == viewer.id):
                    continue
                if ws.individual_scope != SCOPE_OWN_REQUESTS and r.team_id not in viewer.team_ids:
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
        if scope.workspace.is_sample:
            start, end = period_bounds(period)
            params = {"from": start, "to": end}
        else:
            # The real Usage Explorer takes a reporting month.
            params = {"month": period}
        if scope.team:
            params["team"] = scope.team.id
        if scope.provider_id:
            params["provider"] = scope.provider_id
        if scope.cost_status:
            params["cost"] = scope.cost_status
        return f"{self.settings.web_base_url}/usage?{urlencode(params)}"

    def request_link(self, c: CostedRecord, ws: Workspace) -> str:
        params = {"from": c.local_date, "to": c.local_date} if ws.is_sample else {"month": c.local_date[:7]}
        return f"{self.settings.web_base_url}/usage?{urlencode({**params, 'request': c.record.id})}"


def period_bounds(period: str) -> tuple[str, str]:
    y, m = (int(x) for x in period.split("-"))
    return f"{period}-01", f"{period}-{calendar.monthrange(y, m)[1]:02d}"


def previous_period(period: str) -> str:
    y, m = (int(x) for x in period.split("-"))
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"
