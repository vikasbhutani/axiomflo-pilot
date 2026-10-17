/**
 * Read access to company, team and membership records. Every method takes the
 * company ID, and callers only ever pass the configured pilot company, so nothing
 * outside that company can be read through the API.
 *
 * Errors are thrown, never swallowed: "the database is down" must not look like
 * "this person has no membership".
 */
import type { CompanyRecord, MembershipRecord, TeamRecord } from './records.js';

export interface MembershipStore {
  getCompany(companyId: string): Promise<CompanyRecord | null>;
  getMembership(companyId: string, uid: string): Promise<MembershipRecord | null>;
  listTeams(companyId: string): Promise<TeamRecord[]>;
}
