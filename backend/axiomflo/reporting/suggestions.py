"""Savings suggestions: fixed rules run over the records a person may see.

Every suggestion is worked out here, by code, with the figures and the records behind it.
The model only relays them. A suggestion points at something worth a look; it never says
one model gives the same quality as another, and never guesses why spending changed.

All thresholds are in SuggestionRules, so they can be tuned in one place.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

from .calculations import CostedRecord, summarize

# Model IDs treated as a provider's most expensive tier. Matched against the model ID.
PREMIUM_MODEL_PATTERNS = (r"opus", r"fable", r"mythos", r"-pro\b", r"-ultra\b")


@dataclass(frozen=True)
class SuggestionRules:
    # "Costly model for small jobs": premium-model requests that produced little output.
    small_output_tokens: int = 300
    small_jobs_min_requests: int = 10
    small_jobs_min_share: float = 0.25
    # "Spend jump": a team's (or your own) spend compared with the month before.
    jump_min_ratio: float = 1.5
    # "Prompt caching": Claude requests with long prompts and no cache use.
    long_prompt_tokens: int = 4000
    caching_min_requests: int = 10
    # "Failed requests that still cost money".
    failed_min_requests: int = 5
    # Ignore anything smaller than this, in the reporting currency.
    min_amount: float = 1.00
    # Most suggestions returned at once.
    max_suggestions: int = 8


DEFAULT_RULES = SuggestionRules()


def is_premium_model(model_id: str) -> bool:
    return any(re.search(p, model_id) for p in PREMIUM_MODEL_PATTERNS)


@dataclass
class Suggestion:
    kind: str
    title: str
    detail: str
    # Sort key: the amount involved, in the reporting currency (0 for information-only ones).
    amount: float
    figures: dict
    link: dict | None = None

    def as_dict(self) -> dict:
        out = {"kind": self.kind, "title": self.title, "detail": self.detail, "figures": self.figures}
        if self.link:
            out["link"] = self.link
        return out


def _month_name(period: str) -> str:
    return datetime.strptime(period, "%Y-%m").strftime("%B %Y")


def build_suggestions(
    *,
    period: str,
    previous: str | None,
    current: list[CostedRecord],
    earlier: list[CostedRecord] | None,
    is_admin: bool,
    own_scope: bool,
    team_name: Callable[[str], str],
    model_name: Callable[[str], str],
    person_name: Callable[[CostedRecord], str],
    money: Callable[[float], str],
    share: Callable[[float, float], str],
    percent: Callable[[float, float], str],
    usage_link: Callable[..., str],
    currency_note: str | None,
    rate_missing: bool,
    rules: SuggestionRules = DEFAULT_RULES,
) -> list[Suggestion]:
    """`current` and `earlier` are already limited to what the person may see."""
    out: list[Suggestion] = []
    costed = [c for c in current if c.estimated_cost is not None]

    # 1. Costly model for small jobs, per team and model.
    groups: dict[tuple[str, str], list[CostedRecord]] = {}
    for c in costed:
        if c.record.request_status == "succeeded" and is_premium_model(c.record.model_id):
            groups.setdefault((c.record.team_id, c.record.model_id), []).append(c)
    for (team_id, model_id), recs in groups.items():
        small = [c for c in recs if c.record.output_tokens is not None and c.record.output_tokens < rules.small_output_tokens]
        small_cost = sum(c.estimated_cost for c in small)
        if len(small) < rules.small_jobs_min_requests or len(small) / len(recs) < rules.small_jobs_min_share or small_cost < rules.min_amount:
            continue
        who = "Your" if own_scope else f"{team_name(team_id)}'s"
        out.append(
            Suggestion(
                kind="premium_model_small_jobs",
                title=f"{model_name(model_id)} used for small jobs",
                detail=(
                    f"{share(len(small), len(recs))} of {who} {model_name(model_id)} requests ({len(small)} of {len(recs)}) "
                    f"returned under {rules.small_output_tokens:,} output tokens. Together they cost {money(small_cost)}. "
                    "A smaller, cheaper model may handle some of these. Test it on a sample of real tasks before switching, "
                    "because a lower price doesn't mean the same quality."
                ),
                amount=small_cost,
                figures={"team": team_name(team_id), "model": model_name(model_id), "small_requests": len(small), "model_requests": len(recs), "small_requests_cost": money(small_cost)},
                link={"label": f"{model_name(model_id)} requests", "url": usage_link(team_id=team_id)},
            )
        )

    # 2. Spend jump against the month before, per team (or the person's own spend).
    if earlier is not None and previous:
        def by_key(recs: list[CostedRecord]) -> dict[str, list[CostedRecord]]:
            g: dict[str, list[CostedRecord]] = {}
            for c in recs:
                g.setdefault("you" if own_scope else c.record.team_id, []).append(c)
            return g

        cur_g, prev_g = by_key(current), by_key(earlier)
        for key, recs in cur_g.items():
            cur_s, prev_s = summarize(recs), summarize(prev_g.get(key, []))
            change = cur_s.estimated_spend - prev_s.estimated_spend
            if prev_s.estimated_spend <= 0 or cur_s.estimated_spend < prev_s.estimated_spend * rules.jump_min_ratio or change < rules.min_amount:
                continue

            def increase_by(key_of: Callable[[CostedRecord], str]) -> list[tuple[str, float]]:
                totals: dict[str, float] = {}
                for c in recs:
                    if c.estimated_cost is not None:
                        totals[key_of(c)] = totals.get(key_of(c), 0.0) + c.estimated_cost
                for c in prev_g.get(key, []):
                    if c.estimated_cost is not None:
                        totals[key_of(c)] = totals.get(key_of(c), 0.0) - c.estimated_cost
                return sorted(((k, v) for k, v in totals.items() if v > 0), key=lambda kv: kv[1], reverse=True)

            # Only name contributors behind at least a tenth of the increase.
            def notable(rows: list[tuple[str, float]], limit: int) -> list[tuple[str, float]]:
                return [(k, v) for k, v in rows if v >= change * 0.1][:limit]

            drivers = ""
            top_models = notable(increase_by(lambda c: c.record.model_id), 2)
            if top_models:
                drivers += f"Most of the increase was on {' and '.join(f'{model_name(m)} (+{money(v)})' for m, v in top_models)}. "
            if is_admin and not own_scope:
                top_people = notable(increase_by(person_name), 2)
                if top_people:
                    drivers += f"By person: {', '.join(f'{name} (+{money(v)})' for name, v in top_people)}. "
            subject = "Your spend was" if own_scope else f"{team_name(key)} spent"
            out.append(
                Suggestion(
                    kind="spend_jump",
                    title=f"{'Your' if own_scope else team_name(key)} spend jumped in {_month_name(period)}",
                    detail=(
                        f"{subject} {money(cur_s.estimated_spend)} in {_month_name(period)}, up from {money(prev_s.estimated_spend)} in "
                        f"{_month_name(previous)} ({percent(change, prev_s.estimated_spend)}). "
                        + drivers
                        + "AxiomFlo shows what changed, not why, so check with the people involved before acting."
                    ),
                    amount=change,
                    figures={
                        "scope": "your own requests" if own_scope else team_name(key),
                        "current_spend": money(cur_s.estimated_spend),
                        "previous_spend": money(prev_s.estimated_spend),
                        "change": "+" + money(change),
                        "change_percent": percent(change, prev_s.estimated_spend),
                        "current_requests": cur_s.request_count,
                        "previous_requests": prev_s.request_count,
                    },
                    link={"label": f"Requests in {_month_name(period)}", "url": usage_link(team_id=None if own_scope else key)},
                )
            )

    # 3. Prompt caching: long Claude prompts that read and wrote nothing from the cache.
    uncached = [
        c for c in costed
        if c.record.provider_id == "anthropic"
        and c.record.request_status == "succeeded"
        and (c.record.input_tokens or 0) >= rules.long_prompt_tokens
        and c.record.cache_read_tokens == 0
        and c.record.cache_write_tokens == 0
    ]
    uncached_cost = sum(c.estimated_cost for c in uncached)
    if len(uncached) >= rules.caching_min_requests and uncached_cost >= rules.min_amount:
        out.append(
            Suggestion(
                kind="prompt_caching",
                title="Long Claude prompts without prompt caching",
                detail=(
                    f"{len(uncached)} Claude requests sent at least {rules.long_prompt_tokens:,} input tokens without using prompt caching. "
                    f"They cost {money(uncached_cost)} in total. If they repeat the same instructions or documents, "
                    "prompt caching can cut the input part of that cost. It's a setting in the tool or code that sends them."
                ),
                amount=uncached_cost,
                figures={"requests": len(uncached), "cost": money(uncached_cost)},
                link={"label": "Claude requests", "url": usage_link(provider_id="anthropic")},
            )
        )

    # 4. Failed requests that still used tokens.
    failed = [c for c in costed if c.record.request_status == "failed" and c.estimated_cost > 0]
    failed_cost = sum(c.estimated_cost for c in failed)
    if len(failed) >= rules.failed_min_requests and failed_cost >= rules.min_amount:
        out.append(
            Suggestion(
                kind="failed_requests_cost",
                title="Failed requests still cost money",
                detail=(
                    f"{len(failed)} failed requests still used tokens, worth an estimated {money(failed_cost)}. "
                    "Retries that keep failing the same way add up; the request list shows which models and keys they came from."
                ),
                amount=failed_cost,
                figures={"failed_requests": len(failed), "cost": money(failed_cost)},
                link={"label": "Requests this month", "url": usage_link()},
            )
        )

    out.sort(key=lambda s: s.amount, reverse=True)

    # Information that affects every figure comes last, whatever its size.
    unresolved = [c for c in current if c.estimated_cost is None]
    if unresolved:
        out.append(
            Suggestion(
                kind="unresolved_costs",
                title="Some requests have no cost yet",
                detail=(
                    f"{len(unresolved)} requests have no cost because the provider didn't report their token counts, "
                    "or the model has no price in AxiomFlo yet. They're left out of totals, not counted as zero."
                ),
                amount=0.0,
                figures={"unresolved_requests": len(unresolved)},
                link={"label": "Requests without a cost", "url": usage_link(cost_status="unavailable")},
            )
        )
    if rate_missing and currency_note:
        out.append(
            Suggestion(
                kind="exchange_rate",
                title="Exchange rate not set for this month",
                detail=currency_note + " A Company Admin can set this month's rate in Settings.",
                amount=0.0,
                figures={},
            )
        )
    return out[: rules.max_suggestions]
