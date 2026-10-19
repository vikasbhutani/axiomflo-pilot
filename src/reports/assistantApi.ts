/**
 * The AI Cost Assistant on real data, through the AxiomFlo API. The API decides who is
 * asking and what they may see; the browser only sends the question (or a month).
 */
import type { ApiClient } from '../auth/api';

export interface AssistantLink {
  label: string;
  url: string;
}

export interface AssistantAnswer {
  status: 'ok' | 'unavailable' | 'withheld' | 'invalid';
  text: string;
  sessionId: string | null;
  links: AssistantLink[];
}

export interface Suggestion {
  kind: string;
  title: string;
  detail: string;
  link?: AssistantLink;
}

export interface SuggestionsResult {
  status: 'ok' | 'error';
  suggestions?: Suggestion[];
  message?: string | null;
  reporting?: { currency: string; currency_notes?: string[] };
  error?: { code: string; message: string };
}

/** `notSetUp` means the assistant isn't deployed yet, as opposed to failing just now. */
export class AssistantError extends Error {
  constructor(
    message: string,
    readonly notSetUp: boolean,
  ) {
    super(message);
    this.name = 'AssistantError';
  }
}

async function call<T>(api: ApiClient, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await api.fetch(path, { ...init, headers });
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
  if (!response.ok) {
    const code = body?.error?.code;
    const message = typeof body?.error?.message === 'string' ? body.error.message : '';
    // The API writes these messages for people; other server errors stay generic.
    if (code === 'assistant_unavailable') throw new AssistantError(message, /isn’t set up/.test(message));
    if (response.status < 500 && message) throw new AssistantError(message, false);
    if (response.status === 429) throw new AssistantError('Too many questions in a short time. Please wait a minute and try again.', false);
    throw new AssistantError('The assistant couldn’t answer just now. Please try again.', false);
  }
  return body as T;
}

/**
 * Links from the agent point at this web app. Keep only the path, so they open in place
 * and can never send someone to another site.
 */
export function inAppPath(url: string): string | null {
  try {
    const u = new URL(url, window.location.origin);
    return u.pathname.startsWith('/') && !u.pathname.startsWith('//') ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}

export function createAssistantApi(api: ApiClient) {
  return {
    ask: (question: string, sessionId: string | null) =>
      call<AssistantAnswer>(api, '/api/assistant/ask', { method: 'POST', body: JSON.stringify(sessionId ? { question, sessionId } : { question }) }),
    suggestions: (month: string) => call<SuggestionsResult>(api, `/api/assistant/suggestions?month=${encodeURIComponent(month)}`),
  };
}
