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
