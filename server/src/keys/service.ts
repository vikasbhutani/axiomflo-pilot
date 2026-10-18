/**
 * AxiomFlo keys: what a person (or later an app) puts in their AI tools instead of a
 * provider key. The gateway checks each key on every request and records usage
 * against the key's owner and team.
 *
 * A key looks like `axf_<id>_<secret>`. Only a SHA-256 hash of the secret is stored,
 * so a database leak can't be replayed; the full key is shown once, when created.
 */
import type { Role } from '../membership/records.js';

export type KeyStatus = 'active' | 'revoked';

export interface KeyView {
  id: string;
  name: string;
  ownerUid: string;
  /** From Firebase Authentication; only filled in for an admin's company-wide list. */
  ownerEmail: string | null;
  teamId: string;
  status: KeyStatus;
  /** The last four characters, so people can tell their keys apart. */
  hint: string;
  createdAt: string | null;
  revokedAt: string | null;
}

export interface KeyActor {
  uid: string;
  role: Role;
  teamIds: string[];
}

/** Who a valid key acts for, re-checked against the membership on every use. */
export interface KeyPrincipal {
  keyId: string;
  uid: string;
  role: Role;
  teamId: string;
}

export interface NewKey {
  name: string;
  teamId: string;
}

export interface KeyService {
  /** Admins see every key in the company; individual users see only their own. */
  listKeys(companyId: string, actor: KeyActor): Promise<KeyView[]>;
  createKey(companyId: string, actor: KeyActor, input: NewKey): Promise<{ key: KeyView; secret: string }>;
  /** Owners can revoke their own keys; admins can revoke any key in the company. */
  revokeKey(companyId: string, actor: KeyActor, keyId: string): Promise<KeyView>;
  /**
   * For the gateway: throws KeyRejectedError for anything that isn't a usable key
   * (malformed, unknown, revoked, wrong secret, owner not an active member, team no
   * longer theirs), and lets database errors propagate so callers answer 503.
   */
  resolveKey(companyId: string, rawKey: string): Promise<KeyPrincipal>;
}

export class KeyRejectedError extends Error {
  constructor(readonly reason: string) {
    super('AxiomFlo key rejected');
    this.name = 'KeyRejectedError';
  }
}

/** At most this many active keys per person, so a leaked account can't mint endless keys. */
export const MAX_ACTIVE_KEYS_PER_USER = 10;
