import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { UsageView } from '../reports/service.js';
import { FakeStore, FakeUsage, FakeVerifier, IDENTITIES, identity, makeApp, pilotData, token } from '../test/fakes.js';
import { DISCLAIMER } from '../upgrade/engine.js';
import { createMemoryUpgradeStore } from '../upgrade/store.js';

const as = (name: string) => ({ Authorization: `Bearer ${token(name)}` });

/** `n` Sonnet 4.5 calls by alice in Team A over the last week: $0.0045 each. */
function usageRecords(n: number, overrides: Partial<UsageView> = {}): UsageView[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `req-${i}`,
    timestamp: new Date(Date.now() - (1 + (i % 6)) * 86_400_000).toISOString(),
    principal: { type: 'user', id: 'alice' },
    keyId: 'k1',
    teamId: 'team-a',
    teamCode: 'TEAM-A',
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5-20250929',
    inputTokens: 1_000,
    outputTokens: 100,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    requestStatus: 'succeeded',
    providerStatus: 200,
    costStatus: 'estimated',
    estimatedCostUsd: 0.0045,
    priceVersion: 'anthropic-2026-10-18',
    stream: false,
    latencyMs: 1_200,
    ...overrides,
  }));
}

function setup({ records = usageRecords(2_000), rate }: { records?: UsageView[]; rate?: number } = {}) {
  const usage = new FakeUsage();
  usage.result = { records, people: {}, truncated: false, skipped: 0 };
  if (rate) usage.rates.push({ month: new Date().toISOString().slice(0, 7), rate, currency: 'AUD', setBy: 'admin', setAt: null });
  // A view-only judge login: a read-only Company Admin.
  const data = pilotData();
  data.memberships['test-company'].judge = { uid: 'judge', role: 'company_admin', teamIds: [], status: 'active', readOnly: true };
  data.memberships['test-company'].bob = { uid: 'bob', role: 'individual_user', teamIds: ['team-a'], status: 'active' };
  const verifier = new FakeVerifier({ ...IDENTITIES, judge: identity('judge'), bob: identity('bob') });
  const upgradeStore = createMemoryUpgradeStore();
  return { ...makeApp({ usage, store: new FakeStore(data), verifier, upgradeStore }), upgradeStore };
}

const body = (overrides: Record<string, unknown> = {}) => ({
  currentModelId: 'claude-sonnet-4-5',
  candidateModelId: 'claude-sonnet-5-5',
  scope: { level: 'company', id: null },
  timeWindow: { kind: 'last_30_days' },
  migrationPercentage: 100,
  assumptions: {},
  eligibilityRules: [{ id: 'r1', level: 'company', targetId: null, decision: 'eligible', reason: 'Confirmed' }],
  ...overrides,
});

describe('access', () => {
  it.each([
    ['get', '/api/upgrade-analysis/models'],
    ['post', '/api/upgrade-analysis/estimate'],
    ['post', '/api/upgrade-analysis/save'],
    ['get', `/api/upgrade-analysis/ua_${'0'.repeat(24)}`],
    ['post', `/api/upgrade-analysis/ua_${'0'.repeat(24)}/export`],
  ] as const)('%s %s needs a sign-in and an active membership in this company', async (method, path) => {
    const { app, usage } = setup();
    expect((await request(app)[method](path).send(body())).status).toBe(401);
    for (const who of ['sam', 'newcomer', 'outsider']) expect((await request(app)[method](path).set(as(who)).send(body())).status).toBe(403);
    expect(usage.calls).toEqual([]);
  });
});

describe('GET /api/upgrade-analysis/models', () => {
  it('lists observed current models, priced candidates and the member’s scopes', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/upgrade-analysis/models').set(as('alice'));
    expect(res.status).toBe(200);
    expect(res.body.currentModels.map((m: { id: string }) => m.id)).toEqual(['claude-sonnet-4-5']);
    expect(res.body.currentModels[0].observedRequests).toBe(2_000);
    const sonnet55 = res.body.candidateModels.find((m: { id: string }) => m.id === 'claude-sonnet-5-5');
    expect(sonnet55.pricing).toMatchObject({ inputPerMillion: 2, outputPerMillion: 10, pricingVersion: 'anthropic-2026-10-18' });
    expect(sonnet55.upgradePaths.find((p: { fromModelId: string }) => p.fromModelId === 'claude-sonnet-4-5').compatibility).toBe('drop_in');
    // Alice only sees her own team.
    expect(res.body.scopes.find((s: { level: string }) => s.level === 'team').options).toEqual([{ id: 'team-a', label: 'Team A' }]);
    // No exchange rate yet, so USD, and it says so. No secrets anywhere.
    expect(res.body.currency).toBe('USD');
    expect(res.body.notes.join(' ')).toContain('No AUD exchange rate');
    expect(JSON.stringify(res.body)).not.toMatch(/sk-ant|api[_-]?key|secret/i);
  });

  it('converts prices into the reporting currency when a rate is set', async () => {
    const res = await request(setup({ rate: 1.5 }).app).get('/api/upgrade-analysis/models').set(as('admin'));
    expect(res.body.currency).toBe('AUD');
    expect(res.body.candidateModels.find((m: { id: string }) => m.id === 'claude-sonnet-5-5').pricing.inputPerMillion).toBeCloseTo(3, 9);
  });
});

describe('POST /api/upgrade-analysis/estimate', () => {
  it('returns a modelled projection from the member’s own usage', async () => {
    const { app, usage } = setup({ rate: 1.5 });
    const res = await request(app).post('/api/upgrade-analysis/estimate').set(as('alice')).send(body({ assumptions: { outputTokenChangePct: 0 } }));
    expect(res.status).toBe(200);
    const a = res.body.analysis;
    expect(a.currency).toBe('AUD');
    expect(a.current.usage.requests).toBe(2_000);
    expect(a.financial.currentCost).toBeCloseTo(2_000 * 0.0045 * 1.5, 6);
    expect(a.financial.projectedCost).toBeCloseTo(2_000 * 0.003 * 1.5, 6);
    expect(a.basis).toEqual({ current: 'estimated', usage: 'observed', projection: 'modelled' });
    expect(a.disclaimer).toBe(DISCLAIMER);
    expect(a.scope.label).toBe('Your own requests');
    const listed = usage.calls.filter((c) => c.method === 'listUsage');
    expect(listed.every((c) => (c.args[1] as { uid: string }).uid === 'alice')).toBe(true);
  });

  it('shows unconfirmed usage as requiring review, not savings', async () => {
    const res = await request(setup().app).post('/api/upgrade-analysis/estimate').set(as('admin')).send(body({ eligibilityRules: [] }));
    expect(res.status).toBe(200);
    expect(res.body.analysis.recommendation.classification).toBe('insufficient_data');
    expect(res.body.analysis.eligibility.requiresReview.requests).toBe(2_000);
    expect(res.body.analysis.financial).toBeNull();
  });

  it('refuses a team the member can’t see', async () => {
    const res = await request(setup().app).post('/api/upgrade-analysis/estimate').set(as('alice')).send(body({ scope: { level: 'team', id: 'team-b' } }));
    expect(res.status).toBe(403);
  });

  it('refuses scopes this workspace doesn’t record', async () => {
    const res = await request(setup().app).post('/api/upgrade-analysis/estimate').set(as('admin')).send(body({ scope: { level: 'workflow', id: 'wf-1' } }));
    expect(res.status).toBe(403);
  });

  it.each([
    ['a migration percentage over 100', { migrationPercentage: 120 }],
    ['a negative migration percentage', { migrationPercentage: -5 }],
    ['an end date in the future', { timeWindow: { kind: 'custom', from: '2026-01-01', to: '2999-01-01' } }],
    ['a reversed date range', { timeWindow: { kind: 'custom', from: '2026-09-10', to: '2026-09-01' } }],
    ['an unknown model', { candidateModelId: 'gpt-imaginary' }],
    ['figures made up by the client', { financial: { savings: 1_000_000 } }],
  ])('rejects %s with 400', async (_label, change) => {
    const res = await request(setup().app).post('/api/upgrade-analysis/estimate').set(as('admin')).send(body(change));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('says plainly when pricing is missing', async () => {
    const records = usageRecords(10, { modelId: 'claude-legacy-1', estimatedCostUsd: null, costStatus: 'unavailable' });
    const res = await request(setup({ records }).app).post('/api/upgrade-analysis/estimate').set(as('admin')).send(body({ currentModelId: 'claude-legacy-1' }));
    expect(res.status).toBe(200);
    expect(res.body.analysis.recommendation.reasons[0]).toContain('cannot calculate a reliable cost saving');
  });

  it('a view-only login can run estimates', async () => {
    expect((await request(setup().app).post('/api/upgrade-analysis/estimate').set(as('judge')).send(body())).status).toBe(200);
  });

  it('turns a database failure into 503', async () => {
    const { app, usage } = setup();
    usage.failWith = new Error('14 UNAVAILABLE');
    const res = await request(app).post('/api/upgrade-analysis/estimate').set(as('admin')).send(body());
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('UNAVAILABLE');
  });
});

describe('POST /api/upgrade-analysis/save and GET /api/upgrade-analysis/:id', () => {
  it('re-runs the estimate on the server and keeps pricing, inputs, timestamp and access', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/upgrade-analysis/save').set(as('alice')).send({ request: body(), title: 'Sonnet upgrade' });
    expect(res.status).toBe(201);
    const saved = res.body.saved;
    expect(saved.id).toMatch(/^ua_[0-9a-f]{24}$/);
    expect(saved).toMatchObject({
      companyId: 'test-company',
      title: 'Sonnet upgrade',
      status: 'draft',
      createdBy: 'alice',
      authorisation: { uid: 'alice', role: 'individual_user', teamIds: ['team-a'], readOnly: false },
      pricing: { current: { version: 'anthropic-2026-10-18' }, candidate: { version: 'anthropic-2026-10-18' } },
    });
    expect(saved.analysis.inputs.migrationPercentage).toBe(100);
    expect(saved.analysis.calculatedAt).toBe(saved.createdAt);
    expect(saved.audit).toHaveLength(1);

    const read = await request(app).get(`/api/upgrade-analysis/${saved.id}`).set(as('alice'));
    expect(read.status).toBe(200);
    expect(read.body.saved).toEqual(saved);
    // An admin of the company can read it; another individual user can't, nor can anyone outside.
    expect((await request(app).get(`/api/upgrade-analysis/${saved.id}`).set(as('admin'))).status).toBe(200);
    expect((await request(app).get(`/api/upgrade-analysis/${saved.id}`).set(as('bob'))).status).toBe(404);
    expect((await request(app).get(`/api/upgrade-analysis/${saved.id}`).set(as('outsider'))).status).toBe(403);
  });

  it('is idempotent per Idempotency-Key', async () => {
    const { app, upgradeStore } = setup();
    const send = (b: object) => request(app).post('/api/upgrade-analysis/save').set(as('admin')).set('Idempotency-Key', 'save-key-0001').send(b);
    const first = await send({ request: body() });
    const again = await send({ request: body() });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.saved.id).toBe(first.body.saved.id);
    expect(again.body.saved.createdAt).toBe(first.body.saved.createdAt);
    expect((upgradeStore as ReturnType<typeof createMemoryUpgradeStore>).docs.size).toBe(1);
    expect((await send({ request: body({ migrationPercentage: 50 }) })).status).toBe(409);
    expect((await request(app).post('/api/upgrade-analysis/save').set(as('admin')).set('Idempotency-Key', 'bad key!').send({ request: body() })).status).toBe(400);
  });

  it('validates the body', async () => {
    const { app } = setup();
    for (const b of [{}, { request: body(), extra: 1 }, { request: body(), title: '' }, { request: body(), status: 'approved' }, { request: body({ migrationPercentage: 101 }) }]) {
      expect((await request(app).post('/api/upgrade-analysis/save').set(as('admin')).send(b)).status).toBe(400);
    }
  });

  it('a view-only login can’t save', async () => {
    const res = await request(setup().app).post('/api/upgrade-analysis/save').set(as('judge')).send({ request: body() });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('view-only');
  });

  it('unknown or malformed IDs are 404', async () => {
    const { app } = setup();
    expect((await request(app).get(`/api/upgrade-analysis/ua_${'1'.repeat(24)}`).set(as('admin'))).status).toBe(404);
    expect((await request(app).get('/api/upgrade-analysis/../../usage').set(as('admin'))).status).toBe(404);
  });
});

describe('POST /api/upgrade-analysis/:id/export', () => {
  it('exports Markdown or CSV and records each export in the audit history', async () => {
    const { app } = setup();
    const saved = (await request(app).post('/api/upgrade-analysis/save').set(as('admin')).send({ request: body() })).body.saved;
    const md = await request(app).post(`/api/upgrade-analysis/${saved.id}/export`).set(as('admin')).send({});
    expect(md.status).toBe(200);
    expect(md.body).toMatchObject({ id: saved.id, format: 'markdown', contentType: 'text/markdown', filename: `${saved.id}.md` });
    expect(md.body.content).toContain('**Upgrade Analysis**');
    expect(md.body.content).toContain(DISCLAIMER);
    const csv = await request(app).post(`/api/upgrade-analysis/${saved.id}/export`).set(as('judge')).send({ format: 'csv' });
    expect(csv.status).toBe(200);
    expect(csv.body.content).toContain('estimated_monthly_savings');
    const audit = (await request(app).get(`/api/upgrade-analysis/${saved.id}`).set(as('admin'))).body.saved.audit;
    expect(audit.map((e: { action: string; actorUid: string }) => `${e.action}:${e.actorUid}`)).toEqual(['saved:admin', 'exported:admin', 'exported:judge']);
  });

  it('a retried export with the same Idempotency-Key is recorded once', async () => {
    const { app } = setup();
    const saved = (await request(app).post('/api/upgrade-analysis/save').set(as('admin')).send({ request: body() })).body.saved;
    const send = () => request(app).post(`/api/upgrade-analysis/${saved.id}/export`).set(as('admin')).set('Idempotency-Key', 'export-key-1').send({ format: 'csv' });
    const a = await send();
    const b = await send();
    expect(b.body.exportedAt).toBe(a.body.exportedAt);
    const audit = (await request(app).get(`/api/upgrade-analysis/${saved.id}`).set(as('admin'))).body.saved.audit;
    expect(audit).toHaveLength(2);
  });

  it('rejects an unknown format, and someone else’s analysis looks missing', async () => {
    const { app } = setup();
    const saved = (await request(app).post('/api/upgrade-analysis/save').set(as('alice')).send({ request: body() })).body.saved;
    expect((await request(app).post(`/api/upgrade-analysis/${saved.id}/export`).set(as('alice')).send({ format: 'pdf' })).status).toBe(400);
    expect((await request(app).post(`/api/upgrade-analysis/${saved.id}/export`).set(as('bob')).send({})).status).toBe(404);
  });
});
