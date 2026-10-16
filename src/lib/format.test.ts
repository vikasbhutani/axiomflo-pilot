import { describe, expect, it } from 'vitest';
import { formatCurrency, formatNumber, formatPercent, formatPeriod, formatPeriodRange, NOT_AVAILABLE, periodBounds, toLocalDate } from './format';
import { can, scopeUsageRecords, visibleTeamIds } from './permissions';
import { DEMO_PERSONAS, teams, users, usageRecords } from '../data/mockData';

describe('Display formatting', () => {
  it('rounds money only for display and never turns missing values into $0', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
    expect(formatCurrency(0.000123, { precise: true })).toBe('$0.0001');
    expect(formatCurrency(null)).toBe(NOT_AVAILABLE);
    expect(formatCurrency(undefined)).toBe(NOT_AVAILABLE);
    expect(formatCurrency(Number.NaN)).toBe(NOT_AVAILABLE);
    expect(formatNumber(null)).toBe(NOT_AVAILABLE);
  });

  it('shows "Not available" for ratios that divide by zero', () => {
    expect(formatPercent(null)).toBe(NOT_AVAILABLE);
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe(NOT_AVAILABLE);
    expect(formatPercent(0.4567, 1)).toBe('45.7%');
  });

  it('assigns timestamps to the Sydney calendar day, including across daylight saving', () => {
    // 13:59 UTC is 23:59 AEST (UTC+10) on 30 Sept; 14:00 UTC is already 1 Oct.
    expect(toLocalDate('2026-09-30T13:59:00Z')).toBe('2026-09-30');
    expect(toLocalDate('2026-09-30T14:00:00Z')).toBe('2026-10-01');
    // After daylight saving starts (4 Oct 2026) Sydney is UTC+11.
    expect(toLocalDate('2026-10-10T13:30:00Z')).toBe('2026-10-11');
  });

  it('derives month bounds and labels', () => {
    expect(periodBounds('2026-09')).toEqual(['2026-09-01', '2026-09-30']);
    expect(periodBounds('2028-02')).toEqual(['2028-02-01', '2028-02-29']);
    expect(formatPeriod('2026-08')).toBe('August 2026');
    expect(formatPeriodRange('2026-09')).toMatch(/^1 Sept – 30 Sept 2026$/);
  });
});

describe('Demo permissions', () => {
  const admin = { userId: DEMO_PERSONAS.company_admin, role: 'company_admin' as const };
  const individual = { userId: DEMO_PERSONAS.individual_user, role: 'individual_user' as const };

  it('gives admin-only permissions to Company Admins only', () => {
    for (const p of ['view_company_totals', 'manage_teams', 'invite_users', 'view_provider_settings', 'export_company_showback'] as const) {
      expect(can(admin, p)).toBe(true);
      expect(can(individual, p)).toBe(false);
    }
  });

  it('limits an Individual User to their own requests and team', () => {
    const me = users.find((u) => u.id === individual.userId)!;
    const scoped = scopeUsageRecords(usageRecords, individual, users);
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((r) => r.principal.type === 'user' && r.principal.id === me.id && r.teamId === me.teamId)).toBe(true);
    expect(visibleTeamIds(individual, users, teams.map((t) => t.id))).toEqual([me.teamId]);
    expect(scopeUsageRecords(usageRecords, admin, users)).toHaveLength(usageRecords.length);
  });

  it('shows nothing to an unknown user', () => {
    const ghost = { userId: 'u-unknown', role: 'individual_user' as const };
    expect(scopeUsageRecords(usageRecords, ghost, users)).toEqual([]);
    expect(visibleTeamIds(ghost, users, teams.map((t) => t.id))).toEqual([]);
  });
});
