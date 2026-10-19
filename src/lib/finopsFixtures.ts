/**
 * FinOps Scorecard figures the web app calculates for the agent's fixtures, so a
 * Python test can prove backend/axiomflo/reporting/finops.py gives the same answers.
 * Regenerate with `npm run agent:fixtures`.
 */
import { applications, pricingVersions, usageRecords, users } from '../data/mockData';
import { pricingVersionFor } from './calculations';
import { buildScorecard, defaultWorkflowOf, type Scorecard, type ScorecardOptions, type ScorecardRecord } from './finops';
import { periodBounds } from './format';
import { scopeUsageRecords } from './permissions';
import { getReportingPeriods, toCostedRecord } from '../services/mockService';
import { buildDataset } from '../reports/realData';
import { buildUsageSnapshot } from './agentRealFixtures';

function figures(sc: Scorecard) {
  return {
    economics: sc.economics,
    previousEconomics: sc.previousEconomics,
    workflows: sc.workflows.map((w) => ({ id: w.id, label: w.label, kind: w.kind, requests: w.requests, spend: w.spend, inputSpend: w.inputSpend, outputSpend: w.outputSpend })),
    levers: sc.levers.map((l) => ({ id: l.id, rank: l.rank, affectedRequests: l.affectedRequests, affectedSpend: l.affectedSpend, savings: l.savings })),
    combinedSavings: sc.combinedSavings,
    score: sc.score,
    grade: sc.grade,
    components: Object.fromEntries(sc.components.map((c) => [c.id, c.points])),
  };
}

interface Row {
  source: 'demo' | 'snapshot';
  scope: string;
  period: string;
  scorecard: ReturnType<typeof figures>;
}

export function buildFinopsGolden() {
  const rows: Row[] = [];

  // The demo workspace, with its illustrative price list.
  const demoOptions: ScorecardOptions = {
    workflowOf: defaultWorkflowOf((id) => applications.find((a) => a.id === id)?.name),
    rateOf: (modelId, localDate) => pricingVersionFor(localDate, pricingVersions)?.rates.find((r) => r.modelId === modelId) ?? null,
  };
  const costed = usageRecords.map(toCostedRecord);
  const periods = [...getReportingPeriods()].sort();
  const inPeriod = (records: ScorecardRecord[], period: string) => {
    const [start, end] = periodBounds(period);
    return records.filter((r) => r.localDate >= start && r.localDate <= end);
  };
  const demoScopes: [string, (records: ScorecardRecord[]) => ScorecardRecord[]][] = [
    ['company', (r) => r],
    ...users.map((u): [string, (records: ScorecardRecord[]) => ScorecardRecord[]] => [`viewer:${u.id}`, (r) => scopeUsageRecords(r, { userId: u.id, role: u.role }, users)]),
  ];
  for (const [scope, pick] of demoScopes)
    periods.forEach((period, i) => {
      const previous = i > 0 ? pick(inPeriod(costed, periods[i - 1])) : null;
      rows.push({ source: 'demo', scope, period, scorecard: figures(buildScorecard(pick(inPeriod(costed, period)), previous, demoOptions)) });
    });

  // The sample usage snapshot: real-data rules, no price list.
  const snapshot = buildUsageSnapshot();
  const realOptions: ScorecardOptions = { workflowOf: defaultWorkflowOf(() => undefined) };
  const byMonth = snapshot.usage.map((u) => buildDataset(u, snapshot.exchangeRates, snapshot.company.reportingCurrency, snapshot.teams).records);
  const viewers = [...new Set(byMonth.flat().map((r) => r.principal.id))].sort();
  const snapshotScopes: [string, (records: ScorecardRecord[]) => ScorecardRecord[]][] = [
    ['company', (r) => r],
    ...viewers.map((uid): [string, (records: ScorecardRecord[]) => ScorecardRecord[]] => [`viewer:${uid}`, (r) => r.filter((x) => x.principal.id === uid)]),
  ];
  for (const [scope, pick] of snapshotScopes)
    snapshot.usage.forEach((u, i) => {
      rows.push({ source: 'snapshot', scope, period: u.month, scorecard: figures(buildScorecard(pick(byMonth[i]), i > 0 ? pick(byMonth[i - 1]) : null, realOptions)) });
    });

  return { label: 'FinOps Scorecard figures calculated by src/lib/finops.ts for the demo workspace and the sample snapshot.', rows };
}
