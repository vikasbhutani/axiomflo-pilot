/**
 * Types for Upgrade Analysis: what it would cost to move a model dependency to a
 * newer (usually cheaper or faster) model version.
 *
 * This file and engine.ts have no imports outside this folder and use no Node or
 * browser APIs, so the web app's demo workspace runs exactly the same code as the
 * AxiomFlo API (the web app imports them from here).
 *
 * Every API payload of /api/upgrade-analysis/* is typed here.
 */

/** Where a migration applies. `company` covers everything the viewer can see. */
export type ScopeLevel = 'company' | 'team' | 'project' | 'application' | 'workflow' | 'agent' | 'environment';
export const SCOPE_LEVELS: readonly ScopeLevel[] = ['company', 'team', 'project', 'application', 'workflow', 'agent', 'environment'];

/** Eligibility can also be set for a whole model or provider. */
export type EligibilityLevel = ScopeLevel | 'model' | 'provider';
export const ELIGIBILITY_LEVELS: readonly EligibilityLevel[] = [...SCOPE_LEVELS, 'model', 'provider'];

export type Environment = 'production' | 'staging' | 'development';
export const ENVIRONMENTS: readonly Environment[] = ['production', 'staging', 'development'];

/** Model capabilities a call can depend on. */
export type ModelFeature = 'tool_use' | 'structured_output' | 'vision' | 'long_context' | 'prompt_caching';

export const FEATURE_LABELS: Record<ModelFeature, string> = {
  tool_use: 'tool calling',
  structured_output: 'structured output',
  vision: 'image input',
  long_context: 'long context',
  prompt_caching: 'prompt caching',
};

/**
 * How a figure was arrived at.
 * - `reconciled`: matched against a provider bill.
 * - `estimated`: calculated from measured usage and list prices, not yet reconciled.
 * - `observed`: counted from usage records (requests, tokens, latency).
 * - `modelled`: a projection from observed usage and stated assumptions.
 */
export type PricingBasis = 'reconciled' | 'estimated' | 'observed' | 'modelled';

export interface ModelPricing {
  /** Currency of every rate below: the company's reporting currency once loaded. */
  currency: string;
  inputPerMillion: number;
  outputPerMillion: number;
  /** Cached input (cache reads). `null`: the model has no cache discount, so cached tokens cost input price. */
  cachedInputPerMillion: number | null;
  /** Reasoning (thinking) tokens. `null`: billed as output tokens. */
  reasoningPerMillion: number | null;
  pricingVersion: string;
  pricingSource: string;
  /** Last day this price applies, when the provider has announced a change (YYYY-MM-DD). */
  validUntil: string | null;
  /** Set when the rates were converted from another currency. */
  conversionNote: string | null;
}

export type Compatibility = 'drop_in' | 'needs_changes' | 'not_compatible';

export interface UpgradePath {
  /** The current model this candidate can replace. */
  fromModelId: string;
  compatibility: Compatibility;
  note: string;
}

/** What a provider says (or a team has measured) about a model, before any migration. */
export interface ModelExpectations {
  /** Change in response time versus the models it replaces, in percent (-25 = 25% faster). */
  latencyChangePct: number | null;
  /** Share of calls expected to fail and be retried, in percent. */
  errorRatePct: number | null;
  /** Change in output tokens for the same task, in percent. */
  outputTokenChangePct: number | null;
  /** Reasoning tokens the model typically adds per request. */
  reasoningTokensPerRequest: number | null;
}

export interface ModelProfile {
  id: string;
  providerId: string;
  providerName: string;
  displayName: string;
  version: string;
  status: 'ga' | 'preview';
  /** `null`: AxiomFlo has no supported price for this model. */
  pricing: ModelPricing | null;
  features: ModelFeature[];
  /** Regions it can run in; `null` when AxiomFlo has no regional restriction on record. */
  regions: string[] | null;
  /** Environments it is approved for; `null` for all. */
  environments: Environment[] | null;
  expected: ModelExpectations;
  upgradePaths: UpgradePath[];
  /** Benchmark or evaluation evidence on record, if any. */
  qualityEvidence: string | null;
}

/**
 * One request, normalised for the analysis. Token fields don't overlap:
 * `inputTokens` excludes cached reads, `outputTokens` excludes reasoning.
 */
export interface UpgradeUsageRecord {
  id: string;
  /** Calendar date in the reporting timezone (YYYY-MM-DD). */
  localDate: string;
  teamId: string;
  projectId: string | null;
  applicationId: string | null;
  workflowId: string | null;
  agentId: string | null;
  environment: Environment | null;
  providerId: string;
  /** Catalogue model ID (dated snapshots already mapped to their base model). */
  modelId: string;
  inputTokens: number | null;
  cachedInputTokens: number;
  outputTokens: number | null;
  reasoningTokens: number;
  requestStatus: 'succeeded' | 'failed';
  /** This call repeated an earlier failed call. */
  isRetry: boolean;
  /** This call was a fallback after another model failed. */
  isFallback: boolean;
  latencyMs: number | null;
  /** Observed estimated cost in the reporting currency; `null` when usage wasn't measured. */
  cost: number | null;
  costStatus: 'reconciled' | 'estimated' | 'unavailable';
  pricingVersion: string | null;
  /** Features this call relies on, when known. */
  requiredFeatures: ModelFeature[];
}

export interface EligibilityRule {
  id: string;
  level: EligibilityLevel;
  /** What the rule applies to; `null` for `company`. */
  targetId: string | null;
  decision: 'eligible' | 'exclude';
  reason: string;
}

export type TimeWindowInput = { kind: 'last_7_days' } | { kind: 'last_30_days' } | { kind: 'custom'; from: string; to: string };

export interface UpgradeAssumptions {
  /** Change in input tokens per request on the candidate, percent. */
  inputTokenChangePct?: number;
  /** Change in output tokens per request on the candidate, percent (overrides the model's expectation). */
  outputTokenChangePct?: number;
  /** Share of input tokens served from cache on the candidate, percent (defaults to today's share). */
  cachedTokenSharePct?: number;
  /** Reasoning tokens per request on the candidate (overrides the model's expectation). */
  reasoningTokensPerRequest?: number;
  /** Change in request volume once migrated, percent. */
  requestVolumeChangePct?: number;
  /** Expected share of failed calls needing a retry on the candidate, percent. */
  candidateErrorRatePct?: number;
  /** Change in latency on the candidate, percent (overrides the model's expectation). */
  latencyChangePct?: number;
  /** One-off cost of migration, integration, evaluation and testing, in the reporting currency. */
  migrationCostEstimate?: number;
  /** Minimum acceptable evaluation score, 0 to 100. */
  qualityThreshold?: number;
  /** Score the candidate reached in your own side-by-side evaluation, 0 to 100. */
  evaluationQualityScore?: number;
  /** The scope serves business-critical work. */
  businessCritical?: boolean;
}

/** Body of POST /api/upgrade-analysis/estimate. */
export interface UpgradeEstimateRequest {
  currentModelId: string;
  candidateModelId: string;
  scope: { level: ScopeLevel; id: string | null };
  timeWindow: TimeWindowInput;
  /** Share of eligible calls assumed to move, 0 to 100. */
  migrationPercentage: number;
  assumptions: UpgradeAssumptions;
  eligibilityRules: EligibilityRule[];
}

export type Classification = 'strongly_recommended' | 'recommended_with_validation' | 'conditional' | 'not_recommended' | 'insufficient_data';

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  strongly_recommended: 'Strongly recommended',
  recommended_with_validation: 'Recommended with validation',
  conditional: 'Conditional',
  not_recommended: 'Not recommended',
  insufficient_data: 'Insufficient data',
};

export type RiskKind = 'quality' | 'latency' | 'reliability' | 'token' | 'compatibility' | 'financial' | 'governance';
export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export interface UpgradeRisk {
  kind: RiskKind;
  label: string;
  level: RiskLevel;
  detail: string;
}

export interface ModelSide {
  providerId: string;
  providerName: string;
  modelId: string;
  displayName: string;
  version: string;
  pricing: ModelPricing | null;
}

export interface CurrentUsage {
  requests: number;
  /** Requests with measured usage and a cost. */
  costedRequests: number;
  unmeasuredRequests: number;
  successfulRequests: number;
  failedRequests: number;
  retries: number;
  fallbacks: number;
  avgInputTokens: number | null;
  avgCachedTokens: number | null;
  avgOutputTokens: number | null;
  avgReasoningTokens: number | null;
  avgLatencyMs: number | null;
  /** Share of calls that failed, 0 to 1. */
  errorRate: number | null;
  cost: number;
  costPerRequest: number | null;
  costPerSuccessfulRequest: number | null;
  /** `reconciled` only when every costed request is; otherwise `estimated`. */
  costBasis: 'reconciled' | 'estimated';
  pricingVersions: string[];
}

export interface CandidateProjection {
  /** Calls the candidate would serve, retries included. */
  requests: number;
  avgInputTokens: number | null;
  avgCachedTokens: number | null;
  avgOutputTokens: number | null;
  avgReasoningTokens: number | null;
  avgLatencyMs: number | null;
  errorRate: number | null;
  /** Cost of the calls that move. */
  projectedCost: number | null;
  costPerRequest: number | null;
}

export interface EligibilityBucket {
  requests: number;
  /** Share of in-scope requests, 0 to 1. */
  share: number;
  cost: number;
}

export interface EligibilityBreakdown {
  eligible: EligibilityBucket;
  ineligible: EligibilityBucket;
  requiresReview: EligibilityBucket;
  /** Why calls were ineligible or need review, most common first. */
  reasons: { status: 'ineligible' | 'requires_review'; reason: string; requests: number }[];
  /** Workflows with both eligible and ineligible (or review) calls. */
  mixedWorkflows: string[];
}

export interface FinancialImpact {
  currentCost: number;
  projectedCost: number;
  savings: number;
  /** `null` when current cost is zero. */
  savingsPct: number | null;
  currentMonthlyCost: number;
  projectedMonthlyCost: number;
  monthlySavings: number;
  /** Monthly savings × 12. An extrapolation, not a forecast. */
  annualisedSavings: number;
  costPerSuccessfulRequest: { current: number | null; projected: number | null };
  /** Non-recurring; never netted off the savings above. */
  oneOffMigrationCost: number | null;
  paybackMonths: number | null;
}

export type BreakdownRowId = 'input' | 'output' | 'cached' | 'reasoning' | 'requests' | 'retries' | 'tools';

export interface BreakdownRow {
  id: BreakdownRowId;
  label: string;
  currentQuantity: number | null;
  projectedQuantity: number | null;
  currentCost: number | null;
  projectedCost: number | null;
  note: string | null;
}

export type ImpactId = 'unit_price' | 'input_tokens' | 'output_tokens' | 'cached_tokens' | 'reasoning_tokens' | 'request_volume' | 'retries';

export interface ImpactRow {
  id: ImpactId;
  label: string;
  /** Change in cost over the period; negative saves money. */
  amount: number;
  /** Change versus the current cost of the calls that move, 0.1 = +10%. */
  pctOfMigrated: number | null;
}

/** The `UpgradeAnalysis` domain object returned by POST /estimate and stored by POST /save. */
export interface UpgradeAnalysis {
  schemaVersion: 1;
  status: 'complete' | 'insufficient_data';
  calculatedAt: string;
  currency: string;
  scope: { level: ScopeLevel; id: string | null; label: string };
  period: { from: string; to: string; days: number; label: string };
  migrationPercentage: number;
  current: ModelSide & { usage: CurrentUsage };
  candidate: ModelSide & { projection: CandidateProjection };
  basis: { current: PricingBasis; usage: 'observed'; projection: 'modelled' };
  eligibility: EligibilityBreakdown;
  /** `null` when a reliable cost can't be worked out. */
  financial: FinancialImpact | null;
  breakdown: BreakdownRow[];
  impacts: ImpactRow[];
  risks: UpgradeRisk[];
  recommendation: { classification: Classification; label: string; reasons: string[] };
  /** Only for "Strongly recommended" and "Recommended with validation". */
  rolloutPlan: string[] | null;
  nextStep: string;
  /** Plain-language calculation basis. */
  calculationBasis: string[];
  /** Data gaps and edge cases worth knowing. */
  notices: string[];
  disclaimer: string;
  /** The request as interpreted, so a saved analysis can be re-run. */
  inputs: UpgradeEstimateRequest;
}

// ---------------------------------------------------------------------------
// API payloads
// ---------------------------------------------------------------------------

export interface ScopeOption {
  id: string;
  label: string;
}

/** GET /api/upgrade-analysis/models */
export interface UpgradeModelsResponse {
  currency: string;
  /** Today in the reporting timezone; relative windows end here. */
  today: string;
  /** Models with usage the viewer can see (last 92 days), highest estimated cost first. */
  currentModels: (ModelProfile & { observedRequests: number; observedCost: number })[];
  /** Models that can be a candidate. */
  candidateModels: ModelProfile[];
  /** Scope levels and their options; empty when the workspace doesn't record that level. */
  scopes: { level: ScopeLevel; label: string; options: ScopeOption[] }[];
  /** Eligibility rules the workspace starts from. */
  defaultRules: EligibilityRule[];
  notes: string[];
}

/** POST /api/upgrade-analysis/estimate */
export interface UpgradeEstimateResponse {
  analysis: UpgradeAnalysis;
}

/** POST /api/upgrade-analysis/save body. */
export interface UpgradeSaveRequest {
  /** The analysis to save. The server runs it again; figures sent by a client are never stored. */
  request: UpgradeEstimateRequest;
  title?: string;
  status?: 'draft' | 'submitted_for_review';
}

export interface UpgradeAuditEntry {
  at: string;
  actorUid: string;
  action: 'saved' | 'exported';
  detail: string;
}

/** A saved analysis. Never edited after saving: a re-run is saved as a new one. */
export interface SavedUpgradeAnalysis {
  id: string;
  companyId: string;
  title: string;
  status: 'draft' | 'submitted_for_review';
  createdBy: string;
  createdAt: string;
  /** Who was asking, and what they could see, when it was calculated. */
  authorisation: { uid: string; role: string; teamIds: string[]; readOnly: boolean };
  pricing: { current: { version: string | null; source: string | null }; candidate: { version: string | null; source: string | null } };
  analysis: UpgradeAnalysis;
  audit: UpgradeAuditEntry[];
}

/** POST /api/upgrade-analysis/save and GET /api/upgrade-analysis/:id */
export interface UpgradeSavedResponse {
  saved: SavedUpgradeAnalysis;
}

/** POST /api/upgrade-analysis/:id/export body. */
export interface UpgradeExportRequest {
  format?: 'markdown' | 'csv';
}

/** POST /api/upgrade-analysis/:id/export */
export interface UpgradeExportResponse {
  id: string;
  format: 'markdown' | 'csv';
  filename: string;
  contentType: string;
  content: string;
  exportedAt: string;
}
