/**
 * FinOps Scorecard: unit economics, token cost per workflow, and five cost
 * optimisation levers ranked by how much they could save.
 *
 * Everything is worked out here, by code, from the same costed records as the
 * rest of the app. The AI Cost Assistant only relays these figures. Savings are
 * estimates under the assumptions in FINOPS_RULES, shown next to every lever;
 * they never claim a cheaper model gives the same quality.
 *
 * The agent has a Python port (backend/axiomflo/reporting/finops.py). Keep the
 * rules and operation order the same: backend/tests/test_finops_parity.py
 * checks the two agree on the sample data.
 */
import type { CostedUsageRecord } from '../types';
import { safeRatio } from './calculations';

/** Records may carry prompt-cache counts (real data); demo records don't. */
export type ScorecardRecord = CostedUsageRecord & { cacheReadTokens?: number | null; cacheWriteTokens?: number | null };

export type WorkflowKind = 'automated' | 'interactive';

export interface Workflow {
  id: string;
  label: string;
  kind: WorkflowKind;
}

export interface TokenRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface ScorecardOptions {
  workflowOf: (r: ScorecardRecord) => Workflow;
  /** Per-token prices, when the workspace has its own price list (the demo). Without it, costs are split by the 1:5 rule below. */
  rateOf?: (modelId: string, localDate: string) => TokenRate | null;
}

/** Every threshold and assumption, in one place. Shown to people next to the levers. */
export const FINOPS_RULES = {
  // Model right-sizing: successful requests on a higher-tier model that returned a short answer.
  smallJobOutputTokens: 600,
  // When no cheaper model is in use to compare with, assume the next tier down costs this share.
  fallbackCheaperPriceShare: 0.5,
  // Prompt caching: long prompts that read nothing from the cache.
  longPromptTokens: 4_000,
  cacheablePrefixShare: 0.5,
  cachedReadPriceShare: 0.1,
  // Batch processing: automated workflows moved to the providers' batch APIs.
  batchDiscount: 0.5,
  // Context trimming: very long prompts cut down with retrieval or summaries.
  longContextTokens: 50_000,
  contextTrimShare: 0.4,
  // Output limits: long answers capped with max tokens or tighter instructions.
  longOutputTokens: 2_000,
  outputTrimShare: 0.3,
  // Without a price list, output tokens are assumed to cost this many times input tokens.
  outputPriceRatio: 5,
} as const;

export type LeverId = 'model_right_sizing' | 'prompt_caching' | 'batch_processing' | 'context_trimming' | 'output_limits';

export interface ModelMove {
  fromModelId: string;
  fromModel: string;
  /** Null when no cheaper model is in use, so the fallback price share was assumed. */
  toModelId: string | null;
  toModel: string | null;
  requests: number;
  savings: number;
}

export interface Lever {
  id: LeverId;
  rank: number;
  name: string;
  /** What the lever is, in a sentence. */
  summary: string;
  /** What someone would do to pull it. */
  action: string;
  /** The assumption behind the savings figure. */
  assumption: string;
  effort: 'Low' | 'Medium' | 'High';
  affectedRequests: number;
  affectedSpend: number;
  savings: number;
  /** Savings as a share of the period's spend; null when there's no spend. */
  savingsShare: number | null;
  /** Right-sizing only: which models could move where. */
  moves?: ModelMove[];
}

export interface UnitEconomics {
  spend: number;
  requests: number;
  costedRequests: number;
  unresolvedRequests: number;
  succeededCostedRequests: number;
  inputTokens: number;
  outputTokens: number;
  costPerRequest: number | null;
  /** Spend divided by successful requests: what each useful answer really cost, failures included. */
  costPerSuccessfulRequest: number | null;
  costPerMillionTokens: number | null;
  activePeople: number;
  costPerActivePerson: number | null;
  outputToInputRatio: number | null;
  failedSpend: number;
  failedSpendShare: number | null;
}

export interface WorkflowCost extends Workflow {
  requests: number;
  costedRequests: number;
  inputTokens: number;
  outputTokens: number;
  spend: number;
  inputSpend: number;
  outputSpend: number;
  share: number | null;
  costPerRequest: number | null;
  costPerMillionTokens: number | null;
}

export interface ScoreComponent {
  id: 'headroom' | 'model_fit' | 'waste' | 'visibility';
  label: string;
  points: number;
  max: number;
  /** The measure behind the points, as a share (0–1). */
  measure: number | null;
}

export interface Scorecard {
  economics: UnitEconomics;
  previousEconomics: UnitEconomics | null;
  workflows: WorkflowCost[];
  levers: Lever[];
  /** Savings if every lever were pulled, allowing for overlap between them. */
  combinedSavings: number;
  combinedSavingsShare: number | null;
  /** 0–100, or null when there's no spend to score. */
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null;
  components: ScoreComponent[];
  /** True when input and output costs come from a price list rather than the 1:5 rule. */
  exactSplit: boolean;
}

const TIER_PATTERNS: [number, RegExp][] = [
  [3, /(opus|fable|mythos|ultra)/],
  [2, /(sonnet|-pro\b)/],
  [1, /(haiku|flash|lite|mini|nano)/],
];

/** 3 = top tier (Opus, Fable), 2 = mid (Sonnet, Gemini Pro), 1 = small (Haiku, Flash); null when unknown. */
export function modelTier(modelId: string): number | null {
  const id = modelId.toLowerCase();
  for (const [tier, pattern] of TIER_PATTERNS) if (pattern.test(id)) return tier;
  return null;
}

/** Plain code-point order, the same as Python's, so ties break identically in the agent. */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const isCosted = (r: ScorecardRecord): r is ScorecardRecord & { estimatedCost: number } => r.estimatedCost !== null;

/** Input and output parts of a record's cost. */
function splitCost(r: ScorecardRecord & { estimatedCost: number }, options: ScorecardOptions): { input: number; output: number } {
  const i = r.inputTokens ?? 0;
  const o = r.outputTokens ?? 0;
  const rate = options.rateOf?.(r.modelId, r.localDate);
  if (rate) return { input: (i * rate.inputPerMillion) / 1_000_000, output: (o * rate.outputPerMillion) / 1_000_000 };
  const weight = i + FINOPS_RULES.outputPriceRatio * o;
  if (weight === 0) return { input: r.estimatedCost, output: 0 };
  const input = (r.estimatedCost * i) / weight;
  return { input, output: r.estimatedCost - input };
}

export function unitEconomics(records: ScorecardRecord[]): UnitEconomics {
  let spend = 0;
  let costedRequests = 0;
  let succeededCostedRequests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let failedSpend = 0;
  const people = new Set<string>();
  for (const r of records) {
    if (r.principal.type === 'user') people.add(r.principal.id);
    if (!isCosted(r)) continue;
    spend += r.estimatedCost;
    costedRequests++;
    inputTokens += r.inputTokens ?? 0;
    outputTokens += r.outputTokens ?? 0;
    if (r.requestStatus === 'succeeded') succeededCostedRequests++;
    else failedSpend += r.estimatedCost;
  }
  return {
    spend,
    requests: records.length,
    costedRequests,
    unresolvedRequests: records.length - costedRequests,
    succeededCostedRequests,
    inputTokens,
    outputTokens,
    costPerRequest: safeRatio(spend, costedRequests),
    costPerSuccessfulRequest: safeRatio(spend, succeededCostedRequests),
    costPerMillionTokens: inputTokens + outputTokens === 0 ? null : (spend * 1_000_000) / (inputTokens + outputTokens),
    activePeople: people.size,
    costPerActivePerson: safeRatio(spend, people.size),
    outputToInputRatio: safeRatio(outputTokens, inputTokens),
    failedSpend,
    failedSpendShare: safeRatio(failedSpend, spend),
  };
}

export function workflowCosts(records: ScorecardRecord[], options: ScorecardOptions): WorkflowCost[] {
  const groups = new Map<string, WorkflowCost>();
  let total = 0;
  for (const r of records) {
    const wf = options.workflowOf(r);
    let g = groups.get(wf.id);
    if (!g) {
      g = { ...wf, requests: 0, costedRequests: 0, inputTokens: 0, outputTokens: 0, spend: 0, inputSpend: 0, outputSpend: 0, share: null, costPerRequest: null, costPerMillionTokens: null };
      groups.set(wf.id, g);
    }
    g.requests++;
    if (!isCosted(r)) continue;
    const split = splitCost(r, options);
    g.costedRequests++;
    g.inputTokens += r.inputTokens ?? 0;
    g.outputTokens += r.outputTokens ?? 0;
    g.spend += r.estimatedCost;
    g.inputSpend += split.input;
    g.outputSpend += split.output;
    total += r.estimatedCost;
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.share = safeRatio(g.spend, total);
    g.costPerRequest = safeRatio(g.spend, g.costedRequests);
    g.costPerMillionTokens = g.inputTokens + g.outputTokens === 0 ? null : (g.spend * 1_000_000) / (g.inputTokens + g.outputTokens);
  }
  return out.sort((a, b) => b.spend - a.spend || compareText(a.label, b.label));
}

/** Cost per input-equivalent token for each model, from the period's own records. */
function blendedRates(costed: (ScorecardRecord & { estimatedCost: number })[]): Map<string, number> {
  const sums = new Map<string, [number, number]>();
  for (const r of costed) {
    const weight = (r.inputTokens ?? 0) + FINOPS_RULES.outputPriceRatio * (r.outputTokens ?? 0);
    const s = sums.get(r.modelId) ?? [0, 0];
    s[0] += r.estimatedCost;
    s[1] += weight;
    sums.set(r.modelId, s);
  }
  const rates = new Map<string, number>();
  for (const [model, [cost, weight]] of sums) if (weight > 0) rates.set(model, cost / weight);
  return rates;
}

/** The cheaper model a request could move to: the highest tier below it, among models in use with the same provider. */
function cheaperModel(modelId: string, providerId: string, inUse: { modelId: string; providerId: string }[]): string | null {
  const tier = modelTier(modelId);
  if (tier === null) return null;
  const candidates = inUse
    .filter((m) => m.providerId === providerId && m.modelId !== modelId)
    .map((m) => ({ id: m.modelId, tier: modelTier(m.modelId) }))
    .filter((m): m is { id: string; tier: number } => m.tier !== null && m.tier < tier)
    .sort((a, b) => b.tier - a.tier || compareText(a.id, b.id));
  return candidates[0]?.id ?? null;
}

const LEVER_TEXT: Record<LeverId, Pick<Lever, 'name' | 'summary' | 'action' | 'effort'> & { assumption: () => string }> = {
  model_right_sizing: {
    name: 'Model right-sizing',
    summary: 'Send short, simple jobs to a smaller model in the same family.',
    action: 'Route requests with short answers to the smaller model, after testing it on a sample of real tasks.',
    effort: 'Medium',
    assumption: () =>
      `Successful requests on a higher-tier model that returned under ${FINOPS_RULES.smallJobOutputTokens.toLocaleString('en-AU')} output tokens, re-priced on the next tier down that's already in use (or at ${FINOPS_RULES.fallbackCheaperPriceShare * 100}% of the price when none is). A lower price doesn't promise the same quality.`,
  },
  prompt_caching: {
    name: 'Prompt caching',
    summary: 'Reuse the repeated part of long prompts instead of paying full price for it every time.',
    action: 'Turn on prompt caching for long system prompts and shared documents in the tool or code that sends them.',
    effort: 'Low',
    assumption: () =>
      `Successful requests with at least ${FINOPS_RULES.longPromptTokens.toLocaleString('en-AU')} input tokens and no cache reads. Assumes ${FINOPS_RULES.cacheablePrefixShare * 100}% of each prompt repeats and cached reads cost ${FINOPS_RULES.cachedReadPriceShare * 100}% of the input price.`,
  },
  batch_processing: {
    name: 'Batch processing',
    summary: 'Run automated, non-urgent work through the providers’ batch APIs at a discount.',
    action: 'Move bots and scheduled jobs that don’t need an instant answer to the batch API.',
    effort: 'Medium',
    assumption: () => `Requests from automated workflows, at the ${FINOPS_RULES.batchDiscount * 100}% batch discount both providers list. Interactive use is left out.`,
  },
  context_trimming: {
    name: 'Context trimming',
    summary: 'Send only the context a request needs instead of whole files or histories.',
    action: 'Use retrieval, summaries or shorter histories for requests that send very long prompts.',
    effort: 'High',
    assumption: () => `Successful requests with at least ${FINOPS_RULES.longContextTokens.toLocaleString('en-AU')} input tokens, assuming ${FINOPS_RULES.contextTrimShare * 100}% of their input can be cut.`,
  },
  output_limits: {
    name: 'Output limits',
    summary: 'Cap answer length where long answers aren’t needed.',
    action: 'Set max tokens and ask for concise answers in workflows that produce long outputs.',
    effort: 'Low',
    assumption: () => `Requests that returned at least ${FINOPS_RULES.longOutputTokens.toLocaleString('en-AU')} output tokens, assuming ${FINOPS_RULES.outputTrimShare * 100}% of that output can be cut.`,
  },
};

function lever(id: LeverId, affectedRequests: number, affectedSpend: number, savings: number, spend: number, moves?: ModelMove[]): Lever {
  const t = LEVER_TEXT[id];
  return { id, rank: 0, name: t.name, summary: t.summary, action: t.action, effort: t.effort, assumption: t.assumption(), affectedRequests, affectedSpend, savings, savingsShare: safeRatio(savings, spend), ...(moves ? { moves } : {}) };
}

export function optimisationLevers(records: ScorecardRecord[], options: ScorecardOptions, modelName: (modelId: string) => string = (m) => m): Lever[] {
  const costed = records.filter(isCosted);
  const spend = costed.reduce((sum, r) => sum + r.estimatedCost, 0);
  const R = FINOPS_RULES;

  // 1. Model right-sizing.
  const inUse = [...new Map(costed.map((r) => [r.modelId, { modelId: r.modelId, providerId: r.providerId }])).values()];
  const blended = blendedRates(costed);
  const moves = new Map<string, ModelMove>();
  let sizingRequests = 0;
  let sizingSpend = 0;
  let sizingSavings = 0;
  for (const r of costed) {
    const tier = modelTier(r.modelId);
    if (r.requestStatus !== 'succeeded' || tier === null || tier < 2 || (r.outputTokens ?? 0) >= R.smallJobOutputTokens) continue;
    const target = cheaperModel(r.modelId, r.providerId, inUse);
    const fromRate = options.rateOf?.(r.modelId, r.localDate);
    const toRate = target ? options.rateOf?.(target, r.localDate) : null;
    let newCost: number;
    if (fromRate && toRate) newCost = ((r.inputTokens ?? 0) * toRate.inputPerMillion + (r.outputTokens ?? 0) * toRate.outputPerMillion) / 1_000_000;
    else if (target && blended.has(target) && blended.has(r.modelId) && blended.get(r.modelId)! > 0) newCost = (r.estimatedCost * blended.get(target)!) / blended.get(r.modelId)!;
    else newCost = r.estimatedCost * R.fallbackCheaperPriceShare;
    const saved = Math.max(0, r.estimatedCost - newCost);
    sizingRequests++;
    sizingSpend += r.estimatedCost;
    sizingSavings += saved;
    const key = `${r.modelId}>${target ?? ''}`;
    const move = moves.get(key) ?? { fromModelId: r.modelId, fromModel: r.modelName || modelName(r.modelId), toModelId: target, toModel: target ? modelName(target) : null, requests: 0, savings: 0 };
    move.requests++;
    move.savings += saved;
    moves.set(key, move);
  }

  // 2. Prompt caching, 4. context trimming, 5. output limits: parts of input or output cost.
  let cacheRequests = 0, cacheSpend = 0, cacheSavings = 0;
  let trimRequests = 0, trimSpend = 0, trimSavings = 0;
  let outRequests = 0, outSpend = 0, outSavings = 0;
  // 3. Batch processing.
  let batchRequests = 0, batchSpend = 0;
  for (const r of costed) {
    const split = splitCost(r, options);
    const input = r.inputTokens ?? 0;
    if (r.requestStatus === 'succeeded' && input >= R.longPromptTokens && !(r.cacheReadTokens && r.cacheReadTokens > 0)) {
      cacheRequests++;
      cacheSpend += r.estimatedCost;
      cacheSavings += split.input * R.cacheablePrefixShare * (1 - R.cachedReadPriceShare);
    }
    if (r.requestStatus === 'succeeded' && input >= R.longContextTokens) {
      trimRequests++;
      trimSpend += r.estimatedCost;
      trimSavings += split.input * R.contextTrimShare;
    }
    if ((r.outputTokens ?? 0) >= R.longOutputTokens) {
      outRequests++;
      outSpend += r.estimatedCost;
      outSavings += split.output * R.outputTrimShare;
    }
    if (options.workflowOf(r).kind === 'automated') {
      batchRequests++;
      batchSpend += r.estimatedCost;
    }
  }

  const levers = [
    lever('model_right_sizing', sizingRequests, sizingSpend, sizingSavings, spend, [...moves.values()].sort((a, b) => b.savings - a.savings)),
    lever('prompt_caching', cacheRequests, cacheSpend, cacheSavings, spend),
    lever('batch_processing', batchRequests, batchSpend, batchSpend * R.batchDiscount, spend),
    lever('context_trimming', trimRequests, trimSpend, trimSavings, spend),
    lever('output_limits', outRequests, outSpend, outSavings, spend),
  ];
  // Stable order for ties, so the ranking never flickers.
  levers.sort((a, b) => b.savings - a.savings);
  levers.forEach((l, i) => (l.rank = i + 1));
  return levers;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function grade(score: number): Scorecard['grade'] {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'E';
}

export function buildScorecard(current: ScorecardRecord[], previous: ScorecardRecord[] | null, options: ScorecardOptions, modelName?: (modelId: string) => string): Scorecard {
  const economics = unitEconomics(current);
  const levers = optimisationLevers(current, options, modelName);
  const spend = economics.spend;
  const remaining = levers.reduce((keep, l) => keep * (spend > 0 ? 1 - Math.min(1, l.savings / spend) : 1), 1);
  const combinedSavings = spend * (1 - remaining);
  const combinedSavingsShare = safeRatio(combinedSavings, spend);
  const sizing = levers.find((l) => l.id === 'model_right_sizing')!;
  const fitShare = safeRatio(sizing.affectedSpend, spend);
  const costedShare = safeRatio(economics.costedRequests, economics.requests);

  const components: ScoreComponent[] = [
    { id: 'headroom', label: 'Savings headroom', max: 40, measure: combinedSavingsShare, points: 40 * clamp01(1 - (combinedSavingsShare ?? 0) / 0.75) },
    { id: 'model_fit', label: 'Model fit', max: 20, measure: fitShare, points: 20 * clamp01(1 - (fitShare ?? 0) / 0.3) },
    { id: 'waste', label: 'Failed-request waste', max: 20, measure: economics.failedSpendShare, points: 20 * clamp01(1 - (economics.failedSpendShare ?? 0) / 0.05) },
    { id: 'visibility', label: 'Cost visibility', max: 20, measure: costedShare, points: 20 * clamp01(((costedShare ?? 0) - 0.8) / 0.2) },
  ];
  const score = spend > 0 ? Math.round(components.reduce((sum, c) => sum + c.points, 0)) : null;

  return {
    economics,
    previousEconomics: previous ? unitEconomics(previous) : null,
    workflows: workflowCosts(current, options),
    levers,
    combinedSavings,
    combinedSavingsShare,
    score,
    grade: score === null ? null : grade(score),
    components,
    exactSplit: Boolean(options.rateOf),
  };
}

/** Workflows for records that don't name one: each application is its own automated workflow; people's use is grouped per team. */
export function defaultWorkflowOf(applicationName: (id: string) => string | undefined) {
  return (r: ScorecardRecord): Workflow =>
    r.principal.type === 'application'
      ? { id: `app:${r.principal.id}`, label: applicationName(r.principal.id) ?? r.principalName, kind: 'automated' }
      : { id: `team:${r.teamId}`, label: `Interactive use · ${r.teamName}`, kind: 'interactive' };
}
