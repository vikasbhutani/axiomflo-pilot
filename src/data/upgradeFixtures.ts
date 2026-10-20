/**
 * DEMONSTRATION DATA for Upgrade Analysis — sample data only.
 *
 * Adds what the Acme sample requests don't record (project, workflow, agent,
 * environment, latency, cached tokens, retries and the features a call relies on),
 * worked out deterministically from each request ID. Nothing here changes a request's
 * tokens or cost, so every other page's totals stay exactly as they were.
 *
 * Candidate models, prices and expectations are illustrative, NOT current provider
 * pricing or published benchmarks.
 */
import type { EligibilityRule, ModelPricing, ModelProfile, ScopeOption, UpgradeUsageRecord } from '../lib/upgrade';
import type { CostedUsageRecord } from '../types';
import { models, pricingVersions, providerConnections, providers } from './mockData';

export const DEMO_UPGRADE_PRICING_VERSION = 'demo-upgrade-pricing-v1';

export const demoProjects: (ScopeOption & { teamId: string })[] = [
  { id: 'proj-devex', label: 'Developer productivity', teamId: 'team-platform' },
  { id: 'proj-support', label: 'Customer support automation', teamId: 'team-product' },
  { id: 'proj-insights', label: 'Product insights', teamId: 'team-product' },
];

export const demoWorkflows: (ScopeOption & { applicationId: string | null })[] = [
  { id: 'wf-pr-review', label: 'PR review comments', applicationId: 'app-ci-review' },
  { id: 'wf-release-gate', label: 'Release gate checks', applicationId: 'app-ci-review' },
  { id: 'wf-ticket-summary', label: 'Ticket summaries', applicationId: 'app-support-summary' },
  { id: 'wf-interactive-platform', label: 'Interactive use: Platform Engineering', applicationId: null },
  { id: 'wf-interactive-product', label: 'Interactive use: Product Experience', applicationId: null },
];

export const demoAgents: ScopeOption[] = [
  { id: 'agent-code-reviewer', label: 'Code reviewer agent' },
  { id: 'agent-support-triage', label: 'Support triage agent' },
];

/** Rules Maya (Company Admin) has already set; anyone can change them for an analysis. */
export const demoDefaultRules: EligibilityRule[] = [
  { id: 'seed-dev', level: 'environment', targetId: 'development', decision: 'eligible', reason: 'Interactive and development use, approved by Maya Chen' },
  { id: 'seed-staging', level: 'environment', targetId: 'staging', decision: 'eligible', reason: 'Staging pipelines can move freely' },
  { id: 'seed-tickets', level: 'workflow', targetId: 'wf-ticket-summary', decision: 'eligible', reason: 'Summaries are checked by the Product Experience lead' },
  { id: 'seed-gate', level: 'workflow', targetId: 'wf-release-gate', decision: 'exclude', reason: 'Gates production releases; change freeze until the Q1 evaluation' },
];

/** FNV-1a, so each request's extra attributes are the same on every machine. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const LATENCY: Record<string, { base: number; perOutputToken: number }> = {
  'gemini-pro-demo': { base: 900, perOutputToken: 9 },
  'gemini-flash-demo': { base: 350, perOutputToken: 4 },
  'claude-sonnet-demo': { base: 1_100, perOutputToken: 12 },
  'claude-haiku-demo': { base: 400, perOutputToken: 5 },
};

/** One Acme request with the attributes Upgrade Analysis needs. Tokens and cost are unchanged. */
export function toDemoUpgradeRecord(r: CostedUsageRecord): UpgradeUsageRecord {
  const h = hash(r.id);
  const app = r.principal.type === 'application' ? r.principal.id : null;
  let workflowId: string;
  let agentId: string | null = null;
  let environment: UpgradeUsageRecord['environment'];
  let projectId: string;
  let cachedShare = 0;
  const requiredFeatures: UpgradeUsageRecord['requiredFeatures'] = [];
  if (app === 'app-ci-review') {
    workflowId = h % 5 === 0 ? 'wf-release-gate' : 'wf-pr-review';
    agentId = 'agent-code-reviewer';
    environment = workflowId === 'wf-release-gate' || h % 10 < 7 ? 'production' : 'staging';
    projectId = 'proj-devex';
    cachedShare = 0.3;
    requiredFeatures.push('tool_use');
  } else if (app === 'app-support-summary') {
    workflowId = 'wf-ticket-summary';
    agentId = 'agent-support-triage';
    environment = h % 20 < 17 ? 'production' : 'staging';
    projectId = 'proj-support';
    cachedShare = 0.4;
    requiredFeatures.push('structured_output');
  } else {
    workflowId = r.teamId === 'team-platform' ? 'wf-interactive-platform' : 'wf-interactive-product';
    environment = 'development';
    projectId = r.teamId === 'team-platform' ? 'proj-devex' : 'proj-insights';
  }
  if ((r.inputTokens ?? 0) > 100_000) requiredFeatures.push('long_context');
  const cached = r.inputTokens === null ? 0 : Math.round(r.inputTokens * cachedShare);
  const latency = LATENCY[r.modelId];
  return {
    id: r.id,
    localDate: r.localDate,
    teamId: r.teamId,
    projectId,
    applicationId: app,
    workflowId,
    agentId,
    environment,
    providerId: r.providerId,
    modelId: r.modelId,
    inputTokens: r.inputTokens === null ? null : r.inputTokens - cached,
    cachedInputTokens: cached,
    outputTokens: r.outputTokens,
    reasoningTokens: 0,
    requestStatus: r.requestStatus,
    isRetry: app !== null && h % 40 === 1,
    isFallback: app === 'app-support-summary' && r.modelId === 'claude-sonnet-demo' && h % 25 === 2,
    latencyMs: latency && r.outputTokens !== null ? Math.round(latency.base + r.outputTokens * latency.perOutputToken + (h % 400)) : null,
    cost: r.estimatedCost,
    costStatus: r.costStatus,
    pricingVersion: r.pricingVersionId,
    requiredFeatures,
  };
}

const ILLUSTRATIVE = 'Illustrative sample price, not current provider pricing';
const price = (input: number, output: number, cached: number | null, version: string, source: string): ModelPricing => ({
  currency: 'AUD',
  inputPerMillion: input,
  outputPerMillion: output,
  cachedInputPerMillion: cached,
  reasoningPerMillion: null,
  pricingVersion: version,
  pricingSource: source,
  validUntil: null,
  conversionNote: null,
});

const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
const NO_EXPECTATIONS = { latencyChangePct: null, errorRatePct: null, outputTokenChangePct: null, reasoningTokensPerRequest: null };
const ALL_FEATURES: ModelProfile['features'] = ['tool_use', 'structured_output', 'vision', 'long_context', 'prompt_caching'];

/** The four Acme models as they run today, at the demo's own price list. */
const currentModels: ModelProfile[] = models.map((m) => {
  const rate = pricingVersions[0].rates.find((r) => r.modelId === m.id)!;
  return {
    id: m.id,
    providerId: m.providerId,
    providerName: providerName(m.providerId),
    displayName: m.displayName,
    version: 'v1 (illustrative)',
    status: 'ga',
    pricing: price(rate.inputPerMillion, rate.outputPerMillion, null, pricingVersions[0].id, pricingVersions[0].label),
    features: ALL_FEATURES,
    regions: null,
    environments: null,
    expected: NO_EXPECTATIONS,
    upgradePaths: [],
    qualityEvidence: null,
  };
});

const candidate = (m: Omit<ModelProfile, 'status' | 'regions' | 'environments' | 'qualityEvidence'> & Partial<ModelProfile>): ModelProfile => ({ status: 'ga', regions: null, environments: null, qualityEvidence: null, ...m });

/** Newer model versions an Acme team might move to (illustrative). */
const candidateModels: ModelProfile[] = [
  candidate({
    id: 'gemini-flash-2-demo',
    providerId: 'gemini_vertex',
    providerName: providerName('gemini_vertex'),
    displayName: 'Gemini Flash 2 (illustrative)',
    version: 'v2 (illustrative)',
    pricing: price(0.3, 2.5, 0.075, DEMO_UPGRADE_PRICING_VERSION, ILLUSTRATIVE),
    features: ALL_FEATURES,
    regions: ['australia-southeast1', 'asia-southeast1', 'us-central1'],
    expected: { latencyChangePct: -20, errorRatePct: null, outputTokenChangePct: 8, reasoningTokensPerRequest: 120 },
    upgradePaths: [
      { fromModelId: 'gemini-flash-demo', compatibility: 'drop_in', note: 'Same family, newer version: same API and tool-calling format (illustrative).' },
      { fromModelId: 'gemini-pro-demo', compatibility: 'needs_changes', note: 'A smaller tier: expect weaker reasoning on long, complex prompts.' },
    ],
    qualityEvidence: 'a provider benchmark summary (illustrative) rates it comparable to Gemini Flash v1 on summarisation and code review.',
  }),
  candidate({
    id: 'claude-haiku-2-demo',
    providerId: 'anthropic',
    providerName: providerName('anthropic'),
    displayName: 'Claude Haiku 2 (illustrative)',
    version: 'v2 (illustrative)',
    pricing: price(1.2, 6.0, 0.12, DEMO_UPGRADE_PRICING_VERSION, ILLUSTRATIVE),
    features: ['tool_use', 'structured_output', 'vision', 'prompt_caching'],
    expected: { latencyChangePct: -15, errorRatePct: null, outputTokenChangePct: 5, reasoningTokensPerRequest: null },
    upgradePaths: [
      { fromModelId: 'claude-haiku-demo', compatibility: 'drop_in', note: 'Same family, newer version: same API (illustrative). It has a shorter context window.' },
      { fromModelId: 'claude-sonnet-demo', compatibility: 'needs_changes', note: 'A smaller tier: test answer quality on harder tasks.' },
    ],
  }),
  candidate({
    id: 'claude-sonnet-2-demo',
    providerId: 'anthropic',
    providerName: providerName('anthropic'),
    displayName: 'Claude Sonnet 2 (illustrative)',
    version: 'v2 (illustrative)',
    pricing: price(3.4, 17.0, 0.34, DEMO_UPGRADE_PRICING_VERSION, ILLUSTRATIVE),
    features: ALL_FEATURES,
    expected: { latencyChangePct: -10, errorRatePct: null, outputTokenChangePct: 12, reasoningTokensPerRequest: null },
    upgradePaths: [{ fromModelId: 'claude-sonnet-demo', compatibility: 'drop_in', note: 'Same family, newer version: same API and tool-calling format (illustrative).' }],
  }),
  candidate({
    id: 'gemini-pro-2-preview-demo',
    providerId: 'gemini_vertex',
    providerName: providerName('gemini_vertex'),
    displayName: 'Gemini Pro 2 Preview (illustrative)',
    version: 'v2 preview (illustrative)',
    status: 'preview',
    pricing: price(2.3, 18.0, 0.23, DEMO_UPGRADE_PRICING_VERSION, ILLUSTRATIVE),
    features: ALL_FEATURES,
    regions: ['us-central1'],
    environments: ['development', 'staging'],
    expected: { latencyChangePct: 15, errorRatePct: 4, outputTokenChangePct: 20, reasoningTokensPerRequest: 400 },
    upgradePaths: [{ fromModelId: 'gemini-pro-demo', compatibility: 'drop_in', note: 'Same family, newer preview version (illustrative).' }],
  }),
  candidate({
    id: 'gemini-flash-lite-preview-demo',
    providerId: 'gemini_vertex',
    providerName: providerName('gemini_vertex'),
    displayName: 'Gemini Flash-Lite Preview (illustrative)',
    version: 'preview (illustrative)',
    status: 'preview',
    pricing: null,
    features: ['tool_use', 'structured_output'],
    expected: NO_EXPECTATIONS,
    upgradePaths: [{ fromModelId: 'gemini-flash-demo', compatibility: 'needs_changes', note: 'A lighter tier; no supported pricing has been published yet.' }],
  }),
];

export const demoUpgradeCatalogue: ModelProfile[] = [...currentModels, ...candidateModels];

/** Where each provider's calls run today: Acme's Vertex AI connection is in Sydney. */
export function demoRegionOf(providerId: string): string | null {
  return providerConnections.find((c) => c.providerId === providerId)?.region ?? null;
}
