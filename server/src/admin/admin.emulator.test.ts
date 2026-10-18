/**
 * The admin rules against the Firestore and Auth emulators: real transactions, so
 * concurrent requests really race.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { VerifiedIdentity } from '../auth/tokenVerifier.js';
import { applyBootstrap } from '../bootstrap/bootstrap.js';
import { parseBootstrapInput } from '../bootstrap/input.js';
import { ApiError } from '../http/errors.js';
import { emulatorApp, resetEmulators } from '../test/emulator.js';
import { createFirestoreAdminService } from './firestoreAdminService.js';
import { parseInvitationInput } from './validation.js';

const { auth, db } = emulatorApp();
const C = 'pilot-co';
let clock = Date.parse('2026-10-18T00:00:00Z');
const admin = createFirestoreAdminService({ db, auth, now: () => clock });

const setup = parseBootstrapInput({
  company: { id: C, name: 'Pilot Co', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' },
  department: { id: 'engineering', name: 'Engineering' },
  teams: [
    { id: 'platform', name: 'Platform', code: 'PLAT' },
    { id: 'product', name: 'Product', code: 'PROD' },
  ],
});

const invite = (email: string, overrides: Record<string, unknown> = {}) => parseInvitationInput({ email, role: 'individual_user', teamIds: ['product'], ...overrides });
const identity = (uid: string, email: string, emailVerified = true): VerifiedIdentity => ({ uid, email, emailVerified, displayName: null, signInProvider: 'google.com' });
const membership = async (uid: string) => (await db.doc(`companies/${C}/memberships/${uid}`).get()).data();
const audits = async (action: string) => (await db.collection(`companies/${C}/auditEvents`).where('action', '==', action).get()).docs.map((d) => d.data());

async function expectApiError(promise: Promise<unknown>, status: number) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(status);
}

let founderUid: string;
beforeEach(async () => {
  clock = Date.parse('2026-10-18T00:00:00Z');
  await resetEmulators();
  founderUid = (await auth.createUser({ email: 'founder@example.com', emailVerified: true })).uid;
  await applyBootstrap(db, setup, founderUid);
});

describe('invitations', () => {
  it('creates a pending, unsent invitation and audits it without the email address', async () => {
    const inv = await admin.createInvitation(C, founderUid, invite('New@Example.com'));
    expect(inv).toMatchObject({ email: 'new@example.com', role: 'individual_user', teamIds: ['product'], status: 'pending', delivery: 'Created — email not sent' });
    const [event] = await audits('invitation.created');
    expect(event).toMatchObject({ actorUid: founderUid, targetId: inv.id });
    expect(JSON.stringify(event)).not.toContain('new@example.com');
  });

  it('refuses a second pending invitation for the same email, even when sent at the same time', async () => {
    const results = await Promise.allSettled([admin.createInvitation(C, founderUid, invite('dup@example.com')), admin.createInvitation(C, founderUid, invite('DUP@example.com'))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect((await db.collection(`companies/${C}/invitations`).get()).size).toBe(1);
  });

  it('allows a new invitation once the old one is revoked or expired', async () => {
    const first = await admin.createInvitation(C, founderUid, invite('again@example.com'));
    await admin.revokeInvitation(C, founderUid, first.id);
    const second = await admin.createInvitation(C, founderUid, invite('again@example.com', { expiresInDays: 1 }));
    clock += 2 * 24 * 60 * 60 * 1000;
    await admin.createInvitation(C, founderUid, invite('again@example.com'));
    expect((await admin.listInvitations(C)).find((i) => i.id === second.id)?.status).toBe('expired');
  });

  it('refuses teams that do not belong to the company', async () => {
    await db.doc('companies/other-co/teams/foreign').set({ departmentId: 'x', name: 'Foreign', code: 'FOR', status: 'active' });
    await expectApiError(admin.createInvitation(C, founderUid, invite('x@example.com', { teamIds: ['foreign'] })), 400);
  });

  it('refuses to invite someone who is already a member', async () => {
    await expectApiError(admin.createInvitation(C, founderUid, invite('founder@example.com', { role: 'company_admin', teamIds: [] })), 409);
  });
});

describe('accepting an invitation', () => {
  it('creates the membership from the invitation and consumes it', async () => {
    const inv = await admin.createInvitation(C, founderUid, invite('member@example.com'));
    const result = await admin.acceptInvitation(C, identity('member-uid', 'Member@Example.com'));
    expect(result).toEqual({ result: 'accepted', role: 'individual_user', teamIds: ['product'] });
    expect(await membership('member-uid')).toMatchObject({ uid: 'member-uid', role: 'individual_user', teamIds: ['product'], status: 'active' });
    expect((await admin.listInvitations(C)).find((i) => i.id === inv.id)?.status).toBe('accepted');
    expect(await audits('invitation.accepted')).toHaveLength(1);
  });

  it('requires the verified token email to match', async () => {
    await admin.createInvitation(C, founderUid, invite('member@example.com'));
    await expectApiError(admin.acceptInvitation(C, identity('other-uid', 'someone-else@example.com')), 404);
    await expectApiError(admin.acceptInvitation(C, identity('member-uid', 'member@example.com', false)), 403);
    expect(await membership('other-uid')).toBeUndefined();
    expect(await membership('member-uid')).toBeUndefined();
  });

  it('refuses expired and revoked invitations', async () => {
    await admin.createInvitation(C, founderUid, invite('late@example.com', { expiresInDays: 1 }));
    clock += 25 * 60 * 60 * 1000;
    await expectApiError(admin.acceptInvitation(C, identity('late-uid', 'late@example.com')), 404);

    const revoked = await admin.createInvitation(C, founderUid, invite('revoked@example.com'));
    await admin.revokeInvitation(C, founderUid, revoked.id);
    await expectApiError(admin.acceptInvitation(C, identity('revoked-uid', 'revoked@example.com')), 404);
    expect(await membership('late-uid')).toBeUndefined();
    expect(await membership('revoked-uid')).toBeUndefined();
  });

  it('is safe to retry: a second accept reports already_member and changes nothing', async () => {
    await admin.createInvitation(C, founderUid, invite('member@example.com'));
    await admin.acceptInvitation(C, identity('member-uid', 'member@example.com'));
    expect(await admin.acceptInvitation(C, identity('member-uid', 'member@example.com'))).toMatchObject({ result: 'already_member' });
    expect(await audits('invitation.accepted')).toHaveLength(1);
  });

  it('concurrent accepts create exactly one membership', async () => {
    await admin.createInvitation(C, founderUid, invite('member@example.com'));
    const results = await Promise.all(Array.from({ length: 5 }, () => admin.acceptInvitation(C, identity('member-uid', 'member@example.com'))));
    expect(results.filter((r) => r.result === 'accepted')).toHaveLength(1);
    expect(results.filter((r) => r.result === 'already_member')).toHaveLength(4);
    expect(await audits('invitation.accepted')).toHaveLength(1);
  });

  it('does not let a suspended member back in through a new invitation', async () => {
    await admin.createInvitation(C, founderUid, invite('member@example.com'));
    await admin.acceptInvitation(C, identity('member-uid', 'member@example.com'));
    await admin.updateMember(C, founderUid, 'member-uid', { status: 'suspended' });
    // Pretend an invitation exists for them anyway (e.g. created before they joined).
    await db.doc(`companies/${C}/invitations/sneaky`).set({ normalizedEmail: 'member@example.com', role: 'company_admin', teamIds: [], status: 'pending', expiresAt: new Date(clock + 86_400_000), createdAt: new Date(clock) });
    const { emailKey } = await import('./firestoreAdminService.js');
    await db.doc(`companies/${C}/invitationEmails/${emailKey('member@example.com')}`).set({ invitationId: 'sneaky' });

    await expectApiError(admin.acceptInvitation(C, identity('member-uid', 'member@example.com')), 403);
    expect(await membership('member-uid')).toMatchObject({ status: 'suspended', role: 'individual_user' });
  });

  it('is refused while the company is suspended', async () => {
    await admin.createInvitation(C, founderUid, invite('member@example.com'));
    await db.doc(`companies/${C}`).update({ status: 'suspended' });
    await expectApiError(admin.acceptInvitation(C, identity('member-uid', 'member@example.com')), 403);
  });
});

describe('changing members', () => {
  async function addMember(uid: string, email: string, role: 'company_admin' | 'individual_user' = 'individual_user') {
    await auth.createUser({ uid, email, emailVerified: true });
    await admin.createInvitation(C, founderUid, invite(email, role === 'company_admin' ? { role, teamIds: [] } : {}));
    await admin.acceptInvitation(C, identity(uid, email));
  }

  it('changes role, teams and status, with an audit event listing the changes', async () => {
    await addMember('m1', 'm1@example.com');
    const view = await admin.updateMember(C, founderUid, 'm1', { teamIds: ['platform', 'product'] });
    expect(view).toMatchObject({ uid: 'm1', email: 'm1@example.com', teamIds: ['platform', 'product'] });
    await admin.updateMember(C, founderUid, 'm1', { role: 'company_admin' });
    expect(await membership('m1')).toMatchObject({ role: 'company_admin', teamIds: [] });
    const events = await audits('member.updated');
    expect(events).toHaveLength(2);
    expect(events.map((e) => Object.keys(e.metadata.changes))).toContainEqual(['role', 'teamIds']);
  });

  it('never lets an admin change their own membership', async () => {
    await expectApiError(admin.updateMember(C, founderUid, founderUid, { status: 'suspended' }), 403);
    await expectApiError(admin.updateMember(C, founderUid, founderUid, { teamIds: ['platform'], role: 'individual_user' }), 403);
  });

  it('keeps at least one active admin, even when two admins demote each other at once', async () => {
    await addMember('admin2', 'admin2@example.com', 'company_admin');
    const results = await Promise.allSettled([
      admin.updateMember(C, founderUid, 'admin2', { status: 'suspended' }),
      admin.updateMember(C, 'admin2', founderUid, { role: 'individual_user', teamIds: ['platform'] }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const admins = await db.collection(`companies/${C}/memberships`).where('role', '==', 'company_admin').where('status', '==', 'active').get();
    expect(admins.size).toBe(1);
  });

  it('refuses unknown members and foreign teams', async () => {
    await expectApiError(admin.updateMember(C, founderUid, 'nobody', { status: 'suspended' }), 404);
    await addMember('m1', 'm1@example.com');
    await expectApiError(admin.updateMember(C, founderUid, 'm1', { teamIds: ['foreign'] }), 400);
  });

  it('lists members with their email from Firebase Authentication', async () => {
    await addMember('m1', 'm1@example.com');
    const members = await admin.listMembers(C);
    expect(members.map((m) => [m.email, m.role])).toEqual([
      ['founder@example.com', 'company_admin'],
      ['m1@example.com', 'individual_user'],
    ]);
  });
});
