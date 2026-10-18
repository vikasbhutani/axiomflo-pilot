import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { monthBoundsUtc } from '../reports/months.js';
import { FakeUsage, makeApp, token } from '../test/fakes.js';

const as = (name: string) => ({ Authorization: `Bearer ${token(name)}` });

describe('reporting months', () => {
  it('are Sydney calendar months, daylight saving included', () => {
    // October 2026: AEST (+10) on the 1st, AEDT (+11) from the 4th; November starts in AEDT.
    expect(monthBoundsUtc('2026-10', 'Australia/Sydney')).toEqual(['2026-09-30T14:00:00.000Z', '2026-10-31T13:00:00.000Z']);
    expect(monthBoundsUtc('2026-12', 'Australia/Sydney')).toEqual(['2026-11-30T13:00:00.000Z', '2026-12-31T13:00:00.000Z']);
    expect(monthBoundsUtc('2026-04', 'Australia/Sydney')).toEqual(['2026-03-31T13:00:00.000Z', '2026-04-30T14:00:00.000Z']);
    expect(monthBoundsUtc('2026-02', 'UTC')).toEqual(['2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z']);
  });
});

describe('GET /api/usage', () => {
  it('needs a sign-in and an active membership', async () => {
    expect((await request(makeApp().app).get('/api/usage?month=2026-10')).status).toBe(401);
    for (const who of ['sam', 'newcomer', 'outsider']) {
      const { app, usage } = makeApp();
      expect((await request(app).get('/api/usage?month=2026-10').set(as(who))).status).toBe(403);
      expect(usage.calls).toEqual([]);
    }
  });

  it('scopes by the verified member, never by anything in the request', async () => {
    const { app, usage } = makeApp();
    const res = await request(app).get('/api/usage?month=2026-10&uid=admin&role=company_admin&teamId=team-b').set(as('alice'));
    expect(res.status).toBe(200);
    expect(usage.calls).toEqual([
      { method: 'listUsage', args: ['test-company', { uid: 'alice', role: 'individual_user' }, { startIso: '2026-09-30T14:00:00.000Z', endIso: '2026-10-31T13:00:00.000Z' }] },
    ]);
    expect(res.body).toMatchObject({ month: '2026-10', records: [], truncated: false });
  });

  it.each(['', '2026-13', '2026-1', '26-10', '2026-10-01', '1999-01'])('rejects month "%s" with 400', async (month) => {
    const { app, usage } = makeApp();
    expect((await request(app).get(`/api/usage?month=${month}`).set(as('admin'))).status).toBe(400);
    expect(usage.calls).toEqual([]);
  });

  it('turns a database failure into 503', async () => {
    const usage = new FakeUsage();
    usage.failWith = Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    const res = await request(makeApp({ usage }).app).get('/api/usage?month=2026-10').set(as('admin'));
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('UNAVAILABLE');
  });
});

describe('exchange rates', () => {
  it('any member can read them', async () => {
    const res = await request(makeApp().app).get('/api/exchange-rates').set(as('alice'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ currency: 'AUD', rates: [] });
  });

  it('only an admin can set one, in the company’s currency', async () => {
    const { app, usage } = makeApp();
    expect((await request(app).put('/api/exchange-rates/2026-10').set(as('alice')).send({ rate: 1.5 })).status).toBe(403);
    expect(usage.calls).toEqual([]);
    const res = await request(app).put('/api/exchange-rates/2026-10').set(as('admin')).send({ rate: 1.523 });
    expect(res.status).toBe(200);
    expect(usage.calls).toEqual([{ method: 'setRate', args: ['test-company', 'admin', '2026-10', 1.523, 'AUD'] }]);
  });

  it.each([
    ['no rate', {}],
    ['a zero rate', { rate: 0 }],
    ['a negative rate', { rate: -1 }],
    ['a text rate', { rate: '1.5' }],
    ['an extra field', { rate: 1.5, currency: 'USD' }],
  ])('rejects %s with 400', async (_label, body) => {
    const { app, usage } = makeApp();
    expect((await request(app).put('/api/exchange-rates/2026-10').set(as('admin')).send(body)).status).toBe(400);
    expect(usage.calls).toEqual([]);
  });
});
