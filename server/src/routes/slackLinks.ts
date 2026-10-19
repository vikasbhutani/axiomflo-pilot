/**
 * Linking Slack accounts to AxiomFlo members, for active members.
 *
 *   GET    /api/slack/link?code=…   who a link code is for, before confirming
 *   POST   /api/slack/link          { code }  link your Slack account (emails must match)
 *   GET    /api/slack/links         admins: every linked Slack account; others: their own
 *   DELETE /api/slack/links/:id     unlink (admins: any; others: their own)
 *
 * The code comes from a private message the Slack bot sent. The AxiomFlo side of the
 * link is always the verified caller; nothing in the request can name another member.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { getIdentity } from '../auth/authenticate.js';
import { ApiError } from '../http/errors.js';
import type { Logger } from '../http/logger.js';
import { rateLimit } from '../http/rateLimit.js';
import { getMember } from '../membership/requireMember.js';
import { LinkRejectedError, sameEmail, type SlackLinkService } from '../slack/links.js';

const bad = (message: string) => new ApiError(400, 'bad_request', message);

function parseCode(value: unknown): string {
  if (typeof value !== 'string' || value.length < 20 || value.length > 100) throw bad('This Slack link isn’t valid. Message the AxiomFlo bot in Slack to get a new one.');
  return value;
}

export function slackLinksRouter({ authenticate, requireMember, links, companyId, logger }: { authenticate: RequestHandler; requireMember: RequestHandler; links: SlackLinkService; companyId: string; logger: Logger }): Router {
  const router = Router();
  const member = [authenticate, requireMember];
  const limit = rateLimit({ name: 'slack-link', limit: 20, windowMs: 60_000, key: (locals) => getMember(locals).membership.uid });

  const run = (work: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await work(req, res));
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      if (error instanceof LinkRejectedError) return next(error.reason === 'not_found' ? new ApiError(404, 'not_found', error.message) : bad(error.message));
      logger.error('slack link request failed', { requestId: res.locals.requestId, errorName: (error as Error)?.name, code: (error as { code?: unknown })?.code });
      return next(new ApiError(503, 'membership_unavailable', 'We couldn’t reach the database just now. Please try again.'));
    }
  };

  router.get(
    '/api/slack/link',
    ...member,
    limit,
    run(async (req, res) => {
      const pending = await links.peekCode(companyId, parseCode(req.query.code));
      const identity = getIdentity(res.locals);
      return { slackName: pending.slackName, emailMatches: identity.emailVerified && sameEmail(pending.slackEmail, identity.email) };
    }),
  );

  router.post(
    '/api/slack/link',
    ...member,
    limit,
    run(async (req, res) => {
      const body = req.body as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object' || Object.keys(body).some((k) => k !== 'code')) throw bad('Send { "code": "..." }.');
      const identity = getIdentity(res.locals);
      const link = await links.redeemCode(companyId, parseCode(body.code), { uid: getMember(res.locals).membership.uid, email: identity.email, emailVerified: identity.emailVerified });
      return { link };
    }),
  );

  router.get(
    '/api/slack/links',
    ...member,
    run(async (_req, res) => {
      const { membership } = getMember(res.locals);
      return { links: await links.listLinks(companyId, { uid: membership.uid, role: membership.role }) };
    }),
  );

  router.delete(
    '/api/slack/links/:id',
    ...member,
    limit,
    run(async (req, res) => {
      const { membership } = getMember(res.locals);
      await links.deleteLink(companyId, { uid: membership.uid, role: membership.role }, String(req.params.id));
      return { deleted: true };
    }),
  );

  return router;
}
