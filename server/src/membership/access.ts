/**
 * Works out what a verified person may access in the pilot company.
 *
 *   active     active membership in an active company: role and permitted teams
 *   pending    signed in, but no membership yet (or the email isn't verified)
 *   suspended  the membership or the whole company is suspended
 *
 * Nothing is ever created here. A database error propagates as
 * MembershipUnavailableError (503); a malformed record as InvalidRecordError (500).
 * Neither ever becomes "pending" or "active".
 */
import type { VerifiedIdentity } from '../auth/tokenVerifier.js';
import { InvalidRecordError, type CompanyRecord, type MembershipRecord, type TeamRecord } from './records.js';
import type { MembershipStore } from './store.js';

export type PendingReason = 'email_unverified' | 'no_membership' | 'company_not_set_up';
export type SuspendedReason = 'membership_suspended' | 'company_suspended';

export type AccessDecision =
  | { access: 'active'; company: CompanyRecord; membership: MembershipRecord; teams: TeamRecord[] }
  | { access: 'pending'; reason: PendingReason }
  | { access: 'suspended'; reason: SuspendedReason };

export class MembershipUnavailableError extends Error {
  constructor() {
    super('The membership service is unavailable');
    this.name = 'MembershipUnavailableError';
  }
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InvalidRecordError) throw error;
    throw new MembershipUnavailableError();
  }
}

/** Teams a member may see: every team for an admin; only their assigned, active teams otherwise. */
export function permittedTeams(membership: MembershipRecord, teams: TeamRecord[]): TeamRecord[] {
  if (membership.role === 'company_admin') return teams;
  const assigned = new Set(membership.teamIds);
  // Assigned IDs that don't exist in this company are ignored, never invented.
  return teams.filter((t) => assigned.has(t.id) && t.status === 'active');
}

export async function decideAccess(identity: VerifiedIdentity, store: MembershipStore, companyId: string): Promise<AccessDecision> {
  // An unconfirmed email could belong to someone else, so no membership is looked up.
  if (!identity.emailVerified) return { access: 'pending', reason: 'email_unverified' };

  const [membership, company] = await guarded(() => Promise.all([store.getMembership(companyId, identity.uid), store.getCompany(companyId)]));
  if (!membership) return { access: 'pending', reason: 'no_membership' };
  if (!company) return { access: 'pending', reason: 'company_not_set_up' };
  if (company.status !== 'active') return { access: 'suspended', reason: 'company_suspended' };
  if (membership.status !== 'active') return { access: 'suspended', reason: 'membership_suspended' };

  const teams = await guarded(() => store.listTeams(companyId));
  const visible = permittedTeams(membership, teams);
  const knownIds = new Set(teams.map((t) => t.id));
  return {
    access: 'active',
    company,
    membership: { ...membership, teamIds: membership.teamIds.filter((id) => knownIds.has(id)) },
    teams: visible,
  };
}
