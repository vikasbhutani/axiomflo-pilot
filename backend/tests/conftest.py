from __future__ import annotations

import copy
import json
from dataclasses import replace
from typing import AsyncGenerator, Callable

import pytest
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from axiomflo.agent.service import AgentService
from axiomflo.config import DEFAULT_FIXTURES_DIR, Settings
from axiomflo.context import TrustedContext
from axiomflo.reporting.dataset import Workspace, WorkspaceStore, load_fixture_workspace


@pytest.fixture(scope="session")
def acme() -> Workspace:
    return load_fixture_workspace(DEFAULT_FIXTURES_DIR)


@pytest.fixture(scope="session")
def globex(acme: Workspace) -> Workspace:
    """A second tenant with the same people IDs but its own (doubled) usage, to prove isolation."""
    other = copy.deepcopy(acme)
    other.__dict__.pop("costed", None)
    other.__dict__.pop("periods", None)
    other.tenant_id = "co-globex"
    other.company_name = "Globex (test tenant)"
    other.records = other.records + [replace(r, id=r.id + "_dup") for r in other.records]
    return other


@pytest.fixture(scope="session")
def golden() -> dict:
    return json.loads((DEFAULT_FIXTURES_DIR / "golden-totals.json").read_text())


@pytest.fixture
def settings() -> Settings:
    return Settings()


def ctx_for(ws: Workspace, user_id: str, *, channel: str = "web", role: str | None = None, tenant_id: str | None = None) -> TrustedContext:
    person = ws.person(user_id)
    return TrustedContext(
        tenant_id=tenant_id or ws.tenant_id,
        user_id=user_id,
        role=role or (person.role if person else "individual_user"),
        team_ids=(person.team_id,) if person else (),
        channel=channel,
        verified_by="test",
    )


class ScriptedModel(BaseLlm):
    """Stand-in for Gemini in tests: plays back a fixed script and records what it was sent.

    Each step is {"call": name, "args": {...}} or {"text": str | callable(tool_responses) -> str}.
    It can also behave like a compromised model that follows injected instructions.
    """

    model: str = "scripted-test-model"
    steps: list = []
    requests: list = []
    fail_with: str | None = None

    async def generate_content_async(self, llm_request: LlmRequest, stream: bool = False) -> AsyncGenerator[LlmResponse, None]:
        self.requests.append(llm_request)
        if self.fail_with:
            raise RuntimeError(self.fail_with)
        step = self.steps.pop(0) if self.steps else {"text": "Done."}
        usage = types.GenerateContentResponseUsageMetadata(prompt_token_count=100, candidates_token_count=20, total_token_count=120)
        if "call" in step:
            part = types.Part(function_call=types.FunctionCall(name=step["call"], args=step.get("args", {})))
        else:
            text = step["text"]
            if callable(text):
                responses = [p.function_response.response for c in llm_request.contents for p in (c.parts or []) if p.function_response]
                text = text(responses)
            part = types.Part(text=text)
        yield LlmResponse(content=types.Content(role="model", parts=[part]), usage_metadata=usage)


@pytest.fixture
def make_service(acme: Workspace, globex: Workspace) -> Callable[..., tuple[AgentService, ScriptedModel]]:
    def factory(steps: list | None = None, *, settings: Settings | None = None, fail_with: str | None = None):
        model = ScriptedModel(steps=list(steps or []), requests=[], fail_with=fail_with)
        service = AgentService(settings or Settings(), store=WorkspaceStore([acme, globex]), model=model)
        return service, model

    return factory


@pytest.fixture(scope="session")
def snapshot_raw() -> dict:
    """The sample usage snapshot, as the AxiomFlo API sends it for the admin (uid-ava)."""
    return json.loads((DEFAULT_FIXTURES_DIR / "sample-snapshot.json").read_text())


@pytest.fixture(scope="session")
def snapshot_golden() -> dict:
    return json.loads((DEFAULT_FIXTURES_DIR / "sample-snapshot-golden.json").read_text())


def snapshot_ctx(ws: Workspace, *, channel: str = "web") -> TrustedContext:
    """The context the API sends with a snapshot: the person it was made for."""
    viewer = ws.person(ws.snapshot_viewer_id)
    return TrustedContext(ws.tenant_id, viewer.id, viewer.role, viewer.team_ids, channel, "test")


def as_viewer(raw: dict, uid: str, role: str, team_ids: list[str], *, filter_records: bool = True) -> dict:
    """A copy of the snapshot as the API would send it to someone else.

    filter_records=False keeps everyone's records, to prove the agent still scopes them.
    """
    out = copy.deepcopy(raw)
    out["viewer"] = {"uid": uid, "role": role, "teamIds": team_ids, "status": "active"}
    if filter_records:
        for month in out["usage"]:
            month["records"] = [r for r in month["records"] if r["principal"]["id"] == uid]
    return out
