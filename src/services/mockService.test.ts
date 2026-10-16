import { describe, expect, it } from 'vitest';
import { buildOverview, getProviderConnections, getReportingPeriods, selectRecords } from './mockService';
import { DEMO_PERSONAS, usageRecords, users } from '../data/mockData';
import type { UserContext } from '../types';

const admin: UserContext = { userId: DEMO_PERSONAS.company_admin, role: 'company_admin' };
const individual: UserContext = { userId: DEMO_PERSONAS.individual_user, role: 'individual_user' };
const periods = getReportingPeriods();

describe('dataset', () => {
  it('spans two consecutive months, newest first', () => {
    expect(periods).toEqual(['2026-09', '2026-08']);
  });

  it('includes failed requests and records with unavailable usage', () => {
    expect(usageRecords.some((r) => r.requestStatus === 'failed' && r.inputTokens !== null)).toBe(true);
    expect(usageRecords.some((r) => r.requestStatus === 'failed' && r.inputTokens === null)).toBe(true);
    expect(usageRecords.some((r) => r.requestStatus === 'succeeded' && r.inputTokens === null)).toBe(true);
    expect(usageRecords.every((r) => (r.inputTokens === null) === (r.costStatus === 'unavailable'))).toBe(true);
  });
});

describe('overview totals are consistent', () => {
  for (const period of periods) {
    for (const providerId of ['all', 'gemini_vertex', 'anthropic'] as const) {
      it(`team, provider and daily breakdowns add up to the headline (${period}, ${providerId})`, () => {
        const o = buildOverview({ period, teamId: 'all', providerId }, admin);
        const teamSpend = o.byTeam.reduce((s, t) => s + t.summary.estimatedSpend, 0);
        const providerSpend = o.byProvider.reduce((s, p) => s + p.summary.estimatedSpend, 0);
        const dailySpend = o.daily.reduce((s, d) => s + d.estimatedSpend, 0);
        expect(teamSpend).toBeCloseTo(o.summary.estimatedSpend, 9);
        expect(providerSpend).toBeCloseTo(o.summary.estimatedSpend, 9);
        expect(dailySpend).toBeCloseTo(o.summary.estimatedSpend, 9);
        expect(o.byTeam.reduce((s, t) => s + t.summary.requestCount, 0)).toBe(o.summary.requestCount);
        expect(o.byTeam.reduce((s, t) => s + t.summary.unresolvedCount, 0)).toBe(o.summary.unresolvedCount);
        expect(o.summary.costedCount + o.summary.unresolvedCount).toBe(o.summary.requestCount);
      });
    }
  }

  it('team filter narrows every section to that team', () => {
    const all = buildOverview({ period: '2026-09', teamId: 'all', providerId: 'all' }, admin);
    const platform = buildOverview({ period: '2026-09', teamId: 'team-platform', providerId: 'all' }, admin);
    expect(platform.byTeam).toHaveLength(1);
    expect(platform.summary.estimatedSpend).toBeCloseTo(all.byTeam.find((t) => t.teamId === 'team-platform')!.summary.estimatedSpend, 9);
    expect(platform.recentRequests.every((r) => r.teamId === 'team-platform')).toBe(true);
  });
});

describe('role-scoped data filtering', () => {
  it('Individual User only sees their own requests', () => {
    const records = selectRecords({ period: '2026-09' }, individual);
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.principal.type === 'user' && r.principal.id === individual.userId)).toBe(true);
  });

  it('Individual User cannot widen scope with a team filter', () => {
    const otherTeam = selectRecords({ period: '2026-09', teamId: 'team-platform' }, individual);
    expect(otherTeam).toHaveLength(0);
    const o = buildOverview({ period: '2026-09', teamId: 'team-platform' }, individual);
    const noah = users.find((u) => u.id === individual.userId)!;
    expect(o.byTeam.map((t) => t.teamId)).toEqual([noah.teamId]);
    expect(o.recentRequests.every((r) => r.principal.id === individual.userId)).toBe(true);
  });

  it('Individual User totals are a strict subset of company totals', () => {
    const mine = buildOverview({ period: '2026-09' }, individual).summary;
    const company = buildOverview({ period: '2026-09' }, admin).summary;
    expect(mine.requestCount).toBeLessThan(company.requestCount);
    expect(mine.estimatedSpend).toBeLessThan(company.estimatedSpend);
  });

  it('hides provider configuration from Individual Users', async () => {
    const o = buildOverview({ period: '2026-09' }, individual);
    expect(o.connections.every((c) => c.connection.configSummary === '')).toBe(true);
    await expect(getProviderConnections('2026-09', individual)).rejects.toThrow(/Company Admins/);
    await expect(getProviderConnections('2026-09', admin)).resolves.toHaveLength(2);
  });

  it('unknown users see nothing', () => {
    expect(selectRecords({ period: '2026-09' }, { userId: 'nobody', role: 'individual_user' })).toHaveLength(0);
  });
});

describe('missing-cost handling', () => {
  it('unresolved records are excluded from spend and counted separately', () => {
    const records = selectRecords({ period: '2026-09' }, admin);
    const unresolved = records.filter((r) => r.estimatedCost === null);
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved.every((r) => r.costStatus === 'unavailable')).toBe(true);
    const o = buildOverview({ period: '2026-09' }, admin);
    expect(o.summary.unresolvedCount).toBe(unresolved.length);
    expect(o.summary.averageCostPerCostedRequest).toBeCloseTo(o.summary.estimatedSpend / o.summary.costedCount, 12);
  });

  it('failed requests with measured usage still carry cost', () => {
    const failedCosted = selectRecords({ period: '2026-09' }, admin).filter((r) => r.requestStatus === 'failed' && r.estimatedCost !== null);
    expect(failedCosted.length).toBeGreaterThan(0);
    expect(failedCosted.every((r) => r.estimatedCost! > 0)).toBe(true);
  });
});
