import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Gauge, Lightbulb, RotateCcw, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useAsync } from '../../hooks/useAsync';
import { formatPeriod } from '../../lib/format';
import { AssistantError, type SuggestionsResult } from '../../reports/assistantApi';
import { useMonthParam, useRealMember } from '../../reports/useRealReport';
import { MonthSelect } from './RealParts';
import { AssistantTabs } from '../../components/upgrade/AssistantTabs';
import { LinkButton, RealConversationView, useAssistantApi, useRealConversation } from '../../components/assistant/RealConversation';

/** The AI Cost Assistant on the company's real usage: a chat, plus savings suggestions for a month. */
export function RealAssistantPage() {
  const assistant = useAssistantApi();
  const { isAdmin, user } = useRealMember();
  const [month, setMonth, months] = useMonthParam();
  const { messages, pending, restart, notSetUp, markNotSetUp } = useRealConversation();

  const suggestions = useAsync(async () => {
    if (!assistant) throw new AssistantError('AxiomFlo isn’t connected in this build.', true);
    return assistant.suggestions(month);
  }, [assistant, month, user.uid]);

  useEffect(() => {
    if (suggestions.status === 'error' && suggestions.error instanceof AssistantError && suggestions.error.notSetUp) markNotSetUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions]);

  if (notSetUp) {
    return (
      <>
        <PageHeader title="AxiomFlo Cost Assistant" breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'AI Cost Assistant' }]} />
        <AssistantTabs />
        <Card>
          <div className="flex justify-center pt-8 text-slate-300">
            <Bot className="h-8 w-8" aria-hidden />
          </div>
          <EmptyState
            title="The assistant isn’t set up yet"
            description={
              isAdmin
                ? 'It needs the AxiomFlo Agent service running in Google Cloud. The steps are in docs/agent/deploy.md. Meanwhile, the Overview, Teams and Showback pages show the same figures.'
                : 'Your Company Admin needs to finish setting it up. Meanwhile, the Overview page shows the same figures.'
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="AxiomFlo Cost Assistant"
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'AI Cost Assistant' }]}
        description="Ask about your AI spend in plain language. Every figure comes from the same records as the other pages."
        actions={
          messages.length > 0 ? (
            <button type="button" className="btn-secondary" onClick={restart} disabled={pending}>
              <RotateCcw className="h-4 w-4" aria-hidden /> New conversation
            </button>
          ) : undefined
        }
      />
      <AssistantTabs />

      <div className="mb-4 flex animate-fade-in items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden />
        <p>
          Read-only. It answers only from what {isAdmin ? 'a Company Admin' : 'you'} can see, for this month and the two before it. Amounts are estimates from provider list prices, not bills. Answers are
          written by Gemini; a check withholds any answer with a figure AxiomFlo didn’t calculate.
        </p>
      </div>

      <div className="grid animate-fade-in gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="flex flex-col">
          <RealConversationView />
        </Card>

        <Card>
          <CardHeader title="Savings suggestions" description="Worked out by AxiomFlo’s own rules, not by the AI." />
          <div className="p-4 sm:p-5">
            <MonthSelect month={month} months={months} onChange={setMonth} />
            <Link to={`/scorecard?month=${month}`} className="btn-secondary mt-3 w-full justify-center">
              <Gauge className="h-4 w-4" aria-hidden /> Open the FinOps Scorecard
            </Link>
            <div className="mt-4">
              {suggestions.status === 'loading' && !suggestions.data && <LoadingState label="Looking for savings…" />}
              {suggestions.status === 'error' && <ErrorState message={suggestions.error.message} onRetry={suggestions.reload} />}
              {suggestions.data && suggestions.status !== 'error' && <SuggestionList result={suggestions.data} month={month} />}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

function SuggestionList({ result, month }: { result: SuggestionsResult; month: string }) {
  if (result.status === 'error') return <p className="text-sm text-slate-600">{result.error?.message ?? 'Suggestions are unavailable for this month.'}</p>;
  const items = result.suggestions ?? [];
  if (items.length === 0) return <p className="text-sm text-slate-600">{result.message ?? `Nothing stands out for ${formatPeriod(month)}.`}</p>;
  return (
    <ul className="space-y-3" aria-label={`Savings suggestions for ${formatPeriod(month)}`}>
      {items.map((s) => (
        <li key={`${s.kind}:${s.title}`} className="animate-fade-up rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="flex items-start gap-2 text-sm font-semibold text-slate-900">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            {s.title}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{s.detail}</p>
          {s.link && <LinkButton link={s.link} />}
        </li>
      ))}
    </ul>
  );
}

