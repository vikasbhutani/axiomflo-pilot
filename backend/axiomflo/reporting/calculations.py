"""Python port of the web app's shared cost module (src/lib/calculations.ts).

Every figure the agent reports comes from here, never from the model. The rules are the
same as the web app's, and tests/test_calculation_parity.py checks the totals match the
TypeScript results exactly:

- estimated cost = (input tokens x input rate per million
                    + output tokens x output rate per million) / 1,000,000
- Full precision is kept; rounding happens only when formatting.
- Missing usage -> cost is None ("unresolved"), never zero.
- Failed requests are costed from whatever usage was measured.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Callable, Iterable, TypeVar

K = TypeVar("K")


@dataclass(frozen=True)
class PricingRate:
    model_id: str
    input_per_million: float
    output_per_million: float


@dataclass(frozen=True)
class PricingVersion:
    id: str
    label: str
    effective_from: str  # inclusive Australia/Sydney date, YYYY-MM-DD
    currency: str
    rates: tuple[PricingRate, ...]


@dataclass(frozen=True)
class UsageRecord:
    id: str
    timestamp: str  # ISO 8601, UTC
    principal_type: str  # "user" | "application"
    principal_id: str
    team_id: str
    team_code: str
    provider_id: str
    model_id: str
    input_tokens: int | None
    output_tokens: int | None
    request_status: str  # "succeeded" | "failed"
    cost_status: str  # "reconciled" | "estimated" | "unavailable"
    # Prompt-cache token counts; None when the source doesn't report them (the demo data).
    cache_write_tokens: int | None = None
    cache_read_tokens: int | None = None


@dataclass(frozen=True)
class CostedRecord:
    record: UsageRecord
    local_date: str
    estimated_cost: float | None
    pricing_version_id: str | None


def pricing_version_for(local_date: str, versions: Iterable[PricingVersion]) -> PricingVersion | None:
    applicable = sorted((v for v in versions if v.effective_from <= local_date), key=lambda v: v.effective_from, reverse=True)
    return applicable[0] if applicable else None


def cost_record(record: UsageRecord, local_date: str, versions: Iterable[PricingVersion]) -> CostedRecord:
    if record.input_tokens is None or record.output_tokens is None:
        return CostedRecord(record, local_date, None, None)
    version = pricing_version_for(local_date, versions)
    rate = next((r for r in version.rates if r.model_id == record.model_id), None) if version else None
    if version is None or rate is None:
        return CostedRecord(record, local_date, None, None)
    # Same operation order as the TypeScript code so results are bit-for-bit identical.
    input_cost = (record.input_tokens * rate.input_per_million) / 1_000_000
    output_cost = (record.output_tokens * rate.output_per_million) / 1_000_000
    return CostedRecord(record, local_date, input_cost + output_cost, version.id)


@dataclass
class CostSummary:
    request_count: int = 0
    succeeded_count: int = 0
    failed_count: int = 0
    costed_count: int = 0
    unresolved_count: int = 0  # cost cannot be calculated; never counted as zero
    reconciled_count: int = 0
    estimated_only_count: int = 0
    estimated_spend: float = 0.0  # reconciled + estimated-only, full precision
    reconciled_spend: float = 0.0
    estimated_only_spend: float = 0.0
    average_cost_per_costed_request: float | None = None
    input_tokens: int = 0
    output_tokens: int = 0

    def as_dict(self) -> dict:
        return asdict(self)


def summarize(records: Iterable[CostedRecord]) -> CostSummary:
    s = CostSummary()
    for c in records:
        r = c.record
        s.request_count += 1
        if r.request_status == "failed":
            s.failed_count += 1
        else:
            s.succeeded_count += 1
        s.input_tokens += r.input_tokens or 0
        s.output_tokens += r.output_tokens or 0
        if c.estimated_cost is None:
            s.unresolved_count += 1
            continue
        s.costed_count += 1
        s.estimated_spend += c.estimated_cost
        if r.cost_status == "reconciled":
            s.reconciled_count += 1
            s.reconciled_spend += c.estimated_cost
        else:
            s.estimated_only_count += 1
            s.estimated_only_spend += c.estimated_cost
    s.average_cost_per_costed_request = s.estimated_spend / s.costed_count if s.costed_count else None
    return s


def summarize_by(records: Iterable[CostedRecord], key_of: Callable[[CostedRecord], K]) -> dict[K, CostSummary]:
    """Groups records by a key (first-seen order) and summarizes each group."""
    groups: dict[K, list[CostedRecord]] = {}
    for c in records:
        groups.setdefault(key_of(c), []).append(c)
    return {k: summarize(v) for k, v in groups.items()}


def cost_status_label(s: CostSummary) -> str:
    """Overall status of a total. Estimates are never described as invoices.

    Unresolved requests are reported separately (unresolved_count), not folded in here.
    """
    if s.costed_count == 0:
        return "no calculable cost"
    if s.estimated_only_count == 0:
        return "reconciled"
    if s.reconciled_count == 0:
        return "estimated"
    return "partly reconciled, partly estimated"
