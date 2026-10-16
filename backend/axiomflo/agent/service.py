"""The channel-independent AxiomFlo Agent API.

Every channel (web app, Slack, Microsoft) calls AgentService.ask() with a TrustedContext it
built after verifying the person. Business rules and authorization live here and in the
tools, never in a channel adapter.
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field

from google.adk.agents import LlmAgent
from google.adk.models.base_llm import BaseLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from ..config import Settings
from ..context import ContextRegistry, TrustedContext
from ..observability.audit import AuditEvent, AuditLog
from ..reporting.dataset import WorkspaceStore, load_fixture_workspace
from ..reporting.service import ReportingService
from ..tools.read_only import make_read_only_tools
from ..tools.runtime import DirectToolContext, ToolRuntime
from .guardrails import unverified_figures
from .instructions import AGENT_INSTRUCTION

logger = logging.getLogger(__name__)

APP_NAME = "axiomflo_agent"
AGENT_NAME = "axiomflo_agent"
MAX_QUESTION_CHARS = 2000
# The assistant's own model usage is attributed to this workload, separate from customer spend.
ASSISTANT_WORKLOAD = "AxiomFlo assistant"


@dataclass
class AgentAnswer:
    status: str  # "ok" | "unavailable" | "withheld" | "invalid"
    text: str
    request_id: str
    session_id: str | None = None
    data_labels: list[str] = field(default_factory=list)
    tools_called: list[str] = field(default_factory=list)
    links: list[dict] = field(default_factory=list)
    assistant_usage: dict | None = None

    @property
    def is_mock(self) -> bool:
        return any(label.startswith("MOCK DATA") for label in self.data_labels)


def build_model(settings: Settings) -> BaseLlm | None:
    """Gemini on Vertex AI, or None when not configured. No model ID is assumed."""
    if settings.model_problem():
        return None
    from google.adk.models.google_llm import Gemini

    return Gemini(
        model=settings.model,
        client_kwargs={
            "enterprise": True,  # Vertex AI (Gemini Enterprise Agent Platform), not the consumer API
            "project": settings.google_cloud_project,
            "location": settings.google_cloud_location,
        },
    )


def build_agent(tools: list, model: BaseLlm) -> LlmAgent:
    return LlmAgent(
        name=AGENT_NAME,
        description="Answers questions about AxiomFlo AI usage and estimated costs using read-only tools.",
        model=model,
        instruction=AGENT_INSTRUCTION,
        tools=tools,
        # Low temperature: the agent explains figures, it does not need creativity.
        generate_content_config=types.GenerateContentConfig(temperature=0.1),
    )


def default_store(settings: Settings) -> WorkspaceStore:
    if settings.data_source == "fixtures":
        return WorkspaceStore([load_fixture_workspace(settings.fixtures_dir)])
    return WorkspaceStore([])


class AgentService:
    def __init__(
        self,
        settings: Settings,
        store: WorkspaceStore | None = None,
        model: BaseLlm | None = None,
        registry: ContextRegistry | None = None,
        audit: AuditLog | None = None,
    ) -> None:
        self.settings = settings
        self.registry = registry or ContextRegistry()
        self.audit = audit or AuditLog()
        self.runtime = ToolRuntime(settings, ReportingService(settings, store or default_store(settings)), self.registry, self.audit)
        self.tools = {t.__name__: t for t in make_read_only_tools(self.runtime)}
        self.model = model or build_model(settings)
        self.sessions = InMemorySessionService()
        self.runner = Runner(agent=build_agent(list(self.tools.values()), self.model), app_name=APP_NAME, session_service=self.sessions) if self.model else None

    def call_tool(self, ctx: TrustedContext, name: str, **args) -> dict:
        """Runs one read-only tool without the model (local CLI and tests).

        Uses the same registry lookup, scoping and audit as a model-initiated call.
        """
        tool = self.tools.get(name)
        if tool is None:
            raise KeyError(f"Unknown tool {name!r}. Available: {', '.join(self.tools)}.")
        session_id = f"direct_{uuid.uuid4().hex}"
        self.registry.bind(ctx.session_user_id, session_id, ctx)
        try:
            return tool(tool_context=DirectToolContext(ctx.session_user_id, session_id), **args)
        finally:
            self.registry.release(ctx.session_user_id, session_id)

    async def ask(self, ctx: TrustedContext, question: str, session_id: str | None = None) -> AgentAnswer:
        question = (question or "").strip()
        if not question:
            return AgentAnswer("invalid", "Please type a question.", ctx.request_id)
        if len(question) > MAX_QUESTION_CHARS:
            return AgentAnswer("invalid", f"Please keep questions under {MAX_QUESTION_CHARS} characters.", ctx.request_id)
        if self.runner is None:
            # Never answer from fixtures or canned text when the model is missing.
            return AgentAnswer("unavailable", (self.settings.model_problem() or "The AI model is not available.") + " No answer was generated.", ctx.request_id)

        session = await self._session_for(ctx, session_id)
        self.registry.bind(ctx.session_user_id, session.id, ctx)
        started = time.monotonic()
        tool_results: list[dict] = []
        tools_called: list[str] = []
        final_text = ""
        usage = {"prompt_tokens": 0, "output_tokens": 0, "total_tokens": 0, "model_calls": 0}
        outcome = "ok"
        try:
            async for event in self.runner.run_async(
                user_id=ctx.session_user_id,
                session_id=session.id,
                new_message=types.Content(role="user", parts=[types.Part(text=question)]),
            ):
                if event.usage_metadata:
                    usage["model_calls"] += 1
                    usage["prompt_tokens"] += event.usage_metadata.prompt_token_count or 0
                    usage["output_tokens"] += event.usage_metadata.candidates_token_count or 0
                    usage["total_tokens"] += event.usage_metadata.total_token_count or 0
                for call in event.get_function_calls():
                    tools_called.append(call.name)
                for response in event.get_function_responses():
                    if isinstance(response.response, dict):
                        tool_results.append(response.response)
                if event.is_final_response() and event.content and event.content.parts:
                    final_text = "".join(p.text or "" for p in event.content.parts if not getattr(p, "thought", False)).strip()
        except Exception as e:  # model or runtime failure: report it, never substitute fake results
            logger.warning("Agent turn failed: %s", type(e).__name__)
            outcome = "model_unavailable"
            answer = AgentAnswer("unavailable", "The AxiomFlo Agent could not reach its AI model, so no answer was generated. Please try again later.", ctx.request_id, session.id, tools_called=tools_called)
        else:
            answer = self._finish(ctx, session.id, final_text, tool_results, tools_called)
            outcome = answer.status
        finally:
            # Authority lasts for one turn only; the next turn binds a fresh context.
            self.registry.release(ctx.session_user_id, session.id)

        answer.assistant_usage = {
            "workload": ASSISTANT_WORKLOAD,
            "billed_to": "AxiomFlo (the assistant's own Gemini usage, not customer workload spend)",
            "model": getattr(self.model, "model", None),
            "request_id": ctx.request_id,
            **usage,
        }
        self.audit.record(
            AuditEvent(
                kind="agent_turn",
                request_id=ctx.request_id,
                tenant_id=ctx.tenant_id,
                actor_user_id=ctx.user_id,
                role=ctx.role,
                channel=ctx.channel,
                outcome=outcome,
                latency_ms=int((time.monotonic() - started) * 1000),
                scope={"tools": tools_called},
                model_usage=answer.assistant_usage,
            )
        )
        return answer

    def _finish(self, ctx: TrustedContext, session_id: str, text: str, tool_results: list[dict], tools_called: list[str]) -> AgentAnswer:
        labels = sorted({r["data_label"] for r in tool_results if isinstance(r.get("data_label"), str)})
        links = [link for r in tool_results for link in r.get("links", []) if isinstance(link, dict)]
        if not text:
            return AgentAnswer("unavailable", "The AI model returned no answer. Please try again.", ctx.request_id, session_id, labels, tools_called, links)
        problems = unverified_figures(text, tool_results)
        if problems:
            logger.warning("Withheld an answer with %d unverified figure(s).", len(problems))
            message = (
                "I couldn't verify every figure in the generated answer against AxiomFlo's calculations, so I've withheld it. "
                "Please use the links to see the figures directly, or ask again."
            )
            return AgentAnswer("withheld", message, ctx.request_id, session_id, labels, tools_called, links)
        return AgentAnswer("ok", text, ctx.request_id, session_id, labels, tools_called, links)

    async def _session_for(self, ctx: TrustedContext, session_id: str | None):
        if session_id:
            # Sessions are looked up under this tenant+channel+user only, so one person can
            # never continue another person's (or another company's) conversation.
            existing = await self.sessions.get_session(app_name=APP_NAME, user_id=ctx.session_user_id, session_id=session_id)
            if existing:
                return existing
        return await self.sessions.create_session(app_name=APP_NAME, user_id=ctx.session_user_id, session_id=f"s_{uuid.uuid4().hex}")
