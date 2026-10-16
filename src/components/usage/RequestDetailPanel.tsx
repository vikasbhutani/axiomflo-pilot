import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Copy, ShieldCheck } from 'lucide-react';
import { useDemo } from '../../context/DemoContext';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { getRequestDetail } from '../../services/mockService';
import { glossary } from '../../lib/glossary';
import { formatCurrency, formatDateTime, formatNumber, NOT_AVAILABLE } from '../../lib/format';
import { CostStatusBadge, DemoTag, RequestStatusBadge } from '../ui/StatusBadge';
import { InfoTooltip } from '../ui/InfoTooltip';
import { ErrorState, LoadingState } from '../ui/States';

const costStatusExplanation = {
  reconciled: 'This estimate has been matched to a (simulated) provider billing record. Sample state only.',
  estimated: 'Calculated from measured usage and illustrative rates. Not yet reconciled.',
  unavailable: 'Usage measurements are missing, so no cost can be calculated. Counted as unresolved, not $0.',
} as const;

/** Rates are per million tokens; show enough decimals that small rates stay exact. */
function formatRate(value: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

/** Per-line amounts in the breakdown get 6 decimals so the parts visibly add up. */
function formatPreciseAmount(value: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 6, maximumFractionDigits: 6 }).format(value);
}

export function RequestDetailPanel({ requestId }: { requestId: string }) {
  const { userContext, dataVersion } = useDemo();
  const state = useAsync(() => getRequestDetail(requestId, userContext), [requestId, userContext.userId, userContext.role, dataVersion]);

  if (state.status === 'error') return <ErrorState message={state.error.message} />;
  if (state.status === 'loading' || !state.data) return <LoadingState label="Loading request…" />;

  const { record, breakdown, pricingVersion, missingInformation } = state.data;
  const totalTokens = record.inputTokens !== null && record.outputTokens !== null ? record.inputTokens + record.outputTokens : null;

  return (
    <div className="space-y-6 text-sm">
      <section>
        <SectionTitle>Request identifier</SectionTitle>
        <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs text-slate-800">{record.id}</code>
          <CopyButton value={record.id} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <Item label="Timestamp">{formatDateTime(record.timestamp)}</Item>
          <Item label="Request status">
            <RequestStatusBadge status={record.requestStatus} />
          </Item>
        </dl>
      </section>

      <section>
        <SectionTitle>Team attribution</SectionTitle>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Item label={record.principal.type === 'user' ? 'User' : 'Application'}>{record.principalName}</Item>
          <Item label="Team">{record.teamName}</Item>
          <Item
            label={
              <span className="inline-flex items-center gap-1">
                Team code <InfoTooltip text={glossary.teamCode} label="About team codes" />
              </span>
            }
          >
            <span className="font-mono text-xs">{record.teamCode}</span>
          </Item>
        </dl>
      </section>

      <section>
        <SectionTitle>
          Provider and model <DemoTag />
        </SectionTitle>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Item label="Provider">{record.providerName}</Item>
          <Item label="Model">{record.modelName}</Item>
        </dl>
      </section>

      <section>
        <SectionTitle>
          Usage measurements <InfoTooltip text={glossary.tokens} label="About tokens" />
        </SectionTitle>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3">
          <Item label="Input tokens">{record.inputTokens === null ? <Muted /> : formatNumber(record.inputTokens)}</Item>
          <Item label="Output tokens">{record.outputTokens === null ? <Muted /> : formatNumber(record.outputTokens)}</Item>
          <Item label="Total tokens">{totalTokens === null ? <Muted /> : formatNumber(totalTokens)}</Item>
        </dl>
      </section>

      <section>
        <SectionTitle>
          Calculation breakdown <DemoTag>Illustrative pricing</DemoTag>
        </SectionTitle>
        <p className="mb-3 text-xs text-slate-500">
          Pricing version: <span className="font-medium text-slate-700">{pricingVersion?.label ?? NOT_AVAILABLE}</span>
          {pricingVersion && <span className="font-mono"> ({pricingVersion.id})</span>}
        </p>
        {breakdown ? (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Part</th>
                  <th scope="col" className="px-3 py-2 font-medium">Calculation</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                <tr>
                  <td className="px-3 py-2 text-slate-700">Input</td>
                  <td className="px-3 py-2 text-slate-600">
                    {formatNumber(record.inputTokens)} × {formatRate(breakdown.rate.inputPerMillion)} ÷ 1,000,000
                  </td>
                  <td className="px-3 py-2 text-right text-slate-800">{formatPreciseAmount(breakdown.inputCost)}</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-slate-700">Output</td>
                  <td className="px-3 py-2 text-slate-600">
                    {formatNumber(record.outputTokens)} × {formatRate(breakdown.rate.outputPerMillion)} ÷ 1,000,000
                  </td>
                  <td className="px-3 py-2 text-right text-slate-800">{formatPreciseAmount(breakdown.outputCost)}</td>
                </tr>
                <tr className="bg-slate-50 font-medium">
                  <td className="px-3 py-2 text-slate-900" colSpan={2}>
                    Estimated cost
                  </td>
                  <td className="px-3 py-2 text-right text-slate-900">{formatCurrency(breakdown.total, { precise: true })}</td>
                </tr>
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Rates are AUD per million tokens. Totals are kept at full precision and rounded only for display.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">Estimated cost: Not available. It can't be calculated without both input and output token counts.</div>
        )}
      </section>

      <section>
        <SectionTitle>
          Estimated versus reconciled <InfoTooltip text={glossary.reconciliation} label="About reconciliation" />
        </SectionTitle>
        <div className="flex flex-col items-start gap-2">
          <CostStatusBadge status={record.costStatus} />
          <p className="text-xs text-slate-600">{costStatusExplanation[record.costStatus]}</p>
        </div>
      </section>

      {missingInformation.length > 0 && (
        <section>
          <SectionTitle>Missing or unresolved information</SectionTitle>
          <ul className="space-y-1.5">
            {missingInformation.map((m) => (
              <li key={m} className="flex items-start gap-2 text-xs text-slate-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                {m}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
        AxiomFlo records usage metadata only. Prompts, responses, secrets and credentials are never stored or shown.
      </p>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h3>;
}

function Item({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
    </div>
  );
}

function Muted() {
  return <span className="text-slate-400">Not available</span>;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const notify = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      notify('Copying isn’t available in this browser. Select the ID and copy it manually.', 'error');
    }
  };
  return (
    <button type="button" onClick={copy} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600" aria-label={copied ? 'Copied' : 'Copy request ID'}>
      {copied ? <Check className="h-4 w-4 text-teal-600" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
    </button>
  );
}
