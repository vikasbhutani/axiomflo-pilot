/** Saved Upgrade Analyses against the Firestore emulator. */
import { beforeEach, describe, expect, it } from 'vitest';
import { emulatorApp, resetEmulators } from '../test/emulator.js';
import { FIXTURE_CATALOGUE, FIXTURE_SCOPES, FIXTURE_TODAY, fixtureRecords, fixtureRequest } from '../test/upgradeFixtures.js';
import { estimateUpgrade } from './engine.js';
import { createFirestoreUpgradeStore } from './firestoreStore.js';
import type { NewSavedAnalysis } from './store.js';

const { db } = emulatorApp();
const store = createFirestoreUpgradeStore({ db });
const C = 'pilot-co';
const admin = { uid: 'alice', role: 'company_admin' as const };
const member = { uid: 'bob', role: 'individual_user' as const };
const at = new Date('2026-09-30T12:00:00.000Z');

function input(pct = 100): NewSavedAnalysis {
  const analysis = estimateUpgrade(fixtureRequest({ migrationPercentage: pct }), {
    catalogue: FIXTURE_CATALOGUE,
    records: fixtureRecords(),
    scopes: FIXTURE_SCOPES,
    companyLabel: 'Test Company',
    currency: 'USD',
    today: FIXTURE_TODAY,
    regionOf: () => null,
    now: at.toISOString(),
  });
  return { title: 'Sonnet upgrade', status: 'draft', analysis, authorisation: { uid: member.uid, role: member.role, teamIds: ['team-1'], readOnly: false } };
}

beforeEach(async () => {
  await resetEmulators();
});

describe('Firestore Upgrade Analysis store', () => {
  it('saves once per key, keeps the analysis exactly, and audits the save', async () => {
    const first = await store.save(C, member, input(), 'key-00000001', at);
    expect(first.replayed).toBe(false);
    const again = await store.save(C, member, input(), 'key-00000001', new Date('2026-10-01T00:00:00.000Z'));
    expect(again).toMatchObject({ replayed: true, saved: { id: first.saved.id, createdAt: at.toISOString() } });
    await expect(store.save(C, member, input(50), 'key-00000001', at)).rejects.toMatchObject({ status: 409 });

    const stored = await store.get(C, member, first.saved.id);
    expect(stored?.analysis).toEqual(first.saved.analysis);
    expect(stored?.pricing.candidate.version).toBe(first.saved.analysis.candidate.pricing?.pricingVersion);
    const audit = await db.collection(`companies/${C}/auditEvents`).where('action', '==', 'upgradeAnalysis.saved').get();
    expect(audit.size).toBe(1);
  });

  it('shows an analysis only to its author and Company Admins in the same company', async () => {
    const { saved } = await store.save(C, member, input(), 'key-00000002', at);
    expect(await store.get(C, admin, saved.id)).not.toBeNull();
    expect(await store.get(C, { uid: 'carol', role: 'individual_user' }, saved.id)).toBeNull();
    expect(await store.get('other-co', admin, saved.id)).toBeNull();
  });

  it('records each export once per key and never changes the analysis', async () => {
    const { saved } = await store.save(C, member, input(), 'key-00000003', at);
    await store.recordExport(C, member, saved.id, 'Exported as Markdown.', 'exp-00000001', at);
    await store.recordExport(C, member, saved.id, 'Exported as Markdown.', 'exp-00000001', at);
    await store.recordExport(C, admin, saved.id, 'Exported as CSV.', 'exp-00000002', at);
    const after = (await store.get(C, member, saved.id))!;
    expect(after.audit.map((a) => a.action)).toEqual(['saved', 'exported', 'exported']);
    expect(after.analysis).toEqual(saved.analysis);
    await expect(store.recordExport(C, { uid: 'carol', role: 'individual_user' }, saved.id, 'x', null, at)).rejects.toMatchObject({ status: 404 });
    const audit = await db.collection(`companies/${C}/auditEvents`).where('action', '==', 'upgradeAnalysis.exported').get();
    expect(audit.size).toBe(2);
  });
});
