import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../http/logger.js';
import { FakeStore, makeApp, pilotData, token } from '../test/fakes.js';

const PROTECTED = ['/api/me', '/api/company', '/api/teams'];
const get = (path: string, name?: string) => {
  const { app, store } = makeApp();
  const req = request(app).get(path);
  return { req: name ? req.set('Authorization', `Bearer ${token(name)}`) : req, store };
};

describe('authentication on every /api route', () => {
  it.each(PROTECTED)('%s returns 401 without a token', async (path) => {
    const res = await get(path).req;
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it.each([
    ['not a bearer scheme', `Basic ${token('admin')}`],
    ['lower-case scheme with extra spaces', `bearer  ${token('admin')}`],
    ['empty bearer', 'Bearer '],
    ['not a JWT shape', 'Bearer admin'],
    ['two tokens', `Bearer ${token('admin')} ${token('admin')}`],
    ['oversized', `Bearer ${'a'.repeat(5000)}.${'b'.repeat(5000)}.admin`],
  ])('rejects a malformed Authorization header (%s) without calling Firebase', async (_label, header) => {
    const { app, verifier } = makeApp();
    const res = await request(app).get('/api/me').set('Authorization', header);
    expect(res.status).toBe(401);
    expect(verifier.seen).toEqual([]);
  });

  it.each(['expired', 'revoked', 'disabled', 'wrongproject', 'garbage'])('returns 401 for a %s token and reads no membership', async (name) => {
    const { req, store } = get('/api/me', name);
    const res = await req;
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('invalid_token');
    expect(store.reads).toEqual([]);
  });

  it('returns 503 (never access) when the token cannot be checked', async () => {
    const res = await get('/api/me', 'authdown').req;
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('auth_unavailable');
  });

  it('never logs the token or the Authorization header', async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'debug', write: (l) => lines.push(l) });
    const { app } = makeApp({ logger });
    await request(app).get('/api/me').set('Authorization', `Bearer ${token('expired')}`);
    await request(app).get('/api/me').set('Authorization', `Bearer ${token('admin')}`);
    expect(lines.join('\n')).not.toContain('header.payload');
  });
});

describe('GET /api/me', () => {
  it('gives an unknown signed-in person pending access, without creating anything', async () => {
    const { req, store } = get('/api/me', 'newcomer');
    const res = await req;
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { uid: 'newcomer', email: 'newcomer@example.com', emailVerified: true, displayName: 'newcomer' },
      access: 'pending',
      reason: 'no_membership',
    });
    expect(store.data.memberships['test-company'].newcomer).toBeUndefined();
  });

  it('treats an unverified email as pending and does not look up the membership', async () => {
    const { req, store } = get('/api/me', 'unverified');
    const res = await req;
    expect(res.body).toMatchObject({ access: 'pending', reason: 'email_unverified' });
    expect(res.body.company).toBeUndefined();
    expect(store.reads).toEqual([]);
  });

  it('gives the admin company-wide access with every team', async () => {
    const res = await get('/api/me', 'admin').req;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      access: 'active',
      company: { id: 'test-company', name: 'Test Company', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' },
      membership: { role: 'company_admin', teamIds: [] },
    });
    expect(res.body.teams.map((t: { id: string }) => t.id)).toEqual(['team-a', 'team-b']);
    expect(res.body.company.status).toBeUndefined();
  });

  it('gives an individual user only their assigned team', async () => {
    const res = await get('/api/me', 'alice').req;
    expect(res.body).toMatchObject({ access: 'active', membership: { role: 'individual_user', teamIds: ['team-a'] } });
    expect(res.body.teams.map((t: { id: string }) => t.id)).toEqual(['team-a']);
  });

  it('reports a suspended member as suspended with no company details', async () => {
    const res = await get('/api/me', 'sam').req;
    expect(res.body).toEqual({ user: expect.any(Object), access: 'suspended', reason: 'membership_suspended' });
  });

  it('reports everyone as suspended when the company is suspended', async () => {
    const data = pilotData();
    data.companies['test-company'].status = 'suspended';
    const { app } = makeApp({ store: new FakeStore(data) });
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token('admin')}`);
    expect(res.body).toMatchObject({ access: 'suspended', reason: 'company_suspended' });
  });

  it('only looks in the configured pilot company: an admin elsewhere is pending here', async () => {
    const { req, store } = get('/api/me', 'outsider');
    const res = await req;
    expect(res.body).toMatchObject({ access: 'pending', reason: 'no_membership' });
    expect(store.reads.every((r) => r.includes('test-company'))).toBe(true);
  });

  it('returns 503, not pending, when the database is down', async () => {
    const store = new FakeStore(pilotData());
    store.failing = true;
    const { app } = makeApp({ store });
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token('admin')}`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('membership_unavailable');
    expect(res.body.access).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('UNAVAILABLE');
  });

  it('drops assigned team IDs that do not belong to the company', async () => {
    const data = pilotData();
    data.memberships['test-company'].alice.teamIds = ['team-a', 'team-x'];
    const { app } = makeApp({ store: new FakeStore(data) });
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token('alice')}`);
    expect(res.body.membership.teamIds).toEqual(['team-a']);
    expect(res.body.teams.map((t: { id: string }) => t.id)).toEqual(['team-a']);
  });
});

describe('client-supplied values cannot change access', () => {
  it('ignores company, role, uid and demo-role hints in the query, headers and body', async () => {
    const { app, store } = makeApp();
    const res = await request(app)
      .get('/api/me?companyId=other-company&role=company_admin&uid=admin')
      .set('Authorization', `Bearer ${token('alice')}`)
      .set('X-Company-Id', 'other-company')
      .set('X-Demo-Role', 'company_admin')
      .set('X-User-Id', 'admin')
      .send({ uid: 'admin', role: 'company_admin', teamIds: ['team-b'] });
    expect(res.body).toMatchObject({ user: { uid: 'alice' }, company: { id: 'test-company' }, membership: { role: 'individual_user', teamIds: ['team-a'] } });
    expect(store.reads).not.toContain('membership:test-company/admin');
    expect(store.reads.some((r) => r.includes('other-company'))).toBe(false);
  });

  it('an individual user cannot see other teams by asking for them', async () => {
    const res = await get('/api/teams?teamId=team-b&all=true', 'alice').req;
    expect(res.body.teams.map((t: { id: string }) => t.id)).toEqual(['team-a']);
  });
});

describe('GET /api/company and /api/teams', () => {
  it('return company details and all teams to the admin', async () => {
    const company = await get('/api/company', 'admin').req;
    expect(company.status).toBe(200);
    expect(company.body).toEqual({ company: { id: 'test-company', name: 'Test Company', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' } });
    const teams = await get('/api/teams', 'admin').req;
    expect(teams.body.teams).toHaveLength(2);
  });

  it.each(['newcomer', 'sam', 'outsider', 'unverified'])('refuse %s with 403', async (name) => {
    for (const path of ['/api/company', '/api/teams']) {
      const res = await get(path, name).req;
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    }
  });

  it('re-check the membership on every request, so a suspension applies immediately', async () => {
    const { app, store } = makeApp();
    const call = () => request(app).get('/api/teams').set('Authorization', `Bearer ${token('alice')}`);
    expect((await call()).status).toBe(200);
    store.data.memberships['test-company'].alice.status = 'suspended';
    expect((await call()).status).toBe(403);
  });

  it('return 503 when the database is down', async () => {
    const store = new FakeStore(pilotData());
    store.failing = true;
    const { app } = makeApp({ store });
    const res = await request(app).get('/api/teams').set('Authorization', `Bearer ${token('admin')}`);
    expect(res.status).toBe(503);
  });
});
