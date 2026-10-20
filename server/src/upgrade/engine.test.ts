import { describe, expect, it } from 'vitest';
import { FIXTURE_CATALOGUE, FIXTURE_SCOPES, FIXTURE_TODAY, SONNET_45, SONNET_55, fixtureRecords, fixtureRequest } from '../test/upgradeFixtures.js';
import {
  DISCLAIMER,
  MISSING_PRICING_MESSAGE,
  QUALITY_UNKNOWN_MESSAGE,
  UpgradeAccessError,
  UpgradeInputError,
  classifyRecord,
  estimateUpgrade,
  parseEstimateRequest,
  resolveTimeWindow,
  type EstimateContext,
} from './engine.js';
import { renderCsvReport, renderMarkdownReport, summaryLines } from './report.js';
import type { ModelProfile, UpgradeEstimateRequest, UpgradeUsageRecord } from './types.js';

function ctx(overrides: Partial<EstimateContext> = {}): EstimateContext {
  return {
    catalogue: FIXTURE_CATALOGUE,
    records: fixtureRecords(),
    scopes: FIXTURE_SCOPES,
    companyLabel: 'Test Company',
    currency: 'USD',
    today: FIXTURE_TODAY,
    regionOf: () => null,
    now: '2026-09-30T12:00:00.000Z',
    ...overrides,
  };
}

/** A simple record: 1,000 input and 100 output tokens on Sonnet 4.5 ($0.0045). */
function rec(overrides: Partial<UpgradeUsageRecord> = {}): UpgradeUsageRecord {
  return {
    id: 'r',
    localDate: '2026-09-20',
    teamId: 'team-a',
    projectId: null,
    applicationId: null,
    workflowId: null,
    agentId: null,
    environment: null,
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    inputTokens: 1_000,
    cachedInputTokens: 0,
    outputTokens: 100,
    reasoningTokens: 0,
    requestStatus: 'succeeded',
    isRetry: false,
    isFallback: false,
    latencyMs: 1_000,
    cost: 0.0045,
    costStatus: 'estimated',
    pricingVersion: 'v1',
    requiredFeatures: [],
    ...overrides,
  };
}

const many = (n: number, overrides: Partial<UpgradeUsageRecord> = {}) => Array.from({ length: n }, (_, i) => rec({ id: `r${i}`, ...overrides }));
const eligibleAll = fixtureRequest().eligibilityRules;
const run = (records: UpgradeUsageRecord[], req: Partial<UpgradeEstimateRequest> = {}, c: Partial<EstimateContext> = {}) => estimateUpgrade(fixtureRequest(req), ctx({ records, ...c }));

describe('savings calculation', () => {
  it('re-prices eligible calls at the candidate’s rates', () => {
    const a = run(many(10));
    // Candidate: (1,000 × $2 + 100 × $10) ÷ 1M = $0.003 a call, but Sonnet 5.5 expects 10% more output.
    const perCall = (1_000 * 2 + 110 * 10) / 1_000_000;
    expect(a.candidate.projection.costPerRequest).toBeCloseTo(perCall, 12);
    expect(a.financial!.currentCost).toBeCloseTo(0.045, 12);
    expect(a.financial!.projectedCost).toBeCloseTo(10 * perCall, 12);
    expect(a.financial!.savings).toBeCloseTo(0.045 - 10 * perCall, 12);
  });

  it('follows projectedCost = eligible × migration% × tokens × candidate price + ineligible at current cost', () => {
    const records = [...many(8, { workflowId: 'wf-reports' }), ...many(2, { workflowId: 'wf-vision' })].map((r, i) => ({ ...r, id: `r${i}` }));
    const a = run(records, {
      migrationPercentage: 80,
      assumptions: { outputTokenChangePct: 0 },
      eligibilityRules: [
        { id: 'a', level: 'workflow', targetId: 'wf-reports', decision: 'eligible', reason: '' },
        { id: 'b', level: 'workflow', targetId: 'wf-vision', decision: 'exclude', reason: 'Owner said no' },
      ],
    });
    const eligible = 8;
    const ineligible = 2;
    const candidateCall = (1_000 * 2 + 100 * 10) / 1_000_000;
    const currentCall = 0.0045;
    const expected = eligible * 0.8 * candidateCall + eligible * 0.2 * currentCall + ineligible * currentCall;
    expect(a.financial!.projectedCost).toBeCloseTo(expected, 12);
    expect(a.eligibility.eligible.requests).toBe(8);
    expect(a.eligibility.ineligible.requests).toBe(2);
  });

  it('works out percentage, monthly and annualised savings', () => {
    const a = run(many(10), { assumptions: { outputTokenChangePct: 0 } });
    const f = a.financial!;
    expect(f.savingsPct).toBeCloseTo(((0.045 - 0.03) / 0.045) * 100, 9);
    // 30-day window scaled to an average month of 30.4375 days.
    expect(f.monthlySavings).toBeCloseTo(0.015 * (30.4375 / 30), 12);
    expect(f.annualisedSavings).toBeCloseTo(f.monthlySavings * 12, 12);
    expect(f.costPerSuccessfulRequest.current).toBeCloseTo(0.0045, 12);
    expect(f.costPerSuccessfulRequest.projected).toBeCloseTo(0.003, 12);
  });

  it('keeps a one-off migration cost separate and works out payback', () => {
    const records = many(1000);
    const a = run(records, { assumptions: { outputTokenChangePct: 0, migrationCostEstimate: 2 } });
    const f = a.financial!;
    expect(f.savings).toBeCloseTo(1.5, 9);
    expect(f.oneOffMigrationCost).toBe(2);
    expect(f.paybackMonths).toBeCloseTo(2 / f.monthlySavings, 9);
  });

  it('matches the seed fixture: current cost is the recorded cost of every measured call', () => {
    const a = estimateUpgrade(fixtureRequest(), ctx());
    const records = fixtureRecords().filter((r) => r.modelId === 'claude-sonnet-4-5');
    const recorded = records.reduce((s, r) => s + (r.cost ?? 0), 0);
    expect(a.current.usage.requests).toBe(240);
    expect(a.current.usage.unmeasuredRequests).toBe(4);
    expect(a.financial!.currentCost).toBeCloseTo(recorded, 9);
    // Every split of the change adds back up to the total.
    const impactSum = a.impacts.reduce((s, i) => s + i.amount, 0);
    expect(-impactSum).toBeCloseTo(a.financial!.savings, 9);
    const tokenRows = a.breakdown.filter((r) => ['input', 'output', 'cached', 'reasoning'].includes(r.id));
    expect(tokenRows.reduce((s, r) => s + r.currentCost!, 0)).toBeCloseTo(a.financial!.currentCost, 9);
    expect(tokenRows.reduce((s, r) => s + r.projectedCost!, 0)).toBeCloseTo(a.financial!.projectedCost, 9);
  });
});

describe('migration percentage', () => {
  it('0% moves nothing: projected cost equals current cost, and says so', () => {
    const a = run(many(10), { migrationPercentage: 0 });
    expect(a.financial!.projectedCost).toBeCloseTo(a.financial!.currentCost, 12);
    expect(a.financial!.savings).toBeCloseTo(0, 12);
    expect(a.notices.join(' ')).toContain('0%');
    expect(a.recommendation.classification).toBe('not_recommended');
  });

  it('scales linearly with the share that moves', () => {
    const half = run(many(10), { migrationPercentage: 50, assumptions: { outputTokenChangePct: 0 } });
    expect(half.financial!.savings).toBeCloseTo(0.0075, 12);
  });

  it.each([
    [101, 'between 0 and 100'],
    [-1, 'between 0 and 100'],
    ['80', 'a number'],
    [Number.NaN, 'a number'],
    [undefined, 'a number'],
  ])('rejects %s', (value, message) => {
    const body = { ...fixtureRequest(), migrationPercentage: value };
    expect(() => parseEstimateRequest(body)).toThrow(message);
  });
});

describe('eligibility', () => {
  const ctxFor = (candidate: ModelProfile = SONNET_55, rules = eligibleAll, region: string | null = null) => ({ candidate, path: candidate.upgradePaths[0] ?? null, rules, region });

  it('needs confirmation: without a matching rule a call requires review, never savings', () => {
    expect(classifyRecord(rec(), ctxFor(SONNET_55, [])).status).toBe('requires_review');
    const a = run(many(10), { eligibilityRules: [] });
    expect(a.status).toBe('insufficient_data');
    expect(a.recommendation.classification).toBe('insufficient_data');
    expect(a.eligibility.requiresReview.requests).toBe(10);
    expect(a.financial).toBeNull();
  });

  it('an explicit exclusion beats an eligibility rule at any level', () => {
    const rules = [
      { id: 'a', level: 'workflow' as const, targetId: 'wf-x', decision: 'eligible' as const, reason: '' },
      { id: 'b', level: 'environment' as const, targetId: 'production', decision: 'exclude' as const, reason: 'Change freeze' },
    ];
    const d = classifyRecord(rec({ workflowId: 'wf-x', environment: 'production' }), ctxFor(SONNET_55, rules));
    expect(d).toEqual({ status: 'ineligible', reason: 'Excluded (environment rule): Change freeze' });
    expect(classifyRecord(rec({ workflowId: 'wf-x', environment: 'staging' }), ctxFor(SONNET_55, rules)).status).toBe('eligible');
  });

  it.each([
    ['team', { teamId: 'team-b' }],
    ['project', { projectId: 'p1' }],
    ['application', { applicationId: 'app1' }],
    ['agent', { agentId: 'ag1' }],
    ['model', { modelId: 'claude-sonnet-4-5' }],
    ['provider', { providerId: 'anthropic' }],
  ] as const)('can be set at %s level', (level, fields) => {
    const targetId = Object.values(fields)[0];
    const rules = [{ id: 'x', level, targetId, decision: 'eligible' as const, reason: '' }];
    expect(classifyRecord(rec(fields), ctxFor(SONNET_55, rules)).status).toBe('eligible');
    expect(classifyRecord(rec(), ctxFor(SONNET_55, rules)).status).toBe(level === 'model' || level === 'provider' ? 'eligible' : 'requires_review');
  });

  it('calls needing a feature the candidate lacks are ineligible', () => {
    const noVision = { ...SONNET_55, features: SONNET_55.features.filter((f) => f !== 'vision') };
    expect(classifyRecord(rec({ requiredFeatures: ['vision'] }), ctxFor(noVision)).status).toBe('ineligible');
    const a = estimateUpgrade(fixtureRequest(), ctx({ catalogue: [SONNET_45, noVision] }));
    expect(a.eligibility.reasons[0].reason).toContain('image input');
    expect(a.eligibility.ineligible.requests).toBe(30);
  });

  it('a workflow can have eligible and ineligible calls; only eligible ones count', () => {
    const a = estimateUpgrade(fixtureRequest({ eligibilityRules: [...eligibleAll, { id: 'p', level: 'environment', targetId: 'production', decision: 'exclude', reason: '' }] }), ctx());
    expect(a.eligibility.mixedWorkflows).toEqual(['Ticket triage']);
    expect(a.eligibility.eligible.requests).toBe(90); // staging triage 30 + development reports 60
  });

  it('a candidate unavailable in the region or environment can’t take those calls', () => {
    const regional = { ...SONNET_55, regions: ['us-east5'] };
    const a = estimateUpgrade(fixtureRequest(), ctx({ catalogue: [SONNET_45, regional], regionOf: () => 'australia-southeast1' }));
    expect(a.eligibility.eligible.requests).toBe(0);
    expect(a.recommendation.classification).toBe('not_recommended');
    expect(a.risks.find((r) => r.kind === 'governance')!.level).toBe('high');
    const devOnly = { ...SONNET_55, environments: ['development' as const] };
    expect(estimateUpgrade(fixtureRequest(), ctx({ catalogue: [SONNET_45, devOnly] })).eligibility.eligible.requests).toBe(60);
  });

  it('an unknown pairing needs review unless someone confirms it', () => {
    const unpaired = { ...SONNET_55, upgradePaths: [] };
    expect(classifyRecord(rec(), { candidate: unpaired, path: null, rules: [], region: null }).reason).toContain('No compatibility record');
    const a = estimateUpgrade(fixtureRequest(), ctx({ catalogue: [SONNET_45, unpaired] }));
    expect(a.risks.find((r) => r.kind === 'compatibility')!.level).toBe('high');
    expect(a.recommendation.classification).toBe('not_recommended');
  });
});

describe('missing data', () => {
  it('missing candidate pricing gives volumes, the agreed message and no savings', () => {
    const a = run(many(10), { candidateModelId: 'claude-sonnet-preview' });
    expect(a.status).toBe('insufficient_data');
    expect(a.financial).toBeNull();
    expect(a.recommendation.reasons).toEqual([MISSING_PRICING_MESSAGE]);
    expect(a.current.usage.requests).toBe(10);
    expect(a.risks.find((r) => r.kind === 'financial')!.level).toBe('high');
  });

  it('missing current pricing when no call has a cost is the same message', () => {
    const unpricedCurrent = { ...SONNET_45, pricing: null };
    const a = estimateUpgrade(fixtureRequest(), ctx({ catalogue: [unpricedCurrent, SONNET_55], records: many(3, { cost: null, costStatus: 'unavailable' }) }));
    expect(a.recommendation.reasons).toEqual([MISSING_PRICING_MESSAGE]);
  });

  it('no observed usage in the period is insufficient data, not zero savings', () => {
    const a = run(many(5, { localDate: '2026-07-01' }));
    expect(a.recommendation.classification).toBe('insufficient_data');
    expect(a.recommendation.reasons[0]).toContain('no observed usage');
  });

  it('calls without measured usage are left out of cost, not counted as zero', () => {
    const a = run([...many(4), rec({ id: 'u', inputTokens: null, outputTokens: null, cost: null, costStatus: 'unavailable' })]);
    expect(a.current.usage.unmeasuredRequests).toBe(1);
    expect(a.financial!.currentCost).toBeCloseTo(0.018, 12);
    expect(a.notices.join(' ')).toContain('not counted as zero');
  });
});

describe('token categories', () => {
  it('prices input, cached, output and reasoning tokens separately', () => {
    const candidate: ModelProfile = {
      ...SONNET_55,
      pricing: { ...SONNET_55.pricing!, inputPerMillion: 1, cachedInputPerMillion: 0.1, outputPerMillion: 5, reasoningPerMillion: 4 },
      expected: { ...SONNET_55.expected, outputTokenChangePct: null, reasoningTokensPerRequest: 200 },
    };
    const records = many(10, { inputTokens: 600, cachedInputTokens: 400, outputTokens: 100, cost: (600 * 3 + 400 * 0.3 + 100 * 15) / 1e6 });
    const a = estimateUpgrade(fixtureRequest(), ctx({ catalogue: [SONNET_45, candidate], records }));
    // Same cache share (40%), plus 200 reasoning tokens priced at $4/M.
    expect(a.candidate.projection.costPerRequest).toBeCloseTo((600 * 1 + 400 * 0.1 + 100 * 5 + 200 * 4) / 1e6, 12);
    const reasoning = a.impacts.find((i) => i.id === 'reasoning_tokens')!;
    expect(reasoning.amount).toBeCloseTo((10 * 200 * 4) / 1e6, 12);
    expect(a.risks.find((r) => r.kind === 'token')!.level).toBe('medium');
  });

  it('bills reasoning as output and cached as input when the candidate has no separate rate', () => {
    const candidate: ModelProfile = { ...SONNET_55, pricing: { ...SONNET_55.pricing!, cachedInputPerMillion: null, reasoningPerMillion: null } };
    const records = many(1, { inputTokens: 500, cachedInputTokens: 500, outputTokens: 100, reasoningTokens: 50, cost: 0.003 });
    const a = estimateUpgrade(fixtureRequest({ assumptions: { outputTokenChangePct: 0 } }), ctx({ catalogue: [SONNET_45, candidate], records }));
    // No cache discount: all 1,000 prompt tokens at input price.
    expect(a.candidate.projection.costPerRequest).toBeCloseTo((1_000 * 2 + 100 * 10 + 50 * 10) / 1e6, 12);
    expect(a.breakdown.find((r) => r.id === 'reasoning')!.note).toContain('output');
  });

  it('applies token and output changes from the assumptions', () => {
    const a = run(many(10), { assumptions: { inputTokenChangePct: 20, outputTokenChangePct: 50 } });
    expect(a.candidate.projection.avgInputTokens).toBeCloseTo(1_200, 9);
    expect(a.candidate.projection.avgOutputTokens).toBeCloseTo(150, 9);
    expect(a.impacts.find((i) => i.id === 'input_tokens')!.amount).toBeCloseTo((10 * 200 * 2) / 1e6, 12);
  });

  it('models retries and request volume, and the splits add up', () => {
    const records = [...many(9), rec({ id: 'retry', isRetry: true })];
    const a = run(records, { assumptions: { outputTokenChangePct: 0, candidateErrorRatePct: 20, requestVolumeChangePct: 10 } });
    // 9 first calls × 1.1 volume ÷ (1 − 0.2) retries.
    expect(a.candidate.projection.requests).toBeCloseTo((9 * 1.1) / 0.8, 9);
    const total = a.impacts.reduce((s, i) => s + i.amount, 0);
    expect(total).toBeCloseTo(a.financial!.projectedCost - a.financial!.currentCost, 12);
    expect(a.impacts.find((i) => i.id === 'retries')!.amount).toBeGreaterThan(0);
  });
});

describe('recommendation', () => {
  it('a more expensive candidate is not recommended', () => {
    const pricier = { ...SONNET_55, pricing: { ...SONNET_55.pricing!, inputPerMillion: 5, outputPerMillion: 25 } };
    const a = estimateUpgrade(fixtureRequest(), ctx({ catalogue: [SONNET_45, pricier] }));
    expect(a.financial!.savings).toBeLessThan(0);
    expect(a.recommendation.classification).toBe('not_recommended');
    expect(a.rolloutPlan).toBeNull();
  });

  it('without an evaluation it needs validation, with a rollout plan', () => {
    const a = estimateUpgrade(fixtureRequest(), ctx({ records: fixtureRecords().map((r) => ({ ...r, cost: r.cost === null ? null : r.cost * 1000 })) }));
    expect(a.recommendation.classification).toBe('recommended_with_validation');
    expect(a.risks.find((r) => r.kind === 'quality')!.detail).toContain(QUALITY_UNKNOWN_MESSAGE);
    expect(a.rolloutPlan).toHaveLength(7);
    expect(a.rolloutPlan![0]).toContain('development');
  });

  it('a passing evaluation on a drop-in upgrade is strongly recommended; business-critical work is not', () => {
    const records = fixtureRecords().map((r) => ({ ...r, cost: r.cost === null ? null : r.cost * 1000 }));
    const assumptions = { evaluationQualityScore: 92, qualityThreshold: 85, outputTokenChangePct: 0 };
    expect(estimateUpgrade(fixtureRequest({ assumptions }), ctx({ records })).recommendation.classification).toBe('strongly_recommended');
    expect(estimateUpgrade(fixtureRequest({ assumptions: { ...assumptions, businessCritical: true } }), ctx({ records })).recommendation.classification).toBe('recommended_with_validation');
    expect(estimateUpgrade(fixtureRequest({ assumptions: { evaluationQualityScore: 70, qualityThreshold: 85 } }), ctx({ records })).recommendation.classification).toBe('not_recommended');
  });

  it('a large share needing review makes it conditional', () => {
    const records = fixtureRecords().map((r) => ({ ...r, cost: r.cost === null ? null : r.cost * 1000 }));
    const a = estimateUpgrade(fixtureRequest({ eligibilityRules: [{ id: 'd', level: 'environment', targetId: 'development', decision: 'eligible', reason: '' }] }), ctx({ records }));
    expect(a.recommendation.classification).toBe('conditional');
    expect(a.rolloutPlan).toBeNull();
  });

  it('a big latency increase is a material risk', () => {
    const records = fixtureRecords().map((r) => ({ ...r, cost: r.cost === null ? null : r.cost * 1000 }));
    const a = estimateUpgrade(fixtureRequest({ assumptions: { latencyChangePct: 60 } }), ctx({ records }));
    expect(a.risks.find((r) => r.kind === 'latency')!.level).toBe('high');
    expect(a.recommendation.classification).toBe('not_recommended');
  });

  it('immaterial savings are not recommended', () => {
    // The fixture saves only about a dollar a month: below the $5 materiality floor.
    const a = estimateUpgrade(fixtureRequest(), ctx());
    expect(a.financial!.monthlySavings).toBeLessThan(5);
    expect(a.recommendation.classification).toBe('not_recommended');
    expect(a.recommendation.reasons[0]).toContain('immaterial');
  });
});

describe('edge cases', () => {
  it('flags mixed providers and leaves other models alone', () => {
    const a = estimateUpgrade(fixtureRequest(), ctx());
    expect(a.notices.join(' ')).toContain('2 providers');
  });

  it('flags a price change during the period', () => {
    const a = run([...many(5), ...many(5, { pricingVersion: 'v2' }).map((r) => ({ ...r, id: `${r.id}b` }))]);
    expect(a.notices.join(' ')).toContain('Pricing changed during the period');
    expect(a.risks.find((r) => r.kind === 'financial')!.level).toBe('medium');
  });

  it('flags a cross-provider move', () => {
    const gemini: ModelProfile = { ...SONNET_55, id: 'gemini-x', providerId: 'gemini_vertex', providerName: 'Google', displayName: 'Gemini X' };
    const a = estimateUpgrade(fixtureRequest({ candidateModelId: 'gemini-x' }), ctx({ catalogue: [SONNET_45, gemini] }));
    expect(a.notices.join(' ')).toContain('different provider');
    expect(a.risks.find((r) => r.kind === 'compatibility')!.level).toBe('medium');
  });
});

describe('authorisation and tenancy', () => {
  it('rejects a scope the viewer can’t see', () => {
    expect(() => estimateUpgrade(fixtureRequest({ scope: { level: 'team', id: 'team-z' } }), ctx())).toThrow(UpgradeAccessError);
    expect(() => estimateUpgrade(fixtureRequest({ scope: { level: 'team', id: 'team-b' } }), ctx({ scopes: { team: [{ id: 'team-a', label: 'A' }] } }))).toThrow(UpgradeAccessError);
  });

  it('only counts records in the chosen scope', () => {
    const a = estimateUpgrade(fixtureRequest({ scope: { level: 'team', id: 'team-a' } }), ctx());
    expect(a.current.usage.requests).toBe(150);
    expect(a.scope.label).toBe('Team A (team)');
  });
});

describe('input validation', () => {
  it.each([
    ['a future end date', { kind: 'custom', from: '2026-09-01', to: '2026-10-05' }, 'after today'],
    ['a reversed range', { kind: 'custom', from: '2026-09-10', to: '2026-09-01' }, 'on or before'],
    ['an impossible date', { kind: 'custom', from: '2026-02-30', to: '2026-03-01' }, 'real calendar dates'],
    ['too long a window', { kind: 'custom', from: '2026-01-01', to: '2026-09-01' }, '92 days'],
  ])('rejects %s', (_label, window, message) => {
    expect(() => resolveTimeWindow(window as never, FIXTURE_TODAY)).toThrow(message);
  });

  it('resolves relative windows to dates ending today', () => {
    expect(resolveTimeWindow({ kind: 'last_7_days' }, FIXTURE_TODAY)).toMatchObject({ from: '2026-09-24', to: '2026-09-30', days: 7 });
  });

  it.each([
    ['an unknown model', { candidateModelId: 'gpt-nope' }, 'Unknown model'],
    ['the same model twice', { candidateModelId: 'claude-sonnet-4-5' }, 'differs'],
    ['several current models at once', { currentModelId: ['a', 'b'] }, 'one current model'],
    ['an unknown field', { extra: 1 }, 'Unexpected field'],
    ['an unknown scope level', { scope: { level: 'galaxy', id: 'x' } }, 'scope.level'],
    ['a scope without an ID', { scope: { level: 'team' } }, 'scope.id'],
    ['a non-numeric assumption', { assumptions: { inputTokenChangePct: '10' } }, 'must be a number'],
    ['an out-of-range assumption', { assumptions: { candidateErrorRatePct: 80 } }, 'between 0 and 50'],
    ['a bad eligibility level', { eligibilityRules: [{ level: 'planet', decision: 'eligible' }] }, 'level'],
    ['a missing time window', { timeWindow: undefined }, 'time window'],
  ])('rejects %s', (_label, change, message) => {
    const body = { ...fixtureRequest(), ...change };
    expect(() => estimateUpgrade(parseEstimateRequest(body), ctx())).toThrow(message);
    try {
      estimateUpgrade(parseEstimateRequest(body), ctx());
    } catch (e) {
      expect(e).toBeInstanceOf(UpgradeInputError);
    }
  });
});

describe('reports', () => {
  it('always label projections as estimates and include the disclaimer', () => {
    const a = estimateUpgrade(fixtureRequest(), ctx());
    const md = renderMarkdownReport(a, { savedId: 'abc' });
    expect(md).toContain('Modelled projection');
    expect(md).toContain('Not a guaranteed saving');
    expect(md).toContain(DISCLAIMER);
    expect(md).toContain('**Recommendation:**');
    expect(summaryLines(a)[0]).toBe('**Upgrade Analysis**');
  });

  it('csv neutralises spreadsheet formulas', () => {
    const a = estimateUpgrade(fixtureRequest(), ctx({ companyLabel: '=HYPERLINK("x")' }));
    expect(renderCsvReport(a)).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
