/**
 * AI providers for a real workspace: how requests reach each provider through the
 * AxiomFlo gateway, and the month's usage per provider. No provider credentials are
 * ever shown or entered here: they live in Google Cloud (Secret Manager, service accounts).
 */
import { Link } from 'react-router-dom';
import { PlugZap } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { summarize } from '../../lib/calculations';
import { formatNumber, formatPeriod } from '../../lib/format';
import { useMonthParam, useRealDataset, useRealMember } from '../../reports/useRealReport';
import { DataNotes, MonthSelect, spendText } from './RealParts';

const PROVIDERS = [
  {
    id: 'anthropic' as const,
    name: 'Anthropic (Claude API)',
    how: 'Point the Anthropic SDK or tool at the AxiomFlo gateway’s /anthropic address and use your AxiomFlo key as the API key. Requests and answers keep Anthropic’s own format, streaming included.',
    status: 'Built. The gateway goes live once your Company Admin approves its deployment.',
  },
  {
    id: 'gemini_vertex' as const,
    name: 'Gemini on Vertex AI',
    how: 'Point the Google Gen AI SDK at the AxiomFlo gateway’s /vertex address and use your AxiomFlo key as the API key. The gateway calls Vertex AI in your company’s Google Cloud project with its own identity, so you never need Google Cloud access.',
    status: 'Built. The gateway goes live once your Company Admin approves its deployment.',
  },
];

export function RealProvidersPage() {
  const [month, setMonth, months] = useMonthParam();
  const { isAdmin } = useRealMember();
  const state = useRealDataset(month);
  return (
    <>
      <PageHeader
        title="AI Providers"
        description="AxiomFlo counts AI requests sent through its gateway with an AxiomFlo key."
        actions={<MonthSelect month={month} months={months} onChange={setMonth} />}
      />
      {state.data && <DataNotes data={state.data} isAdmin={isAdmin} />}
      <div className="grid gap-6 lg:grid-cols-2">
        {PROVIDERS.map((p) => {
          const s = state.data ? summarize(state.data.records.filter((r) => r.providerId === p.id)) : null;
          return (
            <Card key={p.id}>
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-2">
                    <PlugZap className="h-4 w-4 text-slate-500" aria-hidden /> {p.name}
                  </span>
                }
                description={p.status}
              />
              <div className="space-y-3 px-5 py-4 text-sm text-slate-700">
                <p>{p.how}</p>
                {state.status === 'error' ? (
                  <ErrorState message={state.error.message} onRetry={state.reload} />
                ) : !s || !state.data ? (
                  <LoadingState label="Loading usage…" />
                ) : (
                  <p className="rounded-lg bg-slate-50 px-3 py-2">
                    {formatPeriod(month)}: <span className="font-medium tabular-nums">{formatNumber(s.requestCount)}</span> request{s.requestCount === 1 ? '' : 's'}
                    {s.requestCount > 0 && <>, {spendText(s, state.data.money.currency)} estimated</>}
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <Card className="mt-6">
        <CardHeader title="What isn’t counted" />
        <ul className="list-disc space-y-1 px-10 py-4 text-sm text-slate-700">
          <li>Chats in the Claude or Gemini apps (claude.ai, gemini.google.com).</li>
          <li>Requests made with a personal or company provider key directly, instead of through AxiomFlo.</li>
        </ul>
        <p className="px-5 pb-4 text-sm text-slate-600">
          Each person creates their AxiomFlo key in{' '}
          <Link to="/settings?tab=integrations" className="font-medium text-teal-800 underline">
            Settings
          </Link>
          .
        </p>
      </Card>
    </>
  );
}
