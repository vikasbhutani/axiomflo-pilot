import { beforeEach, describe, expect, it } from 'vitest';
import { buildMonthlyShowback, buildOverview, buildShowbackCsv, renameTeam, SHOWBACK_CSV_HEADER } from './mockService';
import { csvCell, parseCsv, toCsv } from '../lib/csv';
import { demoStore } from '../data/demoStore';
import { DEMO_PERSONAS, users } from '../data/mockData';
import type { UserContext } from '../types';

const admin: UserContext = { userId: DEMO_PERSONAS.company_admin, role: 'company_admin' };
const individual: UserContext = { userId: DEMO_PERSONAS.individual_user, role: 'individual_user' };

function csvRows(csv: string) {
  const [header, ...rows] = parseCsv(csv);
  return { header, rows: rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))) };
}

beforeEach(() => demoStore.reset());

describe('Monthly showback', () => {
  it('matches the Overview totals for the same month', () => {
    const report = buildMonthlyShowback('2026-09', {}, admin);
    const overview = buildOverview({ period: '2026-09' }, admin).summary;
    expect(report.summary.requestCount).toBe(overview.requestCount);
    expect(report.summary.estimatedSpend).toBeCloseTo(overview.estimatedSpend, 9);
    expect(report.summary.unresolvedCount).toBe(overview.unresolvedCount);
    expect(report.isCompanyWide).toBe(true);
  });

  it('allocates every request and dollar to exactly one team and provider', () => {
    const report = buildMonthlyShowback('2026-09', {}, admin);
    const teamSpend = report.teams.reduce((s, t) => s + t.summary.estimatedSpend, 0);
    const teamRequests = report.teams.reduce((s, t) => s + t.summary.requestCount, 0);
    const providerSpend = report.providers.reduce((s, p) => s + p.summary.estimatedSpend, 0);
    expect(teamSpend).toBeCloseTo(report.summary.estimatedSpend, 9);
    expect(providerSpend).toBeCloseTo(report.summary.estimatedSpend, 9);
    expect(teamRequests).toBe(report.summary.requestCount);
    for (const t of report.teams) {
      const perProvider = Object.values(t.byProvider).reduce((s, p) => s + p.estimatedSpend, 0);
      expect(perProvider).toBeCloseTo(t.summary.estimatedSpend, 9);
    }
  });

  it('keeps reconciled, estimated-only and unresolved states separate', () => {
    const s = buildMonthlyShowback('2026-09', {}, admin).summary;
    expect(s.reconciledCount + s.estimatedOnlyCount + s.unresolvedCount).toBe(s.requestCount);
    expect(s.reconciledSpend + s.estimatedOnlySpend).toBeCloseTo(s.estimatedSpend, 9);
    expect(s.unresolvedCount).toBeGreaterThan(0);
  });

  it('applies team and provider filters for admins', () => {
    const report = buildMonthlyShowback('2026-08', { teamId: 'team-product', providerId: 'gemini_vertex' }, admin);
    expect(report.teams.map((t) => t.teamId)).toEqual(['team-product']);
    expect(report.providers.map((p) => p.providerId)).toEqual(['gemini_vertex']);
    expect(report.isCompanyWide).toBe(false);
    for (const r of report.unresolved) {
      expect(r.teamId).toBe('team-product');
      expect(r.providerId).toBe('gemini_vertex');
    }
  });

  it('limits an individual to their own requests and ignores a team filter', () => {
    const own = buildMonthlyShowback('2026-09', {}, individual);
    const tampered = buildMonthlyShowback('2026-09', { teamId: 'team-platform' }, individual);
    expect(tampered.summary.requestCount).toBe(own.summary.requestCount);
    expect(own.teams).toHaveLength(1);
    expect(own.teams[0].teamId).toBe(users.find((u) => u.id === individual.userId)?.teamId);
    expect(own.summary.requestCount).toBeLessThan(buildMonthlyShowback('2026-09', {}, admin).summary.requestCount);
    expect(own.scopeDescription).toMatch(/requests in/);
  });

  it('shows renamed team names while keeping codes', async () => {
    await renameTeam('team-product', 'Customer Experience', admin);
    const team = buildMonthlyShowback('2026-09', {}, admin).teams.find((t) => t.teamId === 'team-product');
    expect(team?.name).toBe('Customer Experience');
    expect(team?.code).toBe('ENG-PRODUCT');
  });
});

describe('Showback CSV export', () => {
  it('has one row per scoped request with AUD and a cost status on every row', () => {
    const report = buildMonthlyShowback('2026-09', {}, admin);
    const { csv, rowCount, filename } = buildShowbackCsv('2026-09', {}, admin);
    const { header, rows } = csvRows(csv);
    expect(header).toEqual(SHOWBACK_CSV_HEADER);
    expect(rowCount).toBe(report.summary.requestCount);
    expect(rows).toHaveLength(rowCount);
    expect(filename).toBe('axiomflo-showback-2026-09-company-sample.csv');
    for (const r of rows) {
      expect(r.currency).toBe('AUD');
      expect(['reconciled', 'estimated', 'unavailable']).toContain(r.cost_status);
    }
  });

  it('sums to the report total and leaves unavailable costs blank, not 0', () => {
    const report = buildMonthlyShowback('2026-09', {}, admin);
    const { rows } = csvRows(buildShowbackCsv('2026-09', {}, admin).csv);
    const total = rows.reduce((s, r) => s + (r.estimated_cost === '' ? 0 : Number(r.estimated_cost)), 0);
    expect(total).toBeCloseTo(report.summary.estimatedSpend, 4);
    const unavailable = rows.filter((r) => r.cost_status === 'unavailable');
    expect(unavailable).toHaveLength(report.summary.unresolvedCount);
    for (const r of unavailable) expect(r.estimated_cost).toBe('');
    for (const r of rows.filter((x) => x.cost_status !== 'unavailable')) expect(Number(r.estimated_cost)).toBeGreaterThan(0);
  });

  it('matches the selected month and filters', () => {
    const { rows, header } = csvRows(buildShowbackCsv('2026-08', { teamId: 'team-platform', providerId: 'anthropic' }, admin).csv);
    expect(header).toEqual(SHOWBACK_CSV_HEADER);
    expect(rows.length).toBe(buildMonthlyShowback('2026-08', { teamId: 'team-platform', providerId: 'anthropic' }, admin).summary.requestCount);
    for (const r of rows) {
      expect(r.local_date_australia_sydney.startsWith('2026-08')).toBe(true);
      expect(r.team_code).toBe('ENG-PLATFORM');
      expect(r.provider).toMatch(/Anthropic/);
    }
    expect(buildShowbackCsv('2026-08', { teamId: 'team-platform', providerId: 'anthropic' }, admin).filename).toBe('axiomflo-showback-2026-08-eng-platform-anthropic-sample.csv');
  });

  it('exports only the individual’s own requests, even with another team requested', () => {
    const me = users.find((u) => u.id === individual.userId)!;
    const result = buildShowbackCsv('2026-09', { teamId: 'team-platform' }, individual);
    const { rows } = csvRows(result.csv);
    expect(result.filename).toBe('axiomflo-showback-2026-09-my-requests-sample.csv');
    expect(rows.length).toBe(buildMonthlyShowback('2026-09', {}, individual).summary.requestCount);
    for (const r of rows) expect(r.user_or_application).toBe(me.name);
  });

  it('never includes prompts, responses or credentials', () => {
    const header = SHOWBACK_CSV_HEADER.join(',');
    expect(header).not.toMatch(/prompt|response|secret|key|credential|token_value/i);
  });
});

describe('CSV encoding', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('neutralises spreadsheet formulas in text cells', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(-3)).toBe('-3');
  });

  it('round-trips through the parser', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'he said "ok"'], [null, 1]]);
    expect(parseCsv(csv)).toEqual([['a', 'b'], ['x,y', 'he said "ok"'], ['', '1']]);
  });
});
