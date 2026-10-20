import { describe, expect, it } from 'vitest';
import { buildAssistantResponse, detectIntent, getAssistantResponse, SUGGESTED_QUESTIONS } from './assistantService';
import { buildDemoScorecard } from './finopsService';
import { buildMonthlyShowback, buildOverview, selectRecords } from './mockService';
import { DEMO_PERSONAS } from '../data/mockData';
import { summarize } from '../lib/calculations';
import type { UserContext } from '../types';

const admin: UserContext = { userId: DEMO_PERSONAS.company_admin, role: 'company_admin' };
const individual: UserContext = { userId: DEMO_PERSONAS.individual_user, role: 'individual_user' };
const sept = { period: '2026-09' };

describe('Assistant intent detection', () => {
  it('supports every suggested question', () => {
    expect(SUGGESTED_QUESTIONS.map(detectIntent)).toEqual(['team_spend', 'provider_spend', 'period_change', 'supporting_requests', 'estimated_meaning', 'optimise', 'unit_economics']);
  });

  it('refuses requests to change data', () => {
    expect(detectIntent('Increase the Platform team budget')).toBe('read_only');
    expect(detectIntent('Disable the Anthropic connection')).toBe('read_only');
    const r = buildAssistantResponse('Please change our budget settings', sept, admin);
    expect(r.answer.join(' ')).toMatch(/read-only/);
    expect(r.supporting).toBeUndefined();
  });

  it('explains its scope for unsupported questions instead of inventing an answer', () => {
    const r = buildAssistantResponse('What is the weather in Sydney?', sept, admin);
    expect(r.intent).toBe('unsupported');
    expect(r.answer.join(' ')).toMatch(/I can answer questions about/);
    expect(r.figures).toEqual({});
  });

  it('does not claim a cheaper model is equivalent', () => {
    const r = buildAssistantResponse('Which model is cheaper and just as good?', sept, admin);
    expect(r.answer.join(' ')).toMatch(/doesn’t mean a model gives equivalent quality/);
  });
});

describe('Assistant answers use the shared calculations', () => {
  it('team spend matches the Overview and showback totals', () => {
    const r = buildAssistantResponse(SUGGESTED_QUESTIONS[0], sept, admin);
    const overview = buildOverview(sept, admin).summary;
    const showback = buildMonthlyShowback('2026-09', {}, admin);
    expect(r.figures.estimatedSpend).toBeCloseTo(overview.estimatedSpend, 9);
    for (const t of showback.teams) expect(r.figures[`team:${t.teamId}`]).toBeCloseTo(t.summary.estimatedSpend, 9);
    expect(r.table?.rows).toHaveLength(2);
    expect(r.facts.find((f) => f.label === 'Currency')?.value).toBe('AUD');
    expect(r.supporting?.filters).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('Gemini spend matches the provider total and links with a provider filter', () => {
    const r = buildAssistantResponse(SUGGESTED_QUESTIONS[1], sept, admin);
    const expected = summarize(selectRecords({ period: '2026-09', providerId: 'gemini_vertex' }, admin));
    expect(r.figures.estimatedSpend).toBeCloseTo(expected.estimatedSpend, 9);
    expect(r.supporting?.filters.provider).toBe('gemini_vertex');
  });

  it('period comparison reports the measured change without inventing a cause', () => {
    const r = buildAssistantResponse(SUGGESTED_QUESTIONS[2], sept, admin);
    const now = buildOverview({ period: '2026-09' }, admin).summary.estimatedSpend;
    const before = buildOverview({ period: '2026-08' }, admin).summary.estimatedSpend;
    expect(r.figures.change).toBeCloseTo(now - before, 9);
    expect(r.answer.join(' ')).toMatch(/can’t tell you the business reason/);
    expect(r.answer[0]).toMatch(now > before ? /increased/ : /decreased|unchanged/);
  });

  it('has no previous period for the earliest month', () => {
    const r = buildAssistantResponse(SUGGESTED_QUESTIONS[2], { period: '2026-08' }, admin);
    expect(r.answer[0]).toMatch(/earliest month/);
    expect(r.table).toBeUndefined();
  });

  it('"this total" reuses the previous answer’s filters', () => {
    const gemini = buildAssistantResponse(SUGGESTED_QUESTIONS[1], sept, admin);
    const r = buildAssistantResponse(SUGGESTED_QUESTIONS[3], { ...sept, previous: gemini.supporting?.filters }, admin);
    expect(r.supporting?.filters).toEqual(gemini.supporting?.filters);
    expect(r.figures.estimatedSpend).toBeCloseTo(gemini.figures.estimatedSpend!, 9);
  });

  it('counts unavailable costs separately and never as $0', () => {
    const r = buildAssistantResponse('Which requests have unavailable costs?', sept, admin);
    expect(r.figures.unresolvedCount).toBe(buildOverview(sept, admin).summary.unresolvedCount);
    expect(r.supporting?.filters.cost).toBe('unavailable');
    expect(r.answer[0]).toMatch(/not counted as \$0/);
  });

  it('describes estimates as showback, not a bill', () => {
    const r = buildAssistantResponse(SUGGESTED_QUESTIONS[4], sept, admin);
    expect(r.answer.join(' ')).toMatch(/not a bill or an amount due/);
    expect(r.table?.rows).toHaveLength(4);
  });

  it('resolves through the async service', async () => {
    const r = await getAssistantResponse(SUGGESTED_QUESTIONS[0], sept, admin);
    expect(r.intent).toBe('team_spend');
  });
});

describe('Assistant role scoping', () => {
  it('limits an individual to their own requests', () => {
    const r = buildAssistantResponse(SUGGESTED_QUESTIONS[0], sept, individual);
    const own = buildMonthlyShowback('2026-09', {}, individual).summary;
    expect(r.figures.estimatedSpend).toBeCloseTo(own.estimatedSpend, 9);
    expect(r.figures.estimatedSpend!).toBeLessThan(buildOverview(sept, admin).summary.estimatedSpend);
    expect(r.answer[0]).toMatch(/only see your own requests/);
    expect(r.table?.rows).toHaveLength(1);
    expect(r.facts.find((f) => f.label === 'Data scope')?.value).toMatch(/Individual User/);
  });

  it('scopes every intent for an individual', () => {
    const adminTotal = buildOverview(sept, admin).summary.requestCount;
    for (const q of SUGGESTED_QUESTIONS.slice(0, 4)) {
      const r = buildAssistantResponse(q, sept, individual);
      const count = r.figures.requestCount ?? r.figures.currentRequests;
      if (count !== undefined && count !== null) expect(count).toBeLessThan(adminTotal);
    }
  });
});

describe('Cost optimisation answers', () => {
  it('ranks the five levers from the FinOps Scorecard', () => {
    const r = buildAssistantResponse('How can we cut our AI costs?', sept, admin);
    const { scorecard } = buildDemoScorecard('2026-09', admin);
    expect(r.intent).toBe('optimise');
    expect(r.table?.rows).toHaveLength(5);
    expect(r.table?.rows[0].lever).toBe(scorecard.levers[0].name);
    expect(r.figures.combinedSavings).toBe(scorecard.combinedSavings);
    expect(r.figures.score).toBe(scorecard.score);
    expect(r.page?.to).toBe('/scorecard');
    expect(r.answer.join(' ')).toMatch(/doesn’t promise the same quality/);
  });

  it('understands other ways of asking', () => {
    for (const q of ['Any savings ideas?', 'How do we optimise spend?', 'Show the FinOps scorecard', 'Ways to reduce our Gemini cost']) expect(detectIntent(q)).toBe('optimise');
    for (const q of ['What is our unit economics?', 'Token cost per workflow', 'What is the cost per request?']) expect(detectIntent(q)).toBe('unit_economics');
    expect(detectIntent('Which model is cheaper and just as good?')).toBe('unsupported');
  });

  it('gives token cost per workflow, scoped to the person asking', () => {
    const r = buildAssistantResponse('What does each workflow cost in tokens?', sept, admin);
    expect(r.table?.rows.map((row) => row.workflow)).toContain('CI code-review bot');
    const own = buildAssistantResponse('What does each workflow cost in tokens?', sept, individual);
    expect(own.table?.rows.map((row) => row.workflow)).toEqual(['Interactive use · Product Experience']);
    expect(own.figures.estimatedSpend).toBeLessThan(r.figures.estimatedSpend!);
  });
});
