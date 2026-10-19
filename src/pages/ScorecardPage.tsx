import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { SelectField } from '../components/ui/SelectField';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { ScorecardView } from '../components/finops/ScorecardView';
import { useDemo } from '../context/DemoContext';
import { useAsync } from '../hooks/useAsync';
import { formatCurrency, formatPeriod, formatPeriodRange } from '../lib/format';
import { can } from '../lib/permissions';
import { getDemoScorecard } from '../services/finopsService';

const money = (value: number | null, options?: { precise?: boolean }) => formatCurrency(value, options);

export function ScorecardPage() {
  const { userContext, period, setPeriod, workspace, dataVersion } = useDemo();
  const isAdmin = can(userContext, 'view_all_teams');
  const state = useAsync(() => getDemoScorecard(period, userContext), [period, userContext.userId, userContext.role, dataVersion]);
  const data = state.data;

  return (
    <>
      <PageHeader
        title="FinOps Scorecard"
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'FinOps Scorecard' }]}
        description={
          <>
            Unit economics, token cost per workflow and five ways to cut cost for {formatPeriod(period)} ({formatPeriodRange(period)}) · AUD · {isAdmin ? 'All teams' : 'Your own requests'}
          </>
        }
        actions={<SelectField label="Month" value={period} onChange={setPeriod} options={workspace.periods.map((p) => ({ value: p, label: formatPeriod(p) }))} className="w-full sm:w-44" />}
      />
      {state.status === 'error' ? (
        <Card>
          <ErrorState message={state.error.message} onRetry={state.reload} />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingState />
        </Card>
      ) : data.scorecard.economics.requests === 0 ? (
        <Card>
          <EmptyState title={`No requests in ${formatPeriod(period)}`} description="There is nothing to score for this month." />
        </Card>
      ) : (
        <div className={state.status === 'loading' ? 'opacity-60' : ''} aria-busy={state.status === 'loading'}>
          <ScorecardView scorecard={data.scorecard} money={money} previousLabel={data.previousPeriod ? formatPeriod(data.previousPeriod) : null} assistantHref="/assistant?q=How%20can%20we%20cut%20our%20AI%20costs%3F" />
          <p className="mt-6 text-xs text-slate-500">Sample data with illustrative prices. Savings are estimates under the assumptions shown for each lever, not a promise; test a change on real tasks before rolling it out.</p>
        </div>
      )}
    </>
  );
}
