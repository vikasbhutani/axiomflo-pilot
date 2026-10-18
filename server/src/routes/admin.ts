/**
 * Member and invitation routes.
 *
 *   GET   /api/members                  admin   members with email and name
 *   PATCH /api/members/:uid             admin   change role, teams or status (never your own)
 *   GET   /api/invitations              admin   invitations, newest first
 *   POST  /api/invitations              admin   invite an email address
 *   POST  /api/invitations/:id/revoke   admin   revoke a pending invitation
 *   POST  /api/invitations/accept       any verified, signed-in person: accept the
 *                                       invitation that matches their own email
 *
 * Invitations are created with "Created — email not sent": the pilot has no email
 * delivery, so the admin tells the person to sign in.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { getIdentity } from '../auth/authenticate.js';
import type { AdminService } from '../admin/service.js';
import { parseId, parseInvitationInput, parseMemberPatch } from '../admin/validation.js';
import { ApiError } from '../http/errors.js';
import type { Logger } from '../http/logger.js';
import { rateLimit } from '../http/rateLimit.js';
import { InvalidRecordError } from '../membership/records.js';
import { getMember, requireRole } from '../membership/requireMember.js';

const MINUTE = 60_000;

export function adminRouter({
  authenticate,
  requireMember,
  admin,
  companyId,
  logger,
}: {
  authenticate: RequestHandler;
  requireMember: RequestHandler;
  admin: AdminService;
  companyId: string;
  logger: Logger;
}): Router {
  const router = Router();
  const isAdmin = [authenticate, requireMember, requireRole('company_admin')];
  const byUser = (locals: Record<string, unknown>) => getIdentity(locals).uid;
  const writeLimit = rateLimit({ name: 'admin-write', limit: 30, windowMs: MINUTE, key: byUser });
  const acceptLimit = rateLimit({ name: 'accept', limit: 10, windowMs: MINUTE, key: byUser });

  /** ApiErrors pass through; anything else from Firestore or Auth is a 503, never success. */
  const run = (work: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await work(req, res));
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      if (error instanceof InvalidRecordError) {
        logger.error('invalid record', { requestId: res.locals.requestId, path: error.path, field: error.field });
        return next(new ApiError(500, 'internal', 'A stored record has a problem.'));
      }
      logger.error('admin operation failed', { requestId: res.locals.requestId, errorName: (error as Error)?.name, code: (error as { code?: unknown })?.code });
      return next(new ApiError(503, 'membership_unavailable', 'We couldn’t complete that just now. Please try again.'));
    }
  };

  router.get('/api/members', ...isAdmin, run(async () => ({ members: await admin.listMembers(companyId) })));

  router.patch(
    '/api/members/:uid',
    ...isAdmin,
    writeLimit,
    run(async (req, res) => {
      const uid = parseId(req.params.uid, 'member ID');
      const patch = parseMemberPatch(req.body);
      return { member: await admin.updateMember(companyId, getMember(res.locals).membership.uid, uid, patch) };
    }),
  );

  router.get('/api/invitations', ...isAdmin, run(async () => ({ invitations: await admin.listInvitations(companyId) })));

  router.post(
    '/api/invitations',
    ...isAdmin,
    writeLimit,
    run(async (req, res) => {
      const input = parseInvitationInput(req.body);
      const invitation = await admin.createInvitation(companyId, getMember(res.locals).membership.uid, input);
      res.status(201);
      return { invitation };
    }),
  );

  // Registered before /:id/revoke so "accept" is never read as an invitation ID. Any body is
  // ignored on purpose: role, teams and email come only from the invitation and the token.
  router.post('/api/invitations/accept', authenticate, acceptLimit, run(async (_req, res) => admin.acceptInvitation(companyId, getIdentity(res.locals))));

  router.post(
    '/api/invitations/:id/revoke',
    ...isAdmin,
    writeLimit,
    run(async (req, res) => ({ invitation: await admin.revokeInvitation(companyId, getMember(res.locals).membership.uid, parseId(req.params.id, 'invitation ID')) })),
  );

  return router;
}
