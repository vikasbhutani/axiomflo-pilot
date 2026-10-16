import { DatabaseZap } from 'lucide-react';
import { useWorkspaceSession } from '../../auth/WorkspaceSession';
import { roleLabels } from '../../lib/permissions';
import { Card } from '../ui/Card';

/**
 * What an approved member sees until a real reporting backend exists. Sample data is
 * deliberately NOT shown here, so real and demo data can never be mixed up.
 */
export function RealWorkspaceNotice() {
  const session = useWorkspaceSession();
  if (session.mode !== 'real') return null;
  const { membership } = session;
  return (
    <Card className="mx-auto max-w-2xl">
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <DatabaseZap className="h-9 w-9 text-teal-700" aria-hidden />
        <h1 className="mt-4 text-lg font-semibold text-navy-900">Your workspace access is approved</h1>
        <p className="mt-1 text-sm text-slate-600">
          {membership.companyName ?? 'Your company'} · {roleLabels[membership.role]}
        </p>
        <p className="mt-4 max-w-md text-sm text-slate-600">
          Real usage and cost reports will appear here once AxiomFlo’s reporting backend is connected. Until then this workspace has no data, and sample data is only shown in the demo workspace.
        </p>
      </div>
    </Card>
  );
}
