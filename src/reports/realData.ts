/**
 * Turns the API's usage records into the same costed-record shape the demo uses, so
 * the shared calculations (`summarize`, `summarizeBy`) produce every total.
 *
 * Money: the gateway estimates each request's cost in USD from list prices. It is
 * shown in the company's reporting currency using the exchange rate a Company Admin
 * set for that month. Months without their own rate use the most recent earlier rate
 * (or, before the first rate, the first one). With no rate at all, amounts stay in USD
 * and the page says so. A missing cost is never shown as zero.
 */
import { toLocalDate } from '../lib/format';
import type { CostedUsageRecord } from '../types';
import type { ExchangeRateView, UsageResponse, UsageView } from './reportsApi';

export interface RealRecord extends CostedUsageRecord {
  estimatedCostUsd: number | null;
  /** Exchange rate used for `estimatedCost`, or null when shown in USD. */
  exchangeRate: number | null;
  cacheWriteTokens: number | null;
  cacheReadTokens: number | null;
  keyId: string;
  principalEmail: string | null;
  providerStatus: number | null;
  latencyMs: number | null;
  stream: boolean;
}

export interface Money {
  /** Currency every amount on the page is shown in. */
  currency: string;
  /** True when the company reports in another currency but no exchange rate is set yet. */
  usingUsdFallback: boolean;
  reportingCurrency: string;
}

export interface RealDataset {
  month: string;
  records: RealRecord[];
  money: Money;
  truncated: boolean;
  skipped: number;
}

export interface TeamLookup {
  id: string;
  name: string;
  code: string;
}

const PROVIDER_NAMES: Record<UsageView['providerId'], string> = { anthropic: 'Anthropic (Claude API)', gemini_vertex: 'Gemini on Vertex AI' };

export function providerName(id: UsageView['providerId']): string {
  return PROVIDER_NAMES[id] ?? id;
}

/** "claude-sonnet-5-5" → "Claude Sonnet 5.5"; "gemini-2.5-pro" → "Gemini 2.5 Pro". Unknown shapes are shown as-is. */
export function modelDisplayName(id: string): string {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`;
  if (/^gemini-[a-z0-9.-]+$/.test(id))
    return id
      .split('-')
      .map((p) => (/^\d/.test(p) ? p : p[0].toUpperCase() + p.slice(1)))
      .join(' ');
  return id;
}

/** The rate for a month: its own, else the latest earlier one, else the earliest one. */
export function rateFor(month: string, rates: ExchangeRateView[]): number | null {
  const sorted = [...rates].sort((a, b) => a.month.localeCompare(b.month));
  if (sorted.length === 0) return null;
  const earlier = sorted.filter((r) => r.month <= month);
  return (earlier[earlier.length - 1] ?? sorted[0]).rate;
}

export function buildDataset(usage: UsageResponse, rates: ExchangeRateView[], reportingCurrency: string, teams: TeamLookup[]): RealDataset {
  const sameCurrency = reportingCurrency === 'USD';
  const usableRates = rates.filter((r) => r.currency === reportingCurrency && r.rate > 0);
  const usingUsdFallback = !sameCurrency && usableRates.length === 0;
  const records = usage.records.map((r): RealRecord => {
    const localDate = toLocalDate(r.timestamp);
    const rate = sameCurrency || usingUsdFallback ? null : rateFor(localDate.slice(0, 7), usableRates);
    const person = usage.people[r.principal.id];
    const team = teams.find((t) => t.id === r.teamId);
    const estimatedCost = r.estimatedCostUsd === null ? null : rate === null ? r.estimatedCostUsd : r.estimatedCostUsd * rate;
    return {
      id: r.id,
      timestamp: r.timestamp,
      principal: r.principal,
      teamId: r.teamId,
      teamCode: r.teamCode,
      providerId: r.providerId,
      modelId: r.modelId,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      requestStatus: r.requestStatus,
      costStatus: r.costStatus,
      estimatedCost,
      estimatedCostUsd: r.estimatedCostUsd,
      exchangeRate: rate,
      pricingVersionId: r.priceVersion,
      principalName: person?.name || person?.email || 'Unknown person',
      principalEmail: person?.email ?? null,
      teamName: team?.name ?? r.teamCode,
      modelName: modelDisplayName(r.modelId),
      providerName: providerName(r.providerId),
      localDate,
      cacheWriteTokens: r.cacheWriteTokens,
      cacheReadTokens: r.cacheReadTokens,
      keyId: r.keyId,
      providerStatus: r.providerStatus,
      latencyMs: r.latencyMs,
      stream: r.stream,
    };
  });
  return {
    month: usage.month,
    records,
    money: { currency: sameCurrency || usingUsdFallback ? 'USD' : reportingCurrency, usingUsdFallback, reportingCurrency },
    truncated: usage.truncated,
    skipped: usage.skipped,
  };
}

/** The current month in the reporting timezone, and the eleven before it, newest first. */
export function recentMonths(now = new Date(), count = 12): string[] {
  const current = toLocalDate(now.toISOString()).slice(0, 7);
  let [y, m] = current.split('-').map(Number);
  const months: string[] = [];
  for (let i = 0; i < count; i++) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return months;
}

export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
