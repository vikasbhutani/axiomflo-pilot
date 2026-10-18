/**
 * AxiomFlo key routes, for any active member.
 *
 *   GET  /api/keys              your keys (admins: every key in the company)
 *   POST /api/keys              create a key for one of your teams; the secret is returned once
 *   POST /api/keys/:id/revoke   revoke your key (admins: any key)
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { ApiError } from '../http/errors.js';
import type { Logger } from '../http/logger.js';
import { rateLimit } from '../http/rateLimit.js';
import type { KeyActor, KeyService } from '../keys/service.js';
import { parseKeyId, parseNewKey } from '../keys/validation.js';
import { InvalidRecordError } from '../membership/records.js';
import { getMember } from '../membership/requireMember.js';

const MINUTE = 60_000;

export function keysRouter({
  authenticate,
  requireMember,
  keys,
  companyId,
  logger,
}: {
  authenticate: RequestHandler;
  requireMember: RequestHandler;
  keys: KeyService;
  companyId: string;
  logger: Logger;
}): Router {
  const router = Router();
  const member = [authenticate, requireMember];
  const actor = (res: Response): KeyActor => {
    const { membership } = getMember(res.locals);
    return { uid: membership.uid, role: membership.role, teamIds: membership.teamIds };
  };
  const writeLimit = rateLimit({ name: 'key-write', limit: 10, windowMs: MINUTE, key: (locals) => getMember(locals).membership.uid });

  const run = (work: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = await work(req, res);
      // Responses that may carry a secret must never be cached anywhere.
      res.set('Cache-Control', 'no-store');
      res.json(body);
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      if (error instanceof InvalidRecordError) {
        logger.error('invalid record', { requestId: res.locals.requestId, path: error.path, field: error.field });
        return next(new ApiError(500, 'internal', 'A stored record has a problem.'));
      }
      logger.error('key operation failed', { requestId: res.locals.requestId, errorName: (error as Error)?.name, code: (error as { code?: unknown })?.code });
      return next(new ApiError(503, 'membership_unavailable', 'We couldn’t complete that just now. Please try again.'));
    }
  };

  router.get('/api/keys', ...member, run(async (_req, res) => ({ keys: await keys.listKeys(companyId, actor(res)) })));

  router.post(
    '/api/keys',
    ...member,
    writeLimit,
    run(async (req, res) => {
      const created = await keys.createKey(companyId, actor(res), parseNewKey(req.body));
      res.status(201);
      return created;
    }),
  );

  router.post('/api/keys/:id/revoke', ...member, writeLimit, run(async (req, res) => ({ key: await keys.revokeKey(companyId, actor(res), parseKeyId(req.params.id)) })));

  return router;
}
