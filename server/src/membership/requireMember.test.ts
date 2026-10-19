import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authenticate } from '../auth/authenticate.js';
import { errorHandler } from '../http/errors.js';
import { silentLogger } from '../http/logger.js';
import { COMPANY_ID, FakeStore, FakeVerifier, IDENTITIES, pilotData, token } from '../test/fakes.js';
import { parseMembership } from './records.js';
import { requireActiveMember, requireRole } from './requireMember.js';

function adminOnlyApp(store = new FakeStore(pilotData())) {
  const app = express();
  app.get(
    '/admin-only',
    authenticate({ verifier: new FakeVerifier(IDENTITIES), logger: silentLogger }),
    requireActiveMember({ store, companyId: COMPANY_ID, logger: silentLogger }),
    requireRole('company_admin'),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  app.use(errorHandler(silentLogger));
  return app;
}

describe('requireRole', () => {
  it('lets the admin through and refuses an individual user with 403', async () => {
    expect((await request(adminOnlyApp()).get('/admin-only').set('Authorization', `Bearer ${token('admin')}`)).status).toBe(200);
    expect((await request(adminOnlyApp()).get('/admin-only').set('Authorization', `Bearer ${token('alice')}`)).status).toBe(403);
  });

  it('cannot be satisfied by a role sent by the client', async () => {
    const res = await request(adminOnlyApp())
      .get('/admin-only?role=company_admin')
      .set('Authorization', `Bearer ${token('alice')}`)
      .set('X-Role', 'company_admin');
    expect(res.status).toBe(403);
  });
});

describe('malformed membership records', () => {
  it('are refused with a 500, never treated as access', async () => {
    const store = new FakeStore(pilotData());
    // Same parser the Firestore store uses, applied to a stored role nobody defined.
    store.getMembership = async (c, uid) => parseMembership(c, uid, { uid, role: 'superuser', teamIds: [], status: 'active' });
    const res = await request(adminOnlyApp(store)).get('/admin-only').set('Authorization', `Bearer ${token('admin')}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal');
  });
});

describe('read-only members', () => {
  function viewerApp() {
    const store = new FakeStore(pilotData());
    store.data.memberships[COMPANY_ID].admin = { ...store.data.memberships[COMPANY_ID].admin, readOnly: true };
    const app = express();
    const guard = [authenticate({ verifier: new FakeVerifier(IDENTITIES), logger: silentLogger }), requireActiveMember({ store, companyId: COMPANY_ID, logger: silentLogger })];
    const ok: express.RequestHandler = (_req, res) => {
      res.json({ ok: true });
    };
    app.get('/api/members', ...guard, ok);
    app.post('/api/invitations', ...guard, ok);
    app.post('/api/keys', ...guard, ok);
    app.put('/api/exchange-rates/2026-10', ...guard, ok);
    app.patch('/api/members/x', ...guard, ok);
    app.delete('/api/slack/links/x', ...guard, ok);
    app.post('/api/assistant/ask', ...guard, ok);
    app.use(errorHandler(silentLogger));
    return app;
  }
  const auth = { Authorization: `Bearer ${token('admin')}` };

  it('can read and ask the assistant', async () => {
    const app = viewerApp();
    expect((await request(app).get('/api/members').set(auth)).status).toBe(200);
    expect((await request(app).post('/api/assistant/ask').set(auth)).status).toBe(200);
  });

  it('is refused every change with 403', async () => {
    const app = viewerApp();
    for (const res of [
      await request(app).post('/api/invitations').set(auth),
      await request(app).post('/api/keys').set(auth),
      await request(app).put('/api/exchange-rates/2026-10').set(auth),
      await request(app).patch('/api/members/x').set(auth),
      await request(app).delete('/api/slack/links/x').set(auth),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    }
  });

  it('only accepts true or false in the stored flag', () => {
    expect(parseMembership('c', 'u', { uid: 'u', role: 'company_admin', teamIds: [], status: 'active', readOnly: true }).readOnly).toBe(true);
    expect(parseMembership('c', 'u', { uid: 'u', role: 'company_admin', teamIds: [], status: 'active', readOnly: false }).readOnly).toBeUndefined();
    expect(() => parseMembership('c', 'u', { uid: 'u', role: 'company_admin', teamIds: [], status: 'active', readOnly: 'yes' })).toThrow();
  });
});
