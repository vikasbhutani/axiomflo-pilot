"""The AxiomFlo Agent as a private web service (Cloud Run service `axiomflo-agent`).

Only the AxiomFlo API calls it. The API has already verified the person (Firebase sign-in
for the web app; a linked account for Slack) and their membership, and sends:

- the trusted context: company, person, role, teams, channel;
- the usage snapshot for that person (docs/agent/usage-snapshot.md);
- the question, or the month for suggestions.

Routes:
  GET  /health          liveness, no data
  POST /v1/ask          {context, question, sessionId?, snapshot}  -> the answer
  POST /v1/suggestions  {context, period, team?, snapshot}         -> savings suggestions, no AI model

Who may call it: on Cloud Run the service is private (no public access), so Google only
lets through callers with the Cloud Run Invoker role, which only the API's service account
has. As a second check, each request's Google ID token must belong to one of
AXIOMFLO_AGENT_ALLOWED_CALLERS. Locally (no K_SERVICE), with no allowed callers set, the
check is off so you can try it with curl.

Run locally:  uvicorn axiomflo.http_service:app --port 8090
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import replace

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .agent.service import AgentService
from .config import DATA_SOURCE_API, Settings
from .context import CHANNELS, ROLES, TrustedContext
from .errors import AgentToolError
from .reporting.snapshot import load_snapshot

logger = logging.getLogger(__name__)

# The API's channels; "cli" and "adk_dev" are local-only and never accepted here.
SERVICE_CHANNELS = ("web", "slack", "microsoft")
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
SESSION_ID_RE = re.compile(r"^s_[0-9a-f]{32}$")
# A snapshot of six months at pilot volumes is well under this.
MAX_BODY_BYTES = 30 * 1024 * 1024


class CallerCheck:
    """Verifies the Google ID token Cloud Run passes through, and who it belongs to."""

    def __init__(self, allowed: list[str], audience: str | None, required: bool) -> None:
        self.allowed = {a.strip().lower() for a in allowed if a.strip()}
        self.audience = audience
        self.required = required or bool(self.allowed)
        if self.required and not self.allowed:
            raise RuntimeError("AXIOMFLO_AGENT_ALLOWED_CALLERS must name the AxiomFlo API's service account on Cloud Run.")

    def __call__(self, request: Request) -> None:
        if not self.required:
            return
        header = request.headers.get("authorization", "")
        if not header.lower().startswith("bearer "):
            raise HTTPException(401, "Missing caller identity.")
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token

        # The token must be made for this service: its configured address, else the address it was called on.
        audience = self.audience or f"https://{request.headers.get('host', '')}"
        try:
            claims = id_token.verify_oauth2_token(header[7:], google_requests.Request(), audience=audience)
        except Exception:
            raise HTTPException(401, "Caller identity could not be verified.") from None
        email = str(claims.get("email", "")).lower()
        if not claims.get("email_verified") or email not in self.allowed:
            raise HTTPException(403, "This caller may not use the AxiomFlo Agent.")


def _context(body: dict, request_id: str | None) -> TrustedContext:
    raw = body.get("context")
    if not isinstance(raw, dict):
        raise HTTPException(400, "context is required.")
    channel = raw.get("channel")
    if channel not in SERVICE_CHANNELS or channel not in CHANNELS:
        raise HTTPException(400, "context.channel is not supported.")
    if raw.get("role") not in ROLES:
        raise HTTPException(400, "context.role is not supported.")
    team_ids = raw.get("teamIds") or []
    if not isinstance(team_ids, list) or not all(isinstance(t, str) for t in team_ids):
        raise HTTPException(400, "context.teamIds must be a list of team IDs.")
    try:
        kwargs = {}
        if request_id and REQUEST_ID_RE.match(request_id):
            kwargs["request_id"] = request_id
        return TrustedContext(
            tenant_id=str(raw.get("tenantId") or ""),
            user_id=str(raw.get("userId") or ""),
            role=raw["role"],
            team_ids=tuple(team_ids),
            channel=channel,
            verified_by=str(raw.get("verifiedBy") or "axiomflo_api"),
            **kwargs,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


def _snapshot(body: dict):
    try:
        return load_snapshot(body.get("snapshot"))
    except AgentToolError as e:
        raise HTTPException(400, e.message) from None


def create_app(service: AgentService | None = None, caller_check: CallerCheck | None = None) -> FastAPI:
    settings = Settings.from_env()
    if service is None:
        if settings.data_source != DATA_SOURCE_API:
            settings = replace(settings, data_source=DATA_SOURCE_API)
        service = AgentService(settings)
    if service.settings.data_source != DATA_SOURCE_API:
        raise RuntimeError("The agent service only answers from real data sent by the AxiomFlo API.")
    check = caller_check or CallerCheck(
        os.environ.get("AXIOMFLO_AGENT_ALLOWED_CALLERS", "").split(","),
        os.environ.get("AXIOMFLO_AGENT_AUDIENCE") or None,
        required=bool(os.environ.get("K_SERVICE")),
    )

    app = FastAPI(title="AxiomFlo Agent", docs_url=None, redoc_url=None, openapi_url=None)

    async def read_body(request: Request) -> dict:
        # Verifying the token may fetch Google's public keys, so keep it off the event loop.
        await run_in_threadpool(check, request)
        length = request.headers.get("content-length")
        if length and int(length) > MAX_BODY_BYTES:
            raise HTTPException(413, "Request too large.")
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "The request body must be JSON.") from None
        if not isinstance(body, dict):
            raise HTTPException(400, "The request body must be a JSON object.")
        return body

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "model_configured": service.model is not None}

    @app.post("/v1/ask")
    async def ask(request: Request) -> dict:
        body = await read_body(request)
        ctx = _context(body, request.headers.get("x-request-id"))
        question = body.get("question")
        if not isinstance(question, str):
            raise HTTPException(400, "question is required.")
        session_id = body.get("sessionId")
        session_id = session_id if isinstance(session_id, str) and SESSION_ID_RE.match(session_id) else None
        snapshot = _snapshot(body)
        try:
            answer = await service.ask(ctx, question, session_id, snapshot=snapshot)
        except ValueError:
            raise HTTPException(403, "The usage data doesn't belong to this person.") from None
        return {
            "status": answer.status,
            "text": answer.text,
            "requestId": answer.request_id,
            "sessionId": answer.session_id,
            "links": answer.links,
            "toolsCalled": answer.tools_called,
        }

    @app.post("/v1/suggestions")
    async def suggestions(request: Request) -> dict:
        body = await read_body(request)
        ctx = _context(body, request.headers.get("x-request-id"))
        period, team = body.get("period"), body.get("team")
        if not isinstance(period, str) or (team is not None and not isinstance(team, str)):
            raise HTTPException(400, "period is required, and team must be text.")
        snapshot = _snapshot(body)
        try:
            return service.call_tool(ctx, "get_savings_suggestions", snapshot=snapshot, period=period, team=team)
        except ValueError:
            raise HTTPException(403, "The usage data doesn't belong to this person.") from None

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException):
        return JSONResponse({"error": {"message": exc.detail}}, status_code=exc.status_code)

    return app


_app: FastAPI | None = None


def __getattr__(name: str):
    # `uvicorn axiomflo.http_service:app` builds the app on first use, so importing this
    # module (in tests) doesn't read the environment.
    global _app
    if name == "app":
        if _app is None:
            logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
            _app = create_app()
        return _app
    raise AttributeError(name)
