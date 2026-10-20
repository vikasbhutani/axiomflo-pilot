/**
 * Overview for a real workspace: the month's estimated AI spend from the AxiomFlo
 * gateway's usage records. Admins see the whole company; individual users their own requests.
 */
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowRight, Coins, Hash, Scale } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { CostStatusBadge } from '../../components/ui/StatusBadge';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { TableScroll } from '../../components/ui/TableScroll';
import { CountUp } from '../../components/ui/CountUp';
import { motionAllowed, useFirstRender } from '../../hooks/useMotion';
import { summarize, summarizeBy } from '../../lib/calculations';
import { formatCalendarDate, formatDateTime, formatMoney, formatNumber, formatPeriod, formatPeriodRange, periodBounds } from '../../lib/format';
import { glossary } from '../../lib/glossary';
import type { RealDataset } from '../../reports/realData';
import { useMonthParam, useRealDataset, useRealMember } from '../../reports/useRealReport';
import { COST_NOTE, DataNotes, MonthSelect, NoUsageYet, spendRows, SpendList, spendText } from './RealParts';

export function RealOverviewPage() {
  const [month, setMonth, months] = useMonthParam();
  const { isAdmin, membership } = useRealMember();
  const state = useRealDataset(month);
  const scope = isAdmin ? `All teams in ${membership.companyName ?? 'your company'}` : 'Your own requests';

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <>
            Estimated AI spend for {formatPeriod(month)} ({formatPeriodRange(month)}, Australia/Sydney) · {scope}
          </>
        }
        actions={<MonthSelect month={month} months={months} onChange={setMonth} />}
      />
      {state.status === 'error' ? (
        <Card>
          <ErrorState message={state.error.message} onRetry={state.reload} />
        </Card>
      ) : !state.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label="Loading overview">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <div className={`space-y-6 ${state.status === 'loading' ? 'opacity-60' : ''}`} aria-busy={state.status === 'loading'}>
          <DataNotes data={state.data} isAdmin={isAdmin} />
          {state.data.records.length === 0 ? <NoUsageYet month={month} /> : <OverviewBody data={state.data} isAdmin={isAdmin} />}
          <p className="text-xs text-slate-500">{COST_NOTE}</p>
        </div>
      )}
    </>
  );
}

function OverviewBody({ data, isAdmin }: { data: RealDataset; isAdmin: boolean }) {
  const { records, money } = data;
  const s = summarize(records);
  const total = s.estimatedSpend;
  return (
    <>
      <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Estimated spend" tooltip={glossary.estimatedSpend} icon={<Coins className="h-4 w-4" aria-hidden />} value={spendText(s, money.currency) === 'Not available' ? 'Not available' : <CountUp value={s.estimatedSpend} format={(n) => formatMoney(n, money.currency)} />} detail={money.currency} />
        <StatCard
          label="Requests"
          icon={<Hash className="h-4 w-4" aria-hidden />}
          value={<CountUp value={s.requestCount} format={(n) => formatNumber(Math.round(n))} />}
          detail={`${formatNumber(s.succeededCount)} succeeded · ${formatNumber(s.failedCount)} failed`}
        />
        <StatCard
          label="Avg cost per request"
          tooltip={glossary.averageCost}
          icon={<Scale className="h-4 w-4" aria-hidden />}
          value={formatMoney(s.averageCostPerCostedRequest, money.currency, { precise: true })}
          detail={`${formatNumber(s.inputTokens)} input · ${formatNumber(s.outputTokens)} output tokens`}
        />
        <StatCard
          label="Cost unavailable"
          tooltip={glossary.unresolved}
          tone={s.unresolvedCount > 0 ? 'warning' : 'default'}
          icon={<AlertTriangle className={`h-4 w-4 ${s.unresolvedCount > 0 ? 'text-amber-500' : ''}`} aria-hidden />}
          value={formatNumber(s.unresolvedCount)}
          detail={
            s.unresolvedCount > 0 ? (
              <Link to="/usage?cost=unavailable" className="font-medium text-teal-700 hover:underline">
                Review these requests
              </Link>
            ) : (
              'Every request has an estimate'
            )
          }
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <DailyCard data={data} />
        <SpendList
          title={isAdmin ? 'Spend by team' : 'Spend by your teams'}
          description="By the team each AxiomFlo key belongs to"
          rows={spendRows(
            records,
            (r) => r.teamId,
            (r) => ({ label: r.teamName, sublabel: r.teamCode }),
          )}
          total={total}
          currency={money.currency}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        {isAdmin ? (
          <SpendList
            title="Spend by person"
            rows={spendRows(
              records,
              (r) => r.principal.id,
              (r) => ({ label: r.principalName, sublabel: r.principalEmail ?? undefined }),
            ).slice(0, 10)}
            total={total}
            currency={money.currency}
          />
        ) : (
          <SpendList
            title="Spend by provider"
            rows={spendRows(
              records,
              (r) => r.providerId,
              (r) => ({ label: r.providerName }),
            )}
            total={total}
            currency={money.currency}
          />
        )}
        <SpendList
          title="Spend by model"
          rows={spendRows(
            records,
            (r) => r.modelId,
            (r) => ({ label: r.modelName, sublabel: r.providerName }),
          )}
          total={total}
          currency={money.currency}
        />
        <RecentCard data={data} />
      </div>
    </>
  );
}

function DailyCard({ data }: { data: RealDataset }) {
  const [showTable, setShowTable] = useState(false);
  // Draw the chart in on first load only; a month change swaps the data without replaying it.
  const firstRender = useFirstRender();
  const [animateChart] = useState(() => motionAllowed());
  const titleId = useId();
  const [start, end] = periodBounds(data.month);
  const byDay = summarizeBy(data.records, (r) => r.localDate);
  const daily: { date: string; spend: number; requests: number }[] = [];
  for (let d = Number(start.slice(8)); d <= Number(end.slice(8)); d++) {
    const date = `${data.month}-${String(d).padStart(2, '0')}`;
    const s = byDay.get(date);
    daily.push({ date, spend: s?.estimatedSpend ?? 0, requests: s?.requestCount ?? 0 });
  }
  const currency = data.money.currency;
  return (
    <Card className="xl:col-span-2">
      <CardHeader
        titleId={titleId}
        title="Daily estimated spend"
        description={`${currency} per day, Australia/Sydney dates. Excludes requests with unavailable cost.`}
        action={
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className="text-xs font-medium text-teal-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
          >
            {showTable ? 'Show chart' : 'Show as table'}
          </button>
        }
      />
      {showTable ? (
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
              {daily.map((d) => (
                <tr key={d.date}>
                  <td className="py-1.5">{formatCalendarDate(d.date, { withYear: true })}</td>
                  <td className="py-1.5 text-right">{formatNumber(d.requests)}</td>
                  <td className="py-1.5 text-right">{formatMoney(d.spend, currency, { precise: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-72 px-2 pb-3 pt-4" role="img" aria-label={`Daily estimated spend chart. Use "Show as table" for exact values.`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={daily} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d: string) => formatCalendarDate(d)} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} minTickGap={24} />
              <YAxis tickFormatter={(v: number) => formatMoney(v, currency)} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={64} />
              <Tooltip formatter={(v: number) => [formatMoney(v, currency, { precise: true }), 'Estimated spend']} labelFormatter={(d: string) => formatCalendarDate(d, { withYear: true })} />
              <Area type="monotone" dataKey="spend" stroke="#0d9488" strokeWidth={2} fill="#0d9488" fillOpacity={0.12} isAnimationActive={animateChart && firstRender} animationDuration={1500} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function RecentCard({ data }: { data: RealDataset }) {
  const recent = data.records.slice(0, 6);
  return (
    <Card>
      <CardHeader
        title="Recent requests"
        action={
          <Link to={data.month ? `/usage?month=${data.month}` : '/usage'} className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline">
            Usage Explorer <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      />
      <TableScroll label="Recent requests">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {recent.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-2.5">
                  <Link to={`/usage?month=${data.month}&request=${encodeURIComponent(r.id)}`} className="text-slate-900 hover:underline" aria-label={`Open details for request ${r.id}`}>
                    {r.modelName}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(r.timestamp, { short: true })} · {r.principalName}
                  </p>
                </td>
                <td className="px-5 py-2.5 text-right">
                  <p className="tabular-nums text-slate-900">{formatMoney(r.estimatedCost, data.money.currency, { precise: true })}</p>
                  <CostStatusBadge status={r.costStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}
