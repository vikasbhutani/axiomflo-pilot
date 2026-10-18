/** The gateway end to end: real AxiomFlo keys and usage records in the emulators, a pretend Anthropic. */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyBootstrap } from '../bootstrap/bootstrap.js';
import { parseBootstrapInput } from '../bootstrap/input.js';
import { silentLogger } from '../http/logger.js';
import { createFirestoreKeyService } from '../keys/firestoreKeyService.js';
import { emulatorApp, resetEmulators } from '../test/emulator.js';
import { FakeAnthropic } from '../test/fakeAnthropic.js';
import { testConfig } from '../test/testConfig.js';
import { createGatewayApp } from './app.js';
import { createFirestoreUsageRecorder } from './usage.js';

const { auth, db } = emulatorApp();
const C = 'pilot-co';
const keys = createFirestoreKeyService({ db, auth });
const setup = parseBootstrapInput({
  company: { id: C, name: 'Pilot Co', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' },
  department: { id: 'engineering', name: 'Engineering' },
  teams: [
    { id: 'platform', name: 'Platform', code: 'PLAT' },
    { id: 'product', name: 'Product', code: 'PROD' },
  ],
});

let upstream: FakeAnthropic;
let aliceUid: string;
let aliceKey: string;
let aliceKeyId: string;

const gateway = () =>
  createGatewayApp({ config: { ...testConfig({ pilotCompanyId: C }), anthropicApiKey: 'sk-ant-company', anthropicBaseUrl: upstream.url, vertexProjectId: 'axiomflo-test', vertexBaseUrl: upstream.url }, logger: silentLogger, keys, usage: createFirestoreUsageRecorder(db), googleTokens: { token: async () => 'google-token' } });
const ask = (key: string) => request(gateway()).post('/anthropic/v1/messages').set('x-api-key', key).send({ model: 'claude-sonnet-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'SECRET PROMPT TEXT' }] });
const usageDocs = async () => (await db.collection(`companies/${C}/usage`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

beforeEach(async () => {
  await resetEmulators();
  upstream = new FakeAnthropic();
  await upstream.start();
  const founder = await auth.createUser({ email: 'founder@example.com', emailVerified: true });
  await applyBootstrap(db, setup, founder.uid);
  const a = await auth.createUser({ email: 'alice@example.com', emailVerified: true });
  aliceUid = a.uid;
  await db.doc(`companies/${C}/memberships/${a.uid}`).set({ uid: a.uid, role: 'individual_user', teamIds: ['product'], status: 'active' });
  const created = await keys.createKey(C, { uid: a.uid, role: 'individual_user', teamIds: ['product'] }, { name: 'Laptop', teamId: 'product' });
  aliceKey = created.secret;
  aliceKeyId = created.key.id;
});
afterEach(() => upstream.stop());

describe('gateway with real keys', () => {
  it('forwards a request and stores one usage record under the company, without the prompt', async () => {
    const res = await ask(aliceKey);
    expect(res.status).toBe(200);
    const docs = await usageDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      id: res.headers['x-request-id'],
      principal: { type: 'user', id: aliceUid },
      keyId: aliceKeyId,
      teamId: 'product',
      teamCode: 'PROD',
      modelId: 'claude-sonnet-5-5',
      inputTokens: 1000,
      outputTokens: 500,
      requestStatus: 'succeeded',
      costStatus: 'estimated',
    });
    expect(docs[0]).toHaveProperty('recordedAt');
    expect(JSON.stringify(docs)).not.toContain('SECRET');
    expect(JSON.stringify(docs)).not.toContain(aliceKey.slice(29));
  });

  it('stops working as soon as the key is revoked or the member is suspended', async () => {
    await keys.revokeKey(C, { uid: aliceUid, role: 'individual_user', teamIds: ['product'] }, aliceKeyId);
    expect((await ask(aliceKey)).status).toBe(401);

    const second = await keys.createKey(C, { uid: aliceUid, role: 'individual_user', teamIds: ['product'] }, { name: 'Second', teamId: 'product' });
    await db.doc(`companies/${C}/memberships/${aliceUid}`).update({ status: 'suspended' });
    expect((await ask(second.secret)).status).toBe(403);

    expect(upstream.seen).toEqual([]);
    expect(await usageDocs()).toEqual([]);
  });

  it('records a Gemini request the same way', async () => {
    upstream.respond = (_r, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'SECRET' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 }, modelVersion: 'gemini-2.5-flash' }));
    };
    const res = await request(gateway()).post('/vertex/v1beta/models/gemini-2.5-flash:generateContent').set('x-goog-api-key', aliceKey).send({ contents: [{ role: 'user', parts: [{ text: 'SECRET PROMPT TEXT' }] }] });
    expect(res.status).toBe(200);
    const docs = await usageDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ providerId: 'gemini_vertex', modelId: 'gemini-2.5-flash', teamCode: 'PROD', inputTokens: 100, outputTokens: 20, costStatus: 'estimated' });
    expect(JSON.stringify(docs)).not.toContain('SECRET');
  });

  it('refuses a key once its team is taken off the member', async () => {
    await db.doc(`companies/${C}/memberships/${aliceUid}`).update({ teamIds: ['platform'] });
    expect((await ask(aliceKey)).status).toBe(403);
    expect(upstream.seen).toEqual([]);
  });
});
