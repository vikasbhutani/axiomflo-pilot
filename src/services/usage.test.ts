import { describe, expect, it } from 'vitest';
import { buildOverview, buildRequestDetail, getDataDateBounds, getRequestDetail, getUsage, selectUsage } from './mockService';
import { DEMO_PERSONAS } from '../data/mockData';
import type { UserContext } from '../types';

const admin: UserContext = { userId: DEMO_PERSONAS.company_admin, role: 'company_admin' };
const individual: UserContext = { userId: DEMO_PERSONAS.individual_user, role: 'individual_user' };
const september = { startDate: '2026-09-01', endDate: '2026-09-30' };

describe('Usage Explorer filtering', () => {
  it('derives date bounds from the dataset', () => {
    expect(getDataDateBounds()).toEqual(['2026-08-01', '2026-09-30']);
  });

  it('matches the Overview totals for the same month', async () => {
    const usage = await getUsage(september, admin);
    const overview = buildOverview({ period: '2026-09' }, admin).summary;
    expect(usage.summary.requestCount).toBe(overview.requestCount);
    expect(usage.summary.estimatedSpend).toBeCloseTo(overview.estimatedSpend, 9);
    expect(usage.summary.unresolvedCount).toBe(overview.unresolvedCount);
  });

  it('applies date, team, provider, request status and cost status filters', () => {
    const rows = selectUsage({ startDate: '2026-09-10', endDate: '2026-09-12', teamId: 'team-product', providerId: 'anthropic', requestStatus: 'succeeded', costStatus: 'estimated' }, admin);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.localDate >= '2026-09-10' && r.localDate <= '2026-09-12').toBe(true);
      expect(r.teamId).toBe('team-product');
      expect(r.providerId).toBe('anthropic');
      expect(r.requestStatus).toBe('succeeded');
      expect(r.costStatus).toBe('estimated');
    }
  });

  it('returns newest first', () => {
    const rows = selectUsage(september, admin);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].timestamp >= rows[i].timestamp).toBe(true);
  });

  it('searches by request ID, case-insensitively', () => {
    const target = selectUsage(september, admin)[42];
    const rows = selectUsage({ ...september, search: `  ${target.id.toUpperCase()} ` }, admin);
    expect(rows.map((r) => r.id)).toEqual([target.id]);
    expect(selectUsage({ ...september, search: 'req_20260915' }, admin).every((r) => r.id.startsWith('req_20260915'))).toBe(true);
  });

  it('unavailable-cost filter returns only unresolved records, never zero-cost ones', () => {
    const rows = selectUsage({ ...september, costStatus: 'unavailable' }, admin);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.estimatedCost === null)).toBe(true);
  });

  it('keeps Individual Users to their own requests even when filters name another team', () => {
    expect(selectUsage({ ...september, teamId: 'team-platform' }, individual)).toHaveLength(0);
    const mine = selectUsage(september, individual);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.principal.type === 'user' && r.principal.id === individual.userId)).toBe(true);
  });
});

describe('request detail', () => {
  it('breakdown parts add up to the record cost', () => {
    const record = selectUsage({ ...september, costStatus: 'estimated' }, admin)[0];
    const detail = buildRequestDetail(record.id, admin);
    expect(detail.breakdown).not.toBeNull();
    expect(detail.breakdown!.inputCost + detail.breakdown!.outputCost).toBeCloseTo(record.estimatedCost!, 12);
    expect(detail.pricingVersion?.id).toBe(record.pricingVersionId);
  });

  it('reports missing usage instead of inventing values', () => {
    const record = selectUsage({ ...september, costStatus: 'unavailable' }, admin)[0];
    const detail = buildRequestDetail(record.id, admin);
    expect(detail.breakdown).toBeNull();
    expect(detail.record.estimatedCost).toBeNull();
    expect(detail.missingInformation.join(' ')).toMatch(/did not report/);
    expect(detail.missingInformation.join(' ')).toMatch(/not counted as \$0/);
  });

  it('costs failed requests from measured usage', () => {
    const record = selectUsage({ ...september, requestStatus: 'failed' }, admin).find((r) => r.inputTokens !== null)!;
    expect(buildRequestDetail(record.id, admin).breakdown!.total).toBeGreaterThan(0);
  });

  it('hides other people’s requests from an Individual User', async () => {
    const someoneElse = selectUsage(september, admin).find((r) => r.principal.id !== individual.userId)!;
    expect(() => buildRequestDetail(someoneElse.id, individual)).toThrow(/not visible/);
    await expect(getRequestDetail(someoneElse.id, individual)).rejects.toThrow(/not visible/);
    const own = selectUsage(september, individual)[0];
    await expect(getRequestDetail(own.id, individual)).resolves.toMatchObject({ record: { id: own.id } });
  });
});
