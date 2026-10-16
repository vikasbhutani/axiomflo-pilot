"""Shared plumbing for agent tools: trusted-context lookup, error handling and audit."""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Callable

from google.adk.tools import ToolContext

from ..config import Settings
from ..context import ContextRegistry, TrustedContext
from ..errors import AgentToolError
from ..observability.audit import AuditEvent, AuditLog
from ..reporting.dataset import Person, Workspace
from ..reporting.service import ReportingService

logger = logging.getLogger(__name__)

NO_CONTEXT_MESSAGE = (
    "This conversation is not linked to a verified AxiomFlo account, so no cost data can be shown. "
    "Sign in to AxiomFlo and link your account first."
)


@dataclass
class ToolRuntime:
    settings: Settings
    reporting: ReportingService
    registry: ContextRegistry
    audit: AuditLog

    def run(
        self,
        tool_context: ToolContext,
        tool_name: str,
        scope_args: dict,
        body: Callable[[TrustedContext, Workspace, Person], dict],
    ) -> dict:
        """Runs a tool body with the server-held context for this session.

        The context comes from the registry, keyed by the ADK session the model is running
        in. The model cannot choose it: it is not a tool argument, and arguments the model
        invents (such as a tenant ID) are dropped before the tool runs.
        """
        ctx = self.registry.lookup(tool_context.user_id, tool_context.session.id)
        if ctx is None:
            return {"status": "error", "error": {"code": "not_linked", "message": NO_CONTEXT_MESSAGE}}

        started = time.monotonic()
        try:
            ws, viewer = self.reporting.workspace_for(ctx)
            result = body(ctx, ws, viewer)
            outcome = "ok"
        except AgentToolError as e:
            result, outcome = e.to_result(), e.code
        except Exception:  # never leak internals to the model or the user
            logger.exception("Tool %s failed", tool_name)
            result = {"status": "error", "error": {"code": "unavailable", "message": "This information is unavailable right now because of an internal error."}}
            outcome = "internal_error"

        self.audit.record(
            AuditEvent(
                kind="tool_call",
                request_id=ctx.request_id,
                tenant_id=ctx.tenant_id,
                actor_user_id=ctx.user_id,
                role=ctx.role,
                channel=ctx.channel,
                tool=tool_name,
                scope={k: v for k, v in scope_args.items() if v not in (None, "")},
                outcome=outcome,
                latency_ms=int((time.monotonic() - started) * 1000),
            )
        )
        return result


class _Session:
    def __init__(self, session_id: str) -> None:
        self.id = session_id


class DirectToolContext:
    """Minimal stand-in for ADK's ToolContext, for calling a tool without a model
    (the local CLI and tests). It carries only the session identity; the trusted
    context is still looked up in the registry."""

    def __init__(self, user_id: str, session_id: str) -> None:
        self.user_id = user_id
        self.session = _Session(session_id)
