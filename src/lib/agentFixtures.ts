/**
 * Builds the sample-data fixtures used by the AxiomFlo Agent backend (`backend/`).
 *
 * The Python agent recalculates costs on its own. To prove both sides agree, this
 * module exports the raw demo dataset AND the totals this web app calculates for it
 * ("golden totals"). A Python test fails if any of its totals differ.
 *
 * Regenerate with `npm run agent:fixtures` after changing the demo dataset or the
 * shared calculations. `agentFixtures.test.ts` fails while the committed files are stale.
 */
import { applications, company, department, models, pricingVersions, providers, teams, usageRecords, users } from '../data/mockData';
import { summarize, type CostSummary } from './calculations';
import { periodBounds } from './format';
import { scopeUsageRecords } from './permissions';
import { getReportingPeriods, toCostedRecord } from '../services/mockService';
import type { CostedUsageRecord } from '../types';

export const AGENT_FIXTURE_VERSION = 1;

export function buildWorkspaceFixture() {
  return {
    fixtureVersion: AGENT_FIXTURE_VERSION,
    label: 'MOCK DATA: AxiomFlo demo workspace. Illustrative models and prices, not provider pricing.',
    generatedFrom: 'src/data/mockData.ts',
    company,
    department,
    teams,
    users,
    applications,
    providers,
    models,
    pricingVersions,
    usageRecords,
  };
}

type GoldenScope = { scope: string; period: string; summary: CostSummary };

export function buildGoldenTotals() {
  const costed = usageRecords.map(toCostedRecord);
  const periods = [...getReportingPeriods()].sort();
  const rows: GoldenScope[] = [];

  const add = (scope: string, period: string, records: CostedUsageRecord[]) => rows.push({ scope, period, summary: summarize(records) });

  for (const period of periods) {
    const [start, end] = periodBounds(period);
    const inPeriod = costed.filter((r) => r.localDate >= start && r.localDate <= end);
    add('company', period, inPeriod);
    for (const t of teams) {
      add(`team:${t.id}`, period, inPeriod.filter((r) => r.teamId === t.id));
      for (const p of providers) add(`team:${t.id}|provider:${p.id}`, period, inPeriod.filter((r) => r.teamId === t.id && r.providerId === p.id));
    }
    for (const p of providers) add(`provider:${p.id}`, period, inPeriod.filter((r) => r.providerId === p.id));
    for (const m of models) add(`model:${m.id}`, period, inPeriod.filter((r) => r.modelId === m.id));
    // What each person may see under the web app's role rules.
    for (const u of users) add(`viewer:${u.id}`, period, scopeUsageRecords(inPeriod, { userId: u.id, role: u.role }, users));
  }

  return {
    fixtureVersion: AGENT_FIXTURE_VERSION,
    label: 'MOCK DATA: totals calculated by src/lib/calculations.ts for the demo workspace.',
    timezone: company.reportingTimezone,
    currency: company.reportingCurrency,
    periods,
    rows,
  };
}
