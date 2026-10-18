/**
 * Where AxiomFlo membership (company, teams, role, status) comes from: the AxiomFlo
 * API's `GET /api/me`, which verifies the Firebase ID token and reads the membership
 * on the server.
 *
 * It is never taken from the browser: not from the demo role switcher, URL
 * parameters, localStorage, Firestore read directly, or an email-domain match.
 */
import type { Role } from '../types';
import type { ApiClient } from './api';
import type { AuthUser, Membership, TeamSummary } from './types';

export interface MembershipService {
  /** The person's membership, or null when they have none yet. Throws if the lookup fails. */
  getMembership(user: AuthUser): Promise<Membership | null>;
}

/**
 * Used when Firebase isn't configured: nobody has an approved membership, so every
 * signed-in person is shown the "Access pending" screen. This is deliberate.
 */
export const noBackendMembershipService: MembershipService = {
  async getMembership() {
    return null;
  },
};

const ROLES: Role[] = ['company_admin', 'individual_user'];

class UnexpectedResponseError extends Error {
  constructor() {
    super('The AxiomFlo API response was not in the expected format.');
    this.name = 'UnexpectedResponseError';
  }
}

type Data = Record<string, unknown>;

function isObject(v: unknown): v is Data {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseTeams(value: unknown): TeamSummary[] {
  if (!Array.isArray(value)) throw new UnexpectedResponseError();
  return value.map((t) => {
    if (!isObject(t) || typeof t.id !== 'string' || typeof t.name !== 'string' || typeof t.code !== 'string') throw new UnexpectedResponseError();
    return { id: t.id, name: t.name, code: t.code };
  });
}

/**
 * Turns a `GET /api/me` response into the app's Membership, checking its shape first.
 *
 *   access "active"    → an active membership with company, role and teams
 *   access "pending"   → null (no membership yet)
 *   access "suspended" → a suspended membership; only its status is used (Access denied)
 */
export function parseMeResponse(value: unknown): Membership | null {
  if (!isObject(value) || !isObject(value.user) || typeof value.user.uid !== 'string') throw new UnexpectedResponseError();
  const userId = value.user.uid;
  if (value.access === 'pending') return null;
  // The denied page shows no company details, so none are needed (or trusted) here.
  if (value.access === 'suspended') return { userId, companyId: '', role: 'individual_user', teamIds: [], status: 'suspended' };
  if (value.access !== 'active') throw new UnexpectedResponseError();

  const { company, membership } = value;
  if (!isObject(company) || typeof company.id !== 'string' || typeof company.name !== 'string') throw new UnexpectedResponseError();
  if (!isObject(membership) || !ROLES.includes(membership.role as Role) || !Array.isArray(membership.teamIds) || !membership.teamIds.every((t) => typeof t === 'string')) {
    throw new UnexpectedResponseError();
  }
  return {
    userId,
    companyId: company.id,
    companyName: company.name,
    role: membership.role as Role,
    teamIds: membership.teamIds as string[],
    teams: parseTeams(value.teams),
    status: 'active',
  };
}

/**
 * Asks the AxiomFlo API who the signed-in person is and what they may access.
 *
 * If they have no membership yet, it tries ONCE to accept an invitation that matches
 * their verified email (`POST /api/invitations/accept`), then asks again. "No matching
 * invitation" (404) is a normal outcome: they stay on Access pending, with no retry
 * loop. The browser sends no role, team or email; the API takes them from the
 * invitation and the sign-in token.
 *
 * Any other non-200 answer (including 401 after one token refresh, 403, 5xx) is an
 * error, which the app shows as a retryable "couldn't check your access" page.
 */
export function createHttpMembershipService(api: ApiClient): MembershipService {
  const loadMe = async (): Promise<unknown> => {
    const response = await api.fetch('/api/me', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Membership lookup failed (HTTP ${response.status}).`);
    return response.json();
  };

  return {
    async getMembership() {
      const me = await loadMe();
      const membership = parseMeResponse(me);
      if (membership || !isObject(me) || me.reason !== 'no_membership') return membership;

      const accept = await api.fetch('/api/invitations/accept', { method: 'POST', headers: { Accept: 'application/json' } });
      // No invitation, already handled, or too many attempts: stay pending.
      if (accept.status === 404 || accept.status === 409 || accept.status === 429) return null;
      if (!accept.ok) throw new Error(`Invitation check failed (HTTP ${accept.status}).`);
      return parseMeResponse(await loadMe());
    },
  };
}
