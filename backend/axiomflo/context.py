"""Trusted request context.

A TrustedContext says WHO is asking and WHAT they may see. Only server code builds it,
after verifying identity (Firebase token for the web app; Slack/Microsoft identity in
later milestones). The model never supplies or changes it: no tool takes a tenant,
company or user ID as an argument, and tools look the context up here by the ADK
session they are running in.
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field

ROLE_COMPANY_ADMIN = "company_admin"
ROLE_INDIVIDUAL_USER = "individual_user"
ROLES = (ROLE_COMPANY_ADMIN, ROLE_INDIVIDUAL_USER)

CHANNELS = ("web", "slack", "microsoft", "cli", "adk_dev")


@dataclass(frozen=True)
class TrustedContext:
    tenant_id: str
    user_id: str
    role: str
    # Teams the membership store assigns to this user. Admins may still see every team
    # in their own tenant; Individual Users see only their own requests in these teams.
    team_ids: tuple[str, ...]
    channel: str
    # How the identity was verified, e.g. "firebase_id_token" or "demo_persona".
    verified_by: str
    request_id: str = field(default_factory=lambda: f"req_{uuid.uuid4().hex}")

    def __post_init__(self) -> None:
        if self.role not in ROLES:
            raise ValueError(f"Unknown role {self.role!r}.")
        if self.channel not in CHANNELS:
            raise ValueError(f"Unknown channel {self.channel!r}.")
        if not self.tenant_id or not self.user_id:
            raise ValueError("A trusted context needs a tenant and a user.")

    @property
    def is_admin(self) -> bool:
        return self.role == ROLE_COMPANY_ADMIN

    @property
    def session_user_id(self) -> str:
        """ADK user ID: sessions and memory are scoped by tenant, channel and user."""
        return f"{self.tenant_id}:{self.channel}:{self.user_id}"


class ContextRegistry:
    """Server-side map from an ADK session to the context it was created for.

    Kept outside ADK session state on purpose: session state can be written by tools and
    by whoever calls the runner, so it is not a safe place for authorization data.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._by_session: dict[tuple[str, str], TrustedContext] = {}

    def bind(self, session_user_id: str, session_id: str, context: TrustedContext) -> None:
        if session_user_id != context.session_user_id:
            raise ValueError("A session can only be bound to the user it was created for.")
        with self._lock:
            self._by_session[(session_user_id, session_id)] = context

    def lookup(self, session_user_id: str, session_id: str) -> TrustedContext | None:
        with self._lock:
            context = self._by_session.get((session_user_id, session_id))
        # Defence in depth: the session's own user ID must still match the context.
        if context is None or context.session_user_id != session_user_id:
            return None
        return context

    def release(self, session_user_id: str, session_id: str) -> None:
        with self._lock:
            self._by_session.pop((session_user_id, session_id), None)


# One registry per process. Tests may create their own.
default_registry = ContextRegistry()
