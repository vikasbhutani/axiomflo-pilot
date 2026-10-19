import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AgentUnavailableError, createHttpAgentClient, metadataIdTokenSource, type AgentAnswer, type AgentClient } from '../assistant/agentClient.js';
import { parseAgentUrl } from '../config.js';
import { currentMonth, monthsEndingWith } from '../reports/months.js';
import { FakeUsage, makeApp, token } from '../test/fakes.js';

const as = (name: string) => ({ Authorization: `Bearer ${token(name)}` });

class FakeAgent implements AgentClient {
  readonly calls: { method: string; input: Parameters<AgentClient['ask']>[0] | Parameters<AgentClient['suggestions']>[0]; requestId: string }[] = [];
  failWith: Error | null = null;
  answer: AgentAnswer = { status: 'ok', text: 'You spent $1.00.', requestId: 'r', sessionId: `s_${'a'.repeat(32)}`, links: [], toolsCalled: ['get_cost_summary'] };
  async ask(input: Parameters<AgentClient['ask']>[0], requestId: string) {
    this.calls.push({ method: 'ask', input, requestId });
    if (this.failWith) throw this.failWith;
    return this.answer;
  }
  async suggestions(input: Parameters<AgentClient['suggestions']>[0], requestId: string) {
    this.calls.push({ method: 'suggestions', input, requestId });
    if (this.failWith) throw this.failWith;
    return { status: 'ok', suggestions: [] };
  }
}

describe('POST /api/assistant/ask', () => {
  it('needs a sign-in and an active membership, and never reaches the agent otherwise', async () => {
    const agent = new FakeAgent();
    expect((await request(makeApp({ agent }).app).post('/api/assistant/ask').send({ question: 'hi' })).status).toBe(401);
    for (const who of ['sam', 'newcomer', 'outsider']) {
      expect((await request(makeApp({ agent }).app).post('/api/assistant/ask').set(as(who)).send({ question: 'hi' })).status).toBe(403);
    }
    expect(agent.calls).toEqual([]);
  });

  it('says plainly when the assistant is not set up', async () => {
    const res = await request(makeApp().app).post('/api/assistant/ask').set(as('admin')).send({ question: 'What did we spend?' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('assistant_unavailable');
  });

  it('sends the verified context and only this member’s usage, whatever the body says', async () => {
    const agent = new FakeAgent();
    const { app, usage } = makeApp({ agent });
    const res = await request(app).post('/api/assistant/ask').set(as('alice')).send({ question: '  What did I spend?  ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', text: 'You spent $1.00.', sessionId: `s_${'a'.repeat(32)}`, links: [] });
    const [call] = agent.calls;
    expect(call.input.context).toEqual({ tenantId: 'test-company', userId: 'alice', role: 'individual_user', teamIds: ['team-a'], channel: 'web', verifiedBy: 'firebase_id_token' });
    expect((call.input as { question: string }).question).toBe('What did I spend?');
    const snapshot = call.input.snapshot;
    expect(snapshot.viewer).toMatchObject({ uid: 'alice', role: 'individual_user', teamIds: ['team-a'] });
    expect(snapshot.teams.map((t) => t.id)).toEqual(['team-a']);
    expect(snapshot.usage).toHaveLength(3);
    const listed = usage.calls.filter((c) => c.method === 'listUsage');
    expect(listed).toHaveLength(3);
    for (const c of listed) expect(c.args[1]).toEqual({ uid: 'alice', role: 'individual_user' });
  });

  it.each([
    ['no question', {}],
    ['an empty question', { question: '   ' }],
    ['a long question', { question: 'x'.repeat(2001) }],
    ['a made-up session', { question: 'hi', sessionId: '../other' }],
    ['someone else’s identity', { question: 'hi', userId: 'admin' }],
  ])('rejects %s with 400', async (_label, body) => {
    const agent = new FakeAgent();
    expect((await request(makeApp({ agent }).app).post('/api/assistant/ask').set(as('alice')).send(body)).status).toBe(400);
    expect(agent.calls).toEqual([]);
  });

  it('turns an unreachable agent into 503 without guessing an answer', async () => {
    const agent = new FakeAgent();
    agent.failWith = new AgentUnavailableError('timeout');
    const res = await request(makeApp({ agent }).app).post('/api/assistant/ask').set(as('admin')).send({ question: 'hi' });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/no answer was generated/);
  });

  it('turns a database failure into 503 before calling the agent', async () => {
    const agent = new FakeAgent();
    const usage = new FakeUsage();
    usage.failWith = Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    const res = await request(makeApp({ agent, usage }).app).post('/api/assistant/ask').set(as('admin')).send({ question: 'hi' });
    expect(res.status).toBe(503);
    expect(agent.calls).toEqual([]);
  });
});

describe('GET /api/assistant/suggestions', () => {
  it('sends the month and the one before it', async () => {
    const agent = new FakeAgent();
    const { app, usage } = makeApp({ agent });
    const res = await request(app).get('/api/assistant/suggestions?month=2026-01').set(as('admin'));
    expect(res.status).toBe(200);
    expect((agent.calls[0].input as { period: string }).period).toBe('2026-01');
    expect(agent.calls[0].input.snapshot.usage.map((u) => u.month)).toEqual(['2025-12', '2026-01']);
    expect(usage.calls.filter((c) => c.method === 'listUsage').map((c) => c.args[1])).toEqual([{ uid: 'admin', role: 'company_admin' }, { uid: 'admin', role: 'company_admin' }]);
  });

  it('rejects a bad month', async () => {
    const agent = new FakeAgent();
    expect((await request(makeApp({ agent }).app).get('/api/assistant/suggestions?month=soon').set(as('admin'))).status).toBe(400);
    expect(agent.calls).toEqual([]);
  });
});

describe('agent client', () => {
  const answer = { status: 'ok', text: 'hi', requestId: 'r', sessionId: null, links: [], toolsCalled: [] };

  it('posts JSON with the request ID and an ID token', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(answer), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createHttpAgentClient({ url: 'https://agent.example', idToken: async () => 'id-token', fetchImpl });
    expect(await client.ask({ context: {} as never, question: 'hi', snapshot: {} as never }, 'req-1')).toEqual(answer);
    expect(seen[0].url).toBe('https://agent.example/v1/ask');
    expect(seen[0].init.headers).toMatchObject({ authorization: 'Bearer id-token', 'x-request-id': 'req-1' });
  });

  it('treats errors and network failures as unavailable', async () => {
    const failing = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    await expect(createHttpAgentClient({ url: 'https://a', idToken: async () => null, fetchImpl: failing }).ask({} as never, 'r')).rejects.toBeInstanceOf(AgentUnavailableError);
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(createHttpAgentClient({ url: 'https://a', idToken: async () => null, fetchImpl: down }).ask({} as never, 'r')).rejects.toBeInstanceOf(AgentUnavailableError);
  });

  it('caches the ID token from the metadata server', async () => {
    let calls = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls++;
      expect(url).toContain('audience=https%3A%2F%2Fagent.example');
      expect(init.headers).toEqual({ 'Metadata-Flavor': 'Google' });
      return new Response('tok\n', { status: 200 });
    }) as unknown as typeof fetch;
    const source = metadataIdTokenSource('https://agent.example', fetchImpl);
    expect(await source()).toBe('tok');
    expect(await source()).toBe('tok');
    expect(calls).toBe(1);
  });
});

describe('assistant settings and months', () => {
  it('AGENT_URL must be an https origin, or http on localhost', () => {
    expect(parseAgentUrl('')).toBeNull();
    expect(parseAgentUrl('https://axiomflo-agent-abc.a.run.app')).toBe('https://axiomflo-agent-abc.a.run.app');
    expect(parseAgentUrl('http://localhost:8090')).toBe('http://localhost:8090');
    for (const bad of ['http://agent.example', 'https://agent.example/v1', 'not a url']) expect(() => parseAgentUrl(bad)).toThrow();
  });

  it('works out the current Sydney month and the months before it', () => {
    expect(currentMonth('Australia/Sydney', new Date('2026-10-31T13:30:00Z'))).toBe('2026-11');
    expect(monthsEndingWith('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});
