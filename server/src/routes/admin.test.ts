import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../http/errors.js';
import { FakeAdmin, makeApp, token } from '../test/fakes.js';

const as = (name: string) => ({ Authorization: `Bearer ${token(name)}` });

describe('admin-only routes', () => {
  const routes: [string, string, object?][] = [
    ['get', '/api/members'],
    ['patch', '/api/members/alice', { role: 'company_admin' }],
    ['get', '/api/invitations'],
    ['post', '/api/invitations', { email: 'new@example.com', role: 'individual_user', teamIds: ['team-a'] }],
    ['post', '/api/invitations/inv-1/revoke'],
  ];

  it.each(routes)('%s %s needs a sign-in (401)', async (method, path, body) => {
    const { app, admin } = makeApp();
    const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path).send(body);
    expect(res.status).toBe(401);
    expect(admin.calls).toEqual([]);
  });

  it.each(routes)('%s %s refuses an individual user, a suspended member and a newcomer (403)', async (method, path, body) => {
    for (const who of ['alice', 'sam', 'newcomer', 'outsider']) {
      const { app, admin } = makeApp();
      const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path).set(as(who)).send(body);
      expect(res.status).toBe(403);
      expect(admin.calls).toEqual([]);
    }
  });

  it('lets the admin list members, scoped to the pilot company', async () => {
    const { app, admin } = makeApp();
    const res = await request(app).get('/api/members').set(as('admin'));
    expect(res.status).toBe(200);
    expect(admin.calls).toEqual([{ method: 'listMembers', args: ['test-company'] }]);
  });
});

describe('POST /api/invitations', () => {
  it('creates an invitation with a normalized email and the admin as the inviter', async () => {
    const { app, admin } = makeApp();
    const res = await request(app).post('/api/invitations').set(as('admin')).send({ email: '  New.Person@Example.COM ', role: 'individual_user', teamIds: ['team-a'] });
    expect(res.status).toBe(201);
    expect(res.body.invitation).toMatchObject({ email: 'new.person@example.com', delivery: 'Created — email not sent' });
    expect(admin.calls[0]).toEqual({ method: 'createInvitation', args: ['test-company', 'admin', { normalizedEmail: 'new.person@example.com', role: 'individual_user', teamIds: ['team-a'], expiresInDays: 14 }] });
  });

  it.each([
    ['a bad email', { email: 'not-an-email', role: 'individual_user', teamIds: ['team-a'] }],
    ['an unknown role', { email: 'a@example.com', role: 'owner', teamIds: ['team-a'] }],
    ['an individual user with no team', { email: 'a@example.com', role: 'individual_user', teamIds: [] }],
    ['an admin with teams', { email: 'a@example.com', role: 'company_admin', teamIds: ['team-a'] }],
    ['an expiry over 30 days', { email: 'a@example.com', role: 'individual_user', teamIds: ['team-a'], expiresInDays: 90 }],
    ['a fractional expiry', { email: 'a@example.com', role: 'individual_user', teamIds: ['team-a'], expiresInDays: 1.5 }],
    ['an extra field (company)', { email: 'a@example.com', role: 'individual_user', teamIds: ['team-a'], companyId: 'other-company' }],
    ['an extra field (invitedBy)', { email: 'a@example.com', role: 'individual_user', teamIds: ['team-a'], invitedBy: 'someone' }],
    ['team IDs that are not strings', { email: 'a@example.com', role: 'individual_user', teamIds: [{ $gt: '' }] }],
  ])('rejects %s with 400 before touching the database', async (_label, body) => {
    const { app, admin } = makeApp();
    const res = await request(app).post('/api/invitations').set(as('admin')).send(body);
    expect(res.status).toBe(400);
    expect(admin.calls).toEqual([]);
  });

  it('passes conflicts (e.g. a duplicate pending invitation) through as 409', async () => {
    const admin = new FakeAdmin();
    admin.failWith = new ApiError(409, 'conflict', 'There is already a pending invitation for this email.');
    const { app } = makeApp({ admin });
    const res = await request(app).post('/api/invitations').set(as('admin')).send({ email: 'a@example.com', role: 'individual_user', teamIds: ['team-a'] });
    expect(res.status).toBe(409);
  });

  it('turns a database failure into 503, never success', async () => {
    const admin = new FakeAdmin();
    admin.failWith = Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    const { app } = makeApp({ admin });
    const res = await request(app).post('/api/invitations').set(as('admin')).send({ email: 'a@example.com', role: 'individual_user', teamIds: ['team-a'] });
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('UNAVAILABLE');
  });

  it('rate-limits invitation and member changes per admin', async () => {
    const { app } = makeApp();
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) {
      statuses.push((await request(app).post('/api/invitations').set(as('admin')).send({ email: `p${i}@example.com`, role: 'individual_user', teamIds: ['team-a'] })).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 201)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
  });
});

describe('POST /api/invitations/accept', () => {
  it('uses only the verified identity, ignoring any role, team or email in the body', async () => {
    const { app, admin } = makeApp();
    const res = await request(app).post('/api/invitations/accept').set(as('newcomer')).send({ role: 'company_admin', teamIds: ['team-b'], email: 'admin@example.com', uid: 'admin' });
    expect(res.status).toBe(200);
    expect(admin.calls).toEqual([{ method: 'acceptInvitation', args: ['test-company', expect.objectContaining({ uid: 'newcomer', email: 'newcomer@example.com' })] }]);
  });

  it('needs a valid sign-in', async () => {
    for (const name of [undefined, 'expired', 'revoked']) {
      const { app, admin } = makeApp();
      const req = request(app).post('/api/invitations/accept');
      const res = await (name ? req.set(as(name)) : req);
      expect(res.status).toBe(401);
      expect(admin.calls).toEqual([]);
    }
  });

  it('reports "no matching invitation" as 404', async () => {
    const admin = new FakeAdmin();
    admin.failWith = new ApiError(404, 'not_found', 'No invitation matches your email address.');
    const { app } = makeApp({ admin });
    expect((await request(app).post('/api/invitations/accept').set(as('newcomer'))).status).toBe(404);
  });
});

describe('PATCH /api/members/:uid', () => {
  it('passes the acting admin from the token, not from the request', async () => {
    const { app, admin } = makeApp();
    const res = await request(app).patch('/api/members/alice').set(as('admin')).send({ status: 'suspended' });
    expect(res.status).toBe(200);
    expect(admin.calls[0]).toEqual({ method: 'updateMember', args: ['test-company', 'admin', 'alice', { status: 'suspended' }] });
  });

  it.each([
    ['an empty change', {}],
    ['an unknown status', { status: 'deleted' }],
    ['an unknown field', { companyId: 'other-company' }],
    ['a uid in the body', { uid: 'admin', role: 'individual_user' }],
  ])('rejects %s with 400', async (_label, body) => {
    const { app, admin } = makeApp();
    expect((await request(app).patch('/api/members/alice').set(as('admin')).send(body)).status).toBe(400);
    expect(admin.calls).toEqual([]);
  });

  it('rejects a malformed member ID', async () => {
    const { app } = makeApp();
    expect((await request(app).patch('/api/members/a%2Fb').set(as('admin')).send({ status: 'active' })).status).toBe(400);
  });
});
