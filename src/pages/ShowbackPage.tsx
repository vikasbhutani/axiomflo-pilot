import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Download, Eye, FileText, Printer, Table2 } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { SelectField } from '../components/ui/SelectField';
import { StatCard } from '../components/ui/StatCard';
import { InfoTooltip } from '../components/ui/InfoTooltip';
import { Modal } from '../components/ui/Modal';
import { CostStatusBadge, RequestStatusBadge } from '../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { useDemo } from '../context/DemoContext';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import { buildShowbackCsv, getLookups, getMonthlyShowback, type MonthlyShowback, type ShowbackFilters } from '../services/mockService';
import { can } from '../lib/permissions';
import { glossary } from '../lib/glossary';
import { downloadText } from '../lib/csv';
import { safeRatio } from '../lib/calculations';
import { formatCalendarDate, formatCurrency, formatDateTime, formatNumber, formatPercent, formatPeriod, formatPeriodRange } from '../lib/format';
import type { ProviderId } from '../types';
import { TableScroll } from '../components/ui/TableScroll';

export const SHOWBACK_NOTICE = 'This report explains allocated AI usage costs. It is not an invoice and does not initiate payment.';

function usageHref(report: MonthlyShowback, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ from: report.startDate, to: report.endDate });
  if (report.filters.teamId && report.filters.teamId !== 'all') params.set('team', report.filters.teamId);
  if (report.filters.providerId && report.filters.providerId !== 'all') params.set('provider', report.filters.providerId);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `/usage?${params.toString()}`;
}

export function ShowbackPage() {
  const { userContext, period, setPeriod, workspace, dataVersion } = useDemo();
  const notify = useToast();
  const [params, setParams] = useSearchParams();
  const [previewOpen, setPreviewOpen] = useState(false);
  const isAdmin = can(userContext, 'export_company_showback');
  const filters: ShowbackFilters = {
    teamId: isAdmin ? params.get('team') ?? 'all' : 'all',
    providerId: (params.get('provider') ?? 'all') as ProviderId | 'all',
  };
  const setFilter = (key: 'team' | 'provider', value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const state = useAsync(() => getMonthlyShowback(period, filters, userContext), [period, filters.teamId, filters.providerId, userContext.userId, userContext.role, dataVersion]);

  const downloadCsv = () => {
    try {
      const { filename, csv, rowCount } = buildShowbackCsv(period, filters, userContext);
      downloadText(filename, csv);
      notify(`Downloaded ${formatNumber(rowCount)} request rows for ${formatPeriod(period)} (sample data, AUD).`, 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'The CSV could not be created.', 'error');
    }
  };

  const report = state.data;

  return (
    <>
      <PageHeader
        title="Monthly Showback"
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'Monthly Showback' }]}
        description={isAdmin ? 'Monthly review of estimated AI usage costs allocated to each team.' : 'Monthly review of the estimated cost of your own AI requests.'}
        actions={
          <>
            <SelectField label="Month" value={period} onChange={setPeriod} options={workspace.periods.map((p) => ({ value: p, label: formatPeriod(p) }))} className="w-full sm:w-44" />
            {isAdmin && (
              <SelectField
                label="Team"
                value={filters.teamId ?? 'all'}
                onChange={(v) => setFilter('team', v)}
                options={[{ value: 'all', label: 'All teams' }, ...getLookups().teams.map((t) => ({ value: t.id, label: t.name }))]}
                className="w-full sm:w-52"
              />
            )}
            <SelectField
              label="Provider"
              value={filters.providerId ?? 'all'}
              onChange={(v) => setFilter('provider', v)}
              options={[{ value: 'all', label: 'All providers' }, ...getLookups().providers.map((p) => ({ value: p.id, label: p.name }))]}
              className="w-full sm:w-48"
            />
          </>
        }
      />

      <div className="mb-6 flex flex-col gap-4 rounded-xl border border-teal-200 bg-teal-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-sm text-teal-950">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden />
          <span>
            <strong className="font-semibold">{SHOWBACK_NOTICE}</strong>{' '}
            <InfoTooltip text={glossary.showback} label="About showback" />
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => setPreviewOpen(true)} disabled={!report}>
            <Eye className="h-4 w-4" aria-hidden /> Preview report
          </button>
          <button type="button" className="btn-primary" onClick={downloadCsv} disabled={!report || report.summary.requestCount === 0}>
            <Download className="h-4 w-4" aria-hidden /> Download CSV
          </button>
          {report && (
            <Link to={usageHref(report)} className="btn-secondary">
              <Table2 className="h-4 w-4" aria-hidden /> View underlying requests
            </Link>
          )}
        </div>
      </div>

      {state.status === 'error' ? (
        <Card>
          <ErrorState message={state.error.message} onRetry={state.reload} />
        </Card>
      ) : !report ? (
        <Card>
          <LoadingState label="Preparing showback…" />
        </Card>
      ) : report.summary.requestCount === 0 ? (
        <Card>
          <EmptyState title="No requests for this month and filters" description="Choose another month, team or provider." />
        </Card>
      ) : (
        <div className={`space-y-6 ${state.status === 'loading' ? 'opacity-60 transition-opacity' : ''}`} aria-busy={state.status === 'loading'}>
          <ShowbackSummary report={report} />
          <TeamAllocation report={report} />
          <div className="grid gap-6 xl:grid-cols-2">
            <ProviderBreakdown report={report} />
            <ReconciliationCard report={report} />
          </div>
          <UnresolvedCard report={report} />
          <p className="text-xs text-slate-500">
            Reporting currency AUD · Dates in Australia/Sydney · Demo reporting date {formatCalendarDate(report.asOfDate, { withYear: true })}. Rates are illustrative sample values, not current provider pricing. Reconciliation states are sample data.
          </p>
        </div>
      )}

      <Modal
        open={previewOpen && !!report}
        onClose={() => setPreviewOpen(false)}
        title="Showback report preview"
        description="Sample data · not an invoice"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden /> Print
            </button>
            <button type="button" className="btn-primary" onClick={downloadCsv}>
              <Download className="h-4 w-4" aria-hidden /> Download CSV
            </button>
          </>
        }
      >
        {report && <ReportPreview report={report} />}
      </Modal>
    </>
  );
}

function ShowbackSummary({ report }: { report: MonthlyShowback }) {
  const s = report.summary;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total estimated spend" tooltip={glossary.estimatedSpend} value={formatCurrency(s.estimatedSpend)} detail={`${formatPeriodRange(report.month)} · AUD`} />
      <StatCard label="Requests" value={formatNumber(s.requestCount)} detail={`${formatNumber(s.costedCount)} with a calculable cost`} />
      <StatCard
        label="Reconciled (sample)"
        tooltip={glossary.reconciliation}
        value={formatCurrency(s.reconciledSpend)}
        detail={`${formatCurrency(s.estimatedOnlySpend)} still estimated`}
      />
      <StatCard
        label="Unresolved"
        tooltip={glossary.unresolved}
        tone={s.unresolvedCount > 0 ? 'warning' : 'default'}
        value={formatNumber(s.unresolvedCount)}
        detail={s.unresolvedCount > 0 ? 'Not included in the total and not counted as $0' : 'Every request has a calculable cost'}
      />
    </div>
  );
}

function TeamAllocation({ report }: { report: MonthlyShowback }) {
  const showProviders = report.providers;
  return (
    <Card>
      <CardHeader title="Team allocation" description="Estimated spend allocated by each team’s usage code" />
      <TableScroll label="Team allocation table">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="whitespace-nowrap bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-medium">Team</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Code</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Requests</th>
              {showProviders.map((p) => (
                <th key={p.providerId} scope="col" className="px-3 py-2.5 text-right font-medium">
                  {p.name}
                </th>
              ))}
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Estimated spend</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Share</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">Unresolved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {report.teams.map((t) => (
              <tr key={t.teamId}>
                <th scope="row" className="px-5 py-3 text-left font-medium text-slate-900">
                  {t.name}
                </th>
                <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-600">{t.code}</td>
                <td className="px-3 py-3 text-right text-slate-700">{formatNumber(t.summary.requestCount)}</td>
                {showProviders.map((p) => (
                  <td key={p.providerId} className="px-3 py-3 text-right text-slate-700">
                    {formatCurrency(t.byProvider[p.providerId].estimatedSpend)}
                  </td>
                ))}
                <td className="px-3 py-3 text-right font-semibold text-slate-900">{formatCurrency(t.summary.estimatedSpend)}</td>
                <td className="px-3 py-3 text-right text-slate-600">{formatPercent(safeRatio(t.summary.estimatedSpend, report.summary.estimatedSpend))}</td>
                <td className="px-5 py-3 text-right text-slate-600">{t.summary.unresolvedCount > 0 ? <span className="text-amber-700">{formatNumber(t.summary.unresolvedCount)}</span> : '0'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold tabular-nums">
            <tr>
              <th scope="row" className="px-5 py-3 text-left text-slate-900" colSpan={2}>
                Total
              </th>
              <td className="px-3 py-3 text-right text-slate-900">{formatNumber(report.summary.requestCount)}</td>
              {showProviders.map((p) => (
                <td key={p.providerId} className="px-3 py-3 text-right text-slate-900">
                  {formatCurrency(p.summary.estimatedSpend)}
                </td>
              ))}
              <td className="px-3 py-3 text-right text-slate-900">{formatCurrency(report.summary.estimatedSpend)}</td>
              <td className="px-3 py-3 text-right text-slate-600">{report.summary.estimatedSpend > 0 ? '100%' : '—'}</td>
              <td className="px-5 py-3 text-right text-slate-900">{formatNumber(report.summary.unresolvedCount)}</td>
            </tr>
          </tfoot>
        </table>
      </TableScroll>
    </Card>
  );
}

function ProviderBreakdown({ report }: { report: MonthlyShowback }) {
  return (
    <Card>
      <CardHeader title="Provider breakdown" description="Illustrative models and rates" />
      <TableScroll label="Provider breakdown table">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="whitespace-nowrap bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-medium">Provider</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Requests</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Reconciled</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Estimated</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {report.providers.map((p) => (
              <tr key={p.providerId}>
                <th scope="row" className="px-5 py-3 text-left font-medium text-slate-900">
                  {p.name}
                  {p.summary.unresolvedCount > 0 && <span className="block text-xs font-normal text-amber-700">{formatNumber(p.summary.unresolvedCount)} unresolved</span>}
                </th>
                <td className="px-3 py-3 text-right text-slate-700">{formatNumber(p.summary.requestCount)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{formatCurrency(p.summary.reconciledSpend)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{formatCurrency(p.summary.estimatedOnlySpend)}</td>
                <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatCurrency(p.summary.estimatedSpend)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}

function ReconciliationCard({ report }: { report: MonthlyShowback }) {
  const s = report.summary;
  const rows = [
    { key: 'reconciled', label: 'Reconciled (sample)', count: s.reconciledCount, amount: s.reconciledSpend, color: 'bg-emerald-500' },
    { key: 'estimated', label: 'Estimated, not yet reconciled', count: s.estimatedOnlyCount, amount: s.estimatedOnlySpend, color: 'bg-sky-500' },
    { key: 'unavailable', label: 'Cost unavailable', count: s.unresolvedCount, amount: null, color: 'bg-amber-500' },
  ];
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            Reconciliation status <InfoTooltip text={glossary.reconciliation} label="About reconciliation" />
          </span>
        }
        description="Sample states only. No provider billing records are compared."
      />
      <div className="px-5 py-5">
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden>
          {rows.map((r) => (
            <div key={r.key} className={`${r.color} h-full`} style={{ width: `${(safeRatio(r.count, s.requestCount) ?? 0) * 100}%` }} />
          ))}
        </div>
        <ul className="mt-4 space-y-3 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-700">
                <span className={`h-2.5 w-2.5 rounded-sm ${r.color}`} aria-hidden />
                {r.label}
              </span>
              <span className="text-right tabular-nums text-slate-900">
                {formatNumber(r.count)} requests · {r.amount === null ? 'Not available' : formatCurrency(r.amount)}
                <span className="ml-1 text-xs text-slate-500">({formatPercent(safeRatio(r.count, s.requestCount))})</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function UnresolvedCard({ report }: { report: MonthlyShowback }) {
  const shown = report.unresolved.slice(0, 10);
  return (
    <Card>
      <CardHeader
        title="Requests with missing or unresolved costs"
        description="Usage wasn’t reported, so no estimate can be calculated. These are excluded from totals, not counted as $0."
        action={
          report.unresolved.length > 0 && (
            <Link to={usageHref(report, { cost: 'unavailable' })} className="text-xs font-medium text-teal-700 hover:underline">
              View all {formatNumber(report.unresolved.length)} in Usage Explorer
            </Link>
          )
        }
      />
      {shown.length === 0 ? (
        <EmptyState title="No unresolved requests this month" />
      ) : (
        <TableScroll label="Unresolved requests table">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="whitespace-nowrap bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">Request</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Timestamp</th>
                <th scope="col" className="px-3 py-2.5 font-medium">User or application</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Team code</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Model</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Request</th>
                <th scope="col" className="px-5 py-2.5 font-medium">Cost status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-2.5">
                    <Link to={usageHref(report, { cost: 'unavailable', request: r.id })} className="whitespace-nowrap font-mono text-xs text-teal-800 hover:underline">
                      {r.id}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{formatDateTime(r.timestamp, { short: true })}</td>
                  <td className="px-3 py-2.5 text-slate-900">{r.principalName}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-600">{r.teamCode}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{r.modelName}</td>
                  <td className="px-3 py-2.5">
                    <RequestStatusBadge status={r.requestStatus} />
                  </td>
                  <td className="px-5 py-2.5">
                    <CostStatusBadge status={r.costStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  );
}

/** Compact, document-style version of the report for the preview dialog and printing. */
function ReportPreview({ report }: { report: MonthlyShowback }) {
  const s = report.summary;
  return (
    <article id="showback-report" className="space-y-5 text-sm text-slate-800" aria-label="Showback report">
      <header className="border-b border-slate-200 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">AI usage showback · sample data</p>
        <h3 className="mt-1 text-lg font-semibold text-slate-900">
          {report.companyName} — {formatPeriod(report.month)}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          {formatPeriodRange(report.month)} ({report.timezone}) · {report.currency} · {report.scopeDescription}
        </p>
      </header>
      <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
        {SHOWBACK_NOTICE}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PreviewStat label="Estimated spend" value={formatCurrency(s.estimatedSpend)} />
        <PreviewStat label="Requests" value={formatNumber(s.requestCount)} />
        <PreviewStat label="Reconciled (sample)" value={formatCurrency(s.reconciledSpend)} />
        <PreviewStat label="Unresolved" value={formatNumber(s.unresolvedCount)} />
      </dl>
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">By team</h4>
        <table className="w-full text-xs tabular-nums">
          <tbody className="divide-y divide-slate-100">
            {report.teams.map((t) => (
              <tr key={t.teamId}>
                <td className="py-1.5">
                  {t.name} <span className="font-mono text-slate-500">({t.code})</span>
                </td>
                <td className="py-1.5 text-right text-slate-500">{formatNumber(t.summary.requestCount)} req.</td>
                <td className="py-1.5 text-right font-medium">{formatCurrency(t.summary.estimatedSpend)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">By provider</h4>
        <table className="w-full text-xs tabular-nums">
          <tbody className="divide-y divide-slate-100">
            {report.providers.map((p) => (
              <tr key={p.providerId}>
                <td className="py-1.5">{p.name}</td>
                <td className="py-1.5 text-right text-slate-500">{formatNumber(p.summary.requestCount)} req.</td>
                <td className="py-1.5 text-right font-medium">{formatCurrency(p.summary.estimatedSpend)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-slate-500">
        Totals exclude {formatNumber(s.unresolvedCount)} request(s) whose usage wasn’t reported. Rates are illustrative sample values, not current provider pricing. Demo reporting date {formatCalendarDate(report.asOfDate, { withYear: true })}.
      </p>
    </article>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
