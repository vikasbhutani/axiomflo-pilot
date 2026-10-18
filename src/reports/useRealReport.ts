/** Hooks shared by the real workspace's report pages. */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApiClient } from '../auth/apiContext';
import { useWorkspaceSession } from '../auth/WorkspaceSession';
import { useAsync } from '../hooks/useAsync';
import { buildDataset, recentMonths, type RealDataset, type TeamLookup } from './realData';
import { createReportsApi, type ReportsApi } from './reportsApi';

export function useReportsApi(): ReportsApi | null {
  const api = useApiClient();
  return useMemo(() => (api ? createReportsApi(api) : null), [api]);
}

/** The signed-in member. Only used under the real workspace, so anything else is a bug. */
export function useRealMember() {
  const session = useWorkspaceSession();
  if (session.mode !== 'real') throw new Error('useRealMember is only for the real workspace');
  const teams: TeamLookup[] = session.membership.teams ?? [];
  return { user: session.user, membership: session.membership, teams, isAdmin: session.membership.role === 'company_admin' };
}

/** The reporting month from `?month=`, defaulting to the current month. */
export function useMonthParam(): [string, (month: string) => void, string[]] {
  const [params, setParams] = useSearchParams();
  const months = useMemo(() => recentMonths(), []);
  const asked = params.get('month');
  const month = asked && months.includes(asked) ? asked : months[0];
  const setMonth = (next: string) => {
    const p = new URLSearchParams(params);
    if (next === months[0]) p.delete('month');
    else p.set('month', next);
    p.delete('page');
    p.delete('request');
    setParams(p, { replace: true });
  };
  return [month, setMonth, months];
}

/** Usage and exchange rates for a month, as costed records. */
export function useRealDataset(month: string) {
  const reports = useReportsApi();
  const { teams, user } = useRealMember();
  return useAsync<RealDataset>(async () => {
    if (!reports) throw new Error('AxiomFlo isn’t connected in this build.');
    const [usage, rates] = await Promise.all([reports.usage(month), reports.rates()]);
    return buildDataset(usage, rates.rates, rates.currency, teams);
  }, [reports, month, user.uid, teams.map((t) => t.id).join(',')]);
}
