/** Slack account links against the Firestore emulator. */
import { beforeEach, describe, expect, it } from 'vitest';
import { emulatorApp, resetEmulators } from '../test/emulator.js';
import { CODE_TTL_MS, createFirestoreSlackLinkService, hashCode, LinkRejectedError } from './links.js';

const { db } = emulatorApp();
const C = 'pilot-co';
let now = 1_800_000_000_000;
const links = createFirestoreSlackLinkService({ db, now: () => now });
const pending = { slackTeamId: 'T0001', slackUserId: 'U0001', slackName: 'Alice', slackEmail: 'Alice@Example.com' };
const alice = { uid: 'alice', email: 'alice@example.com', emailVerified: true };

async function rejected(promise: Promise<unknown>, reason: string) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(LinkRejectedError);
  expect((error as LinkRejectedError).reason).toBe(reason);
}

beforeEach(async () => {
  await resetEmulators();
  now = 1_800_000_000_000;
});

describe('Slack links', () => {
  it('stores only a hash of the code, and links once when the emails match', async () => {
    const code = await links.createCode(C, pending);
    expect((await db.doc(`companies/${C}/slackLinkCodes/${hashCode(code)}`).get()).exists).toBe(true);
    expect((await db.collection(`companies/${C}/slackLinkCodes`).get()).docs.map((d) => d.id)).not.toContain(code);
    expect(await links.peekCode(C, code)).toEqual(pending);

    const link = await links.redeemCode(C, code, alice);
    expect(link).toMatchObject({ id: 'T0001_U0001', uid: 'alice', slackName: 'Alice' });
    expect(await links.findUid(C, { teamId: 'T0001', userId: 'U0001' })).toBe('alice');
    await rejected(links.redeemCode(C, code, alice), 'invalid');
    const audit = await db.collection(`companies/${C}/auditEvents`).where('action', '==', 'slackLink.create').get();
    expect(audit.size).toBe(1);
  });

  it('refuses a different or unverified email, and keeps the code for the right person', async () => {
    const code = await links.createCode(C, pending);
    await rejected(links.redeemCode(C, code, { uid: 'mallory', email: 'mallory@example.com', emailVerified: true }), 'email_mismatch');
    await rejected(links.redeemCode(C, code, { ...alice, emailVerified: false }), 'email_mismatch');
    expect(await links.findUid(C, { teamId: 'T0001', userId: 'U0001' })).toBeNull();
    expect((await links.redeemCode(C, code, alice)).uid).toBe('alice');
  });

  it('refuses a Slack profile with no email, an expired code and a made-up code', async () => {
    await rejected(links.redeemCode(C, await links.createCode(C, { ...pending, slackEmail: null }), alice), 'no_slack_email');
    const code = await links.createCode(C, pending);
    now += CODE_TTL_MS + 1;
    await rejected(links.redeemCode(C, code, alice), 'expired');
    await rejected(links.peekCode(C, 'x'.repeat(43)), 'invalid');
    await rejected(links.peekCode(C, '../../memberships/alice'), 'invalid');
  });

  it('lets people see and remove their own links; admins see and remove all', async () => {
    await links.redeemCode(C, await links.createCode(C, pending), alice);
    await links.redeemCode(C, await links.createCode(C, { ...pending, slackUserId: 'U0002', slackEmail: 'bob@example.com' }), { uid: 'bob', email: 'bob@example.com', emailVerified: true });
    expect((await links.listLinks(C, { uid: 'alice', role: 'individual_user' })).map((l) => l.uid)).toEqual(['alice']);
    expect((await links.listLinks(C, { uid: 'admin', role: 'company_admin' })).length).toBe(2);
    await rejected(links.deleteLink(C, { uid: 'alice', role: 'individual_user' }, 'T0001_U0002'), 'not_found');
    await links.deleteLink(C, { uid: 'alice', role: 'individual_user' }, 'T0001_U0001');
    await links.deleteLink(C, { uid: 'admin', role: 'company_admin' }, 'T0001_U0002');
    expect(await links.listLinks(C, { uid: 'admin', role: 'company_admin' })).toEqual([]);
    await rejected(links.deleteLink(C, { uid: 'admin', role: 'company_admin' }, '../x'), 'not_found');
  });
});
