import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { LinkRejectedError, sameEmail, type PendingLink, type SlackLinkService, type SlackLinkView } from '../slack/links.js';
import { makeApp, token } from '../test/fakes.js';

const as = (name: string) => ({ Authorization: `Bearer ${token(name)}` });
const CODE = 'c'.repeat(43);

/** Same visibility rules as the Firestore service (tested against the emulator). */
class FakeLinks implements SlackLinkService {
  readonly calls: { method: string; args: unknown[] }[] = [];
  pending: PendingLink = { slackTeamId: 'T1', slackUserId: 'U1', slackName: 'Alice', slackEmail: 'alice@example.com' };
  readonly links: SlackLinkView[] = [];
  async createCode() {
    return CODE;
  }
  async peekCode(...args: unknown[]) {
    this.calls.push({ method: 'peekCode', args });
    return this.pending;
  }
  async redeemCode(c: string, code: string, member: { uid: string; email: string | null; emailVerified: boolean }) {
    this.calls.push({ method: 'redeemCode', args: [c, code, member] });
    if (!sameEmail(this.pending.slackEmail, member.email)) throw new LinkRejectedError('email_mismatch', 'Your Slack email doesn’t match.');
    const link = { id: 'T1_U1', uid: member.uid, slackTeamId: 'T1', slackUserId: 'U1', slackName: 'Alice', linkedAt: null };
    this.links.push(link);
    return link;
  }
  async findUid() {
    return null;
  }
  async listLinks(c: string, actor: { uid: string; role: string }) {
    this.calls.push({ method: 'listLinks', args: [c, actor] });
    return this.links.filter((l) => actor.role === 'company_admin' || l.uid === actor.uid);
  }
  async deleteLink(c: string, actor: { uid: string; role: string }, id: string) {
    this.calls.push({ method: 'deleteLink', args: [c, actor, id] });
  }
}

describe('Slack account linking', () => {
  it('needs a sign-in and an active membership', async () => {
    const slackLinks = new FakeLinks();
    expect((await request(makeApp({ slackLinks }).app).post('/api/slack/link').send({ code: CODE })).status).toBe(401);
    expect((await request(makeApp({ slackLinks }).app).post('/api/slack/link').set(as('sam')).send({ code: CODE })).status).toBe(403);
    expect(slackLinks.calls).toEqual([]);
  });

  it('shows who the code is for and whether the emails match, without revealing the Slack email', async () => {
    const slackLinks = new FakeLinks();
    const res = await request(makeApp({ slackLinks }).app).get(`/api/slack/link?code=${CODE}`).set(as('alice'));
    expect(res.body).toEqual({ slackName: 'Alice', emailMatches: true });
    const other = await request(makeApp({ slackLinks }).app).get(`/api/slack/link?code=${CODE}`).set(as('admin'));
    expect(other.body).toEqual({ slackName: 'Alice', emailMatches: false });
  });

  it('links the verified caller, never anyone named in the body', async () => {
    const slackLinks = new FakeLinks();
    const app = makeApp({ slackLinks }).app;
    expect((await request(app).post('/api/slack/link').set(as('alice')).send({ code: CODE, uid: 'admin' })).status).toBe(400);
    const res = await request(app).post('/api/slack/link').set(as('alice')).send({ code: CODE });
    expect(res.status).toBe(200);
    expect(slackLinks.calls.at(-1)).toEqual({ method: 'redeemCode', args: ['test-company', CODE, { uid: 'alice', email: 'alice@example.com', emailVerified: true }] });
  });

  it('turns an email mismatch into a readable 400', async () => {
    const res = await request(makeApp({ slackLinks: new FakeLinks() }).app).post('/api/slack/link').set(as('admin')).send({ code: CODE });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/doesn’t match/);
  });

  it('lists and removes links as the verified member', async () => {
    const slackLinks = new FakeLinks();
    const app = makeApp({ slackLinks }).app;
    await request(app).get('/api/slack/links').set(as('alice'));
    await request(app).delete('/api/slack/links/T1_U1').set(as('alice'));
    expect(slackLinks.calls).toEqual([
      { method: 'listLinks', args: ['test-company', { uid: 'alice', role: 'individual_user' }] },
      { method: 'deleteLink', args: ['test-company', { uid: 'alice', role: 'individual_user' }, 'T1_U1'] },
    ]);
  });
});
