import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildOverview,
  buildProviderCards,
  buildTeams,
  changeUserTeam,
  getAuditEvents,
  inviteUser,
  renameTeam,
  resetDemoWorkspace,
  saveAnthropicConfig,
  saveGeminiConfig,
  selectUsage,
  setConnectionEnabled,
  setUserStatus,
  simulateConnectionTest,
  ValidationError,
} from './mockService';
import { demoStore } from '../data/demoStore';
import { DEMO_PERSONAS } from '../data/mockData';
import type { UserContext } from '../types';

const admin: UserContext = { userId: DEMO_PERSONAS.company_admin, role: 'company_admin' };
const individual: UserContext = { userId: DEMO_PERSONAS.individual_user, role: 'individual_user' };

beforeEach(() => demoStore.reset());

describe('teams', () => {
  it('admins see both teams; totals match the Overview team breakdown', () => {
    const data = buildTeams('2026-09', admin);
    const overview = buildOverview({ period: '2026-09' }, admin);
    expect(data.teams.map((t) => t.team.code)).toEqual(['ENG-PLATFORM', 'ENG-PRODUCT']);
    for (const t of data.teams) {
      const slice = overview.byTeam.find((s) => s.teamId === t.team.id)!;
      expect(t.summary.estimatedSpend).toBeCloseTo(slice.summary.estimatedSpend, 9);
      expect(t.summary.requestCount).toBe(slice.summary.requestCount);
    }
  });

  it('Individual Users see only their team, and only their own activity counts', () => {
    const data = buildTeams('2026-09', individual);
    expect(data.canManage).toBe(false);
    expect(data.teams).toHaveLength(1);
    const others = data.teams[0].members.filter((m) => m.id !== individual.userId);
    expect(others.every((m) => m.requestCount === 0)).toBe(true);
  });

  it('renames a team without changing its code, and the new name flows into usage records', async () => {
    await renameTeam('team-product', 'Customer Experience', admin);
    const team = buildTeams('2026-09', admin).teams.find((t) => t.team.id === 'team-product')!.team;
    expect(team.name).toBe('Customer Experience');
    expect(team.code).toBe('ENG-PRODUCT');
    const record = selectUsage({ startDate: '2026-09-01', endDate: '2026-09-30', teamId: 'team-product' }, admin)[0];
    expect(record.teamName).toBe('Customer Experience');
    expect(record.teamCode).toBe('ENG-PRODUCT');
  });

  it('validates team names', async () => {
    await expect(renameTeam('team-product', '   ', admin)).rejects.toBeInstanceOf(ValidationError);
    await expect(renameTeam('team-product', 'platform engineering', admin)).rejects.toThrow(/already uses/);
  });

  it('blocks Individual Users from admin actions in the service layer', async () => {
    await expect(renameTeam('team-product', 'Nope', individual)).rejects.toThrow(/Company Admins/);
    await expect(inviteUser({ name: 'A', email: 'a@acme.example', role: 'individual_user', teamId: 'team-product' }, individual)).rejects.toThrow(/Company Admins/);
    await expect(setUserStatus('u-sofia', 'suspended', individual)).rejects.toThrow(/Company Admins/);
    expect(() => buildProviderCards('2026-09', individual)).toThrow(/Company Admins/);
    await expect(getAuditEvents(individual)).rejects.toThrow(/Company Admins/);
  });
});

describe('users', () => {
  it('invites a user as "invited" and records an audit event', async () => {
    const user = await inviteUser({ name: 'Jordan Lee', email: 'Jordan.Lee@acme.example', role: 'individual_user', teamId: 'team-product' }, admin);
    expect(user.status).toBe('invited');
    expect(user.email).toBe('jordan.lee@acme.example');
    const audit = await getAuditEvents(admin);
    expect(audit[0].action).toMatch(/invited/i);
    expect(audit[0].detail).toMatch(/No email sent/);
  });

  it('validates invitations', async () => {
    const result = inviteUser({ name: '', email: 'not-an-email', role: 'individual_user', teamId: 'nope' }, admin);
    await expect(result).rejects.toBeInstanceOf(ValidationError);
    const error = (await result.catch((e) => e)) as ValidationError;
    expect(Object.keys(error.fieldErrors).sort()).toEqual(['email', 'name', 'teamId']);
    await expect(inviteUser({ name: 'Dup', email: 'sofia.rossi@acme.example', role: 'individual_user', teamId: 'team-product' }, admin)).rejects.toThrow(/already in the workspace/);
  });

  it('moves a member without rewriting historical attribution', async () => {
    const before = selectUsage({ startDate: '2026-08-01', endDate: '2026-09-30' }, admin).filter((r) => r.principal.id === 'u-sofia');
    await changeUserTeam('u-sofia', 'team-platform', admin);
    const after = selectUsage({ startDate: '2026-08-01', endDate: '2026-09-30' }, admin).filter((r) => r.principal.id === 'u-sofia');
    expect(after.map((r) => r.teamCode)).toEqual(before.map((r) => r.teamCode));
    expect(buildTeams('2026-09', admin).teams.find((t) => t.team.id === 'team-platform')!.members.some((m) => m.id === 'u-sofia')).toBe(true);
  });

  it('suspends and reactivates, but protects demo personas', async () => {
    expect((await setUserStatus('u-ethan', 'suspended', admin)).status).toBe('suspended');
    expect((await setUserStatus('u-ethan', 'active', admin)).status).toBe('active');
    await expect(setUserStatus(DEMO_PERSONAS.individual_user, 'suspended', admin)).rejects.toBeInstanceOf(ValidationError);
    await expect(changeUserTeam(DEMO_PERSONAS.individual_user, 'team-platform', admin)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('provider connections', () => {
  it('provider card totals match the Overview provider breakdown', () => {
    const cards = buildProviderCards('2026-09', admin);
    const overview = buildOverview({ period: '2026-09' }, admin);
    for (const c of cards) {
      expect(c.summary.estimatedSpend).toBeCloseTo(overview.byProvider.find((p) => p.providerId === c.connection.providerId)!.summary.estimatedSpend, 9);
    }
  });

  it('never exposes anything but masked credentials', () => {
    const anthropic = buildProviderCards('2026-09', admin).find((c) => c.connection.providerId === 'anthropic')!;
    expect(anthropic.connection.maskedCredential).toMatch(/•/);
    expect(anthropic.connection.configSummary).toMatch(/not a real key/);
  });

  it('simulates success and failure, and refuses tests on disabled connections', async () => {
    expect((await simulateConnectionTest('conn-gemini', 'failure', admin)).lastSimulatedTestResult).toBe('failure');
    expect((await simulateConnectionTest('conn-gemini', 'success', admin)).lastSimulatedTestResult).toBe('success');
    await setConnectionEnabled('conn-anthropic', false, admin);
    await expect(simulateConnectionTest('conn-anthropic', 'success', admin)).rejects.toThrow(/Enable the connection/);
    expect(buildOverview({ period: '2026-09' }, admin).connections.find((c) => c.connection.id === 'conn-anthropic')!.connection.status).toBe('disabled');
  });

  it('validates configuration', async () => {
    await expect(saveGeminiConfig('conn-gemini', { projectId: 'Bad Project!', region: 'mars-1' }, admin)).rejects.toBeInstanceOf(ValidationError);
    const saved = await saveGeminiConfig('conn-gemini', { projectId: 'acme-new-project', region: 'asia-southeast1' }, admin);
    expect(saved.configSummary).toMatch(/acme-new-project · asia-southeast1/);
    await expect(saveAnthropicConfig('conn-anthropic', { displayName: '', notes: '' }, admin)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('demo reset', () => {
  it('restores seed data', async () => {
    await renameTeam('team-product', 'Renamed', admin);
    await inviteUser({ name: 'Temp', email: 'temp@acme.example', role: 'individual_user', teamId: 'team-product' }, admin);
    await resetDemoWorkspace();
    const data = buildTeams('2026-09', admin);
    expect(data.teams.find((t) => t.team.id === 'team-product')!.team.name).toBe('Product Experience');
    expect(data.teams.flatMap((t) => t.members).some((m) => m.email === 'temp@acme.example')).toBe(false);
  });
});
