/**
 * End to end against the Firebase emulators: real ID tokens from the Auth emulator,
 * verified by the real Admin SDK verifier, and memberships read from the Firestore
 * emulator by the real store. Only the Firebase servers are local stand-ins.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createFirebaseTokenVerifier } from '../auth/tokenVerifier.js';
import { applyBootstrap } from '../bootstrap/bootstrap.js';
import { parseBootstrapInput } from '../bootstrap/input.js';
import { silentLogger } from '../http/logger.js';
import { createFirestoreMembershipStore } from '../membership/firestoreStore.js';
import { emulatorApp, PROJECT, resetEmulators, signIn } from '../test/emulator.js';
import { testConfig } from '../test/testConfig.js';

const { auth, db } = emulatorApp();
const config = testConfig({ firebaseProjectId: PROJECT, pilotCompanyId: 'pilot-co' });
const app = createApp({ config, logger: silentLogger, verifier: createFirebaseTokenVerifier(auth, PROJECT), store: createFirestoreMembershipStore(db) });

const setup = parseBootstrapInput({
  company: { id: 'pilot-co', name: 'Pilot Co', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' },
  department: { id: 'engineering', name: 'Engineering' },
  teams: [
    { id: 'platform', name: 'Platform', code: 'PLAT' },
    { id: 'product', name: 'Product', code: 'PROD' },
  ],
});

async function person(email: string, { verified = true } = {}) {
  const user = await auth.createUser({ email, password: 'correct-horse-battery', emailVerified: verified });
  return { uid: user.uid, token: await signIn(email, 'correct-horse-battery') };
}

const me = (token: string) => request(app).get('/api/me').set('Authorization', `Bearer ${token}`);

beforeEach(resetEmulators);

describe('the real API against the emulators', () => {
  it('walks the founder flow: sign in → pending → bootstrap → active admin', async () => {
    const founder = await person('founder@example.com');
    expect((await me(founder.token)).body).toMatchObject({ access: 'pending', reason: 'no_membership', user: { uid: founder.uid, emailVerified: true } });

    await applyBootstrap(db, setup, founder.uid);

    const res = await me(founder.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ access: 'active', company: { id: 'pilot-co', name: 'Pilot Co' }, membership: { role: 'company_admin' } });
    expect(res.body.teams.map((t: { id: string }) => t.id)).toEqual(['platform', 'product']);
  });

  it('gives an individual user only their assigned team', async () => {
    const founder = await person('founder@example.com');
    await applyBootstrap(db, setup, founder.uid);
    const member = await person('member@example.com');
    await db.doc(`companies/pilot-co/memberships/${member.uid}`).set({ uid: member.uid, role: 'individual_user', teamIds: ['product'], status: 'active' });

    const teams = await request(app).get('/api/teams').set('Authorization', `Bearer ${member.token}`);
    expect(teams.body.teams.map((t: { id: string }) => t.id)).toEqual(['product']);
  });

  it('does not look up a membership for an unverified email', async () => {
    const founder = await person('unverified@example.com', { verified: false });
    await applyBootstrap(db, setup, founder.uid);
    expect((await me(founder.token)).body).toMatchObject({ access: 'pending', reason: 'email_unverified' });
  });

  it('rejects a token after the account is disabled', async () => {
    const founder = await person('founder@example.com');
    await applyBootstrap(db, setup, founder.uid);
    await auth.updateUser(founder.uid, { disabled: true });
    expect((await me(founder.token)).status).toBe(401);
  });

  it('rejects a token after sessions are revoked', async () => {
    const founder = await person('founder@example.com');
    // Revocation is recorded in whole seconds, so wait until the token is strictly older.
    await new Promise((r) => setTimeout(r, 1100));
    await auth.revokeRefreshTokens(founder.uid);
    expect((await me(founder.token)).status).toBe(401);
  });

  it('a membership written directly for another company grants nothing here', async () => {
    const outsider = await person('outsider@example.com');
    await db.doc(`companies/other-co/memberships/${outsider.uid}`).set({ uid: outsider.uid, role: 'company_admin', teamIds: [], status: 'active' });
    expect((await me(outsider.token)).body).toMatchObject({ access: 'pending' });
    expect((await request(app).get('/api/company').set('Authorization', `Bearer ${outsider.token}`)).status).toBe(403);
  });
});
