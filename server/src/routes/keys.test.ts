import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { generateKey, hashSecret, parseKey, secretMatches } from '../keys/keyFormat.js';
import { makeApp, token } from '../test/fakes.js';

const as = (name: string) => ({ Authorization: `Bearer ${token(name)}` });
const KEY_ID = 'a'.repeat(24);

describe('key routes', () => {
  const routes: [string, string, object?][] = [
    ['get', '/api/keys'],
    ['post', '/api/keys', { name: 'Laptop', teamId: 'team-a' }],
    ['post', `/api/keys/${KEY_ID}/revoke`],
  ];

  it.each(routes)('%s %s needs a sign-in and an active membership', async (method, path, body) => {
    for (const [who, status] of [[null, 401], ['sam', 403], ['newcomer', 403], ['outsider', 403]] as const) {
      const { app, keys } = makeApp();
      const req = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path);
      const res = await (who ? req.set(as(who)) : req).send(body);
      expect(res.status).toBe(status);
      expect(keys.calls).toEqual([]);
    }
  });

  it('creates a key as the signed-in member, returns the secret once and is never cached', async () => {
    const { app, keys } = makeApp();
    const res = await request(app).post('/api/keys').set(as('alice')).send({ name: ' Laptop ', teamId: 'team-a' });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.secret).toMatch(/^axf_/);
    expect(keys.calls[0]).toEqual({ method: 'createKey', args: ['test-company', { uid: 'alice', role: 'individual_user', teamIds: ['team-a'] }, { name: 'Laptop', teamId: 'team-a' }] });
  });

  it('refuses an owner or extra fields in the body', async () => {
    const { app, keys } = makeApp();
    const res = await request(app).post('/api/keys').set(as('alice')).send({ name: 'x', teamId: 'team-a', uid: 'admin' });
    expect(res.status).toBe(400);
    expect(keys.calls).toEqual([]);
  });

  it('lists only the caller’s keys for an individual user', async () => {
    const { app } = makeApp();
    await request(app).post('/api/keys').set(as('admin')).send({ name: 'Admin key', teamId: 'team-b' });
    await request(app).post('/api/keys').set(as('alice')).send({ name: 'Alice key', teamId: 'team-a' });
    const mine = await request(app).get('/api/keys').set(as('alice'));
    expect(mine.body.keys.map((k: { name: string }) => k.name)).toEqual(['Alice key']);
    const all = await request(app).get('/api/keys').set(as('admin'));
    expect(all.body.keys).toHaveLength(2);
    expect(JSON.stringify(all.body)).not.toContain('axf_');
  });

  it('rejects a malformed key ID, and turns database failures into 503', async () => {
    const { app, keys } = makeApp();
    expect((await request(app).post('/api/keys/not-a-key/revoke').set(as('alice'))).status).toBe(400);
    keys.failWith = new Error('14 UNAVAILABLE');
    expect((await request(app).get('/api/keys').set(as('alice'))).status).toBe(503);
  });
});

describe('key format', () => {
  it('generates keys that parse, and only the right secret matches the stored hash', () => {
    const { id, secret, full } = generateKey();
    expect(parseKey(full)).toEqual({ id, secret });
    const stored = hashSecret(secret);
    expect(stored).not.toContain(secret);
    expect(secretMatches(secret, stored)).toBe(true);
    expect(secretMatches(generateKey().secret, stored)).toBe(false);
  });

  it('rejects anything that is not exactly an AxiomFlo key', () => {
    const { full } = generateKey();
    for (const raw of ['', 'sk-ant-api03-xyz', full + 'x', full.replace('axf_', 'axg_'), full.slice(0, -1), ` ${full}`]) expect(parseKey(raw)).toBeNull();
  });
});
