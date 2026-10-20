/**
 * Upgrade Analysis on real data, through the AxiomFlo API. The API reads the usage,
 * checks the scope and runs the estimate; the browser only sends the choices.
 */
import type { ApiClient } from '../auth/api';
import type { SavedUpgradeAnalysis, UpgradeEstimateRequest, UpgradeEstimateResponse, UpgradeExportResponse, UpgradeModelsResponse, UpgradeSavedResponse } from '../lib/upgrade';
import { UpgradeClientError, type UpgradeAnalysisClient } from '../services/upgradeAnalysisService';

async function call<T>(api: ApiClient, path: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  const response = await api.fetch(path, { ...init, headers });
  const body = (await response.json().catch(() => null)) as { error?: { message?: unknown } } | null;
  if (!response.ok) {
    const message = typeof body?.error?.message === 'string' ? body.error.message : '';
    // The API writes 4xx messages for people; other server errors stay generic.
    if (response.status < 500 && message) throw new UpgradeClientError(message, response.status);
    if (response.status === 429) throw new UpgradeClientError('Too many requests in a short time. Please wait a minute and try again.', 429);
    throw new UpgradeClientError('The analysis couldn’t be run just now. Please try again.', response.status);
  }
  return body as T;
}

export function createUpgradeApi(api: ApiClient): UpgradeAnalysisClient {
  const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
  return {
    models: () => call<UpgradeModelsResponse>(api, '/api/upgrade-analysis/models'),
    estimate: async (request: UpgradeEstimateRequest) => (await call<UpgradeEstimateResponse>(api, '/api/upgrade-analysis/estimate', post(request))).analysis,
    save: async (request, { title, idempotencyKey }): Promise<SavedUpgradeAnalysis> =>
      (await call<UpgradeSavedResponse>(api, '/api/upgrade-analysis/save', post(title ? { request, title } : { request }), idempotencyKey)).saved,
    get: async (id) => (await call<UpgradeSavedResponse>(api, `/api/upgrade-analysis/${encodeURIComponent(id)}`)).saved,
    exportReport: (id, format, key) => call<UpgradeExportResponse>(api, `/api/upgrade-analysis/${encodeURIComponent(id)}/export`, post({ format }), key),
  };
}
