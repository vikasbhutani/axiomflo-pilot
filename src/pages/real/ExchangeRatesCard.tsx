/**
 * USD → reporting-currency exchange rates, one per month. Everyone can see them;
 * only a Company Admin can set one (the API checks, and audits each change).
 */
import { useState, type FormEvent } from 'react';
import { Card, CardHeader } from '../../components/ui/Card';
import { SelectInput, TextField } from '../../components/ui/FormFields';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { formatDateTime, formatPeriod } from '../../lib/format';
import { recentMonths } from '../../reports/realData';
import { useReportsApi } from '../../reports/useRealReport';

export function ExchangeRatesCard({ isAdmin }: { isAdmin: boolean }) {
  const reports = useReportsApi();
  const notify = useToast();
  const state = useAsync(async () => (reports ? reports.rates() : null), [reports]);
  const months = recentMonths();
  const [month, setMonth] = useState(months[0]);
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!reports) return null;
  const currency = state.data?.currency ?? 'AUD';

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(rate);
    if (!Number.isFinite(value) || value <= 0) return setError('Enter a positive number, like 1.52.');
    setBusy(true);
    setError(null);
    try {
      await reports.setRate(month, value);
      notify(`Exchange rate for ${formatPeriod(month)} saved.`, 'success');
      setRate('');
      state.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Exchange rates" description={`AxiomFlo estimates costs in USD. Each month’s rate converts them to ${currency}. A month with no rate uses the latest earlier one.`} />
      <div className="px-5 py-4">
        {state.status === 'error' ? (
          <ErrorState message={state.error.message} onRetry={state.reload} />
        ) : !state.data ? (
          <LoadingState label="Loading rates…" />
        ) : currency === 'USD' ? (
          <p className="text-sm text-slate-600">Your company reports in USD, so no exchange rate is needed.</p>
        ) : (
          <>
            {state.data.rates.length === 0 ? (
              <p className="text-sm text-slate-600">No rates yet, so reports show USD.</p>
            ) : (
              <table className="w-full max-w-lg text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1.5 font-medium">Month</th>
                    <th className="py-1.5 text-right font-medium">{currency} per USD</th>
                    <th className="py-1.5 pl-4 font-medium">Set</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...state.data.rates].reverse().map((r) => (
                    <tr key={r.month}>
                      <td className="py-1.5">{formatPeriod(r.month)}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.rate}</td>
                      <td className="py-1.5 pl-4 text-slate-500">{formatDateTime(r.setAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {isAdmin && (
              <form onSubmit={save} className="mt-4 grid max-w-lg gap-3 sm:grid-cols-[1fr,1fr,auto] sm:items-end">
                <SelectInput label="Month" value={month} onChange={setMonth} options={months.map((m) => ({ value: m, label: formatPeriod(m) }))} />
                <TextField label={`${currency} per 1 USD`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="1.52" error={error ?? undefined} />
                <button type="submit" className="btn-primary" disabled={busy || rate.trim() === ''}>
                  {busy ? 'Saving…' : 'Save rate'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
