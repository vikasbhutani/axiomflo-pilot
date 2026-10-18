import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KeyRejectedError, type KeyPrincipal } from '../keys/service.js';
import { FakeKeys } from '../test/fakes.js';
import { testConfig } from '../test/testConfig.js';
import type { Logger } from '../http/logger.js';
import { createGatewayApp } from './app.js';
import { loadGatewayConfig, type GatewayConfig } from './config.js';
import { FakeAnthropic } from '../test/fakeAnthropic.js';
import { estimateAnthropicCostUsd, PRICE_VERSION } from './prices.js';
import type { UsageRecord, UsageRecorder } from './usage.js';

const COMPANY_KEY = 'sk-ant-company-key-never-shown';
const ALICE_KEY = `axf_${'a'.repeat(24)}_${'s'.repeat(43)}`;
const ALICE: KeyPrincipal = { keyId: 'a'.repeat(24), uid: 'alice', role: 'individual_user', teamId: 'team-a', teamCode: 'TEAM-A' };

class MemoryUsage implements UsageRecorder {
  readonly records: { companyId: string; record: UsageRecord }[] = [];
  failing = false;
  async record(companyId: string, record: UsageRecord) {
    if (this.failing) throw new Error('14 UNAVAILABLE');
    this.records.push({ companyId, record });
  }
}

let upstream: FakeAnthropic;
let keys: FakeKeys;
let usage: MemoryUsage;
let logs: string[];

function gateway(overrides: Partial<GatewayConfig> = {}) {
  const config: GatewayConfig = { ...testConfig(), anthropicApiKey: COMPANY_KEY, anthropicBaseUrl: upstream.url, vertexProjectId: 'axiomflo-test', vertexBaseUrl: upstream.url, ...overrides };
  const logger: Logger = { debug() {}, info: (m, f) => logs.push(JSON.stringify([m, f])), warn: (m, f) => logs.push(JSON.stringify([m, f])), error: (m, f) => logs.push(JSON.stringify([m, f])) };
  return createGatewayApp({ config, logger, keys, usage, googleTokens: { token: async () => 'google-token' } });
}
const ask = (body: object = { model: 'claude-sonnet-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'SECRET PROMPT TEXT' }] }) =>
  request(gateway()).post('/anthropic/v1/messages').set('x-api-key', ALICE_KEY).set('anthropic-version', '2023-06-01').send(body);

beforeEach(async () => {
  upstream = new FakeAnthropic();
  await upstream.start();
  keys = new FakeKeys();
  keys.principals[ALICE_KEY] = ALICE;
  usage = new MemoryUsage();
  logs = [];
});
afterEach(() => upstream.stop());

describe('AxiomFlo key check', () => {
  it('needs a key (401, Anthropic error shape) and forwards nothing', async () => {
    const res = await request(gateway()).post('/anthropic/v1/messages').send({ model: 'claude-sonnet-5-5' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ type: 'error', error: { type: 'authentication_error' } });
    expect(upstream.seen).toEqual([]);
    expect(usage.records).toEqual([]);
  });

  it('rejects an unknown, revoked or malformed key with 401', async () => {
    keys.principals['revoked-key'] = new KeyRejectedError('revoked');
    for (const k of ['axf_nope', 'revoked-key', ALICE_KEY.slice(0, -1) + 't']) {
      const res = await request(gateway()).post('/anthropic/v1/messages').set('x-api-key', k).send({ model: 'claude-sonnet-5-5' });
      expect(res.status).toBe(401);
    }
    expect(upstream.seen).toEqual([]);
  });

  it('refuses a suspended member or a team they left with 403', async () => {
    for (const reason of ['member_suspended', 'team_not_assigned', 'company_inactive', 'team_inactive', 'no_membership']) {
      keys.principals[ALICE_KEY] = new KeyRejectedError(reason);
      const res = await ask();
      expect(res.status).toBe(403);
      expect(res.body.error.type).toBe('permission_error');
    }
    expect(upstream.seen).toEqual([]);
  });

  it('returns 503, never success, when the key database is unavailable', async () => {
    keys.principals[ALICE_KEY] = new Error('14 UNAVAILABLE');
    const res = await ask();
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('UNAVAILABLE');
    expect(upstream.seen).toEqual([]);
  });

  it('accepts the key as a Bearer token too, and only checks it against the pilot company', async () => {
    const res = await request(gateway()).post('/anthropic/v1/messages').set('Authorization', `Bearer ${ALICE_KEY}`).send({ model: 'claude-sonnet-5-5', max_tokens: 10, messages: [] });
    expect(res.status).toBe(200);
    expect(keys.calls).toEqual([{ method: 'resolveKey', args: ['test-company', ALICE_KEY] }]);
  });

  it('limits requests per key', async () => {
    const app = gateway();
    const statuses: number[] = [];
    for (let i = 0; i < 62; i++) statuses.push((await request(app).post('/anthropic/v1/messages').set('x-api-key', ALICE_KEY).send({ model: 'claude-sonnet-5-5' })).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(60)).toEqual([429, 429]);
  });
});

describe('forwarding to Anthropic', () => {
  it('uses the company key, never the caller’s, and passes only the Anthropic headers', async () => {
    await request(gateway())
      .post('/anthropic/v1/messages')
      .set('x-api-key', ALICE_KEY)
      .set('anthropic-version', '2023-06-01')
      .set('anthropic-beta', 'some-beta-2026-01-01')
      .set('Cookie', 'session=abc')
      .set('X-Forwarded-For', '1.2.3.4')
      .send({ model: 'claude-sonnet-5-5', max_tokens: 10, messages: [] });
    const h = upstream.seen[0].headers;
    expect(upstream.seen[0].path).toBe('/v1/messages');
    expect(h['x-api-key']).toBe(COMPANY_KEY);
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h['anthropic-beta']).toBe('some-beta-2026-01-01');
    expect(h.cookie).toBeUndefined();
    expect(h.authorization).toBeUndefined();
    expect(h['x-forwarded-for']).toBeUndefined();
    expect(upstream.seen[0].body).not.toContain(ALICE_KEY);
  });

  it('defaults anthropic-version when the caller leaves it out', async () => {
    await request(gateway()).post('/anthropic/v1/messages').set('x-api-key', ALICE_KEY).send({ model: 'claude-sonnet-5-5' });
    expect(upstream.seen[0].headers['anthropic-version']).toBe('2023-06-01');
  });

  it('passes the answer back unchanged and records usage with an estimated cost', async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(FakeAnthropic.message());
    expect(res.headers['request-id']).toBe('req_upstream_1');
    expect(JSON.stringify(res.headers)).not.toContain(COMPANY_KEY);
    expect(usage.records).toHaveLength(1);
    const { companyId, record } = usage.records[0];
    expect(companyId).toBe('test-company');
    expect(record).toMatchObject({
      id: res.headers['x-request-id'],
      principal: { type: 'user', id: 'alice' },
      keyId: ALICE.keyId,
      teamId: 'team-a',
      teamCode: 'TEAM-A',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      inputTokens: 1000,
      outputTokens: 500,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      requestStatus: 'succeeded',
      providerStatus: 200,
      costStatus: 'estimated',
      priceVersion: PRICE_VERSION,
      stream: false,
      providerRequestId: 'req_upstream_1',
    });
    // Sonnet 5.5: $2 / $10 per million tokens.
    expect(record.estimatedCostUsd).toBeCloseTo(0.002 + 0.005, 10);
  });

  it('never stores or logs the prompt, the answer or any key', async () => {
    await ask();
    const stored = JSON.stringify(usage.records) + JSON.stringify(logs);
    for (const secret of ['SECRET PROMPT TEXT', 'SECRET ANSWER TEXT', COMPANY_KEY, ALICE_KEY]) expect(stored).not.toContain(secret);
  });

  it('records an unknown model with no cost rather than a guess', async () => {
    upstream.respond = (_r, res) => FakeAnthropic.json(res, 200, FakeAnthropic.message('claude-future-9'));
    await ask({ model: 'claude-future-9', max_tokens: 10, messages: [] });
    expect(usage.records[0].record).toMatchObject({ modelId: 'claude-future-9', inputTokens: 1000, costStatus: 'unavailable', estimatedCostUsd: null, priceVersion: null });
  });

  it('passes Anthropic errors through and records the request as failed', async () => {
    upstream.respond = (_r, res) => {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '30', 'request-id': 'req_x' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }));
    };
    const res = await ask();
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.body.error.type).toBe('rate_limit_error');
    expect(usage.records[0].record).toMatchObject({ requestStatus: 'failed', providerStatus: 429, inputTokens: null, costStatus: 'unavailable', estimatedCostUsd: null });
  });

  it('returns 502 when Anthropic can’t be reached, and records the failure', async () => {
    await upstream.stop();
    const res = await ask();
    expect(res.status).toBe(502);
    expect(res.body.error.type).toBe('api_error');
    expect(usage.records[0].record).toMatchObject({ requestStatus: 'failed', providerStatus: null });
  });

  it('still answers when the usage record can’t be written, and logs it', async () => {
    usage.failing = true;
    const res = await ask();
    expect(res.status).toBe(200);
    expect(logs.some((l) => l.includes('usage record failed'))).toBe(true);
  });

  it.each([
    ['no model', { max_tokens: 10 }],
    ['a model that is not a name', { model: 'x/../../admin' }],
    ['stream that is not true/false', { model: 'claude-sonnet-5-5', stream: 'yes' }],
  ])('rejects a body with %s before forwarding', async (_label, body) => {
    const res = await ask(body);
    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe('invalid_request_error');
    expect(upstream.seen).toEqual([]);
  });

  it('rejects unreadable JSON and other routes in Anthropic’s error shape', async () => {
    const bad = await request(gateway()).post('/anthropic/v1/messages').set('x-api-key', ALICE_KEY).set('content-type', 'application/json').send('{"model":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.type).toBe('invalid_request_error');
    const missing = await request(gateway()).get('/anthropic/v1/models').set('x-api-key', ALICE_KEY);
    expect(missing.status).toBe(404);
    expect(missing.body.error.type).toBe('not_found_error');
    expect(upstream.seen).toEqual([]);
  });

  it('sends no CORS headers, so web pages on other sites can’t use it', async () => {
    const res = await ask().set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('streamed answers', () => {
  it('passes every event through as it arrives and records the final token counts', async () => {
    const events = FakeAnthropic.streamEvents('claude-opus-5-5', 1200, 300);
    upstream.respond = (_r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_stream' });
      // Split events awkwardly across writes, as a network would.
      const all = events.join('');
      let i = 0;
      const tick = () => {
        if (i >= all.length) return res.end();
        res.write(all.slice(i, i + 37));
        i += 37;
        setImmediate(tick);
      };
      tick();
    };
    const res = await ask({ model: 'claude-opus-5-5', max_tokens: 10, stream: true, messages: [] }).buffer(true).parse((r, cb) => {
      let text = '';
      r.on('data', (c: Buffer) => (text += c.toString('utf8')));
      r.on('end', () => cb(null, text));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toBe(events.join(''));
    expect(usage.records[0].record).toMatchObject({ stream: true, modelId: 'claude-opus-5-5', inputTokens: 1200, outputTokens: 300, requestStatus: 'succeeded', providerRequestId: 'req_stream', costStatus: 'estimated' });
    // Opus 5.5: $4 / $20 per million tokens.
    expect(usage.records[0].record.estimatedCostUsd).toBeCloseTo(0.0048 + 0.006, 10);
  });

  it('records a stream that stopped early as failed, with the tokens reported so far', async () => {
    const events = FakeAnthropic.streamEvents();
    upstream.respond = (_r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(events.slice(0, 4).join(''));
    };
    await ask({ model: 'claude-sonnet-5-5', stream: true });
    expect(usage.records[0].record).toMatchObject({ requestStatus: 'failed', inputTokens: 1200, outputTokens: 1, costStatus: 'estimated' });
  });

  it('records an error event inside a stream as failed', async () => {
    upstream.respond = (_r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(FakeAnthropic.streamEvents()[0] + `event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n`);
    };
    await ask({ model: 'claude-sonnet-5-5', stream: true });
    expect(usage.records[0].record.requestStatus).toBe('failed');
  });

  it('stops the Anthropic request when the caller disconnects', async () => {
    upstream.respond = (_r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(FakeAnthropic.streamEvents()[0]); // ...and never finishes.
    };
    const app = gateway();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address() as { port: number };
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/anthropic/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': ALICE_KEY }, body: JSON.stringify({ model: 'claude-sonnet-5-5', stream: true }), signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();
    for (let i = 0; i < 50 && (!upstream.clientClosed || usage.records.length === 0); i++) await new Promise((r) => setTimeout(r, 20));
    server.close();
    expect(upstream.clientClosed).toBe(true);
    expect(usage.records[0].record).toMatchObject({ requestStatus: 'failed', inputTokens: 1200 });
  });
});

describe('prices', () => {
  it('estimates from the listed rates, including dated model snapshots', () => {
    const t = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheWriteTokens: 1_000_000, cacheReadTokens: 1_000_000 };
    expect(estimateAnthropicCostUsd('claude-opus-5-5', t)).toBeCloseTo(4 + 20 + 5 + 0.2);
    expect(estimateAnthropicCostUsd('claude-sonnet-4-5-20250929', t)).toBeCloseTo(3 + 15 + 3.75 + 0.3);
    expect(estimateAnthropicCostUsd('claude-opus-4-5', t)).toBeCloseTo(5 + 25 + 6.25 + 0.5);
    expect(estimateAnthropicCostUsd('claude-fable-5-1', t)).toBeCloseTo(10 + 50 + 12.5 + 0.25);
  });

  it('uses Haiku 5.5’s higher rate when the whole prompt is over 100,000 tokens', () => {
    const short = { inputTokens: 60_000, outputTokens: 1_000_000, cacheWriteTokens: 0, cacheReadTokens: 40_000 };
    expect(estimateAnthropicCostUsd('claude-haiku-5-5', short)).toBeCloseTo((60_000 * 0.1 + 1_000_000 * 0.5 + 40_000 * 0.01) / 1e6);
    const long = { ...short, cacheReadTokens: 40_001 };
    expect(estimateAnthropicCostUsd('claude-haiku-5-5', long)).toBeCloseTo((60_000 * 0.5 + 1_000_000 * 2.5 + 40_001 * 0.05) / 1e6);
  });

  it('gives no cost for a model it doesn’t know', () => {
    expect(estimateAnthropicCostUsd('claude-instant-1', { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 })).toBeNull();
  });
});

describe('gateway settings', () => {
  const env = { FIREBASE_PROJECT_ID: 'axiomflo-pilot', PILOT_COMPANY_ID: 'pilot' };
  it('runs without an Anthropic key, and the Claude route then says it isn’t set up', async () => {
    expect(loadGatewayConfig(env)).toMatchObject({ anthropicApiKey: '', vertexProjectId: 'axiomflo-pilot', vertexBaseUrl: 'https://aiplatform.googleapis.com' });
    const res = await request(gateway({ anthropicApiKey: '' })).post('/anthropic/v1/messages').set('x-api-key', ALICE_KEY).send({ model: 'claude-sonnet-5-5' });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/isn’t set up/);
    expect(upstream.seen).toEqual([]);
  });
  it('only calls Vertex AI’s real endpoint on Cloud Run', () => {
    expect(() => loadGatewayConfig({ ...env, VERTEX_BASE_URL: 'https://example.com', K_SERVICE: 'axiomflo-gateway' })).toThrow(/VERTEX_BASE_URL/);
    expect(() => loadGatewayConfig({ ...env, VERTEX_PROJECT_ID: 'Bad Project' })).toThrow(/VERTEX_PROJECT_ID/);
  });
  it('only forwards to api.anthropic.com on Cloud Run', () => {
    expect(loadGatewayConfig({ ...env, ANTHROPIC_API_KEY: 'k' }).anthropicBaseUrl).toBe('https://api.anthropic.com');
    expect(() => loadGatewayConfig({ ...env, ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'https://example.com', K_SERVICE: 'axiomflo-gateway' })).toThrow();
    expect(() => loadGatewayConfig({ ...env, ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'http://example.com' })).toThrow(/https/);
    expect(loadGatewayConfig({ ...env, ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9000' }).anthropicBaseUrl).toBe('http://127.0.0.1:9000');
  });
});

