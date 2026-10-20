/**
 * Upgrade Analysis: the cost model, eligibility rules, risk checks and recommendation.
 *
 * Pure and deterministic. The caller passes usage records already limited to one
 * company and to what the viewer may see; this module never reads data itself. The
 * web app's demo workspace and the AxiomFlo API both run this file.
 *
 * Cost model (all amounts in the reporting currency, full precision):
 *
 *   projectedCost = eligible calls × migration% × expected cost per candidate call
 *                 + everything else at its observed cost
 *
 * where "everything else" is the eligible calls that don't move, ineligible calls and
 * calls that still need review. Current cost is the recorded estimated cost of each
 * request, so it always matches the other report pages. Calls without measured usage
 * have no cost and are left out (never counted as zero). Nothing here changes routing:
 * a projection is a modelled estimate, never a guaranteed saving.
 */
import { count, money, pct, plural, signedPct } from './format.js';
import {
  CLASSIFICATION_LABELS,
  ELIGIBILITY_LEVELS,
  ENVIRONMENTS,
  FEATURE_LABELS,
  SCOPE_LEVELS,
  type BreakdownRow,
  type CandidateProjection,
  type Classification,
  type CurrentUsage,
  type EligibilityBreakdown,
  type EligibilityLevel,
  type EligibilityRule,
  type FinancialImpact,
  type ImpactRow,
  type ModelPricing,
  type ModelProfile,
  type ScopeLevel,
  type ScopeOption,
  type TimeWindowInput,
  type UpgradeAnalysis,
  type UpgradeAssumptions,
  type UpgradeEstimateRequest,
  type UpgradePath,
  type UpgradeRisk,
  type UpgradeUsageRecord,
} from './types.js';

export const UPGRADE_RULES = {
  /** Savings are material at or above this share of current cost… */
  materialSavingsPct: 5,
  /** …and this much per month in the reporting currency. */
  materialMonthlySavings: 5,
  /** Above this share of cost needing review, savings depend on the review: "Conditional". */
  conditionalReviewShare: 0.25,
  /** "Strongly recommended" needs less than this share of cost needing review. */
  strongMaxReviewShare: 0.1,
  latencyMediumPct: 10,
  latencyHighPct: 25,
  /** Percentage points of extra retries. */
  retryMediumPp: 1,
  retryHighPp: 3,
  maxWindowDays: 92,
  daysPerMonth: 365.25 / 12,
  maxRules: 50,
} as const;

export const DISCLAIMER = 'Estimated savings are modelled from observed usage and stated assumptions. Validate quality, latency, and actual billing before production migration.';
export const MISSING_PRICING_MESSAGE = 'I can compare usage volume, but I cannot calculate a reliable cost saving because pricing for one or both models is unavailable.';
export const QUALITY_UNKNOWN_MESSAGE = 'Quality impact cannot be assessed from available data. Run an evaluation before production migration.';

export const SCOPE_LEVEL_LABELS: Record<ScopeLevel, string> = {
  company: 'Company',
  team: 'Team',
  project: 'Project',
  application: 'Application',
  workflow: 'Workflow',
  agent: 'Agent',
  environment: 'Environment',
};

export const ELIGIBILITY_LEVEL_LABELS: Record<EligibilityLevel, string> = { ...SCOPE_LEVEL_LABELS, model: 'Model', provider: 'Provider' };

/** A request the caller should reject with 400. */
export class UpgradeInputError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'UpgradeInputError';
  }
}

/** A scope the viewer isn't allowed to analyse (403). */
export class UpgradeAccessError extends Error {
  constructor(message = 'You can’t analyse that scope.') {
    super(message);
    this.name = 'UpgradeAccessError';
  }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string): number | null {
  if (!DATE.test(value)) return null;
  const t = Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return new Date(t).toISOString().slice(0, 10) === value ? t : null;
}

export function addDays(date: string, days: number): string {
  const t = parseDate(date);
  if (t === null) throw new Error(`Not a date: ${date}`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** Inclusive number of days from `from` to `to`. */
export function daysInclusive(from: string, to: string): number {
  return Math.round(((parseDate(to) ?? 0) - (parseDate(from) ?? 0)) / 86_400_000) + 1;
}

export interface ResolvedWindow {
  from: string;
  to: string;
  days: number;
  label: string;
}

/** Turns a time window into inclusive dates ending no later than `today`. Throws UpgradeInputError. */
export function resolveTimeWindow(window: TimeWindowInput, today: string): ResolvedWindow {
  if (window.kind === 'last_7_days' || window.kind === 'last_30_days') {
    const days = window.kind === 'last_7_days' ? 7 : 30;
    const from = addDays(today, -(days - 1));
    return { from, to: today, days, label: `Last ${days} days (${from} to ${today})` };
  }
  const { from, to } = window;
  if (parseDate(from) === null || parseDate(to) === null) throw new UpgradeInputError('timeWindow', 'Dates must be real calendar dates like 2026-09-01.');
  if (from > to) throw new UpgradeInputError('timeWindow', 'The start date must be on or before the end date.');
  if (from < '2020-01-01') throw new UpgradeInputError('timeWindow', 'The start date is too far in the past.');
  if (to > today) throw new UpgradeInputError('timeWindow', `The end date can’t be after today (${today}).`);
  const days = daysInclusive(from, to);
  if (days > UPGRADE_RULES.maxWindowDays) throw new UpgradeInputError('timeWindow', `Choose a window of ${UPGRADE_RULES.maxWindowDays} days or fewer.`);
  return { from, to, days, label: `${from} to ${to}` };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

const ASSUMPTION_RANGES: Record<keyof UpgradeAssumptions, [number, number] | 'boolean'> = {
  inputTokenChangePct: [-90, 500],
  outputTokenChangePct: [-90, 500],
  cachedTokenSharePct: [0, 100],
  reasoningTokensPerRequest: [0, 1_000_000],
  requestVolumeChangePct: [-90, 500],
  candidateErrorRatePct: [0, 50],
  latencyChangePct: [-95, 1000],
  migrationCostEstimate: [0, 1_000_000_000],
  qualityThreshold: [0, 100],
  evaluationQualityScore: [0, 100],
  businessCritical: 'boolean',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: string[], field: string) {
  const extra = Object.keys(value).filter((k) => !allowed.includes(k));
  if (extra.length) throw new UpgradeInputError(field, `Unexpected field${extra.length === 1 ? '' : 's'}: ${extra.join(', ')}.`);
}

function finite(value: unknown, field: string, [min, max]: [number, number]): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new UpgradeInputError(field, `${field} must be a number.`);
  if (value < min || value > max) throw new UpgradeInputError(field, `${field} must be between ${min} and ${max}.`);
  return value;
}

function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new UpgradeInputError(field, `${field} is not a valid ID.`);
  return value;
}

export function parseMigrationPercentage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new UpgradeInputError('migrationPercentage', 'migrationPercentage must be a number from 0 to 100.');
  if (value < 0 || value > 100) throw new UpgradeInputError('migrationPercentage', 'migrationPercentage must be between 0 and 100.');
  return value;
}

export function parseRules(value: unknown): EligibilityRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new UpgradeInputError('eligibilityRules', 'eligibilityRules must be a list.');
  if (value.length > UPGRADE_RULES.maxRules) throw new UpgradeInputError('eligibilityRules', `Use ${UPGRADE_RULES.maxRules} eligibility rules or fewer.`);
  return value.map((raw, i) => {
    const field = `eligibilityRules[${i}]`;
    if (!isObject(raw)) throw new UpgradeInputError(field, `${field} must be an object.`);
    onlyKeys(raw, ['id', 'level', 'targetId', 'decision', 'reason'], field);
    if (!ELIGIBILITY_LEVELS.includes(raw.level as EligibilityLevel)) throw new UpgradeInputError(field, `${field}.level must be one of ${ELIGIBILITY_LEVELS.join(', ')}.`);
    const level = raw.level as EligibilityLevel;
    if (raw.decision !== 'eligible' && raw.decision !== 'exclude') throw new UpgradeInputError(field, `${field}.decision must be eligible or exclude.`);
    const targetId = level === 'company' ? null : id(raw.targetId, `${field}.targetId`);
    if (level === 'environment' && !ENVIRONMENTS.includes(targetId as never)) throw new UpgradeInputError(field, `${field}.targetId must be production, staging or development.`);
    const reason = raw.reason === undefined ? '' : raw.reason;
    if (typeof reason !== 'string' || reason.length > 200) throw new UpgradeInputError(field, `${field}.reason must be text of 200 characters or fewer.`);
    return { id: raw.id === undefined ? `rule-${i + 1}` : id(raw.id, `${field}.id`), level, targetId, decision: raw.decision, reason: reason.trim() };
  });
}

function parseTimeWindow(value: unknown): TimeWindowInput {
  if (!isObject(value)) throw new UpgradeInputError('timeWindow', 'Choose a time window: last_7_days, last_30_days or a custom date range.');
  if (value.kind === 'last_7_days' || value.kind === 'last_30_days') {
    onlyKeys(value, ['kind'], 'timeWindow');
    return { kind: value.kind };
  }
  if (value.kind !== 'custom') throw new UpgradeInputError('timeWindow', 'timeWindow.kind must be last_7_days, last_30_days or custom.');
  onlyKeys(value, ['kind', 'from', 'to'], 'timeWindow');
  if (typeof value.from !== 'string' || typeof value.to !== 'string') throw new UpgradeInputError('timeWindow', 'A custom window needs "from" and "to" dates.');
  return { kind: 'custom', from: value.from, to: value.to };
}

/** Validates the body of POST /api/upgrade-analysis/estimate (and the analysis inside /save). */
export function parseEstimateRequest(body: unknown): UpgradeEstimateRequest {
  if (!isObject(body)) throw new UpgradeInputError('body', 'Send the analysis as a JSON object.');
  onlyKeys(body, ['currentModelId', 'candidateModelId', 'scope', 'timeWindow', 'migrationPercentage', 'assumptions', 'eligibilityRules'], 'body');
  if (Array.isArray(body.currentModelId) || Array.isArray(body.candidateModelId))
    throw new UpgradeInputError('currentModelId', 'Analyse one current model and one candidate at a time; run a separate analysis for each model.');
  const currentModelId = id(body.currentModelId, 'currentModelId');
  const candidateModelId = id(body.candidateModelId, 'candidateModelId');
  if (currentModelId === candidateModelId) throw new UpgradeInputError('candidateModelId', 'Pick a candidate model that differs from the current one.');

  if (!isObject(body.scope)) throw new UpgradeInputError('scope', 'Choose a scope.');
  onlyKeys(body.scope, ['level', 'id'], 'scope');
  if (!SCOPE_LEVELS.includes(body.scope.level as ScopeLevel)) throw new UpgradeInputError('scope', `scope.level must be one of ${SCOPE_LEVELS.join(', ')}.`);
  const level = body.scope.level as ScopeLevel;
  const scopeId = level === 'company' ? null : id(body.scope.id, 'scope.id');

  const assumptions: UpgradeAssumptions = {};
  if (body.assumptions !== undefined) {
    if (!isObject(body.assumptions)) throw new UpgradeInputError('assumptions', 'assumptions must be an object.');
    onlyKeys(body.assumptions, Object.keys(ASSUMPTION_RANGES), 'assumptions');
    for (const [key, range] of Object.entries(ASSUMPTION_RANGES) as [keyof UpgradeAssumptions, [number, number] | 'boolean'][]) {
      const v = body.assumptions[key];
      if (v === undefined || v === null) continue;
      if (range === 'boolean') {
        if (typeof v !== 'boolean') throw new UpgradeInputError(`assumptions.${key}`, `assumptions.${key} must be true or false.`);
        assumptions.businessCritical = v;
      } else {
        (assumptions as Record<string, number>)[key] = finite(v, `assumptions.${key}`, range);
      }
    }
  }

  return {
    currentModelId,
    candidateModelId,
    scope: { level, id: scopeId },
    timeWindow: parseTimeWindow(body.timeWindow),
    migrationPercentage: parseMigrationPercentage(body.migrationPercentage),
    assumptions,
    eligibilityRules: parseRules(body.eligibilityRules),
  };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** Most specific first: the first matching exclusion is the reason shown. */
const SPECIFICITY: EligibilityLevel[] = ['agent', 'workflow', 'application', 'project', 'team', 'environment', 'model', 'provider', 'company'];

export function ruleMatches(rule: EligibilityRule, r: UpgradeUsageRecord): boolean {
  switch (rule.level) {
    case 'company':
      return true;
    case 'team':
      return r.teamId === rule.targetId;
    case 'project':
      return r.projectId === rule.targetId;
    case 'application':
      return r.applicationId === rule.targetId;
    case 'workflow':
      return r.workflowId === rule.targetId;
    case 'agent':
      return r.agentId === rule.targetId;
    case 'environment':
      return r.environment === rule.targetId;
    case 'model':
      return r.modelId === rule.targetId;
    case 'provider':
      return r.providerId === rule.targetId;
  }
}

export type EligibilityStatus = 'eligible' | 'ineligible' | 'requires_review';

export interface EligibilityDecision {
  status: EligibilityStatus;
  reason: string;
}

export interface EligibilityContext {
  candidate: ModelProfile;
  path: UpgradePath | null;
  rules: EligibilityRule[];
  /** Region the candidate would run in for this provider, when known. */
  region: string | null;
}

/**
 * A call is eligible only when the models are compatible, the call needs nothing the
 * candidate lacks, no exclusion rule matches, and an eligibility rule confirms it.
 * Exclusions always win. Anything unconfirmed needs review and is never counted as savings.
 */
export function classifyRecord(r: UpgradeUsageRecord, { candidate, path, rules, region }: EligibilityContext): EligibilityDecision {
  if (region && candidate.regions && !candidate.regions.includes(region)) return { status: 'ineligible', reason: `${candidate.displayName} isn’t available in ${region}` };
  if (r.environment && candidate.environments && !candidate.environments.includes(r.environment))
    return { status: 'ineligible', reason: `${candidate.displayName} isn’t approved for ${r.environment}` };
  if (path?.compatibility === 'not_compatible') return { status: 'ineligible', reason: 'The models aren’t compatible for this task' };
  const missing = r.requiredFeatures.filter((f) => !candidate.features.includes(f));
  if (missing.length) return { status: 'ineligible', reason: `Needs ${missing.map((f) => FEATURE_LABELS[f]).join(' and ')}, which ${candidate.displayName} doesn’t support` };
  const matching = rules.filter((rule) => ruleMatches(rule, r)).sort((a, b) => SPECIFICITY.indexOf(a.level) - SPECIFICITY.indexOf(b.level));
  const exclusion = matching.find((rule) => rule.decision === 'exclude');
  if (exclusion) return { status: 'ineligible', reason: `Excluded (${ELIGIBILITY_LEVEL_LABELS[exclusion.level].toLowerCase()} rule)${exclusion.reason ? `: ${exclusion.reason}` : ''}` };
  if (matching.some((rule) => rule.decision === 'eligible')) return { status: 'eligible', reason: 'Confirmed eligible' };
  return { status: 'requires_review', reason: path ? 'Eligibility not confirmed yet' : 'No compatibility record for this pair; eligibility not confirmed' };
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

interface Tokens {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

const ZERO: Tokens = { input: 0, cached: 0, output: 0, reasoning: 0 };
const CATEGORIES = ['input', 'cached', 'output', 'reasoning'] as const;

interface Aggregate {
  requests: number;
  costed: UpgradeUsageRecord[];
  cost: number;
  tokens: Tokens;
  retries: number;
  retryCost: number;
}

const isCosted = (r: UpgradeUsageRecord) => r.cost !== null && r.inputTokens !== null && r.outputTokens !== null;

function aggregate(records: UpgradeUsageRecord[]): Aggregate {
  const costed = records.filter(isCosted);
  const tokens = { ...ZERO };
  let cost = 0;
  let retries = 0;
  let retryCost = 0;
  for (const r of costed) {
    cost += r.cost!;
    tokens.input += r.inputTokens!;
    tokens.cached += r.cachedInputTokens;
    tokens.output += r.outputTokens!;
    tokens.reasoning += r.reasoningTokens;
    if (r.isRetry) {
      retries++;
      retryCost += r.cost!;
    }
  }
  return { requests: records.length, costed, cost, tokens, retries, retryCost };
}

const avg = (total: number, n: number) => (n > 0 ? total / n : null);
const scaleTokens = (t: Tokens, k: number): Tokens => ({ input: t.input * k, cached: t.cached * k, output: t.output * k, reasoning: t.reasoning * k });

function rates(p: ModelPricing): Tokens {
  return { input: p.inputPerMillion, cached: p.cachedInputPerMillion ?? p.inputPerMillion, output: p.outputPerMillion, reasoning: p.reasoningPerMillion ?? p.outputPerMillion };
}

function priceTokens(t: Tokens, p: Tokens): number {
  return (t.input * p.input + t.cached * p.cached + t.output * p.output + t.reasoning * p.reasoning) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

interface Projection {
  migratedRequests: number;
  candidateRequests: number;
  perRequest: Tokens;
  costPerRequest: number;
  migratedCurrentCost: number;
  migratedProjectedCost: number;
  impacts: ImpactRow[];
  errorRate: number;
  errorRateSource: 'assumption' | 'model' | 'unchanged';
  outputChangePct: number;
}

function project(eligible: Aggregate, p: number, candidate: ModelProfile, candidatePricing: ModelPricing, a: UpgradeAssumptions): Projection {
  const n = eligible.costed.length;
  const base = n - eligible.retries;
  const currentRetryRate = n > 0 ? eligible.retries / n : 0;
  const avgT = n > 0 ? scaleTokens(eligible.tokens, 1 / n) : { ...ZERO };
  const P = rates(candidatePricing);

  const inputChange = (a.inputTokenChangePct ?? 0) / 100;
  const outputChangePct = a.outputTokenChangePct ?? candidate.expected.outputTokenChangePct ?? 0;
  const prompt = (avgT.input + avgT.cached) * (1 + inputChange);
  const currentCacheShare = avgT.input + avgT.cached > 0 ? avgT.cached / (avgT.input + avgT.cached) : 0;
  const cacheShare = a.cachedTokenSharePct !== undefined ? a.cachedTokenSharePct / 100 : candidatePricing.cachedInputPerMillion === null ? 0 : currentCacheShare;
  const perRequest: Tokens = {
    input: prompt * (1 - cacheShare),
    cached: prompt * cacheShare,
    output: avgT.output * (1 + outputChangePct / 100),
    reasoning: a.reasoningTokensPerRequest ?? candidate.expected.reasoningTokensPerRequest ?? avgT.reasoning,
  };
  const errorRateSource = a.candidateErrorRatePct !== undefined ? 'assumption' : candidate.expected.errorRatePct !== null ? 'model' : 'unchanged';
  const errorRate = a.candidateErrorRatePct !== undefined ? a.candidateErrorRatePct / 100 : candidate.expected.errorRatePct !== null ? candidate.expected.errorRatePct / 100 : currentRetryRate;
  const volume = (a.requestVolumeChangePct ?? 0) / 100;

  const costPerRequest = priceTokens(perRequest, P);
  const atCurrentTokens = priceTokens(avgT, P);
  const migratedRequests = p * n;
  // Calls before retries, adjusted for volume, then grossed up for the expected retry rate.
  const firstCalls = p * base * (1 + volume);
  const candidateRequests = errorRate < 1 ? firstCalls / (1 - errorRate) : firstCalls;
  const migratedCurrentCost = p * eligible.cost;
  const migratedProjectedCost = candidateRequests * costPerRequest;

  // An exact split of (migratedProjectedCost − migratedCurrentCost).
  const withCurrentRetries = currentRetryRate < 1 ? firstCalls / (1 - currentRetryRate) : firstCalls;
  const volumeRequests = currentRetryRate < 1 ? (p * base * volume) / (1 - currentRetryRate) : p * base * volume;
  const tokenDelta = (k: (typeof CATEGORIES)[number]) => (migratedRequests * (perRequest[k] - avgT[k]) * P[k]) / 1_000_000;
  const rel = (amount: number) => (migratedCurrentCost > 0 ? amount / migratedCurrentCost : null);
  const row = (rowId: ImpactRow['id'], label: string, amount: number): ImpactRow => ({ id: rowId, label, amount, pctOfMigrated: rel(amount) });
  const impacts = [
    row('unit_price', 'Unit-price impact', migratedRequests * atCurrentTokens - migratedCurrentCost),
    row('input_tokens', 'Input-token impact', tokenDelta('input')),
    row('cached_tokens', 'Cached-token impact', tokenDelta('cached')),
    row('output_tokens', 'Output-token impact', tokenDelta('output')),
    row('reasoning_tokens', 'Reasoning-token impact', tokenDelta('reasoning')),
    row('request_volume', 'Request-volume impact', volumeRequests * costPerRequest),
    row('retries', 'Retry or fallback impact', (candidateRequests - withCurrentRetries) * costPerRequest),
  ];
  return { migratedRequests, candidateRequests, perRequest, costPerRequest, migratedCurrentCost, migratedProjectedCost, impacts, errorRate, errorRateSource, outputChangePct };
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

export interface EstimateContext {
  /** Every model that can be current or candidate, with pricing in `currency`. */
  catalogue: ModelProfile[];
  /** Usage already limited to one company and to what the viewer may see. */
  records: UpgradeUsageRecord[];
  /** Scope options the viewer may analyse, by level. `company` is always allowed. */
  scopes: Partial<Record<ScopeLevel, ScopeOption[]>>;
  /** "Acme Innovation", or "Your own requests" for an individual user. */
  companyLabel: string;
  currency: string;
  /** Today in the reporting timezone. */
  today: string;
  /** Region a provider's calls run in, when known. */
  regionOf: (providerId: string) => string | null;
  /** ISO timestamp stamped on the analysis. */
  now: string;
}

export function findModel(catalogue: ModelProfile[], modelId: string, field: string): ModelProfile {
  const m = catalogue.find((x) => x.id === modelId);
  if (!m) throw new UpgradeInputError(field, `Unknown model: ${modelId}.`);
  return m;
}

export function resolveScope(scope: UpgradeEstimateRequest['scope'], ctx: Pick<EstimateContext, 'scopes' | 'companyLabel'>): { label: string } {
  if (scope.level === 'company') return { label: ctx.companyLabel };
  const option = ctx.scopes[scope.level]?.find((o) => o.id === scope.id);
  if (!option) throw new UpgradeAccessError();
  return { label: `${option.label} (${SCOPE_LEVEL_LABELS[scope.level].toLowerCase()})` };
}

function inScope(r: UpgradeUsageRecord, scope: UpgradeEstimateRequest['scope']): boolean {
  if (scope.level === 'company') return true;
  return ruleMatches({ id: 'scope', level: scope.level, targetId: scope.id, decision: 'eligible', reason: '' }, r);
}

function side(m: ModelProfile) {
  return { providerId: m.providerId, providerName: m.providerName, modelId: m.id, displayName: m.displayName, version: m.version, pricing: m.pricing };
}

function bucket(records: UpgradeUsageRecord[], total: number) {
  const a = aggregate(records);
  return { requests: records.length, share: total > 0 ? records.length / total : 0, cost: a.cost };
}

function labelFor(ctx: EstimateContext, level: ScopeLevel, value: string | null): string | null {
  if (!value) return null;
  return ctx.scopes[level]?.find((o) => o.id === value)?.label ?? value;
}

/** Runs one upgrade analysis. Throws UpgradeInputError (400) or UpgradeAccessError (403). */
export function estimateUpgrade(request: UpgradeEstimateRequest, ctx: EstimateContext): UpgradeAnalysis {
  const current = findModel(ctx.catalogue, request.currentModelId, 'currentModelId');
  const candidate = findModel(ctx.catalogue, request.candidateModelId, 'candidateModelId');
  const { label: scopeLabel } = resolveScope(request.scope, ctx);
  const window = resolveTimeWindow(request.timeWindow, ctx.today);
  const p = request.migrationPercentage / 100;
  const a = request.assumptions;
  const path = candidate.upgradePaths.find((u) => u.fromModelId === current.id) ?? null;
  const region = ctx.regionOf(candidate.providerId);
  const crossProvider = current.providerId !== candidate.providerId;

  const scoped = ctx.records.filter((r) => r.localDate >= window.from && r.localDate <= window.to && inScope(r, request.scope));
  const onCurrent = scoped.filter((r) => r.modelId === current.id);
  const decisions = onCurrent.map((r) => ({ r, d: classifyRecord(r, { candidate, path, rules: request.eligibilityRules, region }) }));
  const byStatus = (s: EligibilityStatus) => decisions.filter((x) => x.d.status === s).map((x) => x.r);
  const eligibleRecords = byStatus('eligible');
  const all = aggregate(onCurrent);
  const eligible = aggregate(eligibleRecords);

  // ---- Eligibility breakdown
  const reasonCounts = new Map<string, { status: 'ineligible' | 'requires_review'; reason: string; requests: number }>();
  for (const { d } of decisions) {
    if (d.status === 'eligible') continue;
    const key = `${d.status}:${d.reason}`;
    const entry = reasonCounts.get(key) ?? { status: d.status, reason: d.reason, requests: 0 };
    entry.requests++;
    reasonCounts.set(key, entry);
  }
  const workflowStatuses = new Map<string, Set<EligibilityStatus>>();
  for (const { r, d } of decisions) {
    if (!r.workflowId) continue;
    const set = workflowStatuses.get(r.workflowId) ?? new Set();
    set.add(d.status);
    workflowStatuses.set(r.workflowId, set);
  }
  const eligibility: EligibilityBreakdown = {
    eligible: bucket(eligibleRecords, onCurrent.length),
    ineligible: bucket(byStatus('ineligible'), onCurrent.length),
    requiresReview: bucket(byStatus('requires_review'), onCurrent.length),
    reasons: [...reasonCounts.values()].sort((x, y) => y.requests - x.requests),
    mixedWorkflows: [...workflowStatuses].filter(([, s]) => s.size > 1).map(([w]) => labelFor(ctx, 'workflow', w) ?? w),
  };

  // ---- Current usage
  const n = all.costed.length;
  const succeeded = onCurrent.filter((r) => r.requestStatus === 'succeeded');
  const succeededCosted = all.costed.filter((r) => r.requestStatus === 'succeeded').length;
  const latencies = onCurrent.map((r) => r.latencyMs).filter((v): v is number => v !== null);
  const avgLatency = latencies.length ? latencies.reduce((s, v) => s + v, 0) / latencies.length : null;
  const pricingVersions = [...new Set(all.costed.map((r) => r.pricingVersion).filter((v): v is string => !!v))].sort();
  const usage: CurrentUsage = {
    requests: onCurrent.length,
    costedRequests: n,
    unmeasuredRequests: onCurrent.length - n,
    successfulRequests: succeeded.length,
    failedRequests: onCurrent.length - succeeded.length,
    retries: onCurrent.filter((r) => r.isRetry).length,
    fallbacks: onCurrent.filter((r) => r.isFallback).length,
    avgInputTokens: avg(all.tokens.input, n),
    avgCachedTokens: avg(all.tokens.cached, n),
    avgOutputTokens: avg(all.tokens.output, n),
    avgReasoningTokens: avg(all.tokens.reasoning, n),
    avgLatencyMs: avgLatency,
    errorRate: onCurrent.length ? (onCurrent.length - succeeded.length) / onCurrent.length : null,
    cost: all.cost,
    costPerRequest: avg(all.cost, n),
    costPerSuccessfulRequest: succeededCosted > 0 ? all.cost / succeededCosted : null,
    costBasis: n > 0 && all.costed.every((r) => r.costStatus === 'reconciled') ? 'reconciled' : 'estimated',
    pricingVersions,
  };

  // ---- Data sufficiency
  const notices: string[] = [];
  const pricingMissing = !candidate.pricing || (n === 0 && onCurrent.length > 0 && !current.pricing);
  let insufficient: string | null = null;
  if (onCurrent.length === 0) insufficient = `There’s no observed usage of ${current.displayName} in ${scopeLabel} for ${window.label}.`;
  else if (pricingMissing) insufficient = MISSING_PRICING_MESSAGE;
  else if (n === 0) insufficient = `None of the ${plural(onCurrent.length, 'call')} on ${current.displayName} has measured usage, so there’s no cost to compare.`;
  else if (eligibleRecords.length === 0 && eligibility.requiresReview.requests > 0)
    insufficient = `Eligibility hasn’t been confirmed for any of these calls, so ${count(eligibility.requiresReview.requests)} need review and none count as savings. Confirm which calls can move (an eligibility rule), then run it again.`;

  if (pricingMissing && insufficient !== MISSING_PRICING_MESSAGE) notices.push(MISSING_PRICING_MESSAGE);
  if (usage.unmeasuredRequests > 0) notices.push(`${plural(usage.unmeasuredRequests, 'call')} had no measured usage, so ${usage.unmeasuredRequests === 1 ? 'it has' : 'they have'} no cost and ${usage.unmeasuredRequests === 1 ? 'is' : 'are'} left out of every amount (not counted as zero).`);
  const providersInScope = new Set(scoped.map((r) => r.providerId));
  const otherModelCalls = scoped.length - onCurrent.length;
  if (providersInScope.size > 1 || otherModelCalls > 0)
    notices.push(
      `${providersInScope.size > 1 ? `This scope uses ${providersInScope.size} providers. ` : ''}Only ${current.displayName} calls are analysed; the other ${plural(otherModelCalls, 'call')} on other models stay as they are and aren’t in these figures. Run a separate analysis for each model.`,
    );
  if (pricingVersions.length > 1) notices.push(`Pricing changed during the period (${pricingVersions.join(', ')}). Current cost uses the price in effect for each request; the candidate uses its latest price.`);
  if (request.migrationPercentage === 0) notices.push('The migration percentage is 0%, so no calls move and the projection equals current cost.');
  if (region && candidate.regions && !candidate.regions.includes(region)) notices.push(`${candidate.displayName} isn’t available in ${region}, where ${candidate.providerName} calls run today, so no calls can move there.`);
  if (crossProvider) notices.push(`${candidate.displayName} is from a different provider (${candidate.providerName}), so a migration means a new API integration, not just a model ID change.`);
  if (eligibility.mixedWorkflows.length) notices.push(`Some workflows have both eligible and ineligible or unreviewed calls (${eligibility.mixedWorkflows.join(', ')}); only their eligible calls are counted.`);
  if (window.days < 14) notices.push(`A ${window.days}-day window makes the monthly and annualised figures sensitive to one unusual week.`);
  if (candidate.pricing?.conversionNote) notices.push(candidate.pricing.conversionNote);

  // ---- Projection
  let financial: FinancialImpact | null = null;
  let projection: Projection | null = null;
  let breakdown: BreakdownRow[] = [];
  if (!insufficient && candidate.pricing) {
    projection = project(eligible, p, candidate, candidate.pricing, a);
    const projectedCost = all.cost - projection.migratedCurrentCost + projection.migratedProjectedCost;
    const savings = all.cost - projectedCost;
    const perMonth = UPGRADE_RULES.daysPerMonth / window.days;
    const monthlySavings = savings * perMonth;
    const oneOff = a.migrationCostEstimate ?? null;
    financial = {
      currentCost: all.cost,
      projectedCost,
      savings,
      savingsPct: all.cost > 0 ? (savings / all.cost) * 100 : null,
      currentMonthlyCost: all.cost * perMonth,
      projectedMonthlyCost: projectedCost * perMonth,
      monthlySavings,
      annualisedSavings: monthlySavings * 12,
      costPerSuccessfulRequest: { current: succeededCosted > 0 ? all.cost / succeededCosted : null, projected: succeededCosted > 0 ? projectedCost / succeededCosted : null },
      oneOffMigrationCost: oneOff,
      paybackMonths: oneOff !== null && monthlySavings > 0 ? oneOff / monthlySavings : null,
    };
    breakdown = buildBreakdown(all, eligible, p, projection, current.pricing, candidate.pricing);
  }

  const candidateProjection: CandidateProjection = {
    requests: projection?.candidateRequests ?? 0,
    avgInputTokens: projection ? projection.perRequest.input : null,
    avgCachedTokens: projection ? projection.perRequest.cached : null,
    avgOutputTokens: projection ? projection.perRequest.output : null,
    avgReasoningTokens: projection ? projection.perRequest.reasoning : null,
    avgLatencyMs: null,
    errorRate: projection ? projection.errorRate : null,
    projectedCost: projection ? projection.migratedProjectedCost : null,
    costPerRequest: projection ? projection.costPerRequest : null,
  };

  // ---- Risks
  const latencyChange = a.latencyChangePct ?? candidate.expected.latencyChangePct;
  if (latencyChange !== null && avgLatency !== null) candidateProjection.avgLatencyMs = avgLatency * (1 + latencyChange / 100);
  const risks = buildRisks({ current, candidate, path, usage, projection, a, latencyChange, region, crossProvider, eligibility, scoped: onCurrent });

  // ---- Recommendation
  const reviewCostShare = all.cost > 0 ? eligibility.requiresReview.cost / all.cost : 0;
  let classification: Classification;
  const reasons: string[] = [];
  const material = (f: FinancialImpact) => f.savingsPct !== null && f.savingsPct >= UPGRADE_RULES.materialSavingsPct && f.monthlySavings >= UPGRADE_RULES.materialMonthlySavings;
  const blocking = risks.filter((r) => r.level === 'high' && r.kind !== 'token' && r.kind !== 'financial');
  if (insufficient || !financial || !projection) {
    classification = 'insufficient_data';
    reasons.push(insufficient ?? MISSING_PRICING_MESSAGE);
  } else if (eligibleRecords.length === 0) {
    classification = 'not_recommended';
    const top = eligibility.reasons.find((r) => r.status === 'ineligible');
    reasons.push(`None of these calls is eligible to move, so there’s nothing to save${top ? `. Most common reason: ${top.reason}` : ''}.`);
  } else if (financial.savings < 0) {
    classification = 'not_recommended';
    reasons.push(`${candidate.displayName} would cost more: about ${money(-financial.monthlySavings, ctx.currency)} more a month for this scope.`);
  } else if (!material(financial)) {
    classification = 'not_recommended';
    reasons.push(
      `Projected savings are immaterial: ${pct((financial.savingsPct ?? 0) / 100)} of current cost, about ${money(financial.monthlySavings, ctx.currency)} a month (material means at least ${UPGRADE_RULES.materialSavingsPct}% and ${money(UPGRADE_RULES.materialMonthlySavings, ctx.currency)} a month).`,
    );
  } else if (blocking.length) {
    classification = 'not_recommended';
    for (const r of blocking) reasons.push(`Material ${r.label.toLowerCase()}: ${r.detail}`);
  } else {
    const conditions: string[] = [];
    if (reviewCostShare >= UPGRADE_RULES.conditionalReviewShare) conditions.push(`${pct(reviewCostShare, 0)} of current cost is in calls that still need review, so the saving depends on how that review goes.`);
    const neutral = project(eligible, p, candidate, candidate.pricing!, { migrationCostEstimate: a.migrationCostEstimate });
    const neutralSavings = projection.migratedCurrentCost - neutral.migratedProjectedCost;
    const neutralMonthly = neutralSavings * (UPGRADE_RULES.daysPerMonth / window.days);
    const neutralPct = all.cost > 0 ? (neutralSavings / all.cost) * 100 : 0;
    const dependsOnAssumptions = !(neutralPct >= UPGRADE_RULES.materialSavingsPct && neutralMonthly >= UPGRADE_RULES.materialMonthlySavings);
    if (dependsOnAssumptions) conditions.push('The saving is only material under the token, volume or retry assumptions you entered; without them it isn’t.');
    if (candidate.pricing?.validUntil) conditions.push(`It relies on ${candidate.displayName}’s current price, which applies only until ${candidate.pricing.validUntil}.`);
    if (conditions.length) {
      classification = 'conditional';
      reasons.push(...conditions);
    } else {
      const unclear = risks.filter((r) => r.level !== 'low');
      const strong = reviewCostShare < UPGRADE_RULES.strongMaxReviewShare && unclear.length === 0 && path?.compatibility === 'drop_in' && !a.businessCritical;
      classification = strong ? 'strongly_recommended' : 'recommended_with_validation';
      reasons.push(`Savings are material: ${pct((financial.savingsPct ?? 0) / 100)} of current cost, about ${money(financial.monthlySavings, ctx.currency)} a month.`);
      if (strong) reasons.push('Eligibility is confirmed for nearly all calls and no material quality, latency or compatibility risk is identified.');
      else reasons.push(`Validate first: ${unclear.map((r) => r.label.toLowerCase()).join(', ') || 'a staged rollout'}${a.businessCritical ? ', and this is business-critical work' : ''}.`);
    }
  }

  const pilot = pilotScope(decisions.filter((x) => x.d.status === 'eligible').map((x) => x.r), ctx);
  const rolloutPlan = classification === 'strongly_recommended' || classification === 'recommended_with_validation' ? rolloutSteps(pilot, current, candidate) : null;

  const analysis: UpgradeAnalysis = {
    schemaVersion: 1,
    status: classification === 'insufficient_data' ? 'insufficient_data' : 'complete',
    calculatedAt: ctx.now,
    currency: ctx.currency,
    scope: { level: request.scope.level, id: request.scope.id, label: scopeLabel },
    period: { from: window.from, to: window.to, days: window.days, label: window.label },
    migrationPercentage: request.migrationPercentage,
    current: { ...side(current), usage },
    candidate: { ...side(candidate), projection: candidateProjection },
    basis: { current: usage.costBasis, usage: 'observed', projection: 'modelled' },
    eligibility,
    financial,
    breakdown,
    impacts: projection?.impacts ?? [],
    risks,
    recommendation: { classification, label: CLASSIFICATION_LABELS[classification], reasons },
    rolloutPlan,
    nextStep: nextStep(classification, { current, candidate, pilot, insufficient, blocking, financial }),
    calculationBasis: [],
    notices,
    disclaimer: DISCLAIMER,
    inputs: request,
  };
  analysis.calculationBasis = calculationBasis(analysis, projection, current, candidate);
  return analysis;
}

function buildBreakdown(all: Aggregate, eligible: Aggregate, p: number, proj: Projection, currentPricing: ModelPricing | null, candidatePricing: ModelPricing): BreakdownRow[] {
  const P = rates(candidatePricing);
  const restTokens: Tokens = { input: all.tokens.input - eligible.tokens.input, cached: all.tokens.cached - eligible.tokens.cached, output: all.tokens.output - eligible.tokens.output, reasoning: all.tokens.reasoning - eligible.tokens.reasoning };
  // Observed cost split across token types by list price, so each part adds up to the recorded cost.
  const split = (t: Tokens, observed: number): Tokens | null => {
    if (!currentPricing) return null;
    const C = rates(currentPricing);
    const list = priceTokens(t, C);
    if (list <= 0) return { ...ZERO };
    const k = observed / list;
    return { input: (t.input * C.input * k) / 1e6, cached: (t.cached * C.cached * k) / 1e6, output: (t.output * C.output * k) / 1e6, reasoning: (t.reasoning * C.reasoning * k) / 1e6 };
  };
  const restCost = split(restTokens, all.cost - eligible.cost);
  const eligibleCost = split(eligible.tokens, eligible.cost);
  const labels: Record<(typeof CATEGORIES)[number], string> = { input: 'Input tokens', output: 'Output tokens', cached: 'Cached tokens', reasoning: 'Reasoning tokens' };
  const rows: BreakdownRow[] = (['input', 'output', 'cached', 'reasoning'] as const).map((k) => {
    const currentCost = restCost && eligibleCost ? restCost[k] + eligibleCost[k] : null;
    const projectedCost = restCost && eligibleCost ? restCost[k] + (1 - p) * eligibleCost[k] + (proj.candidateRequests * proj.perRequest[k] * P[k]) / 1e6 : null;
    let note: string | null = null;
    if (k === 'reasoning' && candidatePricing.reasoningPerMillion === null) note = 'Billed as output tokens on the candidate.';
    if (k === 'cached' && candidatePricing.cachedInputPerMillion === null) note = 'No cache discount on the candidate; priced as input.';
    if (!currentPricing) note = 'Current cost can’t be split by token type without a price list.';
    return { id: k, label: labels[k], currentQuantity: all.tokens[k], projectedQuantity: restTokens[k] + (1 - p) * eligible.tokens[k] + proj.candidateRequests * proj.perRequest[k], currentCost, projectedCost, note };
  });
  const retryRateNote = proj.errorRateSource === 'unchanged' ? 'Retry rate assumed unchanged.' : `Candidate retry rate ${pct(proj.errorRate)} (${proj.errorRateSource === 'assumption' ? 'your assumption' : 'model expectation'}).`;
  rows.push({
    id: 'requests',
    label: 'Requests',
    currentQuantity: all.costed.length,
    projectedQuantity: all.costed.length - proj.migratedRequests + proj.candidateRequests,
    currentCost: all.cost,
    projectedCost: all.cost - proj.migratedCurrentCost + proj.migratedProjectedCost,
    note: 'Totals of the token rows.',
  });
  rows.push({
    id: 'retries',
    label: 'Retries and fallbacks',
    currentQuantity: all.retries,
    projectedQuantity: all.retries - p * eligible.retries + proj.candidateRequests * proj.errorRate,
    currentCost: all.retryCost,
    projectedCost: all.retryCost - p * eligible.retryCost + proj.candidateRequests * proj.errorRate * proj.costPerRequest,
    note: `Included in the rows above. ${retryRateNote}`,
  });
  rows.push({ id: 'tools', label: 'Tool or workflow costs', currentQuantity: null, projectedQuantity: null, currentCost: null, projectedCost: null, note: 'Not available: AxiomFlo doesn’t record tool or workflow charges separately.' });
  return rows;
}

interface RiskInput {
  current: ModelProfile;
  candidate: ModelProfile;
  path: UpgradePath | null;
  usage: CurrentUsage;
  projection: Projection | null;
  a: UpgradeAssumptions;
  latencyChange: number | null;
  region: string | null;
  crossProvider: boolean;
  eligibility: EligibilityBreakdown;
  scoped: UpgradeUsageRecord[];
}

function buildRisks({ current, candidate, path, usage, projection, a, latencyChange, region, crossProvider, eligibility, scoped }: RiskInput): UpgradeRisk[] {
  const risks: UpgradeRisk[] = [];

  // Quality
  if (a.evaluationQualityScore !== undefined && a.qualityThreshold !== undefined) {
    const ok = a.evaluationQualityScore >= a.qualityThreshold;
    risks.push({ kind: 'quality', label: 'Quality risk', level: ok ? 'low' : 'high', detail: `Your evaluation scored ${a.evaluationQualityScore} against a threshold of ${a.qualityThreshold}${ok ? '.' : ', so it falls short.'}` });
  } else if (a.evaluationQualityScore !== undefined) {
    risks.push({ kind: 'quality', label: 'Quality risk', level: 'medium', detail: `Your evaluation scored ${a.evaluationQualityScore}, but no quality threshold is set to compare it with.` });
  } else {
    risks.push({ kind: 'quality', label: 'Quality risk', level: 'unknown', detail: `${QUALITY_UNKNOWN_MESSAGE}${candidate.qualityEvidence ? ` On record: ${candidate.qualityEvidence} That isn’t a test of your workloads.` : ''}` });
  }

  // Latency
  if (latencyChange === null) {
    risks.push({ kind: 'latency', label: 'Latency risk', level: 'unknown', detail: `No latency expectation is on record for ${candidate.displayName}${usage.avgLatencyMs !== null ? `; today’s calls average ${count(usage.avgLatencyMs)} ms` : ''}. Measure it in the pilot.` });
  } else {
    const level = latencyChange > UPGRADE_RULES.latencyHighPct ? 'high' : latencyChange > UPGRADE_RULES.latencyMediumPct ? 'medium' : 'low';
    const ms = usage.avgLatencyMs !== null ? ` (about ${count(usage.avgLatencyMs)} ms → ${count(usage.avgLatencyMs * (1 + latencyChange / 100))} ms)` : '';
    risks.push({ kind: 'latency', label: 'Latency risk', level, detail: `Expected response time ${latencyChange <= 0 ? 'falls' : 'rises'} by ${Math.abs(latencyChange)}%${ms}${a.latencyChangePct !== undefined ? ', your assumption' : ', from the model’s published expectation'}.` });
  }

  // Reliability
  const currentRetry = usage.requests ? usage.retries / usage.requests : 0;
  const parts = [`Today ${pct(usage.errorRate)} of calls fail, with ${plural(usage.retries, 'retry', 'retries')} and ${plural(usage.fallbacks, 'fallback')}.`];
  let reliability: UpgradeRisk['level'] = 'low';
  if (projection) {
    const diffPp = (projection.errorRate - currentRetry) * 100;
    if (projection.errorRateSource === 'unchanged') parts.push('The candidate’s retry rate is assumed unchanged.');
    else parts.push(`The candidate is expected to need retries on ${pct(projection.errorRate)} of calls.`);
    if (diffPp > UPGRADE_RULES.retryHighPp) reliability = 'high';
    else if (diffPp > UPGRADE_RULES.retryMediumPp) reliability = 'medium';
  }
  if (candidate.status === 'preview') {
    parts.push('Preview models often have tighter rate limits.');
    if (reliability === 'low') reliability = 'medium';
  }
  risks.push({ kind: 'reliability', label: 'Reliability risk', level: reliability, detail: parts.join(' ') });

  // Tokens
  const tokenParts: string[] = [];
  if (projection) {
    if ((a.inputTokenChangePct ?? 0) > 0) tokenParts.push(`input tokens +${a.inputTokenChangePct}%`);
    if (projection.outputChangePct > 0) tokenParts.push(`output tokens +${projection.outputChangePct}%`);
    const reasoningNow = usage.avgReasoningTokens ?? 0;
    if (projection.perRequest.reasoning > reasoningNow) tokenParts.push(`about ${count(projection.perRequest.reasoning - reasoningNow)} more reasoning tokens per request`);
    if ((usage.avgCachedTokens ?? 0) > 0 && projection.perRequest.cached < (usage.avgCachedTokens ?? 0)) tokenParts.push('fewer cached tokens');
  }
  risks.push(
    tokenParts.length
      ? { kind: 'token', label: 'Token risk', level: 'medium', detail: `Expected: ${tokenParts.join(', ')}. A cheaper price per token can still cost more if the model uses more tokens.` }
      : { kind: 'token', label: 'Token risk', level: 'low', detail: 'No token increase is assumed, but a cheaper model can still produce more output or reasoning tokens. Compare token counts in the pilot.' },
  );

  // Compatibility
  const featureIneligible = eligibility.reasons.filter((r) => r.reason.startsWith('Needs ')).reduce((s, r) => s + r.requests, 0);
  const compat: string[] = [];
  let compatLevel: UpgradeRisk['level'];
  if (!path) {
    compatLevel = 'high';
    compat.push(`AxiomFlo has no compatibility record for ${current.displayName} → ${candidate.displayName}. Confirm tool calling, structured output and API behaviour first.`);
  } else if (path.compatibility === 'not_compatible') {
    compatLevel = 'high';
    compat.push(path.note);
  } else {
    compatLevel = path.compatibility === 'drop_in' ? 'low' : 'medium';
    compat.push(path.note);
  }
  if (crossProvider) {
    compat.push('A different provider means a different API, SDK, error handling and tool-calling format.');
    if (compatLevel === 'low') compatLevel = 'medium';
  }
  if (featureIneligible) compat.push(`${plural(featureIneligible, 'call')} rely on features the candidate lacks and are ineligible.`);
  if (scoped.length && scoped.every((r) => r.requiredFeatures.length === 0) && !scoped.some((r) => r.workflowId)) compat.push('AxiomFlo can’t see which API features these calls use, so check structured output and tool calls in the pilot.');
  risks.push({ kind: 'compatibility', label: 'Compatibility risk', level: compatLevel, detail: compat.join(' ') });

  // Financial
  const fin: string[] = [];
  let finLevel: UpgradeRisk['level'] = 'low';
  if (!candidate.pricing) {
    finLevel = 'high';
    fin.push(`No supported price is on record for ${candidate.displayName}.`);
  } else {
    if (candidate.pricing.validUntil) {
      finLevel = 'medium';
      fin.push(`${candidate.displayName}’s price applies until ${candidate.pricing.validUntil}; after that it changes.`);
    }
    if (candidate.pricing.conversionNote) fin.push(candidate.pricing.conversionNote);
  }
  if (usage.pricingVersions.length > 1) {
    finLevel = finLevel === 'high' ? 'high' : 'medium';
    fin.push('Prices changed during the period.');
  }
  fin.push(usage.costBasis === 'reconciled' ? 'Current cost is reconciled to the provider bill.' : 'Current cost is an estimate from list prices, not invoiced cost; minimum commitments and discounts aren’t included.');
  risks.push({ kind: 'financial', label: 'Financial risk', level: finLevel, detail: fin.join(' ') });

  // Governance
  const gov: string[] = [];
  let govLevel: UpgradeRisk['level'] = 'low';
  if (region && candidate.regions && !candidate.regions.includes(region)) {
    govLevel = 'high';
    gov.push(`${candidate.displayName} isn’t available in ${region} (available in ${candidate.regions.join(', ')}), which may break data-residency commitments.`);
  }
  const envs = [...new Set(scoped.map((r) => r.environment).filter((e): e is NonNullable<typeof e> => !!e))];
  const blockedEnvs = candidate.environments ? envs.filter((e) => !candidate.environments!.includes(e)) : [];
  if (blockedEnvs.length) {
    if (govLevel === 'low') govLevel = 'medium';
    gov.push(`Not approved for ${blockedEnvs.join(' or ')}.`);
  }
  if (candidate.status === 'preview') {
    if (govLevel === 'low') govLevel = 'medium';
    gov.push('It’s a preview model, which provider terms often exclude from production use.');
  }
  if (crossProvider) {
    if (govLevel === 'low') govLevel = 'medium';
    gov.push(`${candidate.providerName} needs its own data-processing, residency and policy review.`);
  }
  if (a.businessCritical) {
    if (govLevel === 'low') govLevel = 'medium';
    gov.push('Marked business-critical, so the workflow owner must approve the change.');
  }
  gov.push('Changing production routing always needs explicit human approval; AxiomFlo never switches models itself.');
  risks.push({ kind: 'governance', label: 'Governance risk', level: govLevel, detail: gov.join(' ') });
  return risks;
}

interface Pilot {
  label: string;
  kind: 'environment' | 'workflow' | 'scope';
}

/** A low-risk place to start: development or staging if eligible calls run there, else the cheapest eligible workflow. */
function pilotScope(eligible: UpgradeUsageRecord[], ctx: EstimateContext): Pilot {
  for (const env of ['development', 'staging'] as const) if (eligible.some((r) => r.environment === env)) return { label: `${env} calls`, kind: 'environment' };
  const byWorkflow = new Map<string, number>();
  for (const r of eligible) if (r.workflowId) byWorkflow.set(r.workflowId, (byWorkflow.get(r.workflowId) ?? 0) + (r.cost ?? 0));
  const cheapest = [...byWorkflow].sort((x, y) => x[1] - y[1])[0];
  if (cheapest) return { label: `the ${labelFor(ctx, 'workflow', cheapest[0])} workflow`, kind: 'workflow' };
  return { label: 'a small, non-critical share of eligible calls', kind: 'scope' };
}

function rolloutSteps(pilot: Pilot, current: ModelProfile, candidate: ModelProfile): string[] {
  return [
    `Select a low-risk pilot scope: ${pilot.label}${pilot.kind === 'environment' ? '' : ' (not production-critical)'}.`,
    `Run a side-by-side evaluation of ${current.displayName} and ${candidate.displayName} on representative prompts with expected outputs.`,
    'Compare cost, latency, token usage, error rate and quality score against agreed thresholds.',
    `Move an initial 10–20% of eligible calls to ${candidate.displayName}.`,
    'Monitor actual savings against this projection for 7–14 days.',
    'Expand gradually only if actual savings and quality meet the thresholds.',
    `Keep ${current.displayName} available for rollback, and record the migration decision and who approved it.`,
  ];
}

function nextStep(
  classification: Classification,
  { current, candidate, pilot, insufficient, blocking, financial }: { current: ModelProfile; candidate: ModelProfile; pilot: Pilot; insufficient: string | null; blocking: UpgradeRisk[]; financial: FinancialImpact | null },
): string {
  switch (classification) {
    case 'insufficient_data':
      if (insufficient === MISSING_PRICING_MESSAGE) return `Add a supported price for ${!candidate.pricing ? candidate.displayName : current.displayName}, then run the analysis again.`;
      if (insufficient?.startsWith('Eligibility')) return 'Confirm which calls can move by adding an eligibility rule (for example, for development or a specific workflow), then run it again.';
      return `Pick a scope or period where ${current.displayName} is used.`;
    case 'not_recommended':
      if (blocking.length) return `Resolve the ${blocking[0].label.toLowerCase()} before reconsidering this migration.`;
      if (financial && financial.savings < 0) return `Keep ${current.displayName}. Re-run this analysis if ${candidate.displayName}’s price falls.`;
      return `Keep ${current.displayName}; the saving doesn’t justify the migration effort.`;
    case 'conditional':
      return 'Narrow the scope to the calls that clearly qualify, review the calls marked "requires review", or validate the assumptions, then run it again.';
    case 'recommended_with_validation':
      return `Run a side-by-side evaluation on ${pilot.label} before moving any production traffic.`;
    case 'strongly_recommended':
      return `Move 10–20% of ${pilot.label} to ${candidate.displayName} with explicit approval, and compare actual savings with this projection for 7–14 days.`;
  }
}

function calculationBasis(an: UpgradeAnalysis, proj: Projection | null, current: ModelProfile, candidate: ModelProfile): string[] {
  const c = an.currency;
  const u = an.current.usage;
  const lines = [
    `Current cost: the recorded estimated cost of ${plural(u.costedRequests, `${current.displayName} call`)} in ${an.scope.label}, ${an.period.label}. Basis: observed usage, ${u.costBasis === 'reconciled' ? 'reconciled' : 'estimated'} cost.`,
    `Eligible calls: ${count(an.eligibility.eligible.requests)} of ${count(u.requests)}. ${an.migrationPercentage}% of them are assumed to move.`,
  ];
  if (proj && candidate.pricing) {
    const pr = candidate.pricing;
    lines.push(
      `Each migrated call is expected to use about ${count(proj.perRequest.input)} input, ${count(proj.perRequest.cached)} cached, ${count(proj.perRequest.output)} output and ${count(proj.perRequest.reasoning)} reasoning tokens, priced at ${candidate.displayName}’s rates: ${money(pr.inputPerMillion, c)} input, ${money(pr.cachedInputPerMillion ?? pr.inputPerMillion, c)} cached and ${money(pr.outputPerMillion, c)} output per million tokens (${pr.pricingVersion}). That is ${money(proj.costPerRequest, c, true)} per call.`,
    );
    lines.push(`Calls that don’t move keep their current cost: the other ${100 - an.migrationPercentage}% of eligible calls, ineligible calls and calls that still need review.`);
    lines.push('Projected cost = eligible calls × migration percentage × expected tokens per call × candidate price + every other call at its current cost.');
    if (proj.errorRateSource !== 'unchanged' || (an.inputs.assumptions.requestVolumeChangePct ?? 0) !== 0)
      lines.push(`Migrated calls are adjusted for a ${signedPct((an.inputs.assumptions.requestVolumeChangePct ?? 0) / 100, 0)} volume change and a ${pct(proj.errorRate)} retry rate.`);
  }
  lines.push(`Monthly figures scale the ${an.period.days}-day period to an average month (${UPGRADE_RULES.daysPerMonth.toFixed(2)} days). Annualised figures are the monthly figure × 12: an extrapolation, not a forecast.`);
  if (an.financial?.oneOffMigrationCost != null) lines.push(`The one-off migration estimate (${money(an.financial.oneOffMigrationCost, c)}) is shown separately and isn’t subtracted from the savings.`);
  return lines;
}
