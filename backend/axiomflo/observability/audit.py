"""Audit trail for agent activity.

Records who asked (verified actor and tenant), through which channel, which tool ran, the
data scope, the outcome and latency. It never records chat text, tool output, identity
tokens or secrets. Milestone 1 keeps events in memory and writes them to the Python log;
Milestone 2 moves them to durable storage.
"""
from __future__ import annotations

import json
import logging
import threading
from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger("axiomflo.audit")


@dataclass(frozen=True)
class AuditEvent:
    kind: str  # "tool_call" | "agent_turn"
    request_id: str
    tenant_id: str
    actor_user_id: str
    role: str
    channel: str
    outcome: str  # "ok" | error code
    latency_ms: int
    tool: str | None = None
    scope: dict = field(default_factory=dict)
    model_usage: dict | None = None
    at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AuditLog:
    """Writes each event to the log (Cloud Logging on Cloud Run) and keeps the latest in memory."""

    def __init__(self, keep: int = 1000) -> None:
        self._lock = threading.Lock()
        self._events: deque[AuditEvent] = deque(maxlen=keep)

    def record(self, event: AuditEvent) -> None:
        with self._lock:
            self._events.append(event)
        logger.info(json.dumps(asdict(event), sort_keys=True))

    def events(self) -> list[AuditEvent]:
        with self._lock:
            return list(self._events)
