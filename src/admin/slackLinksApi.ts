/**
 * Linking Slack accounts to AxiomFlo. The API links the signed-in person only, and only
 * when their sign-in email matches their Slack profile's email.
 */
import type { ApiClient } from '../auth/api';
import { call } from './adminApi';

export interface SlackLinkView {
  id: string;
  uid: string;
  slackTeamId: string;
  slackUserId: string;
  slackName: string | null;
  linkedAt: string | null;
}

export function createSlackLinksApi(api: ApiClient) {
  return {
    peek: (code: string) => call<{ slackName: string | null; emailMatches: boolean }>(api, `/api/slack/link?code=${encodeURIComponent(code)}`),
    link: async (code: string) => (await call<{ link: SlackLinkView }>(api, '/api/slack/link', { method: 'POST', body: JSON.stringify({ code }) })).link,
    list: async () => (await call<{ links: SlackLinkView[] }>(api, '/api/slack/links')).links,
    unlink: (id: string) => call<{ deleted: boolean }>(api, `/api/slack/links/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}
