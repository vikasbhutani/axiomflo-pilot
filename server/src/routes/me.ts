/**
 * GET /api/me: who the verified caller is, and their access to the pilot company.
 *
 * Unknown people get `access: "pending"`, never a made-up membership. Company,
 * role and teams are only included when access is active. A database failure is a
 * 503 error, not "pending".
 *
 * Example (active):
 *   { "user": { "uid", "email", "emailVerified", "displayName" },
 *     "access": "active",
 *     "company": { "id", "name", "reportingCurrency", "reportingTimezone" },
 *     "membership": { "role": "company_admin", "teamIds": ["..."] },
 *     "teams": [{ "id", "name", "code", "departmentId" }] }
 *
 * Example (pending):  { "user": {...}, "access": "pending", "reason": "no_membership" }
 */
import { Router, type RequestHandler } from 'express';
import { getIdentity } from '../auth/authenticate.js';
import type { Logger } from '../http/logger.js';
import { decideAccess } from '../membership/access.js';
import { accessError } from '../membership/requireMember.js';
import type { MembershipStore } from '../membership/store.js';
import { companyView, teamView } from './views.js';

export function meRouter({ authenticate, store, companyId, logger }: { authenticate: RequestHandler; store: MembershipStore; companyId: string; logger: Logger }): Router {
  const router = Router();
  router.get('/api/me', authenticate, async (_req, res, next) => {
    const identity = getIdentity(res.locals);
    const user = { uid: identity.uid, email: identity.email, emailVerified: identity.emailVerified, displayName: identity.displayName };
    let decision;
    try {
      decision = await decideAccess(identity, store, companyId);
    } catch (error) {
      return next(accessError(error, logger, res.locals.requestId));
    }
    if (decision.access !== 'active') {
      res.json({ user, access: decision.access, reason: decision.reason });
      return;
    }
    res.json({
      user,
      access: 'active',
      company: companyView(decision.company),
      membership: { role: decision.membership.role, teamIds: decision.membership.teamIds },
      teams: decision.teams.map(teamView),
    });
  });
  return router;
}
