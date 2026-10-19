"""The private web service the AxiomFlo API calls."""
from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from axiomflo.agent.service import AgentService
from axiomflo.config import Settings
from axiomflo.http_service import CallerCheck, create_app

from .conftest import ScriptedModel, as_viewer

API = Settings(data_source="axiomflo_api")
ADMIN = {"tenantId": "pilot", "userId": "uid-ava", "role": "company_admin", "teamIds": ["team-platform"], "channel": "web", "verifiedBy": "firebase_id_token"}


def client(steps=None, check=None) -> TestClient:
    model = ScriptedModel(steps=list(steps or []), requests=[]) if steps is not None else None
    service = AgentService(API, model=model) if model else AgentService(API)
    return TestClient(create_app(service, check or CallerCheck([], None, required=False)))


def test_health_has_no_data():
    assert client().get("/health").json() == {"status": "ok", "model_configured": False}


def test_suggestions_work_without_an_ai_model(snapshot_raw):
    res = client().post("/v1/suggestions", json={"context": ADMIN, "period": "2026-10", "snapshot": snapshot_raw}, headers={"x-request-id": "req-abc"})
    assert res.status_code == 200
    assert res.json()["suggestions"][0]["kind"] == "spend_jump"


def test_ask_answers_from_the_snapshot(snapshot_raw):
    steps = [{"call": "get_cost_summary", "args": {"period": "2026-10"}}, {"text": lambda r: f"October spend is {r[-1]['figures']['estimated_spend']}."}]
    res = client(steps).post("/v1/ask", json={"context": ADMIN, "question": "What did we spend?", "snapshot": snapshot_raw})
    body = res.json()
    assert res.status_code == 200 and body["status"] == "ok" and body["text"] == "October spend is $25.61."
    assert body["sessionId"].startswith("s_")


def test_ask_without_a_model_says_so(snapshot_raw):
    res = client().post("/v1/ask", json={"context": ADMIN, "question": "Hi", "snapshot": snapshot_raw})
    assert res.json()["status"] == "unavailable"


def test_snapshot_for_someone_else_is_refused(snapshot_raw):
    ben = {**ADMIN, "userId": "uid-ben", "role": "individual_user"}
    res = client().post("/v1/suggestions", json={"context": ben, "period": "2026-10", "snapshot": snapshot_raw})
    assert res.status_code == 403


def test_individual_user_suggestions_cover_only_their_own_requests(snapshot_raw):
    chloe = {**ADMIN, "userId": "uid-chloe", "role": "individual_user", "teamIds": ["team-product"]}
    raw = as_viewer(snapshot_raw, "uid-chloe", "individual_user", ["team-product"], filter_records=False)
    res = client().post("/v1/suggestions", json={"context": chloe, "period": "2026-10", "snapshot": raw})
    assert res.status_code == 200
    assert res.json()["scope"]["visibility"] == "Individual User: only your own requests"


@pytest.mark.parametrize(
    "change",
    [
        {"context": None},
        {"context": {**ADMIN, "channel": "cli"}},
        {"context": {**ADMIN, "role": "owner"}},
        {"context": {**ADMIN, "tenantId": ""}},
        {"period": None},
    ],
)
def test_bad_requests_are_refused(snapshot_raw, change):
    body = {"context": ADMIN, "period": "2026-10", "snapshot": snapshot_raw, **change}
    assert client().post("/v1/suggestions", json=body).status_code == 400


def test_malformed_snapshot_is_refused(snapshot_raw):
    raw = copy.deepcopy(snapshot_raw)
    raw["snapshotVersion"] = 7
    res = client().post("/v1/suggestions", json={"context": ADMIN, "period": "2026-10", "snapshot": raw})
    assert res.status_code == 400 and "malformed" in res.json()["error"]["message"]


def test_on_cloud_run_a_caller_identity_is_required(snapshot_raw):
    check = CallerCheck(["axiomflo-api@axiomflo-pilot.iam.gserviceaccount.com"], "https://agent", required=True)
    c = client(check=check)
    assert c.post("/v1/suggestions", json={"context": ADMIN, "period": "2026-10", "snapshot": snapshot_raw}).status_code == 401
    assert c.post("/v1/suggestions", json={}, headers={"authorization": "Bearer not-a-token"}).status_code == 401


def test_cloud_run_without_allowed_callers_refuses_to_start():
    with pytest.raises(RuntimeError):
        CallerCheck([""], None, required=True)
