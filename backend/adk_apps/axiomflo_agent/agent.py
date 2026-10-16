"""Entry point for Google's local developer UI (`adk web adk_apps`). Sample data only.

The ADK developer UI has no AxiomFlo sign-in, so this file acts as one fixed demo persona
(AXIOMFLO_DEV_PERSONA, default "maya"). It refuses to start with any data source other
than the sample fixtures, so it can never expose real company data.
"""
from __future__ import annotations

import os

from axiomflo.agent.service import build_agent, build_model
from axiomflo.config import DATA_SOURCE_FIXTURES, Settings
from axiomflo.context import TrustedContext
from axiomflo.observability.audit import AuditLog
from axiomflo.personas import persona_context
from axiomflo.reporting.dataset import WorkspaceStore, load_fixture_workspace
from axiomflo.reporting.service import ReportingService
from axiomflo.tools.read_only import make_read_only_tools
from axiomflo.tools.runtime import ToolRuntime


class FixedPersonaRegistry:
    """Dev-only registry: every session in the developer UI acts as one demo persona."""

    def __init__(self, ctx: TrustedContext) -> None:
        self._ctx = ctx

    def lookup(self, session_user_id: str, session_id: str) -> TrustedContext:
        return self._ctx


_settings = Settings.from_env()
if _settings.data_source != DATA_SOURCE_FIXTURES:
    raise RuntimeError("The ADK developer UI entry point only runs with AXIOMFLO_DATA_SOURCE=fixtures.")
_model = build_model(_settings)
if _model is None:
    raise RuntimeError(_settings.model_problem() + " See backend/README.md, 'Try one live question'.")

_workspace = load_fixture_workspace(_settings.fixtures_dir)
_ctx = persona_context(_settings, _workspace, os.environ.get("AXIOMFLO_DEV_PERSONA", "maya"), channel="adk_dev")
_runtime = ToolRuntime(_settings, ReportingService(_settings, WorkspaceStore([_workspace])), FixedPersonaRegistry(_ctx), AuditLog())

root_agent = build_agent(make_read_only_tools(_runtime), _model)
