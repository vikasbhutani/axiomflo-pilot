/**
 * The ONE shared cost-calculation module.
 *
 * Dashboard totals, team and provider totals, showback exports and assistant
 * answers must all come from these functions so the numbers always agree.
 *
 * Rules:
 * - estimated cost = (input tokens × input rate per million
 *                     + output tokens × output rate per million) ÷ 1,000,000
 * - Full precision is kept here; round only when displaying.
 * - Missing usage → cost is `null` ("unresolved"), never zero.
 * - Failed requests are costed from whatever usage was measured; they are not assumed free.
 */
import type { CostedUsageRecord, PricingRate, PricingVersion, UsageRecord } from '../types';

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  total: number;
  rate: PricingRate;
  pricingVersionId: string;
}

/** Picks the pricing version in effect on a given Sydney calendar date. */
export function pricingVersionFor(localDate: string, versions: PricingVersion[]): PricingVersion | null {
  const applicable = versions
    .filter((v) => v.effectiveFrom <= localDate)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return applicable[0] ?? null;
}

export function estimateCost(inputTokens: number, outputTokens: number, rate: PricingRate): number {
  return (inputTokens * rate.inputPerMillion + outputTokens * rate.outputPerMillion) / 1_000_000;
}

/**
 * Cost breakdown for one record, or `null` when usage is missing or no
 * illustrative rate exists for the model.
 */
export function costBreakdown(record: UsageRecord, localDate: string, versions: PricingVersion[]): CostBreakdown | null {
  if (record.inputTokens === null || record.outputTokens === null) return null;
  const version = pricingVersionFor(localDate, versions);
  const rate = version?.rates.find((r) => r.modelId === record.modelId);
  if (!version || !rate) return null;
  const inputCost = (record.inputTokens * rate.inputPerMillion) / 1_000_000;
  const outputCost = (record.outputTokens * rate.outputPerMillion) / 1_000_000;
  return { inputCost, outputCost, total: inputCost + outputCost, rate, pricingVersionId: version.id };
}

export interface CostSummary {
  requestCount: number;
  succeededCount: number;
  failedCount: number;
  /** Records with a calculable cost. */
  costedCount: number;
  /** Records whose cost cannot be calculated (missing usage). Never counted as zero. */
  unresolvedCount: number;
  reconciledCount: number;
  estimatedOnlyCount: number;
  /** Sum of all calculable costs (reconciled + estimated), full precision. */
  estimatedSpend: number;
  reconciledSpend: number;
  estimatedOnlySpend: number;
  /** Average over costed records only; `null` when there are none. */
  averageCostPerCostedRequest: number | null;
  inputTokens: number;
  outputTokens: number;
}

export function summarize(records: CostedUsageRecord[]): CostSummary {
  const summary: CostSummary = {
    requestCount: 0,
    succeededCount: 0,
    failedCount: 0,
    costedCount: 0,
    unresolvedCount: 0,
    reconciledCount: 0,
    estimatedOnlyCount: 0,
    estimatedSpend: 0,
    reconciledSpend: 0,
    estimatedOnlySpend: 0,
    averageCostPerCostedRequest: null,
    inputTokens: 0,
    outputTokens: 0,
  };

  for (const r of records) {
    summary.requestCount++;
    if (r.requestStatus === 'failed') summary.failedCount++;
    else summary.succeededCount++;
    summary.inputTokens += r.inputTokens ?? 0;
    summary.outputTokens += r.outputTokens ?? 0;

    if (r.estimatedCost === null) {
      summary.unresolvedCount++;
      continue;
    }
    summary.costedCount++;
    summary.estimatedSpend += r.estimatedCost;
    if (r.costStatus === 'reconciled') {
      summary.reconciledCount++;
      summary.reconciledSpend += r.estimatedCost;
    } else {
      summary.estimatedOnlyCount++;
      summary.estimatedOnlySpend += r.estimatedCost;
    }
  }

  summary.averageCostPerCostedRequest = summary.costedCount > 0 ? summary.estimatedSpend / summary.costedCount : null;
  return summary;
}

/** Groups records by a key and summarizes each group. Keys are returned in first-seen order. */
export function summarizeBy<K extends string>(records: CostedUsageRecord[], keyOf: (r: CostedUsageRecord) => K): Map<K, CostSummary> {
  const groups = new Map<K, CostedUsageRecord[]>();
  for (const r of records) {
    const key = keyOf(r);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const result = new Map<K, CostSummary>();
  for (const [key, list] of groups) result.set(key, summarize(list));
  return result;
}

/** Ratio helper that refuses to divide by zero. */
export function safeRatio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
