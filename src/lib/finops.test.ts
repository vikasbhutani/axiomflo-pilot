import { describe, expect, it } from 'vitest';
import { buildScorecard, defaultWorkflowOf, FINOPS_RULES, modelTier, type ScorecardOptions, type ScorecardRecord } from './finops';
import { buildDemoScorecard } from '../services/finopsService';
import { summarize } from '../lib/calculations';
import { selectRecords } from '../services/mockService';

let n = 0;
function rec(overrides: Partial<ScorecardRecord>): ScorecardRecord {
  return {
    id: `r${++n}`, timestamp: '2026-09-10T01:00:00Z', principal: { type: 'user', id: 'u1' }, teamId: 't1', teamCode: 'T1',
    providerId: 'anthropic', modelId: 'claude-sonnet-x', inputTokens: 1_000, outputTokens: 1_000, requestStatus: 'succeeded', costStatus: 'estimated',
    estimatedCost: 1, pricingVersionId: 'v', principalName: 'U1', teamName: 'Team One', modelName: '', providerName: '', localDate: '2026-09-10', ...overrides,
  };
}

const rates: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'claude-sonnet-x': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-haiku-x': { inputPerMillion: 1, outputPerMillion: 5 },
};
const priced: ScorecardOptions = { workflowOf: defaultWorkflowOf((id) => (id === 'bot' ? 'Review bot' : undefined)), rateOf: (m) => rates[m] ?? null };
const unpriced: ScorecardOptions = { workflowOf: priced.workflowOf };
const cost = (m: string, i: number, o: number) => (i * rates[m].inputPerMillion + o * rates[m].outputPerMillion) / 1_000_000;

describe('modelTier', () => {
  it('ranks model families', () => {
    expect(modelTier('claude-opus-5-5')).toBe(3);
    expect(modelTier('claude-sonnet-5-5')).toBe(2);
    expect(modelTier('gemini-pro-demo')).toBe(2);
    expect(modelTier('gemini-2.5-pro')).toBe(2);
    expect(modelTier('claude-haiku-5-5')).toBe(1);
    expect(modelTier('gemini-2.5-flash-lite')).toBe(1);
    expect(modelTier('something-else')).toBeNull();
  });
});

describe('unit economics', () => {
  it('counts failed requests in the cost of each successful one and leaves unresolved ones out', () => {
    const sc = buildScorecard(
      [rec({ estimatedCost: 3 }), rec({ estimatedCost: 1, requestStatus: 'failed', principal: { type: 'user', id: 'u2' } }), rec({ estimatedCost: null, inputTokens: null, outputTokens: null })],
      null,
      unpriced,
    );
    const e = sc.economics;
    expect(e.spend).toBe(4);
    expect(e.requests).toBe(3);
    expect(e.unresolvedRequests).toBe(1);
    expect(e.costPerRequest).toBe(2);
    expect(e.costPerSuccessfulRequest).toBe(4);
    expect(e.failedSpend).toBe(1);
    expect(e.failedSpendShare).toBe(0.25);
    expect(e.activePeople).toBe(2);
    expect(e.costPerActivePerson).toBe(2);
    expect(e.costPerMillionTokens).toBe((4 * 1_000_000) / 4_000);
  });

  it('has no score when there is nothing to score', () => {
    const sc = buildScorecard([], null, unpriced);
    expect(sc.score).toBeNull();
    expect(sc.grade).toBeNull();
    expect(sc.levers.every((l) => l.savings === 0 && l.savingsShare === null)).toBe(true);
  });
});

describe('optimisation levers', () => {
  it('re-prices short jobs on the next tier down with the price list', () => {
    const short = rec({ inputTokens: 2_000, outputTokens: 100, estimatedCost: cost('claude-sonnet-x', 2_000, 100) });
    const long = rec({ inputTokens: 2_000, outputTokens: 900, estimatedCost: cost('claude-sonnet-x', 2_000, 900) });
    const haiku = rec({ modelId: 'claude-haiku-x', estimatedCost: cost('claude-haiku-x', 1_000, 1_000) });
    const sizing = buildScorecard([short, long, haiku], null, priced).levers.find((l) => l.id === 'model_right_sizing')!;
    expect(sizing.affectedRequests).toBe(1);
    expect(sizing.savings).toBeCloseTo(short.estimatedCost! - cost('claude-haiku-x', 2_000, 100), 12);
    expect(sizing.moves).toEqual([expect.objectContaining({ fromModelId: 'claude-sonnet-x', toModelId: 'claude-haiku-x', requests: 1 })]);
  });

  it('assumes the fallback price share when no cheaper model is in use', () => {
    const sizing = buildScorecard([rec({ outputTokens: 50, estimatedCost: 2 })], null, unpriced).levers.find((l) => l.id === 'model_right_sizing')!;
    expect(sizing.savings).toBe(2 * (1 - FINOPS_RULES.fallbackCheaperPriceShare));
    expect(sizing.moves?.[0].toModelId).toBeNull();
  });

  it('never suggests a smaller model for a model already in the smallest tier', () => {
    const sizing = buildScorecard([rec({ modelId: 'claude-haiku-x', outputTokens: 50 })], null, unpriced).levers.find((l) => l.id === 'model_right_sizing')!;
    expect(sizing.affectedRequests).toBe(0);
  });

  it('prices caching, trimming and output limits from the input or output part of the cost', () => {
    const r = rec({ inputTokens: 60_000, outputTokens: 2_500, estimatedCost: cost('claude-sonnet-x', 60_000, 2_500) });
    const input = (60_000 * 3) / 1_000_000;
    const output = (2_500 * 15) / 1_000_000;
    const levers = Object.fromEntries(buildScorecard([r], null, priced).levers.map((l) => [l.id, l]));
    expect(levers.prompt_caching.savings).toBeCloseTo(input * 0.5 * 0.9, 12);
    expect(levers.context_trimming.savings).toBeCloseTo(input * 0.4, 12);
    expect(levers.output_limits.savings).toBeCloseTo(output * 0.3, 12);
  });

  it('skips prompts that already read from the cache', () => {
    const r = rec({ inputTokens: 10_000, cacheReadTokens: 5_000 });
    expect(buildScorecard([r], null, unpriced).levers.find((l) => l.id === 'prompt_caching')!.affectedRequests).toBe(0);
  });

  it('splits cost 1:5 between input and output tokens without a price list', () => {
    const sc = buildScorecard([rec({ inputTokens: 5_000, outputTokens: 1_000, estimatedCost: 1 })], null, unpriced);
    expect(sc.exactSplit).toBe(false);
    expect(sc.workflows[0].inputSpend).toBeCloseTo(0.5, 12);
    expect(sc.workflows[0].outputSpend).toBeCloseTo(0.5, 12);
  });

  it('offers batch discounts only for automated workflows', () => {
    const sc = buildScorecard([rec({ principal: { type: 'application', id: 'bot' }, estimatedCost: 4 }), rec({ estimatedCost: 6 })], null, unpriced);
    const batch = sc.levers.find((l) => l.id === 'batch_processing')!;
    expect(batch.affectedRequests).toBe(1);
    expect(batch.savings).toBe(2);
    expect(sc.workflows.map((w) => [w.label, w.kind])).toEqual([
      ['Interactive use · Team One', 'interactive'],
      ['Review bot', 'automated'],
    ]);
  });

  it('ranks the five levers by savings and combines them without double counting', () => {
    const sc = buildScorecard([rec({ principal: { type: 'application', id: 'bot' }, inputTokens: 80_000, outputTokens: 3_000, estimatedCost: 1 })], null, unpriced);
    expect(sc.levers.map((l) => l.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(sc.levers.map((l) => l.savings)).toEqual([...sc.levers.map((l) => l.savings)].sort((a, b) => b - a));
    const sum = sc.levers.reduce((s, l) => s + l.savings, 0);
    expect(sc.combinedSavings).toBeLessThan(sum);
    expect(sc.combinedSavings).toBeGreaterThan(sc.levers[0].savings);
    expect(sc.combinedSavings).toBeLessThanOrEqual(sc.economics.spend);
  });
});

describe('the Acme demo scorecard', () => {
  const admin = { userId: 'u-maya', role: 'company_admin' as const };
  const individual = { userId: 'u-noah', role: 'individual_user' as const };

  it('uses the same spend as every other page', () => {
    const { scorecard, previousPeriod } = buildDemoScorecard('2026-09', admin);
    expect(scorecard.economics.spend).toBeCloseTo(summarize(selectRecords({ period: '2026-09' }, admin)).estimatedSpend, 9);
    expect(previousPeriod).toBe('2026-08');
    expect(scorecard.previousEconomics?.spend).toBeCloseTo(summarize(selectRecords({ period: '2026-08' }, admin)).estimatedSpend, 9);
    expect(scorecard.workflows.reduce((s, w) => s + w.spend, 0)).toBeCloseTo(scorecard.economics.spend, 9);
    expect(scorecard.workflows.reduce((s, w) => s + w.inputSpend + w.outputSpend, 0)).toBeCloseTo(scorecard.economics.spend, 9);
  });

  it('finds savings on every lever and grades the month', () => {
    const { scorecard } = buildDemoScorecard('2026-09', admin);
    expect(scorecard.levers).toHaveLength(5);
    expect(scorecard.levers.every((l) => l.savings > 0)).toBe(true);
    expect(scorecard.score).toBeGreaterThan(0);
    expect(scorecard.grade).toMatch(/^[A-E]$/);
    expect(scorecard.workflows.map((w) => w.label)).toContain('CI code-review bot');
  });

  it('scores only an individual user’s own requests', () => {
    const own = buildDemoScorecard('2026-09', individual).scorecard;
    expect(own.economics.spend).toBeCloseTo(summarize(selectRecords({ period: '2026-09' }, individual)).estimatedSpend, 9);
    expect(own.economics.activePeople).toBe(1);
    expect(own.workflows.map((w) => w.label)).toEqual(['Interactive use · Product Experience']);
  });
});
