/**
 * Report data from the AxiomFlo API. The API decides what each person may see
 * (admins: everyone's requests; individual users: their own); the browser only asks
 * for a month.
 */
import type { ApiClient } from '../auth/api';
import { call } from '../admin/adminApi';

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

export interface UsageResponse {
  month: string;
  startIso: string;
  endIso: string;
  records: UsageView[];
  people: Record<string, { name: string | null; email: string | null }>;
  truncated: boolean;
  skipped: number;
}

export interface ExchangeRateView {
  month: string;
  rate: number;
  currency: string;
  setBy: string | null;
  setAt: string | null;
}

export function createReportsApi(api: ApiClient) {
  return {
    usage: (month: string) => call<UsageResponse>(api, `/api/usage?month=${encodeURIComponent(month)}`),
    rates: () => call<{ currency: string; rates: ExchangeRateView[] }>(api, '/api/exchange-rates'),
    setRate: async (month: string, rate: number) =>
      (await call<{ rate: ExchangeRateView }>(api, `/api/exchange-rates/${encodeURIComponent(month)}`, { method: 'PUT', body: JSON.stringify({ rate }) })).rate,
  };
}

export type ReportsApi = ReturnType<typeof createReportsApi>;
