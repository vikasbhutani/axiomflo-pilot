"""FinOps Scorecard: Python port of the web app's src/lib/finops.ts.

Unit economics, token cost per workflow, and five cost optimisation levers ranked by
how much they could save. Every figure is worked out here, by code; the model only
relays them. tests/test_finops_parity.py checks the results match the web app's on
the sample data, so keep the rules and the order of operations the same as the
TypeScript file.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Callable

from .calculations import CostedRecord, PricingRate, PricingVersion, pricing_version_for

# Every threshold and assumption, in one place (FINOPS_RULES in finops.ts).
SMALL_JOB_OUTPUT_TOKENS = 600
FALLBACK_CHEAPER_PRICE_SHARE = 0.5
LONG_PROMPT_TOKENS = 4_000
CACHEABLE_PREFIX_SHARE = 0.5
CACHED_READ_PRICE_SHARE = 0.1
BATCH_DISCOUNT = 0.5
LONG_CONTEXT_TOKENS = 50_000
CONTEXT_TRIM_SHARE = 0.4
LONG_OUTPUT_TOKENS = 2_000
OUTPUT_TRIM_SHARE = 0.3
OUTPUT_PRICE_RATIO = 5

TIER_PATTERNS = ((3, r"(opus|fable|mythos|ultra)"), (2, r"(sonnet|-pro\b)"), (1, r"(haiku|flash|lite|mini|nano)"))


def model_tier(model_id: str) -> int | None:
    """3 = top tier (Opus, Fable), 2 = mid (Sonnet, Gemini Pro), 1 = small (Haiku, Flash)."""
    mid = model_id.lower()
    for tier, pattern in TIER_PATTERNS:
        if re.search(pattern, mid):
            return tier
    return None


def _ratio(n: float, d: float) -> float | None:
    return None if d == 0 else n / d


@dataclass(frozen=True)
class Workflow:
    id: str
    label: str
    kind: str  # "automated" | "interactive"


RateOf = Callable[[str, str], PricingRate | None]
WorkflowOf = Callable[[CostedRecord], Workflow]


def price_list_rates(versions: list[PricingVersion]) -> RateOf | None:
    """Per-token prices from a workspace's own price list (the demo); None for snapshots."""
    if not versions:
        return None

    def rate_of(model_id: str, local_date: str) -> PricingRate | None:
        v = pricing_version_for(local_date, versions)
        return next((r for r in v.rates if r.model_id == model_id), None) if v else None

    return rate_of


def default_workflow_of(application_name: Callable[[str], str | None], team_name: Callable[[CostedRecord], str]) -> WorkflowOf:
    """Each application is its own automated workflow; people's own use is grouped per team."""

    def workflow_of(c: CostedRecord) -> Workflow:
        r = c.record
        if r.principal_type == "application":
            return Workflow(f"app:{r.principal_id}", application_name(r.principal_id) or "Unknown application", "automated")
        return Workflow(f"team:{r.team_id}", f"Interactive use · {team_name(c)}", "interactive")

    return workflow_of


def _split_cost(c: CostedRecord, rate_of: RateOf | None) -> tuple[float, float]:
    i = c.record.input_tokens or 0
    o = c.record.output_tokens or 0
    rate = rate_of(c.record.model_id, c.local_date) if rate_of else None
    if rate:
        return (i * rate.input_per_million) / 1_000_000, (o * rate.output_per_million) / 1_000_000
    weight = i + OUTPUT_PRICE_RATIO * o
    if weight == 0:
        return c.estimated_cost, 0.0
    inp = (c.estimated_cost * i) / weight
    return inp, c.estimated_cost - inp


@dataclass
class UnitEconomics:
    spend: float
    requests: int
    costed_requests: int
    unresolved_requests: int
    succeeded_costed_requests: int
    input_tokens: int
    output_tokens: int
    cost_per_request: float | None
    cost_per_successful_request: float | None
    cost_per_million_tokens: float | None
    active_people: int
    cost_per_active_person: float | None
    output_to_input_ratio: float | None
    failed_spend: float
    failed_spend_share: float | None


def unit_economics(records: list[CostedRecord]) -> UnitEconomics:
    spend = 0.0
    costed = succeeded = inp = out = 0
    failed = 0.0
    people: set[str] = set()
    for c in records:
        r = c.record
        if r.principal_type == "user":
            people.add(r.principal_id)
        if c.estimated_cost is None:
            continue
        spend += c.estimated_cost
        costed += 1
        inp += r.input_tokens or 0
        out += r.output_tokens or 0
        if r.request_status == "succeeded":
            succeeded += 1
        else:
            failed += c.estimated_cost
    return UnitEconomics(
        spend=spend,
        requests=len(records),
        costed_requests=costed,
        unresolved_requests=len(records) - costed,
        succeeded_costed_requests=succeeded,
        input_tokens=inp,
        output_tokens=out,
        cost_per_request=_ratio(spend, costed),
        cost_per_successful_request=_ratio(spend, succeeded),
        cost_per_million_tokens=None if inp + out == 0 else (spend * 1_000_000) / (inp + out),
        active_people=len(people),
        cost_per_active_person=_ratio(spend, len(people)),
        output_to_input_ratio=_ratio(out, inp),
        failed_spend=failed,
        failed_spend_share=_ratio(failed, spend),
    )


@dataclass
class WorkflowCost:
    workflow: Workflow
    requests: int = 0
    costed_requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    spend: float = 0.0
    input_spend: float = 0.0
    output_spend: float = 0.0
    share: float | None = None
    cost_per_request: float | None = None


def workflow_costs(records: list[CostedRecord], workflow_of: WorkflowOf, rate_of: RateOf | None) -> list[WorkflowCost]:
    groups: dict[str, WorkflowCost] = {}
    total = 0.0
    for c in records:
        wf = workflow_of(c)
        g = groups.setdefault(wf.id, WorkflowCost(wf))
        g.requests += 1
        if c.estimated_cost is None:
            continue
        i, o = _split_cost(c, rate_of)
        g.costed_requests += 1
        g.input_tokens += c.record.input_tokens or 0
        g.output_tokens += c.record.output_tokens or 0
        g.spend += c.estimated_cost
        g.input_spend += i
        g.output_spend += o
        total += c.estimated_cost
    out = list(groups.values())
    for g in out:
        g.share = _ratio(g.spend, total)
        g.cost_per_request = _ratio(g.spend, g.costed_requests)
    return sorted(out, key=lambda g: (-g.spend, g.workflow.label))


def _blended_rates(costed: list[CostedRecord]) -> dict[str, float]:
    sums: dict[str, list[float]] = {}
    for c in costed:
        weight = (c.record.input_tokens or 0) + OUTPUT_PRICE_RATIO * (c.record.output_tokens or 0)
        s = sums.setdefault(c.record.model_id, [0.0, 0.0])
        s[0] += c.estimated_cost
        s[1] += weight
    return {m: cost / weight for m, (cost, weight) in sums.items() if weight > 0}


def _cheaper_model(model_id: str, provider_id: str, in_use: dict[str, str]) -> str | None:
    tier = model_tier(model_id)
    if tier is None:
        return None
    candidates = [(t, m) for m, p in in_use.items() if p == provider_id and m != model_id and (t := model_tier(m)) is not None and t < tier]
    candidates.sort(key=lambda x: (-x[0], x[1]))
    return candidates[0][1] if candidates else None


LEVER_TEXT = {
    "model_right_sizing": (
        "Model right-sizing",
        "Medium",
        "Route requests with short answers to a smaller model in the same family, after testing it on a sample of real tasks.",
        f"Successful requests on a higher-tier model that returned under {SMALL_JOB_OUTPUT_TOKENS:,} output tokens, re-priced on the next tier down "
        f"that's already in use (or at {FALLBACK_CHEAPER_PRICE_SHARE:.0%} of the price when none is). A lower price doesn't promise the same quality.",
    ),
    "prompt_caching": (
        "Prompt caching",
        "Low",
        "Turn on prompt caching for long system prompts and shared documents in the tool or code that sends them.",
        f"Successful requests with at least {LONG_PROMPT_TOKENS:,} input tokens and no cache reads. Assumes {CACHEABLE_PREFIX_SHARE:.0%} of each prompt "
        f"repeats and cached reads cost {CACHED_READ_PRICE_SHARE:.0%} of the input price.",
    ),
    "batch_processing": (
        "Batch processing",
        "Medium",
        "Move bots and scheduled jobs that don't need an instant answer to the providers' batch APIs.",
        f"Requests from automated workflows, at the {BATCH_DISCOUNT:.0%} batch discount both providers list. Interactive use is left out.",
    ),
    "context_trimming": (
        "Context trimming",
        "High",
        "Use retrieval, summaries or shorter histories for requests that send very long prompts.",
        f"Successful requests with at least {LONG_CONTEXT_TOKENS:,} input tokens, assuming {CONTEXT_TRIM_SHARE:.0%} of their input can be cut.",
    ),
    "output_limits": (
        "Output limits",
        "Low",
        "Set max tokens and ask for concise answers in workflows that produce long outputs.",
        f"Requests that returned at least {LONG_OUTPUT_TOKENS:,} output tokens, assuming {OUTPUT_TRIM_SHARE:.0%} of that output can be cut.",
    ),
}


@dataclass
class ModelMove:
    from_model_id: str
    to_model_id: str | None
    requests: int = 0
    savings: float = 0.0


@dataclass
class Lever:
    id: str
    affected_requests: int
    affected_spend: float
    savings: float
    savings_share: float | None
    rank: int = 0
    moves: list[ModelMove] = field(default_factory=list)

    @property
    def name(self) -> str:
        return LEVER_TEXT[self.id][0]

    @property
    def effort(self) -> str:
        return LEVER_TEXT[self.id][1]

    @property
    def action(self) -> str:
        return LEVER_TEXT[self.id][2]

    @property
    def assumption(self) -> str:
        return LEVER_TEXT[self.id][3]


def optimisation_levers(records: list[CostedRecord], workflow_of: WorkflowOf, rate_of: RateOf | None) -> list[Lever]:
    costed = [c for c in records if c.estimated_cost is not None]
    spend = sum(c.estimated_cost for c in costed)

    # 1. Model right-sizing.
    in_use: dict[str, str] = {}
    for c in costed:
        in_use.setdefault(c.record.model_id, c.record.provider_id)
    blended = _blended_rates(costed)
    moves: dict[str, ModelMove] = {}
    sizing_n, sizing_spend, sizing_savings = 0, 0.0, 0.0
    for c in costed:
        r = c.record
        tier = model_tier(r.model_id)
        if r.request_status != "succeeded" or tier is None or tier < 2 or (r.output_tokens or 0) >= SMALL_JOB_OUTPUT_TOKENS:
            continue
        target = _cheaper_model(r.model_id, r.provider_id, in_use)
        from_rate = rate_of(r.model_id, c.local_date) if rate_of else None
        to_rate = rate_of(target, c.local_date) if rate_of and target else None
        if from_rate and to_rate:
            new_cost = ((r.input_tokens or 0) * to_rate.input_per_million + (r.output_tokens or 0) * to_rate.output_per_million) / 1_000_000
        elif target and target in blended and r.model_id in blended and blended[r.model_id] > 0:
            new_cost = (c.estimated_cost * blended[target]) / blended[r.model_id]
        else:
            new_cost = c.estimated_cost * FALLBACK_CHEAPER_PRICE_SHARE
        saved = max(0.0, c.estimated_cost - new_cost)
        sizing_n += 1
        sizing_spend += c.estimated_cost
        sizing_savings += saved
        move = moves.setdefault(f"{r.model_id}>{target or ''}", ModelMove(r.model_id, target))
        move.requests += 1
        move.savings += saved

    cache = [0, 0.0, 0.0]
    trim = [0, 0.0, 0.0]
    outl = [0, 0.0, 0.0]
    batch = [0, 0.0]
    for c in costed:
        r = c.record
        i_cost, o_cost = _split_cost(c, rate_of)
        inp = r.input_tokens or 0
        if r.request_status == "succeeded" and inp >= LONG_PROMPT_TOKENS and not (r.cache_read_tokens and r.cache_read_tokens > 0):
            cache[0] += 1
            cache[1] += c.estimated_cost
            cache[2] += i_cost * CACHEABLE_PREFIX_SHARE * (1 - CACHED_READ_PRICE_SHARE)
        if r.request_status == "succeeded" and inp >= LONG_CONTEXT_TOKENS:
            trim[0] += 1
            trim[1] += c.estimated_cost
            trim[2] += i_cost * CONTEXT_TRIM_SHARE
        if (r.output_tokens or 0) >= LONG_OUTPUT_TOKENS:
            outl[0] += 1
            outl[1] += c.estimated_cost
            outl[2] += o_cost * OUTPUT_TRIM_SHARE
        if workflow_of(c).kind == "automated":
            batch[0] += 1
            batch[1] += c.estimated_cost

    def lever(lever_id: str, n: int, affected: float, savings: float, mv: list[ModelMove] | None = None) -> Lever:
        return Lever(lever_id, n, affected, savings, _ratio(savings, spend), moves=mv or [])

    levers = [
        lever("model_right_sizing", sizing_n, sizing_spend, sizing_savings, sorted(moves.values(), key=lambda m: -m.savings)),
        lever("prompt_caching", *cache),
        lever("batch_processing", batch[0], batch[1], batch[1] * BATCH_DISCOUNT),
        lever("context_trimming", *trim),
        lever("output_limits", *outl),
    ]
    levers.sort(key=lambda l: -l.savings)
    for i, l in enumerate(levers):
        l.rank = i + 1
    return levers


@dataclass
class Scorecard:
    economics: UnitEconomics
    previous_economics: UnitEconomics | None
    workflows: list[WorkflowCost]
    levers: list[Lever]
    combined_savings: float
    combined_savings_share: float | None
    score: int | None
    grade: str | None
    components: dict[str, float]


def _clamp01(x: float) -> float:
    return min(1.0, max(0.0, x))


def _grade(score: int) -> str:
    for g, floor in (("A", 85), ("B", 70), ("C", 55), ("D", 40)):
        if score >= floor:
            return g
    return "E"


def build_scorecard(current: list[CostedRecord], previous: list[CostedRecord] | None, workflow_of: WorkflowOf, rate_of: RateOf | None) -> Scorecard:
    economics = unit_economics(current)
    levers = optimisation_levers(current, workflow_of, rate_of)
    spend = economics.spend
    remaining = 1.0
    for l in levers:
        remaining *= (1 - min(1.0, l.savings / spend)) if spend > 0 else 1
    combined = spend * (1 - remaining)
    combined_share = _ratio(combined, spend)
    sizing = next(l for l in levers if l.id == "model_right_sizing")
    fit_share = _ratio(sizing.affected_spend, spend)
    costed_share = _ratio(economics.costed_requests, economics.requests)
    components = {
        "headroom": 40 * _clamp01(1 - (combined_share or 0) / 0.75),
        "model_fit": 20 * _clamp01(1 - (fit_share or 0) / 0.3),
        "waste": 20 * _clamp01(1 - (economics.failed_spend_share or 0) / 0.05),
        "visibility": 20 * _clamp01(((costed_share or 0) - 0.8) / 0.2),
    }
    # JavaScript's Math.round, so both sides agree on halves.
    score = math.floor(sum(components.values()) + 0.5) if spend > 0 else None
    return Scorecard(
        economics=economics,
        previous_economics=unit_economics(previous) if previous is not None else None,
        workflows=workflow_costs(current, workflow_of, rate_of),
        levers=levers,
        combined_savings=combined,
        combined_savings_share=combined_share,
        score=score,
        grade=_grade(score) if score is not None else None,
        components=components,
    )
