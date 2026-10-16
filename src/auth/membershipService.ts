/**
 * Where AxiomFlo membership (company, teams, role, status) comes from.
 *
 * Membership must come from a trusted backend that verifies the Firebase ID token.
 * It is never taken from the browser: not from the demo role switcher, URL
 * parameters, localStorage, or an email-domain match.
 */
import type { FirebaseApp } from 'firebase/app';
import type { Role } from '../types';
import type { ApiClient } from './api';
import type { AuthUser, Membership, MembershipStatus } from './types';

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
const STATUSES: MembershipStatus[] = ['active', 'pending', 'suspended'];

/** Checks the backend's response has the expected shape before the UI trusts it. */
export function parseMembership(value: unknown): Membership {
  const v = value as Partial<Membership> | null;
  if (
    !v ||
    typeof v.userId !== 'string' ||
    typeof v.companyId !== 'string' ||
    !ROLES.includes(v.role as Role) ||
    !STATUSES.includes(v.status as MembershipStatus) ||
    !Array.isArray(v.teamIds) ||
    !v.teamIds.every((t) => typeof t === 'string')
  ) {
    throw new Error('The membership response was not in the expected format.');
  }
  return {
    userId: v.userId,
    companyId: v.companyId,
    companyName: typeof v.companyName === 'string' ? v.companyName : undefined,
    role: v.role as Role,
    teamIds: v.teamIds,
    status: v.status as MembershipStatus,
  };
}

/**
 * Proposed backend contract (not built yet):
 *   GET /v1/me/membership   Authorization: Bearer <Firebase ID token>
 *   200 → Membership JSON for the verified token's UID
 *   404 → the person has no membership yet
 * The backend must work out the UID from the verified token, never from the request body or URL.
 */
export function createHttpMembershipService(api: ApiClient): MembershipService {
  return {
    async getMembership() {
      const response = await api.fetch('/v1/me/membership', { headers: { Accept: 'application/json' } });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Membership lookup failed (HTTP ${response.status}).`);
      return parseMembership(await response.json());
    },
  };
}

/**
 * Reads memberships from Cloud Firestore: one document per person at `memberships/{Firebase UID}`.
 *
 * This is safe only together with the security rules in `firestore.rules`, which let a
 * signed-in person with a verified email READ their own document and let NOBODY write
 * from the browser. Administrators create and change memberships in the Firebase
 * console (or later from a trusted backend), never from this app.
 *
 * Firestore is loaded only when a membership is first checked, so the demo stays light.
 */
export function createFirestoreMembershipService(app: FirebaseApp): MembershipService {
  return {
    async getMembership(user) {
      const { doc, getDoc, getFirestore } = await import('firebase/firestore');
      const snapshot = await getDoc(doc(getFirestore(app), 'memberships', user.uid));
      if (!snapshot.exists()) return null;
      // The document ID is the UID, so the person can only ever receive their own membership.
      return parseMembership({ ...snapshot.data(), userId: snapshot.id });
    },
  };
}
