import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { KeyRejectedError, type KeyPrincipal } from '../keys/service.js';
import { FakeAnthropic as FakeUpstream } from '../test/fakeAnthropic.js';
import { FakeKeys } from '../test/fakes.js';
import { testConfig } from '../test/testConfig.js';
import type { Logger } from '../http/logger.js';
import { createGatewayApp } from './app.js';
import type { GatewayConfig } from './config.js';
import { baseGeminiModel, estimateVertexCostUsd, VERTEX_PRICE_VERSION } from './vertexPrices.js';
import type { UsageRecord, UsageRecorder } from './usage.js';

const GOOGLE_TOKEN = 'ya29.gateway-own-token-never-shown';
const ALICE_KEY = `axf_${'a'.repeat(24)}_${'s'.repeat(43)}`;
const ALICE: KeyPrincipal = { keyId: 'a'.repeat(24), uid: 'alice', role: 'individual_user', teamId: 'team-a', teamCode: 'TEAM-A' };
const OCT = new Date('2026-10-18T00:00:00Z');

class MemoryUsage implements UsageRecorder {
  readonly records: UsageRecord[] = [];
  async record(_c: string, record: UsageRecord) {
    this.records.push(record);
  }
}

const usageMetadata = (prompt = 1000, candidates = 400, thoughts = 100, cached = 0) => ({ promptTokenCount: prompt, candidatesTokenCount: candidates, thoughtsTokenCount: thoughts, cachedContentTokenCount: cached, totalTokenCount: prompt + candidates + thoughts });
const answer = (model = 'gemini-2.5-flash', usage = usageMetadata()) => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'SECRET ANSWER TEXT' }] }, finishReason: 'STOP' }], usageMetadata: usage, modelVersion: model });
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': 'vx-1' });
  res.end(JSON.stringify(body));
}

let upstream: FakeUpstream;
let keys: FakeKeys;
let usage: MemoryUsage;
let logs: string[];
let tokenFails: boolean;

function gateway() {
  const config: GatewayConfig = { ...testConfig(), anthropicApiKey: 'sk-ant', anthropicBaseUrl: upstream.url, vertexProjectId: 'axiomflo-pilot', vertexBaseUrl: upstream.url };
  const logger: Logger = { debug() {}, info: (m, f) => logs.push(JSON.stringify([m, f])), warn: (m, f) => logs.push(JSON.stringify([m, f])), error: (m, f) => logs.push(JSON.stringify([m, f])) };
  return createGatewayApp({ config, logger, keys, usage, googleTokens: { token: async () => (tokenFails ? Promise.reject(new Error('metadata server down')) : GOOGLE_TOKEN) } });
}
const body = { contents: [{ role: 'user', parts: [{ text: 'SECRET PROMPT TEXT' }] }] };
const ask = (path = '/vertex/v1beta/models/gemini-2.5-flash:generateContent', b: object = body) => request(gateway()).post(path).set('x-goog-api-key', ALICE_KEY).send(b);

beforeEach(async () => {
  upstream = new FakeUpstream();
  upstream.respond = (_r, res) => json(res, 200, answer());
  await upstream.start();
  keys = new FakeKeys();
  keys.principals[ALICE_KEY] = ALICE;
  usage = new MemoryUsage();
  logs = [];
  tokenFails = false;
});
afterEach(() => upstream.stop());

describe('Gemini key check', () => {
  it('needs a key (401, Google error shape) and forwards nothing', async () => {
    const res = await request(gateway()).post('/vertex/v1beta/models/gemini-2.5-flash:generateContent').send(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 401, status: 'UNAUTHENTICATED' });
    expect(upstream.seen).toEqual([]);
  });

  it('refuses a revoked key with 401 and a suspended member with 403', async () => {
    keys.principals[ALICE_KEY] = new KeyRejectedError('revoked');
    expect((await ask()).status).toBe(401);
    keys.principals[ALICE_KEY] = new KeyRejectedError('member_suspended');
    expect((await ask()).body.error.status).toBe('PERMISSION_DENIED');
    expect(upstream.seen).toEqual([]);
  });

  it('returns 503 when the key database is unavailable', async () => {
    keys.principals[ALICE_KEY] = new Error('14 UNAVAILABLE');
    expect((await ask()).status).toBe(503);
    expect(upstream.seen).toEqual([]);
  });
});

describe('forwarding to Vertex AI', () => {
  it('calls the company’s project on the global endpoint as the gateway, never with the caller’s key', async () => {
    await request(gateway()).post('/vertex/v1beta/models/gemini-2.5-flash:generateContent').set('x-goog-api-key', ALICE_KEY).set('Cookie', 'a=b').send(body);
    const seen = upstream.seen[0];
    expect(seen.path).toBe('/v1/projects/axiomflo-pilot/locations/global/publishers/google/models/gemini-2.5-flash:generateContent');
    expect(seen.headers.authorization).toBe(`Bearer ${GOOGLE_TOKEN}`);
    expect(seen.headers['x-goog-api-key']).toBeUndefined();
    expect(seen.headers.cookie).toBeUndefined();
    expect(JSON.parse(seen.body)).toEqual(body);
  });

  it('ignores a project or location in a Vertex-style path', async () => {
    await ask('/vertex/v1/projects/someone-else/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent');
    expect(upstream.seen[0].path).toBe('/v1/projects/axiomflo-pilot/locations/global/publishers/google/models/gemini-2.5-pro:generateContent');
  });

  it('passes the answer back unchanged and records usage, thinking counted as output', async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(answer());
    expect(JSON.stringify(res.headers)).not.toContain(GOOGLE_TOKEN);
    expect(usage.records[0]).toMatchObject({
      principal: { type: 'user', id: 'alice' },
      teamCode: 'TEAM-A',
      providerId: 'gemini_vertex',
      modelId: 'gemini-2.5-flash',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      requestStatus: 'succeeded',
      costStatus: 'estimated',
      priceVersion: VERTEX_PRICE_VERSION,
      stream: false,
      providerRequestId: 'vx-1',
    });
    // Gemini 2.5 Flash: $0.30 in, $2.50 out per million.
    expect(usage.records[0].estimatedCostUsd).toBeCloseTo((1000 * 0.3 + 500 * 2.5) / 1e6, 12);
  });

  it('never stores or logs the prompt, the answer or any key or token', async () => {
    await ask();
    const stored = JSON.stringify(usage.records) + JSON.stringify(logs);
    for (const secret of ['SECRET PROMPT TEXT', 'SECRET ANSWER TEXT', GOOGLE_TOKEN, ALICE_KEY]) expect(stored).not.toContain(secret);
  });

  it('only allows Google’s Gemini models', async () => {
    for (const model of ['claude-sonnet-5-5', 'imagen-4', 'gemini-..%2F..']) {
      const res = await ask(`/vertex/v1beta/models/${model}:generateContent`);
      expect([400, 404]).toContain(res.status);
    }
    expect((await ask('/vertex/v1beta/publishers/anthropic/models/claude:rawPredict')).status).toBe(404);
    expect(upstream.seen).toEqual([]);
  });

  it('passes Vertex errors through and records the request as failed', async () => {
    upstream.respond = (_r, res) => json(res, 429, { error: { code: 429, message: 'Quota', status: 'RESOURCE_EXHAUSTED' } });
    const res = await ask();
    expect(res.status).toBe(429);
    expect(usage.records[0]).toMatchObject({ requestStatus: 'failed', providerStatus: 429, inputTokens: null, costStatus: 'unavailable' });
  });

  it('returns 503 when the gateway can’t get its own Google token, and calls nothing', async () => {
    tokenFails = true;
    const res = await ask();
    expect(res.status).toBe(503);
    expect(upstream.seen).toEqual([]);
  });

  it('returns 502 when Vertex can’t be reached, and records the failure', async () => {
    await upstream.stop();
    expect((await ask()).status).toBe(502);
    expect(usage.records[0]).toMatchObject({ requestStatus: 'failed', providerStatus: null });
  });

  it('records cached prompt tokens separately from new input', async () => {
    upstream.respond = (_r, res) => json(res, 200, answer('gemini-2.5-pro', usageMetadata(10_000, 1000, 0, 8000)));
    await ask('/vertex/v1beta/models/gemini-2.5-pro:generateContent');
    expect(usage.records[0]).toMatchObject({ inputTokens: 2000, cacheReadTokens: 8000, outputTokens: 1000 });
    expect(usage.records[0].estimatedCostUsd).toBeCloseTo((2000 * 1.25 + 8000 * 0.125 + 1000 * 10) / 1e6, 12);
  });
});

describe('streamed Gemini answers', () => {
  it('passes server-sent events through and records the final totals', async () => {
    const chunks = [
      { candidates: [{ content: { parts: [{ text: 'SECRET ' }] } }], usageMetadata: { promptTokenCount: 1200 }, modelVersion: 'gemini-3.8-flash' },
      { candidates: [{ content: { parts: [{ text: 'ANSWER' }] }, finishReason: 'STOP' }], usageMetadata: usageMetadata(1200, 300, 50), modelVersion: 'gemini-3.8-flash' },
    ];
    const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join('');
    upstream.respond = (_r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(sse.slice(0, 50));
      setImmediate(() => res.end(sse.slice(50)));
    };
    const res = await request(gateway())
      .post('/vertex/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse')
      .set('x-goog-api-key', ALICE_KEY)
      .send(body)
      .buffer(true)
      .parse((r, cb) => {
        let text = '';
        r.on('data', (c: Buffer) => (text += c.toString('utf8')));
        r.on('end', () => cb(null, text));
      });
    expect(res.body).toBe(sse);
    expect(upstream.seen[0].path).toBe('/v1/projects/axiomflo-pilot/locations/global/publishers/google/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
    expect(usage.records[0]).toMatchObject({ stream: true, modelId: 'gemini-3.8-flash', inputTokens: 1200, outputTokens: 350, requestStatus: 'succeeded', costStatus: 'estimated' });
  });

  it('needs alt=sse for streaming', async () => {
    expect((await ask('/vertex/v1beta/models/gemini-2.5-flash:streamGenerateContent')).status).toBe(400);
    expect(upstream.seen).toEqual([]);
  });

  it('records a stream that ended without finishing as failed', async () => {
    upstream.respond = (_r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'x' }] } }], usageMetadata: usageMetadata(100, 5, 0) })}\n\n`);
    };
    await ask('/vertex/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    expect(usage.records[0]).toMatchObject({ requestStatus: 'failed', inputTokens: 100 });
  });
});

describe('Gemini prices', () => {
  const t = (prompt: number, output: number, cached = 0, audio = 0) => ({ promptTokens: prompt, cachedTokens: cached, audioPromptTokens: audio, outputTokens: output });

  it('uses the long-context rate over 200,000 prompt tokens', () => {
    expect(estimateVertexCostUsd('gemini-2.5-pro', t(200_000, 1_000_000), OCT)).toBeCloseTo(200_000 * 1.25 / 1e6 + 10);
    expect(estimateVertexCostUsd('gemini-2.5-pro', t(200_001, 1_000_000), OCT)).toBeCloseTo(200_001 * 2.5 / 1e6 + 15);
  });

  it('uses the rate in force on the day, including promotions that end', () => {
    expect(estimateVertexCostUsd('gemini-3.8-flash', t(1_000_000, 0), new Date('2026-12-31T23:00:00Z'))).toBeCloseTo(0.75);
    expect(estimateVertexCostUsd('gemini-3.8-flash', t(1_000_000, 0), new Date('2027-01-01T00:00:00Z'))).toBeCloseTo(1.5);
    expect(estimateVertexCostUsd('gemini-4-argon', t(0, 1_000_000), new Date('2026-12-01T00:00:00Z'))).toBeCloseTo(20);
  });

  it('charges audio input at the audio rate, and gives up rather than guess on cached audio', () => {
    expect(estimateVertexCostUsd('gemini-2.5-flash', t(1_000_000, 0, 0, 400_000), OCT)).toBeCloseTo(0.6 * 0.3 + 0.4 * 1);
    expect(estimateVertexCostUsd('gemini-2.5-flash', t(1_000_000, 0, 10, 400_000), OCT)).toBeNull();
  });

  it('prices versioned model names as their base model, and nothing else', () => {
    expect(baseGeminiModel('gemini-2.5-flash-001')).toBe('gemini-2.5-flash');
    expect(baseGeminiModel('gemini-3.1-pro-preview')).toBe('gemini-3.1-pro');
    expect(estimateVertexCostUsd('gemini-2.5-flash-image', t(1, 1), OCT)).toBeNull();
    expect(estimateVertexCostUsd('gemini-3.8-flash-cyber', t(1, 1), OCT)).toBeNull();
  });
});

describe('the gateway’s own Google token', () => {
  it('is reused until a minute before it expires, and fetched once for concurrent requests', async () => {
    const { credentialTokenSource } = await import('./googleTokens.js');
    let clock = 0;
    let calls = 0;
    const source = credentialTokenSource({ getAccessToken: async () => ({ access_token: `t${++calls}`, expires_in: 3600 }) }, () => clock);
    expect(await Promise.all([source.token(), source.token()])).toEqual(['t1', 't1']);
    clock = 3_539_000;
    expect(await source.token()).toBe('t1');
    clock = 3_541_000;
    expect(await source.token()).toBe('t2');
  });
});
