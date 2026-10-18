/**
 * The security rules from the pilot brief, each checked end to end: real emulator
 * sign-in tokens, the real verifier, real Firestore reads and writes. See
 * docs/backend/security-checklist.md for the rule → test map.
 */
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFirestoreAdminService } from './admin/firestoreAdminService.js';
import { createFirestoreUsageService } from './reports/firestoreUsageService.js';
import { createFirestoreKeyService } from './keys/firestoreKeyService.js';
import { createApp } from './app.js';
import { createFirebaseTokenVerifier } from './auth/tokenVerifier.js';
import { applyBootstrap } from './bootstrap/bootstrap.js';
import { parseBootstrapInput } from './bootstrap/input.js';
import { silentLogger } from './http/logger.js';
import { createFirestoreMembershipStore } from './membership/firestoreStore.js';
import { emulatorApp, PROJECT, resetEmulators, signIn } from './test/emulator.js';
import { testConfig } from './test/testConfig.js';

const { auth, db } = emulatorApp();
const config = testConfig({ firebaseProjectId: PROJECT, pilotCompanyId: 'pilot-co' });
const app = createApp({ config, logger: silentLogger, verifier: createFirebaseTokenVerifier(auth, PROJECT), store: createFirestoreMembershipStore(db), admin: createFirestoreAdminService({ db, auth }), keys: createFirestoreKeyService({ db, auth }), usage: createFirestoreUsageService({ db, auth, logger: silentLogger }) });

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

const as = (token: string) => ({
  get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${token}`),
  post: (path: string, body?: object) => request(app).post(path).set('Authorization', `Bearer ${token}`).send(body),
  patch: (path: string, body?: object) => request(app).patch(path).set('Authorization', `Bearer ${token}`).send(body),
  put: (path: string, body?: object) => request(app).put(path).set('Authorization', `Bearer ${token}`).send(body),
});

/** Every document path in the database, so a test can prove nothing was written. */
async function allDocuments(firestore: Firestore): Promise<string[]> {
  const paths: string[] = [];
  const walk = async (docs: DocumentReference[]) => {
    for (const doc of docs) {
      if ((await doc.get()).exists) paths.push(doc.path);
      for (const sub of await doc.listCollections()) await walk(await sub.listDocuments());
    }
  };
  for (const col of await firestore.listCollections()) await walk(await col.listDocuments());
  return paths.sort();
}

beforeEach(resetEmulators);

describe('a successful Google sign-in alone grants nothing', () => {
  it('the very first person to sign in, on an empty database, is pending and writes nothing', async () => {
    const first = await person('first@example.com');
    const api = as(first.token);
    expect((await api.get('/api/me')).body).toMatchObject({ access: 'pending' });
    // The web app then tries an invitation once; with no company that is refused too.
    expect((await api.post('/api/invitations/accept')).status).toBe(403);
    for (const path of ['/api/company', '/api/teams', '/api/members', '/api/invitations']) expect((await api.get(path)).status).toBe(403);
    expect(await allDocuments(db)).toEqual([]);
  });

  it('sharing the admin’s email domain is not enough', async () => {
    const founder = await person('founder@pilot.example');
    await applyBootstrap(db, setup, founder.uid);
    const colleague = await person('colleague@pilot.example');
    expect((await as(colleague.token).get('/api/me')).body).toMatchObject({ access: 'pending', reason: 'no_membership' });
    expect((await as(colleague.token).get('/api/teams')).status).toBe(403);
  });

  it('a company ID, role or demo role from the browser is ignored', async () => {
    const founder = await person('founder@example.com');
    await applyBootstrap(db, setup, founder.uid);
    const visitor = await person('visitor@example.com');
    const res = await request(app)
      .get('/api/teams?companyId=pilot-co&role=company_admin')
      .set('Authorization', `Bearer ${visitor.token}`)
      .set('X-Company-Id', 'pilot-co')
      .set('X-Role', 'company_admin')
      .set('Cookie', 'axiomflo:demo-role=company_admin');
    expect(res.status).toBe(403);
  });
});

describe('no public endpoint can create the first company administrator', () => {
  it('every write a stranger could try on an empty database is refused, and nothing is stored', async () => {
    const stranger = await person('stranger@example.com');
    const api = as(stranger.token);
    const attempts = [
      api.post('/api/invitations/accept', { role: 'company_admin' }),
      api.post('/api/invitations', { email: 'stranger@example.com', role: 'company_admin', teamIds: [] }),
      api.patch(`/api/members/${stranger.uid}`, { role: 'company_admin' }),
      api.post('/api/bootstrap', { adminUid: stranger.uid }),
      api.post('/api/companies', { id: 'pilot-co' }),
      api.post('/api/memberships', { uid: stranger.uid, role: 'company_admin' }),
      api.put(`/api/members/${stranger.uid}`, { role: 'company_admin' }),
    ];
    for (const res of await Promise.all(attempts)) expect([403, 404]).toContain(res.status);
    expect(await allDocuments(db)).toEqual([]);
    expect((await api.get('/api/me')).body.access).toBe('pending');
  });
});

describe('the caller is always the token, never the request body', () => {
  it('accepting with someone else’s email in the body does not take their invitation', async () => {
    const founder = await person('founder@example.com');
    await applyBootstrap(db, setup, founder.uid);
    await as(founder.token).post('/api/invitations', { email: 'invited@example.com', role: 'individual_user', teamIds: ['platform'] });
    const thief = await person('thief@example.com');
    const res = await as(thief.token).post('/api/invitations/accept', { email: 'invited@example.com', uid: 'someone', role: 'company_admin' });
    expect(res.status).toBe(404);
    expect((await as(thief.token).get('/api/me')).body.access).toBe('pending');
  });

  it('an inviter or company in the invitation body is refused, not silently used', async () => {
    const founder = await person('founder@example.com');
    await applyBootstrap(db, setup, founder.uid);
    const res = await as(founder.token).post('/api/invitations', { email: 'x@example.com', role: 'individual_user', teamIds: ['platform'], invitedBy: 'other', companyId: 'other-co' });
    expect(res.status).toBe(400);
  });
});

describe('members cannot change their own access', () => {
  it('an individual user cannot promote themselves or add teams', async () => {
    const founder = await person('founder@example.com');
    await applyBootstrap(db, setup, founder.uid);
    await as(founder.token).post('/api/invitations', { email: 'member@example.com', role: 'individual_user', teamIds: ['product'] });
    const member = await person('member@example.com');
    await as(member.token).post('/api/invitations/accept');

    expect((await as(member.token).patch(`/api/members/${member.uid}`, { role: 'company_admin' })).status).toBe(403);
    expect((await as(member.token).patch(`/api/members/${member.uid}`, { teamIds: ['platform', 'product'] })).status).toBe(403);
    expect((await as(member.token).get('/api/me')).body.membership).toEqual({ role: 'individual_user', teamIds: ['product'] });
  });

  it('the only admin cannot suspend or demote themselves', async () => {
    const founder = await person('founder@example.com');
    await applyBootstrap(db, setup, founder.uid);
    expect((await as(founder.token).patch(`/api/members/${founder.uid}`, { status: 'suspended' })).status).toBe(403);
    expect((await as(founder.token).patch(`/api/members/${founder.uid}`, { role: 'individual_user', teamIds: ['platform'] })).status).toBe(403);
    expect((await as(founder.token).get('/api/me')).body.membership.role).toBe('company_admin');
  });
});

describe('suspension', () => {
  it('applies on the very next request and survives a fresh invitation attempt', async () => {
    const founder = await person('founder@example.com');
    await applyBootstrap(db, setup, founder.uid);
    await as(founder.token).post('/api/invitations', { email: 'member@example.com', role: 'individual_user', teamIds: ['product'] });
    const member = await person('member@example.com');
    await as(member.token).post('/api/invitations/accept');
    expect((await as(member.token).get('/api/teams')).status).toBe(200);

    await as(founder.token).patch(`/api/members/${member.uid}`, { status: 'suspended' });
    expect((await as(member.token).get('/api/teams')).status).toBe(403);
    // The admin can't invite them again, and accepting can't undo the suspension.
    expect((await as(founder.token).post('/api/invitations', { email: 'member@example.com', role: 'company_admin', teamIds: [] })).status).toBe(409);
    expect((await as(member.token).post('/api/invitations/accept')).status).toBe(403);
    expect((await as(member.token).get('/api/me')).body.access).toBe('suspended');
  });
});

describe('every change is audited', () => {
  it('invite, accept and member change each leave one audit event, without email addresses', async () => {
    const founder = await person('founder@example.com');
    await applyBootstrap(db, setup, founder.uid);
    await as(founder.token).post('/api/invitations', { email: 'member@example.com', role: 'individual_user', teamIds: ['product'] });
    const member = await person('member@example.com');
    await as(member.token).post('/api/invitations/accept');
    await as(founder.token).patch(`/api/members/${member.uid}`, { teamIds: ['platform'] });

    const events = (await db.collection('companies/pilot-co/auditEvents').get()).docs.map((d) => d.data());
    expect(events.map((e) => e.action).sort()).toEqual(['company.bootstrapped', 'invitation.accepted', 'invitation.created', 'member.updated']);
    expect(JSON.stringify(events)).not.toMatch(/@example\.com/);
  });
});
