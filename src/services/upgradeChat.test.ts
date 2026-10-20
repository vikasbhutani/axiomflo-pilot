import { beforeEach, describe, expect, it } from 'vitest';
import { buildAssistantResponse, detectIntent, type AssistantResponse } from './assistantService';
import { buildDemoUpgradeEstimate, buildDemoUpgradeModels, exportDemoUpgrade, getDemoUpgrade, resetDemoUpgrades, saveDemoUpgrade } from './upgradeAnalysisService';
import { parseUpgradeParams, upgradeHref } from '../components/upgrade/params';
import { DEMO_PERSONAS } from '../data/mockData';
import { demoDefaultRules } from '../data/upgradeFixtures';
import { DISCLAIMER, QUALITY_UNKNOWN_MESSAGE, type UpgradeEstimateRequest } from '../lib/upgrade';
import type { UserContext } from '../types';

const admin: UserContext = { userId: DEMO_PERSONAS.company_admin, role: 'company_admin' };
const individual: UserContext = { userId: DEMO_PERSONAS.individual_user, role: 'individual_user' };

/** Asks each question in turn, handing back the previous answer's conversation state. */
function converse(questions: string[], who = admin): AssistantResponse[] {
  const out: AssistantResponse[] = [];
  for (const q of questions) out.push(buildAssistantResponse(q, { period: '2026-09', upgrade: out[out.length - 1]?.upgrade }, who));
  return out;
}
const text = (r: AssistantResponse) => r.answer.join('\n');

const sonnet: UpgradeEstimateRequest = {
  currentModelId: 'claude-sonnet-demo',
  candidateModelId: 'claude-sonnet-2-demo',
  scope: { level: 'company', id: null },
  timeWindow: { kind: 'last_30_days' },
  migrationPercentage: 100,
  assumptions: {},
  eligibilityRules: demoDefaultRules,
};

beforeEach(() => {
  resetDemoUpgrades();
});

describe('Upgrade Analysis in the assistant chat', () => {
  it('routes upgrade questions to the analysis without changing the existing intents', () => {
    expect(detectIntent('Can we upgrade to a newer model?')).toBe('upgrade_analysis');
    expect(detectIntent('What would we save if we migrated Flash to Flash 2?')).toBe('upgrade_analysis');
    expect(detectIntent('How can we cut our AI costs?')).toBe('optimise');
    expect(detectIntent('Which model is cheaper and just as good?')).toBe('unsupported');
  });

  it('asks for each missing input one at a time, then confirms 100% migration before running', () => {
    const [current, scope, window, pct, confirm, result] = converse(['Can we upgrade to a newer model?', 'Claude Sonnet', 'The whole company', 'Last 30 days', 'Yes, 100%', 'Yes, run it']);
    expect(current.upgrade?.awaiting).toBe('current');
    expect(text(current)).toBe('Which model do you use today?');
    expect(current.followUps).toContain('Claude Sonnet');
    expect(scope.upgrade?.awaiting).toBe('scope');
    expect(window.upgrade?.awaiting).toBe('window');
    expect(pct.upgrade?.awaiting).toBe('pct');
    expect(text(pct)).toBe('Assuming 100% of eligible calls migrate. Continue?');
    expect(confirm.upgrade?.awaiting).toBe('confirm');
    expect(text(confirm)).toMatch(/Before I calculate, here are my assumptions/);
    expect(text(confirm)).toMatch(/Candidate model: Claude Sonnet 2/);
    expect(confirm.figures).toEqual({}); // no numbers before the assumptions are confirmed

    expect(result.intent).toBe('upgrade_analysis');
    expect(result.upgrade?.awaiting).toBeNull();
    const expected = buildDemoUpgradeEstimate(sonnet, admin);
    expect(result.figures.monthlySavings).toBeCloseTo(expected.financial!.monthlySavings, 6);
    expect(text(result)).toMatch(/Financial impact \(modelled projection, not a guaranteed saving\)/);
    expect(text(result)).toContain(QUALITY_UNKNOWN_MESSAGE);
    expect(text(result)).toMatch(/Recommendation: Recommended with validation/);
    expect(result.answer[result.answer.length - 1]).toBe(DISCLAIMER);
    expect(result.page?.to).toBe(upgradeHref(sonnet));
    expect(result.facts.map((f) => f.value)).toContain('Modelled estimate · not a guaranteed saving');
  });

  it('skips the questions a full request already answers, but still confirms', () => {
    const [confirm, result] = converse(['How much could we save if we switched Gemini Flash to Flash 2 for the Platform team over the last 7 days at 80%?', 'yes']);
    expect(confirm.upgrade?.awaiting).toBe('confirm');
    expect(text(confirm)).toMatch(/Platform Engineering \(team\)/);
    expect(text(confirm)).toMatch(/80% of eligible calls/);
    expect(result.upgrade?.lastRequest).toMatchObject({ currentModelId: 'gemini-flash-demo', candidateModelId: 'gemini-flash-2-demo', scope: { level: 'team', id: 'team-platform' }, timeWindow: { kind: 'last_7_days' }, migrationPercentage: 80 });
    expect(text(result)).toMatch(/Recommendation: Not recommended/); // the saving is immaterial
  });

  it('asks which model when only a provider is named, and declines providers it has no data for', () => {
    const [anthropic] = converse(['Should we move to a newer Anthropic model?']);
    expect(text(anthropic)).toBe('Which Anthropic model do you use today: Claude Sonnet or Claude Haiku?');
    const [openai] = converse(['Upgrade from GPT-4o']);
    expect(text(openai)).toMatch(/only records Gemini on Vertex AI and Anthropic usage/);
    expect(openai.upgrade?.awaiting).toBe('current');
  });

  it('rejects an invalid migration percentage and asks again', () => {
    const [r] = converse(['Upgrade Sonnet to Sonnet 2 for the whole company over the last 30 days at 150%']);
    expect(text(r)).toMatch(/150% isn’t a valid migration percentage/);
    expect(r.upgrade?.awaiting).toBe('pct');
  });

  it('turns “non-production only” into an exclusion rule and says how it read the question', () => {
    const [, r] = converse(['Migrate only non-production Sonnet calls to Sonnet 2 over the last 30 days at 100%', 'yes']);
    expect(text(r)).toMatch(/production calls are excluded/);
    expect(r.figures.ineligibleCalls).toBeGreaterThan(0);
    expect(r.upgrade?.lastRequest?.eligibilityRules?.some((x) => x.level === 'environment' && x.targetId === 'production' && x.decision === 'exclude')).toBe(true);
  });

  it('reuses the last analysis for “change the migration percentage”', () => {
    const [, first, again, second] = converse(['Upgrade Sonnet to Sonnet 2 for the whole company over the last 30 days at 100%', 'yes', 'Change the migration percentage to 50%', 'yes']);
    expect(again.upgrade?.awaiting).toBe('confirm');
    expect(second.figures.monthlySavings).toBeCloseTo(first.figures.monthlySavings! / 2, 6);
  });

  it('analyses several models one at a time', () => {
    const [confirm, , next] = converse(['Upgrade Sonnet and Haiku to newer versions across the company over the last 30 days at 100%', 'yes', 'Now analyse Claude Haiku']);
    expect(text(confirm)).toMatch(/I analyse one model at a time/);
    expect(text(next)).toMatch(/Current model: Claude Haiku/);
    expect(text(next)).toMatch(/Candidate model: Claude Haiku 2/);
  });

  it('ranks workflows by estimated saving', () => {
    const [, r] = converse(['Which workflows benefit most from upgrading Sonnet to Sonnet 2 over the last 30 days at 100%?', 'yes']);
    expect(r.table?.rows.length).toBeGreaterThan(0);
    const savings = r.table!.rows.map((row) => Number(row.saving.replace(/[^0-9.-]/g, '')));
    expect([...savings].sort((a, b) => b - a)).toEqual(savings);
    expect(r.answer[r.answer.length - 1]).toBe(DISCLAIMER);
  });

  it('saves the last analysis as a draft when asked', () => {
    const [, result, saved] = converse(['Upgrade Sonnet to Sonnet 2 for the whole company over the last 30 days at 100%', 'yes', 'Save this analysis as a draft']);
    expect(text(saved)).toMatch(/Saved as a draft for review/);
    expect(getDemoUpgrade(saved.upgrade!.savedId!, admin).analysis.financial?.monthlySavings).toBeCloseTo(result.figures.monthlySavings!, 6);
  });

  it('keeps an Individual User to their own requests', () => {
    const [, r] = converse(['Upgrade my Sonnet calls to Sonnet 2 over the last 30 days at 100%', 'yes'], individual);
    const own = buildDemoUpgradeEstimate(sonnet, individual);
    expect(r.figures.currentCost).toBeCloseTo(own.financial!.currentCost, 6);
    expect(r.figures.currentCost!).toBeLessThan(buildDemoUpgradeEstimate(sonnet, admin).financial!.currentCost);
    expect(text(r)).toMatch(/requests only/);
  });

  it('answers every upgrade question listed in the README', () => {
    const complete = [
      'How much could we save if we switched Gemini Flash to Flash 2 for the Platform team over the last 7 days at 80%?',
      'Upgrade Sonnet to Sonnet 2 for the whole company over the last 30 days at 100%',
      'Migrate only non-production Sonnet calls to Sonnet 2 over the last 30 days at 100%',
      'Which workflows benefit most from upgrading Sonnet to Sonnet 2 over the last 30 days at 100%?',
      'Upgrade Sonnet and Haiku to newer versions across the company over the last 30 days at 100%',
    ];
    for (const q of complete) {
      const [confirm, result] = converse([q, 'yes']);
      expect(confirm.upgrade?.awaiting).toBe('confirm');
      expect(result.upgrade?.awaiting).toBeNull();
      expect(result.answer[result.answer.length - 1]).toBe(DISCLAIMER);
    }
    for (const q of ['Can we upgrade to a newer model?', 'Should we move to a newer Anthropic model?']) expect(converse([q])[0].upgrade?.awaiting).toBe('current');
    const [, first, again] = converse([complete[1], 'yes', 'Use the last 7 days instead', 'yes']);
    expect(again.upgrade?.awaiting).toBe('confirm');
    expect(text(again)).toMatch(/Period: the last 7 days/);
    expect(first.upgrade?.lastRequest?.timeWindow).toEqual({ kind: 'last_30_days' });
  });

  it('can be cancelled mid-conversation', () => {
    const [, cancelled] = converse(['Can we upgrade to a newer model?', 'cancel']);
    expect(text(cancelled)).toMatch(/dropped that upgrade analysis/);
    expect(cancelled.upgrade?.awaiting).toBeNull();
  });
});

describe('Demo Upgrade Analysis service', () => {
  it('lists only the models the viewer used, highest spend first, and only their own scopes', () => {
    const m = buildDemoUpgradeModels(admin);
    expect(m.currentModels.map((x) => x.id)).toEqual([...m.currentModels].sort((a, b) => b.observedCost - a.observedCost).map((x) => x.id));
    expect(m.candidateModels.every((c) => c.upgradePaths.length > 0)).toBe(true);
    const own = buildDemoUpgradeModels(individual);
    expect(own.scopes.find((s) => s.level === 'team')!.options).toHaveLength(1);
  });

  it('refuses a team the viewer can’t see', () => {
    const otherTeam = buildDemoUpgradeModels(admin).scopes.find((s) => s.level === 'team')!.options.find((o) => !buildDemoUpgradeModels(individual).scopes.find((s) => s.level === 'team')!.options.some((x) => x.id === o.id))!;
    expect(() => buildDemoUpgradeEstimate({ ...sonnet, scope: { level: 'team', id: otherTeam.id } }, individual)).toThrow();
  });

  it('saves idempotently, never rewrites a saved analysis, and audits exports', () => {
    const first = saveDemoUpgrade(sonnet, admin, { idempotencyKey: 'key-00000001' });
    expect(saveDemoUpgrade(sonnet, admin, { idempotencyKey: 'key-00000001' }).id).toBe(first.id);
    expect(() => saveDemoUpgrade({ ...sonnet, migrationPercentage: 50 }, admin, { idempotencyKey: 'key-00000001' })).toThrow(/different inputs/);
    expect(first.pricing.candidate.version).toBeTruthy();
    const md = exportDemoUpgrade(first.id, 'markdown', admin, 'exp-00000001');
    exportDemoUpgrade(first.id, 'markdown', admin, 'exp-00000001');
    expect(md.content).toContain(DISCLAIMER);
    expect(getDemoUpgrade(first.id, admin).audit.map((a) => a.action)).toEqual(['saved', 'exported']);
    expect(() => getDemoUpgrade(first.id, individual)).toThrow(/not found/);
  });
});

describe('Upgrade Analysis links', () => {
  it('round-trips the choices through the URL', () => {
    const request: UpgradeEstimateRequest = { ...sonnet, scope: { level: 'team', id: 'team-platform' }, timeWindow: { kind: 'custom', from: '2026-09-01', to: '2026-09-15' }, migrationPercentage: 80 };
    const href = upgradeHref(request);
    const parsed = parseUpgradeParams(new URL(href, 'http://x').searchParams);
    expect(parsed).toMatchObject({ currentModelId: sonnet.currentModelId, candidateModelId: sonnet.candidateModelId, scope: request.scope, migrationPercentage: 80 });
  });
});
