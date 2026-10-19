/**
 * The few Slack Web API calls the bot makes, with its Bot Token (from Secret Manager).
 * https://api.slack.com/methods
 */
export interface SlackUserProfile {
  name: string | null;
  email: string | null;
  isBot: boolean;
  deleted: boolean;
}

export interface SlackMessage {
  text: string;
  blocks?: unknown[];
}

export interface SlackApi {
  postMessage(channel: string, message: SlackMessage, threadTs?: string): Promise<void>;
  postEphemeral(channel: string, user: string, message: SlackMessage, threadTs?: string): Promise<void>;
  /** Replies to a slash command through its response_url. */
  respond(responseUrl: string, message: SlackMessage): Promise<void>;
  userProfile(userId: string): Promise<SlackUserProfile>;
}

export class SlackApiError extends Error {
  constructor(readonly method: string, readonly slackError: string) {
    super(`Slack ${method} failed: ${slackError}`);
    this.name = 'SlackApiError';
  }
}

const RESPONSE_URL = /^https:\/\/hooks\.slack\.com\//;

export function createSlackApi({ botToken, fetchImpl = fetch, baseUrl = 'https://slack.com/api' }: { botToken: string; fetchImpl?: typeof fetch; baseUrl?: string }): SlackApi {
  async function call(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetchImpl(`${baseUrl}/${method}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${botToken}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.ok !== true) throw new SlackApiError(method, typeof json.error === 'string' ? json.error : `http_${res.status}`);
    return json;
  }
  return {
    async postMessage(channel, message, threadTs) {
      await call('chat.postMessage', { channel, ...message, ...(threadTs ? { thread_ts: threadTs } : {}), unfurl_links: false });
    },
    async postEphemeral(channel, user, message, threadTs) {
      await call('chat.postEphemeral', { channel, user, ...message, ...(threadTs ? { thread_ts: threadTs } : {}) });
    },
    async respond(responseUrl, message) {
      // Only ever post back to Slack's own hooks address.
      if (!RESPONSE_URL.test(responseUrl)) throw new SlackApiError('response_url', 'not_slack');
      const res = await fetchImpl(responseUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response_type: 'ephemeral', replace_original: true, ...message }), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new SlackApiError('response_url', `http_${res.status}`);
    },
    async userProfile(userId) {
      // users.info takes form fields rather than JSON.
      const res = await fetchImpl(`${baseUrl}/users.info`, {
        method: 'POST',
        headers: { authorization: `Bearer ${botToken}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ user: userId }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || json.ok !== true) throw new SlackApiError('users.info', typeof json.error === 'string' ? json.error : `http_${res.status}`);
      const user = (json.user ?? {}) as { real_name?: string; name?: string; is_bot?: boolean; deleted?: boolean; profile?: { email?: string; real_name?: string; display_name?: string } };
      return {
        name: user.profile?.real_name || user.real_name || user.profile?.display_name || user.name || null,
        email: user.profile?.email ?? null,
        isBot: user.is_bot === true,
        deleted: user.deleted === true,
      };
    },
  };
}
