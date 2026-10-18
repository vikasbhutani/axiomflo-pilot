/**
 * Usage Explorer for a real workspace: every request the person may see in a month,
 * with filters and a detail drawer. Prompts and answers are never stored, so they
 * can't be shown.
 */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/ui/Card';
import { Drawer } from '../../components/ui/Drawer';
import { Pagination } from '../../components/ui/Pagination';
import { SelectField } from '../../components/ui/SelectField';
import { CostStatusBadge, RequestStatusBadge } from '../../components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { TableScroll } from '../../components/ui/TableScroll';
import { summarize } from '../../lib/calculations';
import { formatDateTime, formatMoney, formatNumber, formatPeriod } from '../../lib/format';
import type { RealDataset, RealRecord } from '../../reports/realData';
import { useMonthParam, useRealDataset, useRealMember } from '../../reports/useRealReport';
import { COST_NOTE, DataNotes, MonthSelect, NoUsageYet, spendText } from './RealParts';

const PAGE_SIZE = 25;

export function RealUsagePage() {
  const [month, setMonth, months] = useMonthParam();
  const [params, setParams] = useSearchParams();
  const { isAdmin } = useRealMember();
  const state = useRealDataset(month);

  const set = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '' || v === 'all') p.delete(k);
      else p.set(k, v);
    }
    if (!('page' in changes)) p.delete('page');
    setParams(p, { replace: true });
  };
  const team = params.get('team') ?? 'all';
  const provider = params.get('provider') ?? 'all';
  const status = params.get('status') ?? 'all';
  const cost = params.get('cost') ?? 'all';
  const query = (params.get('q') ?? '').trim().toLowerCase();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const selectedId = params.get('request');

  const records = state.data?.records;
  const filtered = useMemo(
    () =>
      (records ?? []).filter(
        (r) =>
          (team === 'all' || r.teamId === team) &&
          (provider === 'all' || r.providerId === provider) &&
          (status === 'all' || r.requestStatus === status) &&
          (cost === 'all' || r.costStatus === cost) &&
          (query === '' || r.id.toLowerCase().includes(query) || r.modelId.includes(query) || r.principalName.toLowerCase().includes(query)),
      ),
    [records, team, provider, status, cost, query],
  );
  const teamOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of records ?? []) seen.set(r.teamId, `${r.teamName} (${r.teamCode})`);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [records]);
  const selected = selectedId ? (records ?? []).find((r) => r.id === selectedId) : undefined;

  return (
    <>
      <PageHeader
        title="Usage Explorer"
        description={`Every AI request sent through AxiomFlo in ${formatPeriod(month)}${isAdmin ? '' : ' by you'}. Prompts and answers are never stored.`}
        actions={<MonthSelect month={month} months={months} onChange={setMonth} />}
      />
      {state.status === 'error' ? (
        <Card>
          <ErrorState message={state.error.message} onRetry={state.reload} />
        </Card>
      ) : !state.data ? (
        <Card>
          <LoadingState label="Loading requests…" />
        </Card>
      ) : state.data.records.length === 0 ? (
        <>
          <DataNotes data={state.data} isAdmin={isAdmin} />
          <NoUsageYet month={month} />
        </>
      ) : (
        <>
          <DataNotes data={state.data} isAdmin={isAdmin} />
          <Card className="mb-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {isAdmin && <SelectField label="Team" value={team} onChange={(v) => set({ team: v })} options={[{ value: 'all', label: 'All teams' }, ...teamOptions]} />}
              <SelectField
                label="Provider"
                value={provider}
                onChange={(v) => set({ provider: v })}
                options={[
                  { value: 'all', label: 'All providers' },
                  { value: 'anthropic', label: 'Anthropic (Claude API)' },
                  { value: 'gemini_vertex', label: 'Gemini on Vertex AI' },
                ]}
              />
              <SelectField
                label="Request status"
                value={status}
                onChange={(v) => set({ status: v })}
                options={[
                  { value: 'all', label: 'Any status' },
                  { value: 'succeeded', label: 'Succeeded' },
                  { value: 'failed', label: 'Failed' },
                ]}
              />
              <SelectField
                label="Cost status"
                value={cost}
                onChange={(v) => set({ cost: v })}
                options={[
                  { value: 'all', label: 'Any cost status' },
                  { value: 'estimated', label: 'Estimated' },
                  { value: 'unavailable', label: 'Cost unavailable' },
                ]}
              />
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Search</span>
                <input
                  type="search"
                  defaultValue={params.get('q') ?? ''}
                  onChange={(e) => set({ q: e.target.value })}
                  placeholder={isAdmin ? 'Request ID, model or person' : 'Request ID or model'}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
          </Card>
          <UsageTable data={state.data} rows={filtered} page={page} onPage={(p) => set({ page: p === 1 ? null : String(p) })} onOpen={(id) => set({ request: id, page: params.get('page') })} />
          <p className="mt-4 text-xs text-slate-500">{COST_NOTE}</p>
        </>
      )}
      <Drawer
        open={selectedId !== null}
        onClose={() => set({ request: null, page: params.get('page') })}
        title="Request details"
        description={state.data ? `${state.data.money.currency} · Australia/Sydney` : undefined}
      >
        {selected && state.data ? (
          <RequestDetail record={selected} currency={state.data.money.currency} />
        ) : state.data ? (
          <EmptyState title="Request not found" description="It isn’t in this month, or you can’t see it." />
        ) : (
          <LoadingState label="Loading…" />
        )}
      </Drawer>
    </>
  );
}

function UsageTable({ data, rows, page, onPage, onOpen }: { data: RealDataset; rows: RealRecord[]; page: number; onPage: (p: number) => void; onOpen: (id: string) => void }) {
  const s = summarize(rows);
  const currency = data.money.currency;
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3" aria-live="polite">
        <Metric label="Matching requests" value={formatNumber(s.requestCount)} />
        <Metric label="Estimated spend" value={spendText(s, currency)} />
        <Metric label="Cost unavailable" value={formatNumber(s.unresolvedCount)} />
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No requests match these filters" description="Try clearing a filter." />
        ) : (
          <>
            <TableScroll label="Requests table">
              <table className="w-full min-w-[1000px] text-sm">
                <caption className="sr-only">Requests matching the current filters. Select a request to open its details.</caption>
                <thead className="whitespace-nowrap bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Time
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Person
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Team
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Model
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Input tokens
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Output tokens
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Estimated cost
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Request
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Cost status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((r) => (
                    <tr key={r.id} onClick={() => onOpen(r.id)} className="cursor-pointer hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-2.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(r.id);
                          }}
                          className="rounded text-left tabular-nums text-teal-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
                          aria-label={`Open details for request ${r.id}`}
                        >
                          {formatDateTime(r.timestamp, { short: true })}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-slate-900">{r.principalName}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">
                        {r.teamName} <span className="font-mono text-xs text-slate-500">{r.teamCode}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{r.modelName}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatNumber(r.inputTokens)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatNumber(r.outputTokens)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{formatMoney(r.estimatedCost, currency, { precise: true })}</td>
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
            <Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPageChange={onPage} />
          </>
        )}
      </Card>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

export function RequestDetail({ record: r, currency }: { record: RealRecord; currency: string }) {
  const missing: string[] = [];
  if (r.inputTokens === null || r.outputTokens === null) missing.push('The provider didn’t report token counts for this request, so it has no cost. It isn’t counted as $0.');
  else if (r.estimatedCostUsd === null) missing.push('AxiomFlo has no list price for this model yet, so it has no cost. It isn’t counted as $0.');
  const rows: [string, string][] = [
    ['Request ID', r.id],
    ['Time', formatDateTime(r.timestamp)],
    ['Person', r.principalEmail && r.principalEmail !== r.principalName ? `${r.principalName} (${r.principalEmail})` : r.principalName],
    ['Team', `${r.teamName} (${r.teamCode})`],
    ['Provider', r.providerName],
    ['Model', `${r.modelName} (${r.modelId})`],
    ['Request', `${r.requestStatus === 'succeeded' ? 'Succeeded' : 'Failed'}${r.providerStatus ? ` · provider status ${r.providerStatus}` : ''}${r.stream ? ' · streamed' : ''}`],
    ['Duration', r.latencyMs === null ? 'Not available' : `${formatNumber(r.latencyMs)} ms`],
    ['Input tokens', formatNumber(r.inputTokens)],
    ['Output tokens', formatNumber(r.outputTokens)],
    ['Cache write tokens', formatNumber(r.cacheWriteTokens)],
    ['Cache read tokens', formatNumber(r.cacheReadTokens)],
    ['Estimated cost (USD)', r.estimatedCostUsd === null ? 'Not available' : `US$${r.estimatedCostUsd.toFixed(6)}`],
  ];
  if (currency !== 'USD')
    rows.push([`Estimated cost (${currency})`, r.estimatedCost === null ? 'Not available' : `${formatMoney(r.estimatedCost, currency, { precise: true })} at ${r.exchangeRate} ${currency} per USD`]);
  rows.push(['Price list', r.pricingVersionId ?? 'Not available'], ['AxiomFlo key', r.keyId ? `…${r.keyId.slice(-6)}` : 'Not available']);
  return (
    <div className="space-y-4 text-sm">
      <dl className="divide-y divide-slate-100">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[10rem,1fr] gap-3 py-2">
            <dt className="text-slate-500">{k}</dt>
            <dd className="break-words text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <CostStatusBadge status={r.costStatus} />
      </div>
      {missing.map((m) => (
        <p key={m} className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
          {m}
        </p>
      ))}
      <p className="text-xs text-slate-500">Prompts and answers pass through AxiomFlo but are never stored, so they can’t be shown.</p>
    </div>
  );
}
