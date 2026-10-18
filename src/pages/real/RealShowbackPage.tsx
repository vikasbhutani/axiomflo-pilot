/**
 * Monthly showback for a real workspace: what each team's AI use cost in a month,
 * and a request-level CSV. It explains costs; it isn't an invoice.
 */
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { TableScroll } from '../../components/ui/TableScroll';
import { useToast } from '../../context/ToastContext';
import { summarize } from '../../lib/calculations';
import { downloadText, toCsv } from '../../lib/csv';
import { formatDateTime, formatNumber, formatPeriod, formatPeriodRange } from '../../lib/format';
import type { RealDataset } from '../../reports/realData';
import { useMonthParam, useRealDataset, useRealMember } from '../../reports/useRealReport';
import { COST_NOTE, DataNotes, MonthSelect, NoUsageYet, spendRows, spendText } from './RealParts';

export const REAL_CSV_HEADER = [
  'request_id',
  'timestamp_utc',
  'local_date_australia_sydney',
  'person',
  'email',
  'team_name',
  'team_code',
  'provider',
  'model',
  'input_tokens',
  'output_tokens',
  'cache_write_tokens',
  'cache_read_tokens',
  'estimated_cost_usd',
  'exchange_rate',
  'estimated_cost',
  'currency',
  'cost_status',
  'request_status',
  'price_list',
];

/** One row per request, oldest first. Unknown costs are blank, never 0. */
export function realShowbackCsv(data: RealDataset): string {
  const rows = [...data.records]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((r) => [
      r.id,
      r.timestamp,
      r.localDate,
      r.principalName,
      r.principalEmail,
      r.teamName,
      r.teamCode,
      r.providerName,
      r.modelId,
      r.inputTokens,
      r.outputTokens,
      r.cacheWriteTokens,
      r.cacheReadTokens,
      r.estimatedCostUsd === null ? null : r.estimatedCostUsd.toFixed(8),
      r.exchangeRate,
      r.estimatedCost === null ? null : r.estimatedCost.toFixed(8),
      data.money.currency,
      r.costStatus,
      r.requestStatus,
      r.pricingVersionId,
    ]);
  return toCsv(REAL_CSV_HEADER, rows);
}

export function RealShowbackPage() {
  const [month, setMonth, months] = useMonthParam();
  const { isAdmin } = useRealMember();
  const notify = useToast();
  const state = useRealDataset(month);
  const data = state.data;

  const download = () => {
    if (!data) return;
    downloadText(`axiomflo-showback-${month}-${isAdmin ? 'company' : 'my-requests'}.csv`, realShowbackCsv(data));
    notify(`Downloaded ${formatNumber(data.records.length)} request rows for ${formatPeriod(month)}.`, 'success');
  };

  return (
    <>
      <PageHeader
        title="Monthly Showback"
        description={`${formatPeriodRange(month)} · Australia/Sydney · ${isAdmin ? 'Whole company' : 'Your own requests'}. Explains AI costs; it isn’t an invoice.`}
        actions={
          <>
            <MonthSelect month={month} months={months} onChange={setMonth} />
            <button type="button" className="btn-primary self-end" onClick={download} disabled={!data || data.records.length === 0}>
              Download CSV
            </button>
          </>
        }
      />
      {state.status === 'error' ? (
        <Card>
          <ErrorState message={state.error.message} onRetry={state.reload} />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingState label="Loading showback…" />
        </Card>
      ) : (
        <div className="space-y-6">
          <DataNotes data={data} isAdmin={isAdmin} />
          {data.records.length === 0 ? <NoUsageYet month={month} /> : <ShowbackBody data={data} />}
          <p className="text-xs text-slate-500">{COST_NOTE}</p>
        </div>
      )}
    </>
  );
}

function ShowbackBody({ data }: { data: RealDataset }) {
  const s = summarize(data.records);
  const currency = data.money.currency;
  const teams = spendRows(
    data.records,
    (r) => r.teamId,
    (r) => ({ label: r.teamName, sublabel: r.teamCode }),
  );
  const providers = ['anthropic', 'gemini_vertex'] as const;
  const unresolved = data.records.filter((r) => r.estimatedCost === null);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total estimated spend" value={spendText(s, currency)} detail={`${formatPeriod(data.month)} · ${currency}`} />
        <StatCard label="Requests" value={formatNumber(s.requestCount)} detail={`${formatNumber(s.failedCount)} failed`} />
        <StatCard label="Cost unavailable" value={formatNumber(s.unresolvedCount)} tone={s.unresolvedCount > 0 ? 'warning' : 'default'} detail="Not counted as $0" />
      </div>
      <Card>
        <CardHeader title="By team" />
        <TableScroll label="Spend by team">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  Team
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Requests
                </th>
                {providers.map((p) => (
                  <th key={p} scope="col" className="px-3 py-2 text-right font-medium">
                    {p === 'anthropic' ? 'Anthropic' : 'Gemini'}
                  </th>
                ))}
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {teams.map((t) => {
                const teamRecords = data.records.filter((r) => r.teamId === t.key);
                return (
                  <tr key={t.key}>
                    <td className="px-5 py-2.5">
                      {t.label} <span className="font-mono text-xs text-slate-500">{t.sublabel}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{formatNumber(t.summary.requestCount)}</td>
                    {providers.map((p) => {
                      const ps = summarize(teamRecords.filter((r) => r.providerId === p));
                      return (
                        <td key={p} className="px-3 py-2.5 text-right text-slate-700">
                          {ps.requestCount === 0 ? '—' : spendText(ps, currency)}
                        </td>
                      );
                    })}
                    <td className="px-5 py-2.5 text-right font-medium text-slate-900">{spendText(t.summary, currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      </Card>
      {unresolved.length > 0 && (
        <Card>
          <CardHeader title="Requests with no cost" description="Left out of the totals above rather than counted as $0." />
          <ul className="divide-y divide-slate-100 text-sm">
            {unresolved.slice(0, 20).map((r) => (
              <li key={r.id} className="flex justify-between gap-3 px-5 py-2.5">
                <span>
                  {r.modelName} · {r.principalName}
                </span>
                <span className="text-slate-500">{formatDateTime(r.timestamp, { short: true })}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
