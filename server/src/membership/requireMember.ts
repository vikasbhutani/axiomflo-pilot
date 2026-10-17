/**
 * Route guards for workspace data. They re-check the membership in Firestore on
 * EVERY request (no caching), so a suspension or role change applies immediately,
 * whatever the browser still has in memory.
 *
 *   403  signed in, but not an active member (or not the required role)
 *   503  membership database unavailable
 */
import type { RequestHandler } from 'express';
import { getIdentity } from '../auth/authenticate.js';
import { ApiError } from '../http/errors.js';
import type { Logger } from '../http/logger.js';
import { decideAccess, MembershipUnavailableError, type AccessDecision } from './access.js';
import { InvalidRecordError, type Role } from './records.js';
import type { MembershipStore } from './store.js';

export type ActiveMember = Extract<AccessDecision, { access: 'active' }>;

export function getMember(locals: Record<string, unknown>): ActiveMember {
  const member = locals.member as ActiveMember | undefined;
  if (!member) throw new Error('requireActiveMember() must run before this handler');
  return member;
}

/** Turns lookup failures into safe API errors. Shared with /api/me. */
export function accessError(error: unknown, logger: Logger, requestId: string): ApiError {
  if (error instanceof MembershipUnavailableError) {
    logger.error('membership lookup failed', { requestId });
    return new ApiError(503, 'membership_unavailable', 'We couldn’t check your AxiomFlo access just now. Please try again.');
  }
  if (error instanceof InvalidRecordError) {
    logger.error('invalid membership data', { requestId, path: error.path, field: error.field });
    return new ApiError(500, 'internal', 'Your AxiomFlo access record has a problem. Contact your administrator.');
  }
  throw error;
}

export function requireActiveMember({ store, companyId, logger }: { store: MembershipStore; companyId: string; logger: Logger }): RequestHandler {
  return async (_req, res, next) => {
    let decision: AccessDecision;
    try {
      decision = await decideAccess(getIdentity(res.locals), store, companyId);
    } catch (error) {
      return next(accessError(error, logger, res.locals.requestId));
    }
    if (decision.access !== 'active') {
      return next(new ApiError(403, 'forbidden', 'You don’t have access to this AxiomFlo workspace.'));
    }
    res.locals.member = decision;
    return next();
  };
}

export function requireRole(role: Role): RequestHandler {
  return (_req, res, next) => {
    if (getMember(res.locals).membership.role !== role) {
      return next(new ApiError(403, 'forbidden', 'You don’t have permission to do that.'));
    }
    return next();
  };
}
