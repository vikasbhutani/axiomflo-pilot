import { CheckCircle2 } from 'lucide-react';
import { useWorkspaceSession } from '../../auth/WorkspaceSession';
import { roleLabels } from '../../lib/permissions';
import { ProfileSummary } from '../settings/ProfileSummary';

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
    <ProfileSummary
      name={user.displayName || user.email || 'You'}
      email={user.email ?? undefined}
      role={roleLabels[membership.role]}
      badge={
        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Access approved
        </span>
      }
      facts={[
        { label: 'Company', value: membership.companyName ?? 'Your company' },
        {
          label: isAdmin ? 'Teams (all)' : 'Your teams',
          value:
            teams.length === 0 ? (
              <span className="text-slate-500">No teams assigned yet</span>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {teams.map((t) => (
                  <li key={t.id} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                    {t.name} <span className="font-mono text-[11px] text-slate-500">{t.code}</span>
                  </li>
                ))}
              </ul>
            ),
        },
      ]}
    />
  );
}
