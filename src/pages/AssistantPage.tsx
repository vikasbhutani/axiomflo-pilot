import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RotateCcw, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { useDemo } from '../context/DemoContext';
import { roleLabels } from '../lib/permissions';
import { formatPeriod } from '../lib/format';
import { AssistantTabs } from '../components/upgrade/AssistantTabs';
import { DemoConversationView, useDemoConversation } from '../components/assistant/DemoConversation';

export function AssistantPage() {
  const { role, period } = useDemo();
  const { messages, pending, ask, restart } = useDemoConversation();

  // A question handed over in the link (e.g. from the FinOps Scorecard) is asked once, then removed from the address.
  const [params, setParams] = useSearchParams();
  const handedOver = params.get('q');
  const askedHandover = useRef<string | null>(null);
  useEffect(() => {
    if (!handedOver || askedHandover.current === handedOver) return;
    askedHandover.current = handedOver;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('q');
      return next;
    }, { replace: true });
    void ask(handedOver);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handedOver]);

  return (
    <>
      <PageHeader
        title="AxiomFlo Cost Assistant"
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'AI Cost Assistant' }]}
        description="Ask about estimated AI spend in plain language. Answers are calculated from the same data as every other page."
        actions={
          messages.length > 0 ? (
            <button type="button" className="btn-secondary" onClick={restart} disabled={pending}>
              <RotateCcw className="h-4 w-4" aria-hidden /> New conversation
            </button>
          ) : undefined
        }
      />
      <AssistantTabs />

      <div>
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
          <p>
            <strong className="font-semibold">Demonstration assistant.</strong> Answers are prepared by fixed rules from sample data, not by a live AI model. It is read-only, answers only
            from data the <strong className="font-semibold">{roleLabels[role]}</strong> role can see ({formatPeriod(period)} selected), and its figures are estimates, not bills.
          </p>
        </div>

        <Card className="flex flex-col">
          <DemoConversationView />
        </Card>
      </div>
    </>
  );
}
