/**
 * Access tokens for Vertex AI, from Application Default Credentials: the gateway's
 * runtime service account on Cloud Run, your own Google sign-in locally. No key file.
 * Tokens are kept in memory until shortly before they expire, and never logged.
 */
import type { Credential } from 'firebase-admin/app';
import type { TokenSource } from './vertex.js';

export function credentialTokenSource(credential: Credential, now = () => Date.now()): TokenSource {
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;
  return {
    async token() {
      if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
      pending ??= credential
        .getAccessToken()
        .then((t) => {
          cached = { token: t.access_token, expiresAt: now() + t.expires_in * 1000 };
          return t.access_token;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}
