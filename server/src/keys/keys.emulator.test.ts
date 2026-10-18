/** AxiomFlo keys against the Firestore and Auth emulators. */
import { beforeEach, describe, expect, it } from 'vitest';
import { applyBootstrap } from '../bootstrap/bootstrap.js';
import { parseBootstrapInput } from '../bootstrap/input.js';
import { ApiError } from '../http/errors.js';
import { emulatorApp, resetEmulators } from '../test/emulator.js';
import { createFirestoreKeyService } from './firestoreKeyService.js';
import { KeyRejectedError, MAX_ACTIVE_KEYS_PER_USER, type KeyActor } from './service.js';

const { auth, db } = emulatorApp();
const C = 'pilot-co';
const keys = createFirestoreKeyService({ db, auth });
const setup = parseBootstrapInput({
  company: { id: C, name: 'Pilot Co', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' },
  department: { id: 'engineering', name: 'Engineering' },
  teams: [
    { id: 'platform', name: 'Platform', code: 'PLAT' },
    { id: 'product', name: 'Product', code: 'PROD' },
  ],
});

let admin: KeyActor;
let alice: KeyActor;
const membershipRef = (uid: string) => db.doc(`companies/${C}/memberships/${uid}`);

async function rejected(promise: Promise<unknown>, reason?: string) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(KeyRejectedError);
  if (reason) expect((error as KeyRejectedError).reason).toBe(reason);
}
async function apiError(promise: Promise<unknown>, status: number) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(status);
}

beforeEach(async () => {
  await resetEmulators();
  const founder = await auth.createUser({ email: 'founder@example.com', emailVerified: true });
  await applyBootstrap(db, setup, founder.uid);
  admin = { uid: founder.uid, role: 'company_admin', teamIds: [] };
  const a = await auth.createUser({ email: 'alice@example.com', emailVerified: true });
  await membershipRef(a.uid).set({ uid: a.uid, role: 'individual_user', teamIds: ['product'], status: 'active' });
  alice = { uid: a.uid, role: 'individual_user', teamIds: ['product'] };
});

describe('creating keys', () => {
  it('stores only a hash, returns the key once, and audits without the secret', async () => {
    const { key, secret } = await keys.createKey(C, alice, { name: 'Laptop', teamId: 'product' });
    expect(key).toMatchObject({ name: 'Laptop', ownerUid: alice.uid, teamId: 'product', status: 'active', hint: secret.slice(-4) });
    const stored = (await db.doc(`companies/${C}/apiKeys/${key.id}`).get()).data()!;
    expect(JSON.stringify(stored)).not.toContain(secret.slice(29));
    const audits = (await db.collection(`companies/${C}/auditEvents`).where('action', '==', 'apiKey.created').get()).docs.map((d) => d.data());
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(secret.slice(29));
  });

  it('only for the person’s own teams (an admin may pick any team)', async () => {
    await apiError(keys.createKey(C, alice, { name: 'x', teamId: 'platform' }), 403);
    await apiError(keys.createKey(C, alice, { name: 'x', teamId: 'nope' }), 400);
    expect((await keys.createKey(C, admin, { name: 'x', teamId: 'platform' })).key.teamId).toBe('platform');
  });

  it('refuses a suspended member and caps active keys per person', async () => {
    for (let i = 0; i < MAX_ACTIVE_KEYS_PER_USER; i++) await keys.createKey(C, alice, { name: `k${i}`, teamId: 'product' });
    await apiError(keys.createKey(C, alice, { name: 'one too many', teamId: 'product' }), 409);
    await membershipRef(alice.uid).update({ status: 'suspended' });
    await apiError(keys.createKey(C, alice, { name: 'x', teamId: 'product' }), 403);
  });
});

describe('listing and revoking', () => {
  it('individual users see and revoke only their own keys; admins see everyone’s with emails', async () => {
    const mine = await keys.createKey(C, alice, { name: 'Alice', teamId: 'product' });
    const theirs = await keys.createKey(C, admin, { name: 'Admin', teamId: 'platform' });
    expect((await keys.listKeys(C, alice)).map((k) => k.name)).toEqual(['Alice']);
    const all = await keys.listKeys(C, admin);
    expect(all.map((k) => k.ownerEmail).sort()).toEqual(['alice@example.com', 'founder@example.com']);

    await apiError(keys.revokeKey(C, alice, theirs.key.id), 404);
    expect((await keys.revokeKey(C, alice, mine.key.id)).status).toBe('revoked');
    expect((await keys.revokeKey(C, admin, theirs.key.id)).status).toBe('revoked');
  });
});

describe('resolving a key (what the gateway does on every request)', () => {
  it('returns the owner, role and team for a valid key', async () => {
    const { key, secret } = await keys.createKey(C, alice, { name: 'Laptop', teamId: 'product' });
    expect(await keys.resolveKey(C, secret)).toEqual({ keyId: key.id, uid: alice.uid, role: 'individual_user', teamId: 'product', teamCode: 'PROD' });
  });

  it('rejects malformed, unknown and tampered keys', async () => {
    const { secret } = await keys.createKey(C, alice, { name: 'Laptop', teamId: 'product' });
    await rejected(keys.resolveKey(C, 'sk-ant-api03-whatever'), 'malformed');
    await rejected(keys.resolveKey(C, `axf_${'0'.repeat(24)}_${secret.slice(29)}`), 'unknown');
    const tampered = secret.slice(0, -1) + (secret.endsWith('A') ? 'B' : 'A');
    await rejected(keys.resolveKey(C, tampered), 'mismatch');
  });

  it('stops working when revoked, when the owner is suspended or removed from the team, or the company is suspended', async () => {
    const make = async () => (await keys.createKey(C, alice, { name: 'k', teamId: 'product' }));
    const a = await make();
    await keys.revokeKey(C, alice, a.key.id);
    await rejected(keys.resolveKey(C, a.secret), 'revoked');

    const b = await make();
    await membershipRef(alice.uid).update({ status: 'suspended' });
    await rejected(keys.resolveKey(C, b.secret), 'member_suspended');
    await membershipRef(alice.uid).update({ status: 'active', teamIds: ['platform'] });
    await rejected(keys.resolveKey(C, b.secret), 'team_not_assigned');
    await membershipRef(alice.uid).update({ teamIds: ['product'] });
    expect((await keys.resolveKey(C, b.secret)).uid).toBe(alice.uid);
    await db.doc(`companies/${C}`).update({ status: 'suspended' });
    await rejected(keys.resolveKey(C, b.secret), 'company_inactive');
  });

  it('a key from another company is unknown here', async () => {
    const { secret } = await keys.createKey(C, alice, { name: 'k', teamId: 'product' });
    await rejected(keys.resolveKey('other-co', secret), 'unknown');
  });
});
