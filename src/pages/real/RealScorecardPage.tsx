/**
 * FinOps Scorecard for a real workspace, over the month's usage records from the
 * AxiomFlo API. Admins score the whole company; individual users their own requests.
 */
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/ui/Card';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ScorecardView } from '../../components/finops/ScorecardView';
import { useAsync } from '../../hooks/useAsync';
import { buildScorecard, defaultWorkflowOf } from '../../lib/finops';
import { formatMoney, formatPeriod, formatPeriodRange } from '../../lib/format';
import { buildDataset, modelDisplayName, previousMonth } from '../../reports/realData';
import { useMonthParam, useRealDataset, useRealMember, useReportsApi } from '../../reports/useRealReport';
import { COST_NOTE, DataNotes, MonthSelect, NoUsageYet } from './RealParts';

// Real requests all come from people's keys, so workflows are each team's interactive use.
const options = { workflowOf: defaultWorkflowOf(() => undefined) };

export function RealScorecardPage() {
  const [month, setMonth, months] = useMonthParam();
  const { isAdmin, membership, teams, user } = useRealMember();
  const reports = useReportsApi();
  const state = useRealDataset(month);
  const prevMonth = previousMonth(month);
  // The month before, for the comparison line. Optional: the page works without it.
  const previous = useAsync(async () => {
    if (!reports) return null;
    const [usage, rates] = await Promise.all([reports.usage(prevMonth), reports.rates()]);
    return buildDataset(usage, rates.rates, rates.currency, teams);
  }, [reports, prevMonth, user.uid, teams.map((t) => t.id).join(',')]);
  const data = state.data;
  const prevRecords = previous.status === 'success' && previous.data && data && previous.data.money.currency === data.money.currency ? previous.data.records : null;
  const scope = isAdmin ? `All teams in ${membership.companyName ?? 'your company'}` : 'Your own requests';

  return (
    <>
      <PageHeader
        title="FinOps Scorecard"
        description={
          <>
            Unit economics, token cost per workflow and five ways to cut cost for {formatPeriod(month)} ({formatPeriodRange(month)}) · {scope}
          </>
        }
        actions={<MonthSelect month={month} months={months} onChange={setMonth} />}
      />
      {state.status === 'error' ? (
        <Card>
          <ErrorState message={state.error.message} onRetry={state.reload} />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingState label="Loading usage…" />
        </Card>
      ) : (
        <div className={`space-y-6 ${state.status === 'loading' ? 'opacity-60' : ''}`} aria-busy={state.status === 'loading'}>
          <DataNotes data={data} isAdmin={isAdmin} />
          {data.records.length === 0 ? (
            <NoUsageYet month={month} />
          ) : (
            <ScorecardView
              scorecard={buildScorecard(data.records, prevRecords && prevRecords.length > 0 ? prevRecords : null, options, modelDisplayName)}
              money={(value, o) => formatMoney(value, data.money.currency, o)}
              previousLabel={prevRecords && prevRecords.length > 0 ? formatPeriod(prevMonth) : null}
              assistantHref="/assistant"
            />
          )}
          <p className="text-xs text-slate-500">{COST_NOTE} Savings are estimates under the assumptions shown for each lever, not a promise.</p>
        </div>
      )}
    </>
  );
}
