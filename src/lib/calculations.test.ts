import { describe, expect, it } from 'vitest';
import { costBreakdown, estimateCost, pricingVersionFor, safeRatio, summarize } from './calculations';
import type { CostedUsageRecord, PricingVersion, UsageRecord } from '../types';

const versions: PricingVersion[] = [
  { id: 'v1', label: 'v1', effectiveFrom: '2026-01-01', currency: 'AUD', rates: [{ modelId: 'm', inputPerMillion: 2, outputPerMillion: 10 }] },
  { id: 'v2', label: 'v2', effectiveFrom: '2026-09-15', currency: 'AUD', rates: [{ modelId: 'm', inputPerMillion: 3, outputPerMillion: 12 }] },
];

const base: UsageRecord = {
  id: 'r1', timestamp: '2026-09-01T00:00:00Z', principal: { type: 'user', id: 'u' }, teamId: 't', teamCode: 'T',
  providerId: 'anthropic', modelId: 'm', inputTokens: 1_000_000, outputTokens: 500_000, requestStatus: 'succeeded', costStatus: 'estimated',
};

function costed(overrides: Partial<CostedUsageRecord>): CostedUsageRecord {
  return { ...base, estimatedCost: 1, pricingVersionId: 'v1', principalName: '', teamName: '', modelName: '', providerName: '', localDate: '2026-09-01', ...overrides };
}

describe('estimateCost', () => {
  it('applies the per-million formula', () => {
    expect(estimateCost(1_000_000, 500_000, versions[0].rates[0])).toBe(2 + 5);
    expect(estimateCost(1234, 567, { modelId: 'm', inputPerMillion: 4.6, outputPerMillion: 23 })).toBeCloseTo((1234 * 4.6 + 567 * 23) / 1_000_000, 12);
  });

  it('keeps full precision (no premature rounding)', () => {
    const cost = estimateCost(1, 1, { modelId: 'm', inputPerMillion: 1.9, outputPerMillion: 15.2 });
    expect(cost).toBeCloseTo(0.0000171, 12);
  });
});

describe('pricingVersionFor', () => {
  it('chooses the latest version effective on the date', () => {
    expect(pricingVersionFor('2026-09-14', versions)?.id).toBe('v1');
    expect(pricingVersionFor('2026-09-15', versions)?.id).toBe('v2');
    expect(pricingVersionFor('2025-12-31', versions)).toBeNull();
  });
});

describe('costBreakdown', () => {
  it('splits input and output cost', () => {
    const b = costBreakdown(base, '2026-09-01', versions)!;
    expect(b.inputCost).toBe(2);
    expect(b.outputCost).toBe(5);
    expect(b.total).toBe(7);
    expect(b.pricingVersionId).toBe('v1');
  });

  it('returns null when usage is missing instead of inventing zero', () => {
    expect(costBreakdown({ ...base, inputTokens: null }, '2026-09-01', versions)).toBeNull();
    expect(costBreakdown({ ...base, outputTokens: null }, '2026-09-01', versions)).toBeNull();
  });

  it('returns null when no illustrative rate exists for the model', () => {
    expect(costBreakdown({ ...base, modelId: 'unknown' }, '2026-09-01', versions)).toBeNull();
  });

  it('costs failed requests from their measured usage', () => {
    const b = costBreakdown({ ...base, requestStatus: 'failed', outputTokens: 0 }, '2026-09-01', versions)!;
    expect(b.total).toBe(2);
  });
});

describe('summarize', () => {
  it('separates unresolved records from spend and never treats them as zero-cost', () => {
    const s = summarize([
      costed({ estimatedCost: 1.5, costStatus: 'reconciled' }),
      costed({ estimatedCost: 0.5, costStatus: 'estimated' }),
      costed({ estimatedCost: null, costStatus: 'unavailable', inputTokens: null, outputTokens: null }),
    ]);
    expect(s.requestCount).toBe(3);
    expect(s.costedCount).toBe(2);
    expect(s.unresolvedCount).toBe(1);
    expect(s.estimatedSpend).toBe(2);
    expect(s.reconciledSpend).toBe(1.5);
    expect(s.estimatedOnlySpend).toBe(0.5);
    // Average excludes the unresolved record rather than counting it as $0.
    expect(s.averageCostPerCostedRequest).toBe(1);
  });

  it('returns a null average when nothing is costed (zero denominator)', () => {
    expect(summarize([]).averageCostPerCostedRequest).toBeNull();
    expect(summarize([costed({ estimatedCost: null, costStatus: 'unavailable' })]).averageCostPerCostedRequest).toBeNull();
  });

  it('counts failed requests', () => {
    expect(summarize([costed({ requestStatus: 'failed' }), costed({})]).failedCount).toBe(1);
  });
});

describe('safeRatio', () => {
  it('refuses to divide by zero', () => {
    expect(safeRatio(5, 0)).toBeNull();
    expect(safeRatio(5, 2)).toBe(2.5);
  });
});
