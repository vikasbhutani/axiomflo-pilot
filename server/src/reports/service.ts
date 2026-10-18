/**
 * Read access to usage records, and the monthly exchange rates used to show USD
 * estimates in the company's reporting currency.
 *
 * Scoping (decided on the server, never by the browser):
 * - Company Admin: every request in the company.
 * - Individual User: only their own requests.
 */
import type { Role } from '../membership/records.js';

export interface UsageViewer {
  uid: string;
  role: Role;
}

/** One usage record as clients see it. Prompts and answers never existed in it. */
export interface UsageView {
  id: string;
  timestamp: string;
  principal: { type: 'user'; id: string };
  keyId: string;
  teamId: string;
  teamCode: string;
  providerId: 'anthropic' | 'gemini_vertex';
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheWriteTokens: number | null;
  cacheReadTokens: number | null;
  requestStatus: 'succeeded' | 'failed';
  providerStatus: number | null;
  costStatus: 'reconciled' | 'estimated' | 'unavailable';
  estimatedCostUsd: number | null;
  priceVersion: string | null;
  stream: boolean;
  latencyMs: number | null;
}

export interface PersonView {
  name: string | null;
  email: string | null;
}

export interface UsageResult {
  records: UsageView[];
  /** Display names for the people in `records`, by uid. */
  people: Record<string, PersonView>;
  /** True when there were more records than one response returns. */
  truncated: boolean;
  /** Stored records that couldn't be read and were left out (logged on the server). */
  skipped: number;
}

export interface ExchangeRateView {
  /** Reporting month, YYYY-MM. */
  month: string;
  /** Units of the reporting currency per 1 USD. */
  rate: number;
  currency: string;
  setBy: string | null;
  setAt: string | null;
}

export interface UsageService {
  listUsage(companyId: string, viewer: UsageViewer, range: { startIso: string; endIso: string }): Promise<UsageResult>;
  listRates(companyId: string): Promise<ExchangeRateView[]>;
  setRate(companyId: string, actorUid: string, month: string, rate: number, currency: string): Promise<ExchangeRateView>;
}

/** Most records one response returns. Pilot volumes are far below this. */
export const MAX_USAGE_RECORDS = 20_000;
