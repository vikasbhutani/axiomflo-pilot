/** Settings for a real workspace: your access, exchange rates, members (admins) and AxiomFlo keys. */
import { PageHeader } from '../../components/layout/PageHeader';
import { AdminPanel } from '../../components/admin/AdminPanel';
import { RealWorkspaceNotice } from '../../components/auth/RealWorkspaceNotice';
import { KeysPanel } from '../../components/keys/KeysPanel';
import { useRealMember } from '../../reports/useRealReport';
import { ExchangeRatesCard } from './ExchangeRatesCard';

export function RealSettingsPage() {
  const { user, teams, isAdmin } = useRealMember();
  return (
    <>
      <PageHeader title="Settings" description={isAdmin ? 'Your access, exchange rates, members and AxiomFlo keys.' : 'Your access and your AxiomFlo keys.'} />
      <div className="space-y-6">
        <RealWorkspaceNotice />
        <ExchangeRatesCard isAdmin={isAdmin} />
        {/* Keyed by user, so a different admin signing in never sees the previous one's data. */}
        {isAdmin && <AdminPanel key={user.uid} currentUid={user.uid} teams={teams} />}
        <KeysPanel key={`keys-${user.uid}`} currentUid={user.uid} teams={teams} isAdmin={isAdmin} />
      </div>
    </>
  );
}
