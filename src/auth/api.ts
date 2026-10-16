/**
 * Helper for calling the future AxiomFlo backend as the signed-in user.
 *
 * It attaches the user's Firebase ID token as an `Authorization: Bearer` header over
 * HTTPS. The token is never put in the URL and never logged.
 *
 * This only proves WHO is calling. The backend must still verify the token with the
 * Firebase Admin SDK and check company/team membership on every protected request;
 * that backend does not exist yet.
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

export function createApiClient({ baseUrl, getIdToken, fetchImpl = (...args) => fetch(...args) }: { baseUrl: string; getIdToken: () => Promise<string | null>; fetchImpl?: typeof fetch }): ApiClient {
  return {
    async fetch(path, init = {}) {
      if (!path.startsWith('/') || path.startsWith('//')) throw new Error('API paths must start with a single "/".');
      const url = new URL(path, baseUrl);
      // Plain http is only allowed for a backend running on your own computer.
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost(url.hostname))) {
        throw new Error('The AxiomFlo API must be called over HTTPS.');
      }
      const token = await getIdToken();
      if (!token) throw new NotSignedInError();
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return fetchImpl(url.toString(), { ...init, headers });
    },
  };
}
