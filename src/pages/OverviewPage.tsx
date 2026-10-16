import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, Circle, Coins, Hash, PlugZap, Scale } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';
import { SelectField } from '../components/ui/SelectField';
import { CostStatusBadge, DemoTag } from '../components/ui/StatusBadge';
import { InfoTooltip } from '../components/ui/InfoTooltip';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/States';
import { useDemo } from '../context/DemoContext';
import { useAsync } from '../hooks/useAsync';
import { getOverview, lookups, type OverviewData } from '../services/mockService';
import { can } from '../lib/permissions';
import { glossary } from '../lib/glossary';
import { safeRatio, type CostSummary } from '../lib/calculations';
import { formatCalendarDate, formatCurrency, formatDateTime, formatNumber, formatPercent, formatPeriod, formatPeriodRange } from '../lib/format';
import type { ProviderId } from '../types';

/** Builds a Usage Explorer link that carries the Overview's team and provider filters. */
function usageLink(filters: OverviewData['filters'], extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (filters.teamId && filters.teamId !== 'all') params.set('team', filters.teamId);
  if (filters.providerId && filters.providerId !== 'all') params.set('provider', filters.providerId);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const query = params.toString();
  return query ? `/usage?${query}` : '/usage';
}

export function OverviewPage() {
  const { userContext, period } = useDemo();
  const [params, setParams] = useSearchParams();
  const isAdmin = can(userContext, 'view_all_teams');
  const teamId = isAdmin ? params.get('team') ?? 'all' : 'all';
  const providerId = (params.get('provider') ?? 'all') as ProviderId | 'all';

  const setFilter = (key: 'team' | 'provider', value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const state = useAsync(() => getOverview({ period, teamId, providerId }, userContext), [period, teamId, providerId, userContext.userId, userContext.role]);

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <>
            Estimated AI spend for {formatPeriod(period)} ({formatPeriodRange(period)}, Australia/Sydney) · AUD
            {state.data && <> · {state.data.scopeDescription}</>}
          </>
        }
        actions={
          <>
            {isAdmin && (
              <SelectField
                label="Team"
                value={teamId}
                onChange={(v) => setFilter('team', v)}
                options={[{ value: 'all', label: 'All teams' }, ...lookups.teams.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))]}
                className="w-full sm:w-64"
              />
            )}
            <SelectField
              label="Provider"
              value={providerId}
              onChange={(v) => setFilter('provider', v)}
              options={[{ value: 'all', label: 'All providers' }, ...lookups.providers.map((p) => ({ value: p.id, label: p.name }))]}
              className="w-full sm:w-52"
            />
          </>
        }
      />

      {state.status === 'error' ? (
        <Card>
          <ErrorState message={state.error.message} onRetry={state.reload} />
        </Card>
      ) : !state.data ? (
        <OverviewSkeleton />
      ) : (
        <div className={`space-y-6 transition-opacity ${state.status === 'loading' ? 'opacity-60' : ''}`} aria-busy={state.status === 'loading'}>
          <SummaryCards data={state.data} />
          <div className="grid gap-6 xl:grid-cols-3">
            <DailySpendCard data={state.data} />
            <BreakdownCard
              title="Spend by team"
              description="Allocated by each team's usage code"
              rows={state.data.byTeam.map((t) => ({ key: t.teamId, label: t.name, sublabel: t.code, summary: t.summary }))}
              total={state.data.summary.estimatedSpend}
            />
          </div>
          <div className="grid gap-6 xl:grid-cols-3">
            <RecentRequestsCard data={state.data} />
            <BreakdownCard
              title="Spend by provider"
              description="Illustrative models and rates"
              rows={state.data.byProvider.map((p) => ({ key: p.providerId, label: p.name, summary: p.summary }))}
              total={state.data.summary.estimatedSpend}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <ConnectionsCard data={state.data} showConfig={isAdmin} />
            <OnboardingCard data={state.data} />
          </div>
          <p className="text-xs text-slate-500">
            Model names and rates are illustrative sample values, not current provider pricing. Reconciliation states are sample data; no provider billing records are being compared.
          </p>
        </div>
      )}
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading overview">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-80 xl:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

function ChangeIndicator({ current, previous, previousPeriod }: { current: number; previous: CostSummary | null; previousPeriod: string | null }) {
  if (!previous || !previousPeriod) return <>No earlier period in the sample data</>;
  const change = safeRatio(current - previous.estimatedSpend, previous.estimatedSpend);
  if (change === null) return <>No spend in {formatPeriod(previousPeriod)} to compare</>;
  const up = change >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {up ? '+' : '−'}
      {formatPercent(Math.abs(change), 1)} vs {formatPeriod(previousPeriod)} ({formatCurrency(previous.estimatedSpend)})
    </span>
  );
}

function SummaryCards({ data }: { data: OverviewData }) {
  const s = data.summary;
  const reconciledShare = safeRatio(s.reconciledCount, s.costedCount);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Estimated spend"
        tooltip={glossary.estimatedSpend}
        icon={<Coins className="h-4 w-4" aria-hidden />}
        value={formatCurrency(s.estimatedSpend)}
        detail={<ChangeIndicator current={s.estimatedSpend} previous={data.previousSummary} previousPeriod={data.previousPeriod} />}
      />
      <StatCard
        label="Requests"
        icon={<Hash className="h-4 w-4" aria-hidden />}
        value={formatNumber(s.requestCount)}
        detail={`${formatNumber(s.succeededCount)} succeeded · ${formatNumber(s.failedCount)} failed`}
      />
      <StatCard
        label="Avg cost per request"
        tooltip={glossary.averageCost}
        icon={<Scale className="h-4 w-4" aria-hidden />}
        value={formatCurrency(s.averageCostPerCostedRequest, { precise: true })}
        detail={s.costedCount > 0 ? `Across ${formatNumber(s.costedCount)} requests with a calculable cost` : 'No requests with a calculable cost'}
      />
      <StatCard
        label="Reconciliation"
        tooltip={glossary.reconciliation}
        tone={s.unresolvedCount > 0 ? 'warning' : 'default'}
        icon={s.unresolvedCount > 0 ? <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
        value={
          <>
            {formatNumber(s.unresolvedCount)} <span className="text-base font-medium text-slate-500">unresolved</span>
          </>
        }
        detail={
          <>
            {reconciledShare === null ? 'Nothing to reconcile yet' : `${formatPercent(reconciledShare)} of costed requests reconciled (sample)`}
            {s.unresolvedCount > 0 && (
              <>
                {' · '}
                <Link to={usageLink(data.filters, { cost: 'unavailable' })} className="font-medium text-teal-700 hover:underline">
                  Review
                </Link>
              </>
            )}
          </>
        }
      />
    </div>
  );
}

function DailyTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as OverviewData['daily'][number];
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-slate-900">{formatCalendarDate(point.date, { withYear: true })}</p>
      <p className="mt-1 tabular-nums text-slate-700">Estimated spend: {formatCurrency(point.estimatedSpend)}</p>
      <p className="tabular-nums text-slate-500">Requests: {formatNumber(point.requestCount)}</p>
      {point.unresolvedCount > 0 && <p className="tabular-nums text-amber-700">Cost unavailable: {formatNumber(point.unresolvedCount)}</p>}
    </div>
  );
}

function DailySpendCard({ data }: { data: OverviewData }) {
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();
  const hasData = data.summary.requestCount > 0;
  return (
    <Card className="xl:col-span-2">
      <CardHeader
        titleId={titleId}
        title="Daily estimated spend"
        description="AUD per day, Australia/Sydney dates. Excludes requests with unavailable cost."
        action={
          hasData && (
            <button type="button" onClick={() => setShowTable((v) => !v)} className="text-xs font-medium text-teal-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
              {showTable ? 'Show chart' : 'Show as table'}
            </button>
          )
        }
      />
      {!hasData ? (
        <EmptyState title="No requests match these filters" description="Try another provider, team, or reporting period." />
      ) : showTable ? (
        <div className="max-h-72 overflow-auto px-5 py-3">
          <table className="w-full text-sm" aria-labelledby={titleId}>
            <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
              <tr>
                <th className="py-1.5 font-medium">Date</th>
                <th className="py-1.5 text-right font-medium">Requests</th>
                <th className="py-1.5 text-right font-medium">Estimated spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {data.daily.map((d) => (
                <tr key={d.date}>
                  <td className="py-1.5">{formatCalendarDate(d.date, { withYear: true })}</td>
                  <td className="py-1.5 text-right">{formatNumber(d.requestCount)}</td>
                  <td className="py-1.5 text-right">{formatCurrency(d.estimatedSpend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-72 px-2 pb-3 pt-4" role="img" aria-label={`Daily estimated spend chart. Total ${formatCurrency(data.summary.estimatedSpend)}. Use "Show as table" for exact values.`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.daily} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0d9488" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#0d9488" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="0" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d: string) => formatCalendarDate(d)} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} minTickGap={24} />
              <YAxis tickFormatter={(v: number) => `$${Number(v.toFixed(1))}`} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={48} />
              <Tooltip content={<DailyTooltip />} cursor={{ stroke: '#94a3b8', strokeWidth: 1 }} />
              <Area type="monotone" dataKey="estimatedSpend" stroke="#0d9488" strokeWidth={2} fill="url(#spendFill)" activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

interface BreakdownRow {
  key: string;
  label: string;
  sublabel?: string;
  summary: CostSummary;
}

function BreakdownCard({ title, description, rows, total }: { title: string; description: string; rows: BreakdownRow[]; total: number }) {
  const max = Math.max(0, ...rows.map((r) => r.summary.estimatedSpend));
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing to show" />
      ) : (
        <ul className="space-y-5 px-5 py-5">
          {rows.map((r) => {
            const share = safeRatio(r.summary.estimatedSpend, total);
            return (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{r.label}</p>
                    {r.sublabel && <p className="font-mono text-xs text-slate-500">{r.sublabel}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-slate-900">{formatCurrency(r.summary.estimatedSpend)}</p>
                    <p className="text-xs tabular-nums text-slate-500">{share === null ? '—' : formatPercent(share)}</p>
                  </div>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-100" aria-hidden>
                  <div className="h-2 rounded-full bg-teal-600" style={{ width: `${max > 0 ? (r.summary.estimatedSpend / max) * 100 : 0}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  {formatNumber(r.summary.requestCount)} requests
                  {r.summary.unresolvedCount > 0 && <span className="text-amber-700"> · {formatNumber(r.summary.unresolvedCount)} cost unavailable</span>}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RecentRequestsCard({ data }: { data: OverviewData }) {
  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title="Recent requests"
        description="Latest requests in the selected period and filters"
        action={
          <Link to={usageLink(data.filters)} className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline">
            Open Usage Explorer <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      />
      {data.recentRequests.length === 0 ? (
        <EmptyState title="No requests in this view" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="whitespace-nowrap bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">Request</th>
                <th scope="col" className="px-3 py-2 font-medium">User or application</th>
                <th scope="col" className="px-3 py-2 font-medium">Model</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Estimated cost</th>
                <th scope="col" className="px-5 py-2 font-medium">Cost status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.recentRequests.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-2.5">
                    <Link to={usageLink(data.filters, { request: r.id })} className="block max-w-[12rem] truncate font-mono text-xs text-teal-800 hover:underline" title={r.id} aria-label={`Open details for request ${r.id}`}>
                      {r.id}
                    </Link>
                    <p className="text-xs text-slate-500">{formatDateTime(r.timestamp, { short: true })}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-slate-900">{r.principalName}</p>
                    <p className="font-mono text-xs text-slate-500">{r.teamCode}</p>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">{r.modelName}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{formatCurrency(r.estimatedCost, { precise: true })}</td>
                  <td className="px-5 py-2.5">
                    <CostStatusBadge status={r.costStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ConnectionsCard({ data, showConfig }: { data: OverviewData; showConfig: boolean }) {
  return (
    <Card>
      <CardHeader
        title="Provider connections"
        description="Simulated connections; no live provider calls are made"
        action={
          showConfig && (
            <Link to="/providers" className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline">
              Manage <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )
        }
      />
      <ul className="divide-y divide-slate-100">
        {data.connections.map(({ connection, providerName, summary }) => (
          <li key={connection.id} className="flex items-start justify-between gap-3 px-5 py-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className="mt-0.5 rounded-lg bg-slate-100 p-2 text-slate-600">
                <PlugZap className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{providerName}</p>
                <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                  {connection.status === 'connected_demo' ? 'Connected — demo' : connection.status === 'disabled' ? 'Disabled' : 'Not configured'}
                </p>
                <p className="text-xs text-slate-500">Last simulated test: {formatDateTime(connection.lastSimulatedTestAt)}</p>
                {showConfig && connection.configSummary && <p className="mt-1 truncate text-xs text-slate-500">{connection.configSummary}</p>}
              </div>
            </div>
            <div className="shrink-0 text-right text-xs text-slate-500">
              <p className="text-sm font-semibold tabular-nums text-slate-900">{formatCurrency(summary.estimatedSpend)}</p>
              <p className="tabular-nums">{formatNumber(summary.requestCount)} requests</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OnboardingCard({ data }: { data: OverviewData }) {
  const done = data.onboarding.filter((i) => i.done).length;
  return (
    <Card>
      <CardHeader
        title="Pilot checklist"
        description={`${done} of ${data.onboarding.length} complete`}
        action={
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <DemoTag>Demo</DemoTag>
            <InfoTooltip text={glossary.showback} label="About showback" />
          </span>
        }
      />
      <ul className="space-y-1 px-3 py-3">
        {data.onboarding.map((item) => (
          <li key={item.id}>
            <Link to={item.href} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
              {item.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-600" aria-hidden /> : <Circle className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />}
              <span className={item.done ? 'text-slate-500' : 'text-slate-900'}>{item.label}</span>
              <span className="sr-only">{item.done ? '(done)' : '(to do)'}</span>
              <ArrowRight className="ml-auto h-3.5 w-3.5 text-slate-300" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
