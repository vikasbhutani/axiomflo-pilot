import { DatabaseZap } from 'lucide-react';
import { useWorkspaceSession } from '../../auth/WorkspaceSession';
import { roleLabels } from '../../lib/permissions';
import { Card } from '../ui/Card';

/**
 * What an approved member sees until a real reporting backend exists: who they are
 * and what the AxiomFlo API says they may access. Sample data is deliberately NOT
 * shown here, so real and demo data can never be mixed up.
 */
export function RealWorkspaceNotice() {
  const session = useWorkspaceSession();
  if (session.mode !== 'real') return null;
  const { user, membership } = session;
  const teams = membership.teams ?? [];
  const isAdmin = membership.role === 'company_admin';

  return (
    <Card className="mx-auto max-w-2xl">
      <div className="px-6 py-10">
        <div className="flex flex-col items-center text-center">
          <DatabaseZap className="h-9 w-9 text-teal-700" aria-hidden />
          <h1 className="mt-4 text-lg font-semibold text-navy-900">Your workspace access is approved</h1>
        </div>

        <dl className="mx-auto mt-6 grid max-w-md grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">Signed in as</dt>
          <dd className="break-words text-slate-800">
            {user.displayName ? `${user.displayName} · ` : ''}
            {user.email}
          </dd>
          <dt className="text-slate-500">Company</dt>
          <dd className="text-slate-800">{membership.companyName ?? 'Your company'}</dd>
          <dt className="text-slate-500">Role</dt>
          <dd className="text-slate-800">{roleLabels[membership.role]}</dd>
          <dt className="text-slate-500">{isAdmin ? 'Teams (all)' : 'Your teams'}</dt>
          <dd className="text-slate-800">
            {teams.length === 0 ? (
              <span className="text-slate-500">No teams assigned yet</span>
            ) : (
              <ul>
                {teams.map((t) => (
                  <li key={t.id}>
                    {t.name} <span className="font-mono text-xs text-slate-500">{t.code}</span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>

        <p className="mx-auto mt-6 max-w-md text-center text-sm text-slate-600">
          Real usage and cost reports will appear here once AxiomFlo’s reporting backend is connected. Until then this workspace has no data, and sample data is only shown in the demo workspace.
        </p>
      </div>
    </Card>
  );
}
