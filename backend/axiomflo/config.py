"""Settings for the AxiomFlo Agent, read from environment variables.

Nothing here has a hidden default that calls a paid service: the Gemini model is only
used when AXIOMFLO_AGENT_MODEL is set, and no model identifier is hard-coded.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FIXTURES_DIR = BACKEND_ROOT / "fixtures"

DATA_SOURCE_FIXTURES = "fixtures"
DATA_SOURCE_API = "axiomflo_api"
DATA_SOURCES = (DATA_SOURCE_FIXTURES, DATA_SOURCE_API)


@dataclass(frozen=True)
class Settings:
    # Where cost data comes from. "fixtures" = labelled sample data. "axiomflo_api" =
    # real data: the AxiomFlo API sends a usage snapshot with each question
    # (docs/agent/usage-snapshot.md). Without one the answer is "unavailable"; it never
    # falls back to sample data.
    data_source: str = DATA_SOURCE_FIXTURES
    fixtures_dir: Path = DEFAULT_FIXTURES_DIR
    # Gemini model ID on Vertex AI, e.g. one listed on Google's "Model versions" page
    # for your region. None = the agent answers "model not configured".
    model: str | None = None
    google_cloud_project: str | None = None
    google_cloud_location: str | None = None
    # Base address of the AxiomFlo web app, used to build links to supporting records.
    web_base_url: str = "http://localhost:5173"
    # Hard limits applied server-side, whatever the model asks for.
    max_reference_rows: int = 50
    max_periods_per_query: int = 2

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        e = os.environ if env is None else env
        source = e.get("AXIOMFLO_DATA_SOURCE", DATA_SOURCE_FIXTURES).strip() or DATA_SOURCE_FIXTURES
        if source not in DATA_SOURCES:
            raise ValueError(f"AXIOMFLO_DATA_SOURCE must be one of {', '.join(DATA_SOURCES)} (got {source!r}).")
        return cls(
            data_source=source,
            fixtures_dir=Path(e.get("AXIOMFLO_FIXTURES_DIR") or DEFAULT_FIXTURES_DIR),
            model=(e.get("AXIOMFLO_AGENT_MODEL") or "").strip() or None,
            google_cloud_project=(e.get("GOOGLE_CLOUD_PROJECT") or "").strip() or None,
            google_cloud_location=(e.get("GOOGLE_CLOUD_LOCATION") or "").strip() or None,
            web_base_url=(e.get("AXIOMFLO_WEB_BASE_URL") or cls.web_base_url).rstrip("/"),
        )

    def model_problem(self) -> str | None:
        """Why the Gemini model cannot be used, or None when it is fully configured."""
        missing = [
            name
            for name, value in (
                ("AXIOMFLO_AGENT_MODEL", self.model),
                ("GOOGLE_CLOUD_PROJECT", self.google_cloud_project),
                ("GOOGLE_CLOUD_LOCATION", self.google_cloud_location),
            )
            if not value
        ]
        if missing:
            return "The AxiomFlo Agent's AI model is not configured (missing " + ", ".join(missing) + ")."
        return None
