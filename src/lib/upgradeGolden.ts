/**
 * Upgrade Analysis results the web app calculates for the agent's fixtures, so a Python
 * test can prove backend/axiomflo/reporting/upgrade.py gives the same answers.
 * Regenerate with `npm run agent:fixtures`.
 *
 * Each case runs on the demo workspace (Acme sample data), which exercises every rule:
 * eligibility rules, environments, regions, missing features, missing pricing, previews.
 */
import { DEMO_PERSONAS, DEMO_REPORTING_DATE } from '../data/mockData';
import { demoDefaultRules } from '../data/upgradeFixtures';
import { demoEstimateContext } from '../services/upgradeAnalysisService';
import type { UserContext } from '../types';
import { buildUsageSnapshot } from './agentRealFixtures';
import { expandRecords } from '../../server/src/upgrade/realWorkspace';
import { addDays, estimateUpgrade, parseEstimateRequest, summaryLines, type EligibilityRule, type UpgradeEstimateRequest } from './upgrade';

const NOW = new Date('2026-09-30T06:00:00.000Z');
const personas: Record<string, UserContext> = {
  admin: { userId: DEMO_PERSONAS.company_admin, role: 'company_admin' },
  individual: { userId: DEMO_PERSONAS.individual_user, role: 'individual_user' },
};

const sonnet = { currentModelId: 'claude-sonnet-demo', candidateModelId: 'claude-sonnet-2-demo' };
const company = { level: 'company', id: null } as const;
const last30 = { kind: 'last_30_days' } as const;
const everything: EligibilityRule[] = [{ id: 'all', level: 'company', targetId: null, decision: 'eligible', reason: '' }];

const CASES: [string, keyof typeof personas, Record<string, unknown>][] = [
  ['sonnet company 30 days', 'admin', { ...sonnet, scope: company, timeWindow: last30, migrationPercentage: 100, eligibilityRules: demoDefaultRules }],
  [
    'sonnet with every assumption',
    'admin',
    {
      ...sonnet,
      scope: company,
      timeWindow: last30,
      migrationPercentage: 50,
      eligibilityRules: demoDefaultRules,
      assumptions: { inputTokenChangePct: 10, outputTokenChangePct: 15, cachedTokenSharePct: 20, reasoningTokensPerRequest: 300, requestVolumeChangePct: 20, candidateErrorRatePct: 5, latencyChangePct: 30, migrationCostEstimate: 500, qualityThreshold: 80, evaluationQualityScore: 70, businessCritical: true },
    },
  ],
  ['flash platform team 7 days 80%', 'admin', { currentModelId: 'gemini-flash-demo', candidateModelId: 'gemini-flash-2-demo', scope: { level: 'team', id: 'team-platform' }, timeWindow: { kind: 'last_7_days' }, migrationPercentage: 80, eligibilityRules: demoDefaultRules }],
  ['haiku missing features', 'admin', { currentModelId: 'claude-haiku-demo', candidateModelId: 'claude-haiku-2-demo', scope: company, timeWindow: last30, migrationPercentage: 100, eligibilityRules: everything }],
  ['pro preview region', 'admin', { currentModelId: 'gemini-pro-demo', candidateModelId: 'gemini-pro-2-preview-demo', scope: company, timeWindow: last30, migrationPercentage: 100, eligibilityRules: demoDefaultRules }],
  ['flash-lite without pricing', 'admin', { currentModelId: 'gemini-flash-demo', candidateModelId: 'gemini-flash-lite-preview-demo', scope: company, timeWindow: last30, migrationPercentage: 100, eligibilityRules: demoDefaultRules }],
  ['no eligibility rules', 'admin', { ...sonnet, scope: company, timeWindow: last30, migrationPercentage: 100 }],
  ['cross provider', 'admin', { currentModelId: 'gemini-flash-demo', candidateModelId: 'claude-haiku-2-demo', scope: company, timeWindow: last30, migrationPercentage: 100, eligibilityRules: everything }],
  ['custom window workflow', 'admin', { ...sonnet, scope: { level: 'workflow', id: 'wf-ticket-summary' }, timeWindow: { kind: 'custom', from: '2026-09-01', to: '2026-09-15' }, migrationPercentage: 75, eligibilityRules: demoDefaultRules }],
  ['strongly recommended', 'admin', { ...sonnet, scope: company, timeWindow: last30, migrationPercentage: 100, eligibilityRules: everything, assumptions: { outputTokenChangePct: 0, evaluationQualityScore: 90, qualityThreshold: 80 } }],
  ['costs increase', 'admin', { currentModelId: 'claude-haiku-demo', candidateModelId: 'claude-sonnet-2-demo', scope: company, timeWindow: last30, migrationPercentage: 100, eligibilityRules: everything }],
  ['zero migration', 'admin', { ...sonnet, scope: company, timeWindow: last30, migrationPercentage: 0, eligibilityRules: demoDefaultRules }],
  ['conditional on review', 'admin', { ...sonnet, scope: company, timeWindow: last30, migrationPercentage: 100, eligibilityRules: [{ id: 'platform', level: 'workflow', targetId: 'wf-interactive-platform', decision: 'eligible', reason: '' }] }],
  ['exclusions and environment rules', 'admin', { currentModelId: 'gemini-flash-demo', candidateModelId: 'gemini-flash-2-demo', scope: { level: 'environment', id: 'production' }, timeWindow: last30, migrationPercentage: 60, eligibilityRules: [...demoDefaultRules, { id: 'x', level: 'application', targetId: 'app-ci-review', decision: 'exclude', reason: 'Owned by CI' }] }],
  ['individual user', 'individual', { ...sonnet, scope: company, timeWindow: last30, migrationPercentage: 100, eligibilityRules: demoDefaultRules }],
];

const pathOf = (c: { upgradePaths: { fromModelId: string; compatibility: string }[] }, from: string) => c.upgradePaths.find((p) => p.fromModelId === from)?.compatibility;

export function buildUpgradeGolden() {
  // One record set per persona: the widest window any case uses (the engine filters by date itself).
  const from = addDays(DEMO_REPORTING_DATE, -29);
  const contexts = Object.fromEntries(
    Object.entries(personas).map(([key, persona]) => {
      const ctx = demoEstimateContext(parseEstimateRequest({ ...sonnet, scope: company, timeWindow: { kind: 'custom', from, to: DEMO_REPORTING_DATE }, migrationPercentage: 100 }), persona, NOW);
      const providers = [...new Set(ctx.catalogue.map((m) => m.providerId))];
      return [key, { ...ctx, regionOf: undefined, regions: Object.fromEntries(providers.map((p) => [p, ctx.regionOf(p)])) }];
    }),
  );
  const cases = CASES.map(([name, persona, body]) => {
    const request: UpgradeEstimateRequest = parseEstimateRequest(body);
    const c = contexts[persona];
    const analysis = estimateUpgrade(request, { ...c, regionOf: (p: string) => c.regions[p] ?? null });
    return { name, context: persona, body, analysis, summary: summaryLines(analysis) };
  });
  // Records as columns and rows, to keep the file small.
  const compact = Object.fromEntries(
    Object.entries(contexts).map(([key, c]) => {
      const columns = Object.keys(c.records[0] ?? {}) as (keyof (typeof c.records)[number])[];
      return [key, { ...c, records: { columns, rows: c.records.map((r) => columns.map((k) => r[k])) } }];
    }),
  );
  // The live path: the upgrade block of the sample snapshot (backend/fixtures/sample-snapshot.json).
  const upgrade = buildUsageSnapshot().upgrade;
  const snapshot = { ...upgrade, records: expandRecords(upgrade.records) };
  const modelIds = [...new Set(snapshot.records.map((r) => r.modelId))].sort();
  const snapshotCases = modelIds.flatMap((currentModelId) =>
    snapshot.catalogue
      // One same-family upgrade and one other move per model, so every observed model is covered.
      .filter((c) => c.pricing && c.upgradePaths.some((p) => p.fromModelId === currentModelId))
      .sort((a, b) => Number(pathOf(b, currentModelId) === 'drop_in') - Number(pathOf(a, currentModelId) === 'drop_in'))
      .slice(0, 2)
      .flatMap((candidate) =>
        (['last_30_days', 'last_7_days'] as const).map((kind) => {
          const body = { currentModelId, candidateModelId: candidate.id, scope: company, timeWindow: { kind }, migrationPercentage: 100, eligibilityRules: everything };
          const analysis = estimateUpgrade(parseEstimateRequest(body), { ...snapshot, regionOf: () => null, now: NOW.toISOString() });
          return { name: `${currentModelId} to ${candidate.id}, ${kind}`, body, analysis, summary: summaryLines(analysis) };
        }),
      ),
  );
  return { generatedFrom: 'src/lib/upgradeGolden.ts', contexts: compact, cases, snapshotNow: NOW.toISOString(), snapshotCases };
}
