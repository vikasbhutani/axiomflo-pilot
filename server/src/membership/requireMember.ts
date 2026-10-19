/**
 * Route guards for workspace data. They re-check the membership in Firestore on
 * EVERY request (no caching), so a suspension or role change applies immediately,
 * whatever the browser still has in memory.
 *
 *   403  signed in, but not an active member (or not the required role), or a
 *        read-only member trying to change something
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

/** The only non-GET request a read-only member may make: asking the assistant changes nothing. */
const READ_ONLY_ALLOWED = new Set(['POST /api/assistant/ask']);

function isReadRequest(method: string, path: string): boolean {
  return method === 'GET' || method === 'HEAD' || READ_ONLY_ALLOWED.has(`${method} ${path}`);
}

export function requireActiveMember({ store, companyId, logger }: { store: MembershipStore; companyId: string; logger: Logger }): RequestHandler {
  return async (req, res, next) => {
    let decision: AccessDecision;
    try {
      decision = await decideAccess(getIdentity(res.locals), store, companyId);
    } catch (error) {
      return next(accessError(error, logger, res.locals.requestId));
    }
    if (decision.access !== 'active') {
      return next(new ApiError(403, 'forbidden', 'You don’t have access to this AxiomFlo workspace.'));
    }
    // Every write route sits behind this guard, so blocking here covers new routes too.
    if (decision.membership.readOnly && !isReadRequest(req.method, req.path)) {
      return next(new ApiError(403, 'forbidden', 'This is a view-only account, so nothing can be changed.'));
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
