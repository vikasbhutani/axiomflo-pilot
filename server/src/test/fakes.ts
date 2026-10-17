/** In-memory stand-ins for Firebase Authentication and Firestore, for tests only. */
import { createApp } from '../app.js';
import type { ServerConfig } from '../config.js';
import { TokenRejectedError, TokenVerificationUnavailableError, type TokenVerifier, type VerifiedIdentity } from '../auth/tokenVerifier.js';
import { silentLogger, type Logger } from '../http/logger.js';
import type { CompanyRecord, MembershipRecord, TeamRecord } from '../membership/records.js';
import type { MembershipStore } from '../membership/store.js';
import { testConfig } from './testConfig.js';

export const COMPANY_ID = 'test-company';

/** Bearer tokens look like JWTs (three dot-separated parts); the last part picks the outcome. */
export const token = (name: string) => `header.payload.${name}`;

export function identity(uid: string, overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid, email: `${uid}@example.com`, emailVerified: true, displayName: uid, signInProvider: 'google.com', ...overrides };
}

export class FakeVerifier implements TokenVerifier {
  readonly seen: string[] = [];
  constructor(private readonly outcomes: Record<string, VerifiedIdentity | Error>) {}
  async verify(raw: string): Promise<VerifiedIdentity> {
    this.seen.push(raw);
    const outcome = this.outcomes[raw.split('.')[2]];
    if (!outcome) throw new TokenRejectedError('invalid');
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

export interface StoreData {
  companies: Record<string, CompanyRecord>;
  teams: Record<string, TeamRecord[]>;
  memberships: Record<string, Record<string, MembershipRecord>>;
}

export class FakeStore implements MembershipStore {
  /** Set to make every read fail, like a Firestore outage. */
  failing = false;
  readonly reads: string[] = [];
  constructor(readonly data: StoreData) {}
  private check(what: string) {
    this.reads.push(what);
    if (this.failing) throw new Error('14 UNAVAILABLE: Firestore is unreachable');
  }
  async getCompany(companyId: string) {
    this.check(`company:${companyId}`);
    return this.data.companies[companyId] ?? null;
  }
  async getMembership(companyId: string, uid: string) {
    this.check(`membership:${companyId}/${uid}`);
    return this.data.memberships[companyId]?.[uid] ?? null;
  }
  async listTeams(companyId: string) {
    this.check(`teams:${companyId}`);
    return this.data.teams[companyId] ?? [];
  }
}

export const TEAM_A: TeamRecord = { id: 'team-a', departmentId: 'dept-1', name: 'Team A', code: 'TEAM-A', status: 'active' };
export const TEAM_B: TeamRecord = { id: 'team-b', departmentId: 'dept-1', name: 'Team B', code: 'TEAM-B', status: 'active' };

/** The pilot company with an admin, an individual user in Team A, and a suspended user. */
export function pilotData(): StoreData {
  return {
    companies: {
      [COMPANY_ID]: { id: COMPANY_ID, name: 'Test Company', status: 'active', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' },
      'other-company': { id: 'other-company', name: 'Other Company', status: 'active', reportingCurrency: 'USD', reportingTimezone: 'UTC' },
    },
    teams: {
      [COMPANY_ID]: [TEAM_A, TEAM_B],
      'other-company': [{ id: 'team-x', departmentId: 'dept-x', name: 'Other Team', code: 'OTHER', status: 'active' }],
    },
    memberships: {
      [COMPANY_ID]: {
        admin: { uid: 'admin', role: 'company_admin', teamIds: [], status: 'active' },
        alice: { uid: 'alice', role: 'individual_user', teamIds: ['team-a'], status: 'active' },
        sam: { uid: 'sam', role: 'individual_user', teamIds: ['team-a'], status: 'suspended' },
      },
      // An admin of a different company must get nothing in the pilot company.
      'other-company': { outsider: { uid: 'outsider', role: 'company_admin', teamIds: ['team-x'], status: 'active' } },
    },
  };
}

export const IDENTITIES = {
  admin: identity('admin'),
  alice: identity('alice'),
  sam: identity('sam'),
  newcomer: identity('newcomer'),
  outsider: identity('outsider'),
  unverified: identity('admin', { emailVerified: false }),
  expired: new TokenRejectedError('expired'),
  revoked: new TokenRejectedError('revoked'),
  disabled: new TokenRejectedError('disabled'),
  wrongproject: new TokenRejectedError('wrong_project'),
  authdown: new TokenVerificationUnavailableError('auth/internal-error'),
};

export function makeApp({ store = new FakeStore(pilotData()), verifier = new FakeVerifier(IDENTITIES), config = testConfig(), logger = silentLogger }: { store?: FakeStore; verifier?: FakeVerifier; config?: ServerConfig; logger?: Logger } = {}) {
  return { app: createApp({ config, logger, verifier, store }), store, verifier };
}
