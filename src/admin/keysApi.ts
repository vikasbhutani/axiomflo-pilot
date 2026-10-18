/**
 * AxiomFlo keys: what people put in their AI tools to send requests through the
 * AxiomFlo gateway. The API decides who sees which keys; the browser never sends an
 * owner, only a name and one of the person's teams.
 */
import type { ApiClient } from '../auth/api';
import { call } from './adminApi';

export interface KeyView {
  id: string;
  name: string;
  ownerUid: string;
  ownerEmail: string | null;
  teamId: string;
  status: 'active' | 'revoked';
  hint: string;
  createdAt: string | null;
  revokedAt: string | null;
}

export function createKeysApi(api: ApiClient) {
  return {
    listKeys: async () => (await call<{ keys: KeyView[] }>(api, '/api/keys')).keys,
    createKey: (input: { name: string; teamId: string }) => call<{ key: KeyView; secret: string }>(api, '/api/keys', { method: 'POST', body: JSON.stringify(input) }),
    revokeKey: async (id: string) => (await call<{ key: KeyView }>(api, `/api/keys/${encodeURIComponent(id)}/revoke`, { method: 'POST' })).key,
  };
}

export type KeysApi = ReturnType<typeof createKeysApi>;
