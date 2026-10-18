/**
 * Helper for calling the AxiomFlo API as the signed-in user.
 *
 * It attaches the user's Firebase ID token as an `Authorization: Bearer` header over
 * HTTPS. The token is never put in the URL, never stored by the app and never logged;
 * Firebase's SDK keeps and refreshes it.
 *
 * If the API answers 401 (for example the token expired a moment ago), the helper asks
 * Firebase for a fresh token and retries exactly once. A 403 is never retried: it means
 * the person is signed in but not allowed.
 *
 * This only proves WHO is calling. The API verifies the token with the Firebase Admin
 * SDK and checks the membership on every request.
 */

export class NotSignedInError extends Error {
  constructor() {
    super('You need to be signed in to do that.');
    this.name = 'NotSignedInError';
  }
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export interface ApiClient {
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

export function createApiClient({
  baseUrl,
  getIdToken,
  fetchImpl = (...args) => fetch(...args),
}: {
  baseUrl: string;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  fetchImpl?: typeof fetch;
}): ApiClient {
  return {
    async fetch(path, init = {}) {
      if (!path.startsWith('/') || path.startsWith('//')) throw new Error('API paths must start with a single "/".');
      const url = new URL(path, baseUrl);
      // Plain http is only allowed for a backend running on your own computer.
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost(url.hostname))) {
        throw new Error('The AxiomFlo API must be called over HTTPS.');
      }
      const send = async (forceRefresh: boolean) => {
        const token = await getIdToken(forceRefresh);
        if (!token) throw new NotSignedInError();
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${token}`);
        // No cookies: the token in the header is the only credential.
        return fetchImpl(url.toString(), { ...init, headers, credentials: 'omit' });
      };
      const first = await send(false);
      if (first.status !== 401) return first;
      return send(true);
    },
  };
}
