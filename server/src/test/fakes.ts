/** In-memory stand-ins for Firebase Authentication and Firestore, for tests only. */
import { createApp } from '../app.js';
import type { ServerConfig } from '../config.js';
import { TokenRejectedError, TokenVerificationUnavailableError, type TokenVerifier, type VerifiedIdentity } from '../auth/tokenVerifier.js';
import { silentLogger, type Logger } from '../http/logger.js';
import type { CompanyRecord, MembershipRecord, TeamRecord } from '../membership/records.js';
import type { MembershipStore } from '../membership/store.js';
import type { AdminService } from '../admin/service.js';
import { KeyRejectedError, type KeyActor, type KeyPrincipal, type KeyService, type KeyView, type NewKey } from '../keys/service.js';
import type { ExchangeRateView, UsageResult, UsageService, UsageViewer } from '../reports/service.js';
import type { AgentClient } from '../assistant/agentClient.js';
import type { SlackLinkService } from '../slack/links.js';
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

/** Records what the routes ask for; the real behaviour is tested against the emulators. */
export class FakeAdmin implements AdminService {
  readonly calls: { method: string; args: unknown[] }[] = [];
  /** Set to make the next call fail (e.g. like a Firestore outage). */
  failWith: Error | null = null;
  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    if (this.failWith) throw this.failWith;
  }
  async listMembers(...args: unknown[]) {
    this.record('listMembers', args);
    return [];
  }
  async listInvitations(...args: unknown[]) {
    this.record('listInvitations', args);
    return [];
  }
  async createInvitation(...args: Parameters<AdminService['createInvitation']>) {
    this.record('createInvitation', args);
    const input = args[2];
    return { id: 'inv-1', email: input.normalizedEmail, role: input.role, teamIds: input.teamIds, status: 'pending' as const, delivery: 'Created — email not sent' as const, expiresAt: new Date(0).toISOString(), createdAt: null };
  }
  async revokeInvitation(...args: Parameters<AdminService['revokeInvitation']>) {
    this.record('revokeInvitation', args);
    return { id: args[2], email: 'x@example.com', role: 'individual_user' as const, teamIds: ['team-a'], status: 'revoked' as const, delivery: 'Created — email not sent' as const, expiresAt: new Date(0).toISOString(), createdAt: null };
  }
  async acceptInvitation(...args: Parameters<AdminService['acceptInvitation']>) {
    this.record('acceptInvitation', args);
    return { result: 'accepted' as const, role: 'individual_user' as const, teamIds: ['team-a'] };
  }
  async updateMember(...args: Parameters<AdminService['updateMember']>) {
    this.record('updateMember', args);
    return { uid: args[2], email: null, displayName: null, role: args[3].role ?? 'individual_user', teamIds: args[3].teamIds ?? [], status: args[3].status ?? 'active' };
  }
}

/** Keeps keys in memory, with the same visibility rules as the real service. */
export class FakeKeys implements KeyService {
  readonly calls: { method: string; args: unknown[] }[] = [];
  failWith: Error | null = null;
  readonly keys: KeyView[] = [];
  /** What resolveKey returns (or throws) for each raw key; anything else is unknown. */
  readonly principals: Record<string, KeyPrincipal | Error> = {};
  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    if (this.failWith) throw this.failWith;
  }
  async listKeys(companyId: string, actor: KeyActor) {
    this.record('listKeys', [companyId, actor]);
    return this.keys.filter((k) => actor.role === 'company_admin' || k.ownerUid === actor.uid);
  }
  async createKey(companyId: string, actor: KeyActor, input: NewKey) {
    this.record('createKey', [companyId, actor, input]);
    const key: KeyView = { id: `${this.keys.length}`.padStart(24, '0'), name: input.name, ownerUid: actor.uid, ownerEmail: null, teamId: input.teamId, status: 'active', hint: 'abcd', createdAt: null, revokedAt: null };
    this.keys.push(key);
    return { key, secret: `axf_${key.id}_${'s'.repeat(43)}` };
  }
  async revokeKey(companyId: string, actor: KeyActor, keyId: string) {
    this.record('revokeKey', [companyId, actor, keyId]);
    const key = this.keys.find((k) => k.id === keyId)!;
    key.status = 'revoked';
    return key;
  }
  async resolveKey(companyId: string, rawKey: string): Promise<KeyPrincipal> {
    this.record('resolveKey', [companyId, rawKey]);
    const outcome = this.principals[rawKey];
    if (!outcome) throw new KeyRejectedError('unknown');
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

export class FakeUsage implements UsageService {
  readonly calls: { method: string; args: unknown[] }[] = [];
  failWith: Error | null = null;
  result: UsageResult = { records: [], people: {}, truncated: false, skipped: 0 };
  readonly rates: ExchangeRateView[] = [];
  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    if (this.failWith) throw this.failWith;
  }
  async listUsage(companyId: string, viewer: UsageViewer, range: { startIso: string; endIso: string }) {
    this.record('listUsage', [companyId, viewer, range]);
    return this.result;
  }
  async listRates(companyId: string) {
    this.record('listRates', [companyId]);
    return this.rates;
  }
  async setRate(companyId: string, actorUid: string, month: string, rate: number, currency: string) {
    this.record('setRate', [companyId, actorUid, month, rate, currency]);
    return { month, rate, currency, setBy: actorUid, setAt: null };
  }
}

export function makeApp({
  store = new FakeStore(pilotData()),
  verifier = new FakeVerifier(IDENTITIES),
  admin = new FakeAdmin(),
  keys = new FakeKeys(),
  usage = new FakeUsage(),
  config = testConfig(),
  logger = silentLogger,
  agent = null,
  slackLinks = null,
}: { store?: FakeStore; verifier?: FakeVerifier; admin?: FakeAdmin; keys?: FakeKeys; usage?: FakeUsage; config?: ServerConfig; logger?: Logger; agent?: AgentClient | null; slackLinks?: SlackLinkService | null } = {}) {
  return { app: createApp({ config, logger, verifier, store, admin, keys, usage, agent, slackLinks }), store, verifier, admin, keys, usage, agent, slackLinks };
}
