/**
 * Seed fixtures for Upgrade Analysis tests: a two-model comparison of Claude Sonnet 4.5
 * (current) and Claude Sonnet 5.5 (candidate), with list prices in USD per million
 * tokens as in gateway/prices.ts, and 30 days of usage across two teams.
 */
import type { ModelPricing, ModelProfile, UpgradeEstimateRequest, UpgradeUsageRecord } from '../upgrade/types.js';

export const FIXTURE_TODAY = '2026-09-30';

const pricing = (version: string, input: number, output: number, cached: number): ModelPricing => ({
  currency: 'USD',
  inputPerMillion: input,
  outputPerMillion: output,
  cachedInputPerMillion: cached,
  reasoningPerMillion: null,
  pricingVersion: version,
  pricingSource: 'Anthropic list price',
  validUntil: null,
  conversionNote: null,
});

export const SONNET_45: ModelProfile = {
  id: 'claude-sonnet-4-5',
  providerId: 'anthropic',
  providerName: 'Anthropic',
  displayName: 'Claude Sonnet 4.5',
  version: '4.5',
  status: 'ga',
  pricing: pricing('anthropic-2026-10-18', 3, 15, 0.3),
  features: ['tool_use', 'structured_output', 'vision', 'long_context', 'prompt_caching'],
  regions: null,
  environments: null,
  expected: { latencyChangePct: null, errorRatePct: null, outputTokenChangePct: null, reasoningTokensPerRequest: null },
  upgradePaths: [],
  qualityEvidence: null,
};

export const SONNET_55: ModelProfile = {
  id: 'claude-sonnet-5-5',
  providerId: 'anthropic',
  providerName: 'Anthropic',
  displayName: 'Claude Sonnet 5.5',
  version: '5.5',
  status: 'ga',
  pricing: pricing('anthropic-2026-10-18', 2, 10, 0.1),
  features: ['tool_use', 'structured_output', 'vision', 'long_context', 'prompt_caching'],
  regions: null,
  environments: null,
  expected: { latencyChangePct: -20, errorRatePct: null, outputTokenChangePct: 10, reasoningTokensPerRequest: null },
  upgradePaths: [{ fromModelId: 'claude-sonnet-4-5', compatibility: 'drop_in', note: 'Same family, newer version: same API and tool-calling format.' }],
  qualityEvidence: null,
};

/** A candidate with no supported price, for the missing-pricing case. */
export const UNPRICED: ModelProfile = { ...SONNET_55, id: 'claude-sonnet-preview', displayName: 'Claude Sonnet preview', version: 'preview', status: 'preview', pricing: null, upgradePaths: [{ fromModelId: 'claude-sonnet-4-5', compatibility: 'drop_in', note: 'Same family.' }] };

export const FIXTURE_CATALOGUE: ModelProfile[] = [SONNET_45, SONNET_55, UNPRICED];

interface Stream {
  teamId: string;
  workflowId: string;
  environment: 'production' | 'staging' | 'development';
  perDay: number;
  input: number;
  cached: number;
  output: number;
  features?: UpgradeUsageRecord['requiredFeatures'];
}

const STREAMS: Stream[] = [
  { teamId: 'team-a', workflowId: 'wf-triage', environment: 'production', perDay: 4, input: 6_000, cached: 4_000, output: 800 },
  { teamId: 'team-a', workflowId: 'wf-triage', environment: 'staging', perDay: 1, input: 6_000, cached: 4_000, output: 800 },
  { teamId: 'team-b', workflowId: 'wf-reports', environment: 'development', perDay: 2, input: 20_000, cached: 0, output: 2_000 },
  { teamId: 'team-b', workflowId: 'wf-vision', environment: 'production', perDay: 1, input: 3_000, cached: 0, output: 400, features: ['vision'] },
];

const cost = (s: Stream) => (s.input * 3 + s.cached * 0.3 + s.output * 15) / 1_000_000;

/** 30 days of Sonnet 4.5 usage: 240 calls, every 20th a retry, every 50th unmeasured. */
export function fixtureRecords(): UpgradeUsageRecord[] {
  const records: UpgradeUsageRecord[] = [];
  let seq = 0;
  for (let day = 1; day <= 30; day++) {
    const localDate = `2026-09-${String(day).padStart(2, '0')}`;
    for (const s of STREAMS) {
      for (let i = 0; i < s.perDay; i++) {
        seq++;
        const unmeasured = seq % 50 === 0;
        records.push({
          id: `req-${seq}`,
          localDate,
          teamId: s.teamId,
          projectId: null,
          applicationId: null,
          workflowId: s.workflowId,
          agentId: null,
          environment: s.environment,
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          inputTokens: unmeasured ? null : s.input,
          cachedInputTokens: unmeasured ? 0 : s.cached,
          outputTokens: unmeasured ? null : s.output,
          reasoningTokens: 0,
          requestStatus: seq % 20 === 19 ? 'failed' : 'succeeded',
          isRetry: seq % 20 === 0,
          isFallback: false,
          latencyMs: 2_000 + (seq % 5) * 100,
          cost: unmeasured ? null : cost(s),
          costStatus: unmeasured ? 'unavailable' : 'estimated',
          pricingVersion: unmeasured ? null : 'anthropic-2026-10-18',
          requiredFeatures: s.features ?? [],
        });
      }
    }
  }
  // Some usage on another provider in the same scope, to check it's left alone.
  records.push({ ...records[0], id: 'req-gemini', providerId: 'gemini_vertex', modelId: 'gemini-2.5-flash', cost: 0.01, pricingVersion: 'vertex-global-2026-10-18' });
  return records;
}

export const FIXTURE_SCOPES = {
  team: [
    { id: 'team-a', label: 'Team A' },
    { id: 'team-b', label: 'Team B' },
  ],
  workflow: [
    { id: 'wf-triage', label: 'Ticket triage' },
    { id: 'wf-reports', label: 'Weekly reports' },
    { id: 'wf-vision', label: 'Receipt reader' },
  ],
  environment: [
    { id: 'production', label: 'Production' },
    { id: 'staging', label: 'Staging' },
    { id: 'development', label: 'Development' },
  ],
};

export function fixtureRequest(overrides: Partial<UpgradeEstimateRequest> = {}): UpgradeEstimateRequest {
  return {
    currentModelId: 'claude-sonnet-4-5',
    candidateModelId: 'claude-sonnet-5-5',
    scope: { level: 'company', id: null },
    timeWindow: { kind: 'last_30_days' },
    migrationPercentage: 100,
    assumptions: {},
    eligibilityRules: [{ id: 'r1', level: 'company', targetId: null, decision: 'eligible', reason: 'Confirmed by the platform owner' }],
    ...overrides,
  };
}
