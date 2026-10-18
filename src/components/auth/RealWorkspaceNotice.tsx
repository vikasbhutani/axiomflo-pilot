import { DatabaseZap } from 'lucide-react';
import { useWorkspaceSession } from '../../auth/WorkspaceSession';
import { roleLabels } from '../../lib/permissions';
import { Card } from '../ui/Card';

/**
 * Who the signed-in member is and what the AxiomFlo API says they may access.
 * Shown on the real workspace's Settings page.
 */
export function RealWorkspaceNotice() {
  const session = useWorkspaceSession();
  if (session.mode !== 'real') return null;
  const { user, membership } = session;
  const teams = membership.teams ?? [];
  const isAdmin = membership.role === 'company_admin';

  return (
    <Card>
      <div className="px-6 py-6">
        <div className="flex flex-col items-center text-center">
          <DatabaseZap className="h-9 w-9 text-teal-700" aria-hidden />
          <h2 className="mt-4 text-lg font-semibold text-navy-900">Your workspace access is approved</h2>
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
      </div>
    </Card>
  );
}
