/**
 * FinOps Scorecard for the demo workspace. Uses the same role-scoped records as
 * every other demo page, so an Individual User scores only their own requests.
 */
import { applications, models, pricingVersions } from '../data/mockData';
import { pricingVersionFor } from '../lib/calculations';
import { buildScorecard, defaultWorkflowOf, type Scorecard, type ScorecardOptions } from '../lib/finops';
import type { PeriodKey, UserContext } from '../types';
import { getReportingPeriods, selectRecords } from './mockService';

export const demoScorecardOptions: ScorecardOptions = {
  workflowOf: defaultWorkflowOf((id) => applications.find((a) => a.id === id)?.name),
  rateOf: (modelId, localDate) => pricingVersionFor(localDate, pricingVersions)?.rates.find((r) => r.modelId === modelId) ?? null,
};

export const demoModelName = (id: string) => models.find((m) => m.id === id)?.displayName ?? id;

export interface DemoScorecard {
  period: PeriodKey;
  previousPeriod: PeriodKey | null;
  scorecard: Scorecard;
}

export function buildDemoScorecard(period: PeriodKey, context: UserContext): DemoScorecard {
  const periods = [...getReportingPeriods()].sort();
  const i = periods.indexOf(period);
  const previousPeriod = i > 0 ? periods[i - 1] : null;
  const current = selectRecords({ period }, context);
  const previous = previousPeriod ? selectRecords({ period: previousPeriod }, context) : null;
  return { period, previousPeriod, scorecard: buildScorecard(current, previous, demoScorecardOptions, demoModelName) };
}

const LATENCY_MS = import.meta.env?.MODE === 'test' ? 0 : 250;

export function getDemoScorecard(period: PeriodKey, context: UserContext): Promise<DemoScorecard> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(buildDemoScorecard(period, context));
      } catch (e) {
        reject(e);
      }
    }, LATENCY_MS),
  );
}
