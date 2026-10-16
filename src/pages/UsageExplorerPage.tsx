import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, RotateCcw, Search } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { SelectField } from '../components/ui/SelectField';
import { CostStatusBadge, RequestStatusBadge } from '../components/ui/StatusBadge';
import { InfoTooltip } from '../components/ui/InfoTooltip';
import { Pagination } from '../components/ui/Pagination';
import { Drawer } from '../components/ui/Drawer';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { RequestDetailPanel } from '../components/usage/RequestDetailPanel';
import { useDemo } from '../context/DemoContext';
import { useAsync } from '../hooks/useAsync';
import { getDataDateBounds, getUsage, getLookups, type UsageFilters } from '../services/mockService';
import { can } from '../lib/permissions';
import { glossary } from '../lib/glossary';
import { formatCurrency, formatDateTime, formatNumber, periodBounds } from '../lib/format';
import type { CostStatus, CostedUsageRecord, ProviderId, RequestStatus } from '../types';

const PAGE_SIZE = 25;
type SortKey = 'time_desc' | 'time_asc' | 'cost_desc' | 'cost_asc';

function sortRecords(records: CostedUsageRecord[], sort: SortKey): CostedUsageRecord[] {
  const list = [...records];
  switch (sort) {
    case 'time_asc':
      return list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    case 'cost_desc':
    case 'cost_asc': {
      const dir = sort === 'cost_desc' ? -1 : 1;
      // Unavailable costs always sort last; they are unknown, not zero.
      return list.sort((a, b) => {
        if (a.estimatedCost === null && b.estimatedCost === null) return 0;
        if (a.estimatedCost === null) return 1;
        if (b.estimatedCost === null) return -1;
        return (a.estimatedCost - b.estimatedCost) * dir;
      });
    }
    default:
      return list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
}

export function UsageExplorerPage() {
  const { userContext, period, dataVersion } = useDemo();
  const [params, setParams] = useSearchParams();
  const isAdmin = can(userContext, 'view_all_teams');
  const [minDate, maxDate] = useMemo(() => getDataDateBounds(), []);
  const [periodStart, periodEnd] = periodBounds(period);

  const filters: UsageFilters = {
    startDate: params.get('from') ?? periodStart,
    endDate: params.get('to') ?? periodEnd,
    teamId: isAdmin ? params.get('team') ?? 'all' : 'all',
    providerId: (params.get('provider') ?? 'all') as ProviderId | 'all',
    requestStatus: (params.get('status') ?? 'all') as RequestStatus | 'all',
    costStatus: (params.get('cost') ?? 'all') as CostStatus | 'all',
    search: params.get('q') ?? '',
  };
  const sort = (params.get('sort') ?? 'time_desc') as SortKey;
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const selectedId = params.get('request');
  const invalidRange = filters.startDate > filters.endDate;

  const update = useCallback(
    (changes: Record<string, string | null>, options: { keepPage?: boolean } = {}) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '' || value === 'all') next.delete(key);
            else next.set(key, value);
          }
          if (!options.keepPage) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Debounce the request-ID search so typing doesn't refetch on every key.
  const [searchText, setSearchText] = useState(filters.search ?? '');
  useEffect(() => setSearchText(params.get('q') ?? ''), [params]);
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchText !== (params.get('q') ?? '')) update({ q: searchText });
    }, 250);
    return () => clearTimeout(handle);
  }, [searchText, params, update]);

  const state = useAsync(
    () => (invalidRange ? Promise.reject(new Error('The start date is after the end date.')) : getUsage(filters, userContext)),
    [filters.startDate, filters.endDate, filters.teamId, filters.providerId, filters.requestStatus, filters.costStatus, filters.search, userContext.userId, userContext.role, dataVersion],
  );

  const sorted = useMemo(() => (state.data ? sortRecords(state.data.records, sort) : []), [state.data, sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const hasCustomFilters = ['from', 'to', 'team', 'provider', 'status', 'cost', 'q'].some((k) => params.has(k));
  const closeDrawer = useCallback(() => update({ request: null }, { keepPage: true }), [update]);

  const toggleSort = (column: 'time' | 'cost') => {
    const next: SortKey = column === 'time' ? (sort === 'time_desc' ? 'time_asc' : 'time_desc') : sort === 'cost_desc' ? 'cost_asc' : 'cost_desc';
    update({ sort: next === 'time_desc' ? null : next });
  };

  return (
    <>
      <PageHeader
        title="Usage Explorer"
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'Usage Explorer' }]}
        description={
          isAdmin
            ? 'Every request across both teams, with how each estimated cost was calculated. Dates use Australia/Sydney time.'
            : 'Your own requests, with how each estimated cost was calculated. Dates use Australia/Sydney time.'
        }
      />

      <Card className="mb-4 p-4 sm:p-5">
        <form role="search" onSubmit={(e) => e.preventDefault()} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateField label="From" value={filters.startDate} min={minDate} max={maxDate} onChange={(v) => update({ from: v || null })} />
          <DateField label="To" value={filters.endDate} min={minDate} max={maxDate} onChange={(v) => update({ to: v || null })} />
          {isAdmin && (
            <SelectField
              label="Team"
              value={filters.teamId ?? 'all'}
              onChange={(v) => update({ team: v })}
              options={[{ value: 'all', label: 'All teams' }, ...getLookups().teams.map((t) => ({ value: t.id, label: t.name }))]}
            />
          )}
          <SelectField
            label="Provider"
            value={filters.providerId ?? 'all'}
            onChange={(v) => update({ provider: v })}
            options={[{ value: 'all', label: 'All providers' }, ...getLookups().providers.map((p) => ({ value: p.id, label: p.name }))]}
          />
          <SelectField
            label="Request status"
            value={filters.requestStatus ?? 'all'}
            onChange={(v) => update({ status: v })}
            options={[
              { value: 'all', label: 'Any status' },
              { value: 'succeeded', label: 'Succeeded' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
          <SelectField
            label="Cost status"
            value={filters.costStatus ?? 'all'}
            onChange={(v) => update({ cost: v })}
            options={[
              { value: 'all', label: 'Any cost status' },
              { value: 'reconciled', label: 'Reconciled (sample)' },
              { value: 'estimated', label: 'Estimated' },
              { value: 'unavailable', label: 'Cost unavailable' },
            ]}
          />
          <SearchField value={searchText} onChange={setSearchText} className={isAdmin ? 'sm:col-span-2' : 'sm:col-span-2 lg:col-span-1'} />
        </form>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <p>{params.has('from') || params.has('to') ? 'Custom date range.' : 'Date range follows the reporting period selected in the top bar.'}</p>
          {hasCustomFilters && (
            <button type="button" onClick={() => setParams(new URLSearchParams(), { replace: true })} className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset filters
            </button>
          )}
        </div>
      </Card>

      {state.data && !invalidRange && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3" aria-live="polite">
          <Metric label="Matching requests" value={formatNumber(state.data.summary.requestCount)} />
          <Metric
            label="Estimated spend"
            // When every matching request lacks usage, the spend is unknown, not $0.
            value={state.data.summary.costedCount === 0 && state.data.summary.unresolvedCount > 0 ? 'Not available' : formatCurrency(state.data.summary.estimatedSpend)}
            tooltip={glossary.estimatedSpend}
          />
          <Metric label="Cost unavailable" value={formatNumber(state.data.summary.unresolvedCount)} tooltip={glossary.unresolved} warn={state.data.summary.unresolvedCount > 0} />
        </div>
      )}

      <Card>
        {state.status === 'error' ? (
          <ErrorState message={state.error.message} onRetry={invalidRange ? undefined : state.reload} />
        ) : !state.data ? (
          <LoadingState label="Loading requests…" />
        ) : sorted.length === 0 ? (
          <EmptyState
            title="No requests match these filters"
            description="Try widening the date range or clearing a filter."
            action={
              hasCustomFilters && (
                <button type="button" className="btn-secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                  Reset filters
                </button>
              )
            }
          />
        ) : (
          <div className={state.status === 'loading' ? 'opacity-60 transition-opacity' : ''} aria-busy={state.status === 'loading'}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-sm">
                <caption className="sr-only">Requests matching the current filters. Select a request ID to open its details.</caption>
                <thead className="whitespace-nowrap bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">Request ID</th>
                    <SortHeader label="Timestamp" active={sort.startsWith('time')} direction={sort === 'time_asc' ? 'asc' : 'desc'} onClick={() => toggleSort('time')} />
                    <th scope="col" className="px-3 py-2.5 font-medium">User or application</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Team</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Team code <InfoTooltip text={glossary.teamCode} label="About team codes" />
                      </span>
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Provider</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Model</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      <span className="inline-flex items-center gap-1">
                        Input tokens <InfoTooltip text={glossary.tokens} label="About tokens" />
                      </span>
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Output tokens</th>
                    <SortHeader label="Estimated cost" align="right" active={sort.startsWith('cost')} direction={sort === 'cost_asc' ? 'asc' : 'desc'} onClick={() => toggleSort('cost')} />
                    <th scope="col" className="px-3 py-2.5 font-medium">Request</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Cost status <InfoTooltip text={glossary.reconciliation} label="About reconciliation" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((r) => (
                    <tr key={r.id} onClick={() => update({ request: r.id }, { keepPage: true })} className={`cursor-pointer hover:bg-slate-50 ${selectedId === r.id ? 'bg-teal-50/60' : ''}`}>
                      <td className="px-5 py-2.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            update({ request: r.id }, { keepPage: true });
                          }}
                          className="max-w-[15rem] truncate rounded text-left font-mono text-xs text-teal-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
                          title={r.id}
                          aria-label={`Open details for request ${r.id}`}
                        >
                          {r.id}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700">{formatDateTime(r.timestamp, { short: true })}</td>
                      <td className="px-3 py-2.5 text-slate-900">{r.principalName}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{r.teamName}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-600">{r.teamCode}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{r.providerName}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{r.modelName}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.inputTokens === null ? <NotAvailable /> : formatNumber(r.inputTokens)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.outputTokens === null ? <NotAvailable /> : formatNumber(r.outputTokens)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{r.estimatedCost === null ? <NotAvailable /> : formatCurrency(r.estimatedCost, { precise: true })}</td>
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
            </div>
            <Pagination page={currentPage} pageSize={PAGE_SIZE} total={sorted.length} onPageChange={(p) => update({ page: p === 1 ? null : String(p) }, { keepPage: true })} />
          </div>
        )}
      </Card>
      <p className="mt-4 text-xs text-slate-500">Prompts, responses, secrets and credentials are never stored or shown. Model names and rates are illustrative sample values.</p>

      <Drawer open={selectedId !== null} onClose={closeDrawer} title="Request details" description="Sample data · AUD · Australia/Sydney">
        {selectedId && <RequestDetailPanel requestId={selectedId} />}
      </Drawer>
    </>
  );
}

function NotAvailable() {
  return <span className="text-xs text-slate-400">Not available</span>;
}

function Metric({ label, value, tooltip, warn = false }: { label: string; value: string; tooltip?: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white px-4 py-3 shadow-sm ${warn ? 'border-amber-200' : 'border-slate-200'}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {label}
        {tooltip && <InfoTooltip text={tooltip} label={`About ${label}`} />}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function SortHeader({ label, active, direction, onClick, align = 'left' }: { label: string; active: boolean; direction: 'asc' | 'desc'; onClick: () => void; align?: 'left' | 'right' }) {
  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th scope="col" className={`px-3 py-2.5 font-medium ${align === 'right' ? 'text-right' : ''}`} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? 'text-slate-700' : 'text-slate-300'}`} aria-hidden />
      </button>
    </th>
  );
}

function DateField({ label, value, min, max, onChange, className = '' }: { label: string; value: string; min: string; max: string; onChange: (value: string) => void; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
      />
    </div>
  );
}

function SearchField({ value, onChange, className = '' }: { value: string; onChange: (value: string) => void; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        Search by request ID
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          id={id}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. req_20260915"
          autoComplete="off"
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 font-mono text-sm text-slate-900 shadow-sm placeholder:font-sans placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
        />
      </div>
    </div>
  );
}
