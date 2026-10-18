import { Bot } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/States';

/** The AI Cost Assistant isn't connected to real data yet; it only runs in the demo. */
export function RealAssistantPage() {
  return (
    <>
      <PageHeader title="AI Cost Assistant" />
      <Card>
        <div className="flex justify-center pt-8 text-slate-300">
          <Bot className="h-8 w-8" aria-hidden />
        </div>
        <EmptyState
          title="Not connected to your real data yet"
          description="The assistant will answer from the same figures as the Overview, Teams and Showback pages once it’s connected. You can try it in the demo workspace."
        />
      </Card>
    </>
  );
}
