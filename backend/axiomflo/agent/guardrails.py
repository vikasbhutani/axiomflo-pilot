"""Checks on the model's final answer.

Gemini explains figures; it must not produce its own. Every dollar amount and percentage in
an answer has to appear in the output of a tool that ran during the same turn. If one does
not, the answer is withheld and replaced with a plain message plus links to the records.
"""
from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation

# "$1.50", "A$1.50", "US$1.50", or a currency code as the Upgrade Analysis writes non-AUD
# amounts ("USD 1.50", with a normal or non-breaking space).
MONEY_RE = re.compile(r"(?<![\w.])[-+−]?(?:(?:A|AU|US)?\$\s?|\b(?:USD|AUD|EUR|GBP|NZD|CAD|SGD|JPY|INR)[\s\u00a0]?)\d[\d,]*(?:\.\d+)?")
PERCENT_RE = re.compile(r"[-+]?\d+(?:\.\d+)?\s?%")


def _money_value(text: str) -> Decimal | None:
    digits = re.sub(r"[^\d.]", "", text)
    try:
        return Decimal(digits)
    except InvalidOperation:
        return None


def _percent_value(text: str) -> Decimal | None:
    try:
        return Decimal(re.sub(r"[^\d.]", "", text))
    except InvalidOperation:
        return None


def figures_in(text: str) -> tuple[set[Decimal], set[Decimal]]:
    money = {v for v in (_money_value(m) for m in MONEY_RE.findall(text)) if v is not None}
    pct = {v for v in (_percent_value(m) for m in PERCENT_RE.findall(text)) if v is not None}
    return money, pct


def unverified_figures(answer: str, tool_results: list[dict]) -> list[str]:
    """Amounts or percentages in the answer that no tool returned this turn (sign ignored)."""
    allowed_money: set[Decimal] = set()
    allowed_pct: set[Decimal] = set()
    for result in tool_results:
        m, p = figures_in(json.dumps(result, ensure_ascii=False))
        allowed_money |= m
        allowed_pct |= p
    problems = []
    for raw in MONEY_RE.findall(answer):
        v = _money_value(raw)
        if v is not None and v not in allowed_money:
            problems.append(raw.strip())
    for raw in PERCENT_RE.findall(answer):
        v = _percent_value(raw)
        if v is not None and v not in allowed_pct:
            problems.append(raw.strip())
    return problems
