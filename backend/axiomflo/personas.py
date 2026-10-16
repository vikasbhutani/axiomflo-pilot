"""Demo personas for local development with sample data.

A persona stands in for a verified sign-in. It is only allowed with the fixture data
source, so it can never grant access to real company data.
"""
from __future__ import annotations

from .config import DATA_SOURCE_FIXTURES, Settings
from .context import TrustedContext
from .reporting.dataset import Workspace

PERSONAS = {
    "maya": "u-maya",  # Company Admin
    "liam": "u-liam",  # Individual User, Platform Engineering
    "noah": "u-noah",  # Individual User, Product Experience
}


def persona_context(settings: Settings, workspace: Workspace, persona: str, channel: str) -> TrustedContext:
    if settings.data_source != DATA_SOURCE_FIXTURES:
        raise PermissionError("Demo personas only work with AXIOMFLO_DATA_SOURCE=fixtures.")
    user_id = PERSONAS.get(persona.lower(), persona)
    person = workspace.person(user_id)
    if person is None:
        raise ValueError(f"Unknown persona {persona!r}. Choose one of: {', '.join(PERSONAS)}.")
    return TrustedContext(
        tenant_id=workspace.tenant_id,
        user_id=person.id,
        role=person.role,
        team_ids=(person.team_id,),
        channel=channel,
        verified_by="demo_persona",
    )
