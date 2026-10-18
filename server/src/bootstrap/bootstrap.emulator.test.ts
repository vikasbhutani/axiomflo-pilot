import { beforeEach, describe, expect, it } from 'vitest';
import { emulatorApp, resetEmulators } from '../test/emulator.js';
import { applyBootstrap, BootstrapConflictError, planBootstrap } from './bootstrap.js';
import { parseBootstrapInput, type BootstrapInput } from './input.js';

const { db } = emulatorApp();
const ADMIN = 'admin-uid-1';

const input: BootstrapInput = parseBootstrapInput({
  company: { id: 'pilot-co', name: 'Pilot Co', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' },
  department: { id: 'engineering', name: 'Engineering' },
  teams: [
    { id: 'platform', name: 'Platform', code: 'PLAT' },
    { id: 'product', name: 'Product', code: 'PROD' },
  ],
});

const company = () => db.collection('companies').doc('pilot-co');
const audits = async () => (await company().collection('auditEvents').get()).docs.map((d) => d.data());

beforeEach(resetEmulators);

describe('bootstrap against the Firestore emulator', () => {
  it('creates the company, department, two teams, admin membership and one audit event', async () => {
    const plan = await applyBootstrap(db, input, ADMIN);
    expect(plan.toCreate).toHaveLength(5);

    expect((await company().get()).data()).toMatchObject({ name: 'Pilot Co', status: 'active', reportingCurrency: 'AUD' });
    expect((await company().get()).get('createdAt')).toBeDefined();
    expect((await company().collection('teams').doc('platform').get()).data()).toMatchObject({ code: 'PLAT', departmentId: 'engineering', status: 'active' });
    expect((await company().collection('memberships').doc(ADMIN).get()).data()).toMatchObject({ uid: ADMIN, role: 'company_admin', status: 'active', teamIds: [] });

    const events = await audits();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'company.bootstrapped', targetId: 'pilot-co', metadata: { adminUid: ADMIN } });
  });

  it('is idempotent: a second run changes nothing and writes no second audit event', async () => {
    await applyBootstrap(db, input, ADMIN);
    const before = (await company().get()).updateTime;
    const again = await applyBootstrap(db, input, ADMIN);
    expect(again.toCreate).toEqual([]);
    expect(again.items.every((i) => i.action === 'unchanged')).toBe(true);
    expect((await company().get()).updateTime?.isEqual(before!)).toBe(true);
    expect(await audits()).toHaveLength(1);
  });

  it('refuses a conflicting record and writes nothing at all', async () => {
    await company().set({ name: 'Someone Else', status: 'active', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' });
    const plan = await planBootstrap(db, input, ADMIN);
    expect(plan.conflicts.map((c) => [c.path, c.differences])).toEqual([['companies/pilot-co', ['name']]]);

    await expect(applyBootstrap(db, input, ADMIN)).rejects.toBeInstanceOf(BootstrapConflictError);
    expect((await company().get()).get('name')).toBe('Someone Else');
    expect((await company().collection('teams').get()).empty).toBe(true);
    expect((await company().collection('memberships').get()).empty).toBe(true);
  });

  it('refuses to re-activate a suspended admin', async () => {
    await applyBootstrap(db, input, ADMIN);
    await company().collection('memberships').doc(ADMIN).update({ status: 'suspended' });
    await expect(applyBootstrap(db, input, ADMIN)).rejects.toBeInstanceOf(BootstrapConflictError);
    expect((await company().collection('memberships').doc(ADMIN).get()).get('status')).toBe('suspended');
  });

  it('refuses a team code already used by another team in the company', async () => {
    await company().collection('teams').doc('legacy').set({ code: 'PLAT', name: 'Legacy', departmentId: 'x', status: 'active' });
    await expect(applyBootstrap(db, input, ADMIN)).rejects.toBeInstanceOf(BootstrapConflictError);
  });

  it('creates only what is missing when some records already match', async () => {
    await applyBootstrap(db, input, ADMIN);
    await company().collection('teams').doc('product').delete();
    const plan = await applyBootstrap(db, input, ADMIN);
    expect(plan.toCreate.map((i) => i.path)).toEqual(['companies/pilot-co/teams/product']);
    expect(await audits()).toHaveLength(2);
  });
});
