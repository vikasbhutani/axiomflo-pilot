/**
 * The AI Cost Assistant, for active members.
 *
 *   POST /api/assistant/ask           { question, sessionId? }  ask about the last three months
 *   GET  /api/assistant/suggestions   ?month=YYYY-MM            savings suggestions (no AI model)
 *
 * Each request re-checks the membership, then sends the agent the verified context and
 * the records this member may see (assistant/snapshot.ts). Nothing in the request body
 * can change who the agent thinks is asking.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { AgentUnavailableError, type AgentClient, type TrustedContextView } from '../assistant/agentClient.js';
import { buildSnapshot } from '../assistant/snapshot.js';
import { getIdentity } from '../auth/authenticate.js';
import { ApiError } from '../http/errors.js';
import type { Logger } from '../http/logger.js';
import { rateLimit } from '../http/rateLimit.js';
import { getMember, type ActiveMember } from '../membership/requireMember.js';
import { currentMonth, monthsEndingWith } from '../reports/months.js';
import type { UsageService } from '../reports/service.js';
import { parseMonth } from '../reports/validation.js';

export const MAX_QUESTION_CHARS = 2000;
/** Months a question can be about: the current one and the two before it. */
export const ASK_MONTHS = 3;
const SESSION_ID = /^s_[0-9a-f]{32}$/;

const bad = (message: string) => new ApiError(400, 'bad_request', message);
const notSetUp = () => new ApiError(503, 'assistant_unavailable', 'The AI Cost Assistant isn’t set up yet. A Company Admin can follow docs/agent/deploy.md.');
const unreachable = () => new ApiError(503, 'assistant_unavailable', 'The AI Cost Assistant couldn’t be reached just now, so no answer was generated. Please try again.');

export function contextFor(member: ActiveMember, companyId: string, channel: TrustedContextView['channel'], verifiedBy: string): TrustedContextView {
  return { tenantId: companyId, userId: member.membership.uid, role: member.membership.role, teamIds: [...member.membership.teamIds], channel, verifiedBy };
}

function parseAsk(body: unknown): { question: string; sessionId?: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw bad('Send { "question": "..." }.');
  const { question, sessionId, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw bad('Only "question" and "sessionId" can be sent.');
  if (typeof question !== 'string' || !question.trim()) throw bad('Please type a question.');
  if (question.length > MAX_QUESTION_CHARS) throw bad(`Please keep questions under ${MAX_QUESTION_CHARS} characters.`);
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId))) throw bad('sessionId is not valid.');
  return { question: question.trim(), sessionId: sessionId as string | undefined };
}

export function assistantRouter({ authenticate, requireMember, usage, agent, companyId, logger, now = () => new Date() }: { authenticate: RequestHandler; requireMember: RequestHandler; usage: UsageService; agent: AgentClient | null; companyId: string; logger: Logger; now?: () => Date }): Router {
  const router = Router();
  const member = [authenticate, requireMember];
  const perUser = (name: string, limit: number) => rateLimit({ name, limit, windowMs: 60_000, key: (locals) => getMember(locals).membership.uid });

  const run = (work: (req: Request, res: Response, agent: AgentClient) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    if (!agent) return next(notSetUp());
    try {
      res.json(await work(req, res, agent));
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      if (error instanceof AgentUnavailableError) {
        logger.warn('agent unavailable', { requestId: res.locals.requestId, reason: error.reason });
        return next(unreachable());
      }
      logger.error('assistant request failed', { requestId: res.locals.requestId, errorName: (error as Error)?.name, code: (error as { code?: unknown })?.code });
      return next(new ApiError(503, 'membership_unavailable', 'We couldn’t load your usage just now. Please try again.'));
    }
  };

  const snapshotFor = (res: Response, months: string[], current: string) =>
    buildSnapshot({ member: getMember(res.locals), identity: getIdentity(res.locals), usage, companyId, months, currentMonth: current, now: now() });

  router.post(
    '/api/assistant/ask',
    ...member,
    perUser('assistant-ask', 20),
    run(async (req, res, agent) => {
      const { question, sessionId } = parseAsk(req.body);
      const m = getMember(res.locals);
      const current = currentMonth(m.company.reportingTimezone, now());
      const snapshot = await snapshotFor(res, monthsEndingWith(current, ASK_MONTHS), current);
      const answer = await agent.ask({ context: contextFor(m, companyId, 'web', 'firebase_id_token'), question, sessionId, snapshot }, res.locals.requestId);
      return { status: answer.status, text: answer.text, sessionId: answer.sessionId, links: answer.links };
    }),
  );

  router.get(
    '/api/assistant/suggestions',
    ...member,
    perUser('assistant-suggestions', 30),
    run(async (req, res, agent) => {
      const m = getMember(res.locals);
      const current = currentMonth(m.company.reportingTimezone, now());
      const month = req.query.month === undefined ? current : parseMonth(req.query.month);
      // The month and the one before it, so spend jumps can be spotted.
      const snapshot = await snapshotFor(res, monthsEndingWith(month, 2), current);
      return agent.suggestions({ context: contextFor(m, companyId, 'web', 'firebase_id_token'), period: month, snapshot }, res.locals.requestId);
    }),
  );

  return router;
}
