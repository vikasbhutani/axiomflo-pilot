"""Errors that tools turn into explicit, user-safe results (never into fake data)."""
from __future__ import annotations


class AgentToolError(Exception):
    code = "error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message

    def to_result(self) -> dict:
        return {"status": "error", "error": {"code": self.code, "message": self.message}}


class AccessDenied(AgentToolError):
    code = "access_denied"


class InvalidArgument(AgentToolError):
    code = "invalid_argument"


class ServiceUnavailable(AgentToolError):
    code = "unavailable"
