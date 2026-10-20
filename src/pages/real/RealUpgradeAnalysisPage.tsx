import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/States';
import { AssistantTabs } from '../../components/upgrade/AssistantTabs';
import { UpgradeAnalysisView } from '../../components/upgrade/UpgradeAnalysisView';
import { parseUpgradeParams } from '../../components/upgrade/params';
import { useApiClient } from '../../auth/apiContext';
import { createUpgradeApi } from '../../reports/upgradeApi';
import { useRealMember } from '../../reports/useRealReport';

/** Upgrade Analysis on the company's real usage, through the AxiomFlo API. */
export function RealUpgradeAnalysisPage() {
  const api = useApiClient();
  const { isAdmin, membership, user } = useRealMember();
  const [params] = useSearchParams();
  const client = useMemo(() => (api ? createUpgradeApi(api) : null), [api]);
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
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden />
        <p>
          Uses only what {isAdmin ? 'a Company Admin' : 'you'} can see. Prices are provider list prices, so every figure is an estimate, not a bill. It changes nothing and never switches a model; any
          migration needs explicit human approval.
        </p>
      </div>
      {client ? (
        <UpgradeAnalysisView client={client} canSave={membership.readOnly !== true} initial={initial} viewerKey={user.uid} />
      ) : (
        <Card>
          <EmptyState title="AxiomFlo isn’t connected in this build" />
        </Card>
      )}
    </>
  );
}
