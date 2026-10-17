/**
 * The Firestore records the API reads, and strict parsers for them.
 *
 * A record that doesn't have the expected shape is an error, never a partial grant:
 * e.g. a membership with an unknown role is refused, not treated as "individual_user".
 *
 *   companies/{companyId}                     CompanyRecord
 *   companies/{companyId}/teams/{teamId}      TeamRecord
 *   companies/{companyId}/memberships/{uid}   MembershipRecord
 */

export type Role = 'company_admin' | 'individual_user';
export type MemberStatus = 'active' | 'suspended';
export type CompanyStatus = 'active' | 'suspended';
export type TeamStatus = 'active' | 'archived';

export const ROLES: readonly Role[] = ['company_admin', 'individual_user'];

export interface CompanyRecord {
  id: string;
  name: string;
  status: CompanyStatus;
  reportingCurrency: string;
  reportingTimezone: string;
}

export interface TeamRecord {
  id: string;
  departmentId: string;
  name: string;
  code: string;
  status: TeamStatus;
}

export interface MembershipRecord {
  uid: string;
  role: Role;
  teamIds: string[];
  status: MemberStatus;
}

/** A stored record is malformed. Access is refused and the problem is logged (by path, not content). */
export class InvalidRecordError extends Error {
  constructor(readonly path: string, readonly field: string) {
    super(`Invalid record at ${path} (${field})`);
    this.name = 'InvalidRecordError';
  }
}

type Data = Record<string, unknown>;

function str(data: Data, field: string, path: string): string {
  const v = data[field];
  if (typeof v !== 'string' || v.trim() === '') throw new InvalidRecordError(path, field);
  return v;
}

function oneOf<T extends string>(data: Data, field: string, allowed: readonly T[], path: string): T {
  const v = data[field];
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new InvalidRecordError(path, field);
  return v as T;
}

export function parseCompany(id: string, data: Data): CompanyRecord {
  const path = `companies/${id}`;
  return {
    id,
    name: str(data, 'name', path),
    status: oneOf(data, 'status', ['active', 'suspended'] as const, path),
    reportingCurrency: str(data, 'reportingCurrency', path),
    reportingTimezone: str(data, 'reportingTimezone', path),
  };
}

export function parseTeam(companyId: string, id: string, data: Data): TeamRecord {
  const path = `companies/${companyId}/teams/${id}`;
  return {
    id,
    departmentId: str(data, 'departmentId', path),
    name: str(data, 'name', path),
    code: str(data, 'code', path),
    status: oneOf(data, 'status', ['active', 'archived'] as const, path),
  };
}

export function parseMembership(companyId: string, uid: string, data: Data): MembershipRecord {
  const path = `companies/${companyId}/memberships/${uid}`;
  // The document ID is the UID. A mismatching uid field means the record was copied or edited wrongly.
  if (data.uid !== uid) throw new InvalidRecordError(path, 'uid');
  const teamIds = data.teamIds;
  if (!Array.isArray(teamIds) || !teamIds.every((t) => typeof t === 'string' && t !== '')) throw new InvalidRecordError(path, 'teamIds');
  return {
    uid,
    role: oneOf(data, 'role', ROLES, path),
    teamIds: [...new Set(teamIds as string[])],
    status: oneOf(data, 'status', ['active', 'suspended'] as const, path),
  };
}
