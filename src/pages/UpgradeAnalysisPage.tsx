import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { AssistantTabs } from '../components/upgrade/AssistantTabs';
import { UpgradeAnalysisView } from '../components/upgrade/UpgradeAnalysisView';
import { parseUpgradeParams } from '../components/upgrade/params';
import { useDemo } from '../context/DemoContext';
import { roleLabels } from '../lib/permissions';
import { demoUpgradeClient } from '../services/upgradeAnalysisService';

/** Upgrade Analysis on the Acme sample data. */
export function UpgradeAnalysisPage() {
  const { userContext, role, dataVersion } = useDemo();
  const [params] = useSearchParams();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const client = useMemo(() => demoUpgradeClient(userContext), [userContext.userId, userContext.role, dataVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => parseUpgradeParams(params), []);
  return (
    <>
      <PageHeader
        title="Upgrade Analysis"
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'AI Cost Assistant', to: '/assistant' }, { label: 'Upgrade Analysis' }]}
        description="What moving a model dependency to a newer, cheaper or faster version would cost. Modelled estimates from observed usage, never guaranteed savings."
      />
      <AssistantTabs />
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
        <p>
          <strong className="font-semibold">Sample data.</strong> Candidate models, prices and expectations are illustrative. It uses only what the{' '}
          <strong className="font-semibold">{roleLabels[role]}</strong> role can see, changes nothing, and never switches a model.
        </p>
      </div>
      <UpgradeAnalysisView client={client} canSave initial={initial} viewerKey={`${userContext.userId}:${role}:${dataVersion}`} />
    </>
  );
}
