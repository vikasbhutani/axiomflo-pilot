/** Small pieces shared by the real workspace's pages. */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { SelectField } from '../../components/ui/SelectField';
import { EmptyState } from '../../components/ui/States';
import { safeRatio, summarizeBy, type CostSummary } from '../../lib/calculations';
import { formatMoney, formatNumber, formatPercent, formatPeriod } from '../../lib/format';
import type { RealDataset, RealRecord } from '../../reports/realData';

export function MonthSelect({ month, months, onChange }: { month: string; months: string[]; onChange: (m: string) => void }) {
  return <SelectField label="Reporting month" value={month} onChange={onChange} options={months.map((m) => ({ value: m, label: formatPeriod(m) }))} className="w-full sm:w-48" />;
}

/** Notes about how complete and in which currency the figures are. Renders nothing when there's nothing to say. */
export function DataNotes({ data, isAdmin }: { data: RealDataset; isAdmin: boolean }) {
  const notes: ReactNode[] = [];
  if (data.money.usingUsdFallback) {
    notes.push(
      <>
        Amounts are in USD because no USD → {data.money.reportingCurrency} exchange rate is set yet.{' '}
        {isAdmin ? (
          <Link to="/settings" className="font-medium text-teal-800 underline">
            Set one in Settings
          </Link>
        ) : (
          'Your Company Admin can set one.'
        )}
      </>,
    );
  }
  if (data.truncated) notes.push('This month has more requests than one report shows, so only the most recent ones are included.');
  if (data.skipped > 0) notes.push(`${data.skipped} stored request record${data.skipped === 1 ? '' : 's'} couldn’t be read and ${data.skipped === 1 ? 'is' : 'are'} left out.`);
  if (notes.length === 0) return null;
  return (
    <div className="mb-4 space-y-1 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" role="note">
      {notes.map((n, i) => (
        <p key={i} className="flex gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{n}</span>
        </p>
      ))}
    </div>
  );
}

export const COST_NOTE = 'Costs are estimates from Anthropic’s list prices, worked out by the AxiomFlo gateway for each request. Your provider bill is the final figure.';

export interface SpendRow {
  key: string;
  label: string;
  sublabel?: string;
  summary: CostSummary;
}

/** A ranked list of spend with bars, like the demo's breakdown cards. */
export function SpendList({
  title,
  description,
  rows,
  total,
  currency,
  empty = 'Nothing to show',
}: {
  title: string;
  description?: string;
  rows: SpendRow[];
  total: number;
  currency: string;
  empty?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.summary.estimatedSpend));
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {rows.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="space-y-5 px-5 py-5">
          {rows.map((r) => {
            const share = safeRatio(r.summary.estimatedSpend, total);
            return (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{r.label}</p>
                    {r.sublabel && <p className="truncate font-mono text-xs text-slate-500">{r.sublabel}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-slate-900">{spendText(r.summary, currency)}</p>
                    <p className="text-xs tabular-nums text-slate-500">{share === null ? '—' : formatPercent(share)}</p>
                  </div>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-100" aria-hidden>
                  <div className="h-2 origin-left animate-grow-x rounded-full bg-teal-600 transition-[width] duration-500" style={{ width: `${max > 0 ? (r.summary.estimatedSpend / max) * 100 : 0}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  {formatNumber(r.summary.requestCount)} request{r.summary.requestCount === 1 ? '' : 's'}
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

/** Spend for a summary: "Not available" when every request lacks a cost, never $0. */
export function spendText(s: CostSummary, currency: string): string {
  return s.costedCount === 0 && s.unresolvedCount > 0 ? 'Not available' : formatMoney(s.estimatedSpend, currency);
}

/** Groups records and returns rows sorted by spend, biggest first. */
export function spendRows(records: RealRecord[], keyOf: (r: RealRecord) => string, label: (first: RealRecord) => { label: string; sublabel?: string }): SpendRow[] {
  const groups = summarizeBy(records, keyOf);
  return [...groups.entries()]
    .map(([key, summary]) => ({ key, summary, ...label(records.find((r) => keyOf(r) === key)!) }))
    .sort((a, b) => b.summary.estimatedSpend - a.summary.estimatedSpend || b.summary.requestCount - a.summary.requestCount);
}

/** Shown when a month has no requests at all. */
export function NoUsageYet({ month }: { month: string }) {
  return (
    <Card>
      <EmptyState
        title={`No AI requests in ${formatPeriod(month)} yet`}
        description="Figures appear here once people send AI requests through the AxiomFlo gateway with their AxiomFlo key. Create a key in Settings. Chats in the Claude or Gemini apps aren’t counted."
        action={
          <Link to="/settings" className="btn-secondary">
            Go to Settings
          </Link>
        }
      />
    </Card>
  );
}
