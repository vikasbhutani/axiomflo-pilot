/**
 * Calls the private AxiomFlo Agent service (Cloud Run service `axiomflo-agent`).
 *
 * On Cloud Run the agent only accepts callers with the Cloud Run Invoker role, so each
 * call carries a Google ID token for the API's own service account, fetched from the
 * metadata server (no key file). Locally, an http://localhost agent is called without one.
 *
 * Nothing here decides who may see what: the routes send only the trusted context and
 * the records the verified member may see.
 */
import type { UsageSnapshot } from './snapshot.js';

export interface TrustedContextView {
  tenantId: string;
  userId: string;
  role: 'company_admin' | 'individual_user';
  teamIds: string[];
  channel: 'web' | 'slack';
  verifiedBy: string;
}

export interface AgentAnswer {
  status: 'ok' | 'unavailable' | 'withheld' | 'invalid';
  text: string;
  requestId: string;
  sessionId: string | null;
  links: { label: string; url: string }[];
  toolsCalled: string[];
}

export interface AgentClient {
  ask(input: { context: TrustedContextView; question: string; sessionId?: string; snapshot: UsageSnapshot }, requestId: string): Promise<AgentAnswer>;
  suggestions(input: { context: TrustedContextView; period: string; team?: string; snapshot: UsageSnapshot }, requestId: string): Promise<Record<string, unknown>>;
}

/** The agent couldn't be reached, timed out, or failed. Shown as "unavailable", never as an answer. */
export class AgentUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`agent unavailable: ${reason}`);
    this.name = 'AgentUnavailableError';
  }
}

export type IdTokenSource = () => Promise<string | null>;

const METADATA_IDENTITY = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';

/** Google ID tokens for `audience`, cached until shortly before they expire (they last an hour). */
export function metadataIdTokenSource(audience: string, fetchImpl: typeof fetch = fetch, now = () => Date.now()): IdTokenSource {
  let cached: { token: string; expiresAt: number } | null = null;
  return async () => {
    if (cached && cached.expiresAt > now()) return cached.token;
    const res = await fetchImpl(`${METADATA_IDENTITY}?audience=${encodeURIComponent(audience)}&format=full`, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!res.ok) throw new AgentUnavailableError(`identity token ${res.status}`);
    const token = (await res.text()).trim();
    cached = { token, expiresAt: now() + 50 * 60_000 };
    return token;
  };
}

export function createHttpAgentClient({ url, idToken, fetchImpl = fetch, timeoutMs = 90_000 }: { url: string; idToken: IdTokenSource; fetchImpl?: typeof fetch; timeoutMs?: number }): AgentClient {
  async function post<T>(path: string, body: unknown, requestId: string): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-request-id': requestId };
    const token = await idToken();
    if (token) headers.authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetchImpl(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    } catch (error) {
      throw new AgentUnavailableError((error as Error)?.name === 'TimeoutError' ? 'timeout' : 'network');
    }
    if (!res.ok) throw new AgentUnavailableError(`status ${res.status}`);
    return (await res.json()) as T;
  }
  return {
    ask: (input, requestId) => post<AgentAnswer>('/v1/ask', input, requestId),
    suggestions: (input, requestId) => post<Record<string, unknown>>('/v1/suggestions', input, requestId),
  };
}

/** The agent for this config: none when AGENT_URL isn't set, no ID token for a localhost agent. */
export function agentClientFor(agentUrl: string | null): AgentClient | null {
  if (!agentUrl) return null;
  const local = new URL(agentUrl).protocol === 'http:';
  return createHttpAgentClient({ url: agentUrl, idToken: local ? async () => null : metadataIdTokenSource(agentUrl) });
}
