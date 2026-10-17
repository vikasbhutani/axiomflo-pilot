import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createLogger, sanitize, silentLogger } from './http/logger.js';
import { testConfig } from './test/testConfig.js';

function app(overrides = {}) {
  return createApp({ config: testConfig(overrides), logger: silentLogger });
}

describe('GET /health', () => {
  it('returns a minimal status with no configuration details', async () => {
    const res = await request(app()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(JSON.stringify(res.body)).not.toContain('test-company');
  });
});

describe('every response', () => {
  it('has a server-generated request ID and ignores one sent by the client', async () => {
    const res = await request(app()).get('/health').set('X-Request-Id', 'forged-id');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-request-id']).not.toBe('forged-id');
  });

  it('does not reveal the framework and is never cached', async () => {
    const res = await request(app()).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('errors', () => {
  it('returns JSON 404 for unknown routes', async () => {
    const res = await request(app()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'not_found' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('rejects bodies over the size limit with 413', async () => {
    const res = await request(app())
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(20_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('payload_too_large');
  });

  it('rejects malformed JSON with 400 and no parser details', async () => {
    const res = await request(app()).post('/api/anything').set('Content-Type', 'application/json').send('{"oops":');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'bad_request', message: 'The request body could not be read.' });
  });
});

describe('CORS', () => {
  const allowed = 'https://app.example.com';

  it('sends no CORS headers when no origins are configured (same-origin setup)', async () => {
    const res = await request(app()).get('/health').set('Origin', allowed);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows an exact configured origin, never a wildcard, and no credentials', async () => {
    const res = await request(app({ allowedOrigins: [allowed] })).get('/health').set('Origin', allowed);
    expect(res.headers['access-control-allow-origin']).toBe(allowed);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('ignores other origins, including look-alikes', async () => {
    for (const origin of ['https://evil.example', 'https://app.example.com.evil.example', 'http://app.example.com']) {
      const res = await request(app({ allowedOrigins: [allowed] })).get('/health').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('answers preflight for an allowed origin with the Authorization header permitted', async () => {
    const res = await request(app({ allowedOrigins: [allowed] }))
      .options('/api/me')
      .set('Origin', allowed)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
  });
});

describe('logging', () => {
  it('redacts sensitive keys at any depth', () => {
    expect(sanitize({ authorization: 'Bearer abc', nested: { idToken: 'abc', ok: 1 }, list: [{ password: 'x' }] })).toEqual({
      authorization: '[redacted]',
      nested: { idToken: '[redacted]', ok: 1 },
      list: [{ password: '[redacted]' }],
    });
  });

  it('never writes the Authorization header into the access log', async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'debug', write: (line) => lines.push(line) });
    await request(createApp({ config: testConfig(), logger }))
      .get('/health?token=secret-in-query')
      .set('Authorization', 'Bearer super-secret-token');
    const output = lines.join('\n');
    expect(output).toContain('"path":"/health"');
    expect(output).not.toContain('super-secret-token');
    expect(output).not.toContain('secret-in-query');
  });
});
