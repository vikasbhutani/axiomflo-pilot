/**
 * Answers one Slack question for one Slack user.
 *
 * Who is asking comes only from Slack's signed request (team and user ID) and the link
 * that person made in AxiomFlo. The membership is then checked exactly as for the web
 * app, on every question, so a suspension applies immediately. The agent gets the same
 * trusted context and usage snapshot it would get from the web app.
 */
import { randomUUID } from 'node:crypto';
import { AgentUnavailableError, type AgentClient } from '../assistant/agentClient.js';
import { buildSnapshot } from '../assistant/snapshot.js';
import type { Logger } from '../http/logger.js';
import { decideAccess } from '../membership/access.js';
import type { MembershipStore } from '../membership/store.js';
import { currentMonth, monthsEndingWith } from '../reports/months.js';
import type { UsageService } from '../reports/service.js';
import { ASK_MONTHS, contextFor, MAX_QUESTION_CHARS } from '../routes/assistant.js';
import { answerMessage, linkPromptMessage, plain } from './format.js';
import type { SlackLinkService } from './links.js';
import type { SlackApi, SlackMessage } from './slackApi.js';

export interface DirectoryUser {
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  disabled: boolean;
}

/** Looks people up in Firebase Authentication. */
export interface UserDirectory {
  get(uid: string): Promise<DirectoryUser | null>;
}

export interface SlackQuestion {
  teamId: string;
  userId: string;
  text: string;
  reply: (message: SlackMessage) => Promise<void>;
}

export interface SlackDeps {
  companyId: string;
  allowedTeamId: string;
  webAppUrl: string;
  store: MembershipStore;
  usage: UsageService;
  agent: AgentClient;
  links: SlackLinkService;
  slack: SlackApi;
  users: UserDirectory;
  logger: Logger;
  now?: () => Date;
}

const SESSION_TTL_MS = 30 * 60_000;

export const HELP_TEXT =
  'Ask me about AI spend, for example "What did my team spend this month?" or "How can we lower our AI spend?". I answer privately, from the same figures as the AxiomFlo web app.';

export function createSlackResponder(deps: SlackDeps) {
  const { companyId, logger } = deps;
  const now = deps.now ?? (() => new Date());
  // Follow-up questions continue the same conversation for half an hour.
  const sessions = new Map<string, { sessionId: string; at: number }>();

  function sessionFor(key: string): string | undefined {
    const s = sessions.get(key);
    if (!s || now().getTime() - s.at > SESSION_TTL_MS) return undefined;
    return s.sessionId;
  }

  return async function answer(q: SlackQuestion): Promise<void> {
    const requestId = randomUUID();
    const key = `${q.teamId}:${q.userId}`;
    const reply = (m: SlackMessage) => q.reply(m).catch((error) => logger.warn('slack reply failed', { requestId, errorName: (error as Error)?.name, slackError: (error as { slackError?: string })?.slackError }));

    if (q.teamId !== deps.allowedTeamId) {
      logger.warn('slack request from another workspace', { requestId });
      return reply(plain('This AxiomFlo bot only works in its own Slack workspace.'));
    }

    try {
      const uid = await deps.links.findUid(companyId, { teamId: q.teamId, userId: q.userId });
      if (!uid) {
        const profile = await deps.slack.userProfile(q.userId);
        if (profile.isBot || profile.deleted) return;
        const code = await deps.links.createCode(companyId, { slackTeamId: q.teamId, slackUserId: q.userId, slackName: profile.name, slackEmail: profile.email });
        return reply(linkPromptMessage(`${deps.webAppUrl}/slack/link?code=${encodeURIComponent(code)}`));
      }

      const user = await deps.users.get(uid);
      if (!user || user.disabled) return reply(plain('Your AxiomFlo account isn’t active, so I can’t show any figures. Ask your Company Admin.'));
      const decision = await decideAccess({ uid, email: user.email, emailVerified: user.emailVerified, displayName: user.displayName, signInProvider: 'slack' }, deps.store, companyId);
      if (decision.access !== 'active') return reply(plain('You don’t have access to this AxiomFlo workspace right now, so I can’t show any figures. Ask your Company Admin.'));

      const question = q.text.trim();
      if (!question || /^help$/i.test(question)) return reply(plain(HELP_TEXT));
      if (question.length > MAX_QUESTION_CHARS) return reply(plain(`Please keep questions under ${MAX_QUESTION_CHARS} characters.`));

      const current = currentMonth(decision.company.reportingTimezone, now());
      const snapshot = await buildSnapshot({ member: decision, identity: user, usage: deps.usage, companyId, months: monthsEndingWith(current, ASK_MONTHS), currentMonth: current, now: now() });
      const result = await deps.agent.ask({ context: contextFor(decision, companyId, 'slack', 'slack_signature_and_linked_account'), question, sessionId: sessionFor(key), snapshot }, requestId);
      if (result.sessionId) sessions.set(key, { sessionId: result.sessionId, at: now().getTime() });
      if (sessions.size > 5_000) for (const [k, s] of sessions) if (now().getTime() - s.at > SESSION_TTL_MS) sessions.delete(k);
      logger.info('slack question answered', { requestId, status: result.status });
      return reply(answerMessage(result));
    } catch (error) {
      if (error instanceof AgentUnavailableError) {
        logger.warn('agent unavailable', { requestId, reason: error.reason });
        return reply(plain('The AxiomFlo assistant couldn’t be reached just now, so no answer was generated. Please try again in a minute.'));
      }
      logger.error('slack question failed', { requestId, errorName: (error as Error)?.name, code: (error as { code?: unknown })?.code });
      return reply(plain('Something went wrong looking that up, so no answer was generated. Please try again in a minute.'));
    }
  };
}
