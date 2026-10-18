/** Usage reads and exchange rates against the Firestore and Auth emulators. */
import { beforeEach, describe, expect, it } from 'vitest';
import { applyBootstrap } from '../bootstrap/bootstrap.js';
import { parseBootstrapInput } from '../bootstrap/input.js';
import { ApiError } from '../http/errors.js';
import { silentLogger } from '../http/logger.js';
import { emulatorApp, resetEmulators } from '../test/emulator.js';
import { createFirestoreUsageService } from './firestoreUsageService.js';

const { auth, db } = emulatorApp();
const C = 'pilot-co';
const usage = createFirestoreUsageService({ db, auth, logger: silentLogger });
const setup = parseBootstrapInput({
  company: { id: C, name: 'Pilot Co', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' },
  department: { id: 'engineering', name: 'Engineering' },
  teams: [
    { id: 'platform', name: 'Platform', code: 'PLAT' },
    { id: 'product', name: 'Product', code: 'PROD' },
  ],
});
const OCT: { startIso: string; endIso: string } = { startIso: '2026-09-30T14:00:00.000Z', endIso: '2026-10-31T13:00:00.000Z' };

let founder: string;
let alice: string;

function record(id: string, uid: string, timestamp: string, extra: Record<string, unknown> = {}) {
  return db.doc(`companies/${C}/usage/${id}`).set({
    timestamp,
    principal: { type: 'user', id: uid },
    keyId: 'k'.repeat(24),
    teamId: 'product',
    teamCode: 'PROD',
    providerId: 'anthropic',
    modelId: 'claude-sonnet-5-5',
    inputTokens: 1000,
    outputTokens: 500,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    requestStatus: 'succeeded',
    providerStatus: 200,
    costStatus: 'estimated',
    estimatedCostUsd: 0.007,
    priceVersion: 'anthropic-2026-10-18',
    stream: false,
    latencyMs: 900,
    providerRequestId: 'req_1',
    ...extra,
  });
}

beforeEach(async () => {
  await resetEmulators();
  founder = (await auth.createUser({ email: 'founder@example.com', displayName: 'Founder', emailVerified: true })).uid;
  await applyBootstrap(db, setup, founder);
  alice = (await auth.createUser({ email: 'alice@example.com', displayName: 'Alice', emailVerified: true })).uid;
  await db.doc(`companies/${C}/memberships/${alice}`).set({ uid: alice, role: 'individual_user', teamIds: ['product'], status: 'active' });
  await record('r-sep', alice, '2026-09-30T13:59:59.000Z');
  await record('r-oct-1', alice, '2026-09-30T14:00:00.000Z');
  await record('r-oct-2', founder, '2026-10-20T01:00:00.000Z');
  await record('r-nov', alice, '2026-10-31T13:00:00.000Z');
  await record('r-bad', alice, '2026-10-05T00:00:00.000Z', { principal: 'nope' });
});

describe('listing usage', () => {
  it('gives an admin everyone’s requests in the Sydney month, newest first, with names', async () => {
    const result = await usage.listUsage(C, { uid: founder, role: 'company_admin' }, OCT);
    expect(result.records.map((r) => r.id)).toEqual(['r-oct-2', 'r-oct-1']);
    expect(result.people[alice]).toEqual({ name: 'Alice', email: 'alice@example.com' });
    expect(result.skipped).toBe(1);
    expect(result.truncated).toBe(false);
    expect(JSON.stringify(result)).not.toContain('req_1');
  });

  it('gives an individual user only their own requests', async () => {
    const result = await usage.listUsage(C, { uid: alice, role: 'individual_user' }, OCT);
    expect(result.records.map((r) => r.id)).toEqual(['r-oct-1']);
    expect(Object.keys(result.people)).toEqual([alice]);
  });

  it('never shows a cost without both token counts behind it', async () => {
    await record('r-odd', alice, '2026-10-10T00:00:00.000Z', { inputTokens: null, estimatedCostUsd: 0.5 });
    const r = (await usage.listUsage(C, { uid: alice, role: 'individual_user' }, OCT)).records.find((x) => x.id === 'r-odd')!;
    expect(r).toMatchObject({ costStatus: 'unavailable', estimatedCostUsd: null });
  });

  it('only reads the configured company', async () => {
    await db.doc(`companies/other/usage/x`).set({ timestamp: '2026-10-10T00:00:00.000Z' });
    const result = await usage.listUsage(C, { uid: founder, role: 'company_admin' }, OCT);
    expect(result.records.map((r) => r.id)).not.toContain('x');
  });
});

describe('exchange rates', () => {
  it('an admin sets a month’s rate; it is audited with the previous value', async () => {
    await usage.setRate(C, founder, '2026-10', 1.5, 'AUD');
    const view = await usage.setRate(C, founder, '2026-10', 1.55, 'AUD');
    expect(view).toMatchObject({ month: '2026-10', rate: 1.55, currency: 'AUD', setBy: founder });
    expect(await usage.listRates(C)).toHaveLength(1);
    const audits = (await db.collection(`companies/${C}/auditEvents`).where('action', '==', 'exchangeRate.set').get()).docs.map((d) => d.data());
    expect(audits.map((a) => a.metadata)).toEqual(expect.arrayContaining([{ rate: 1.55, currency: 'AUD', previousRate: 1.5 }]));
  });

  it('is refused for a non-admin or a suspended admin, even if the route check were skipped', async () => {
    const err = await usage.setRate(C, alice, '2026-10', 1.5, 'AUD').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    await db.doc(`companies/${C}/memberships/${founder}`).update({ status: 'suspended' });
    expect(((await usage.setRate(C, founder, '2026-10', 1.5, 'AUD').catch((e: unknown) => e)) as ApiError).status).toBe(403);
    expect(await usage.listRates(C)).toEqual([]);
  });
});
