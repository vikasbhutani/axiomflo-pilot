/** Settings for a real workspace: your access, then tabs for members (admins), keys and Slack, and exchange rates. */
import { Coins, KeyRound, Users } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { AdminPanel } from '../../components/admin/AdminPanel';
import { RealWorkspaceNotice } from '../../components/auth/RealWorkspaceNotice';
import { KeysPanel } from '../../components/keys/KeysPanel';
import { SlackLinksCard } from '../../components/slack/SlackLinksCard';
import { UrlTabs, type TabItem } from '../../components/ui/Tabs';
import { useRealMember } from '../../reports/useRealReport';
import { ExchangeRatesCard } from './ExchangeRatesCard';

export function RealSettingsPage() {
  const { user, teams, isAdmin } = useRealMember();
  const tabs: TabItem[] = [
    // Keyed by user, so a different admin signing in never sees the previous one's data.
    ...(isAdmin ? [{ id: 'members', label: 'Members', icon: Users, content: <AdminPanel key={user.uid} currentUid={user.uid} teams={teams} /> }] : []),
    {
      id: 'integrations',
      label: 'Keys & Slack',
      icon: KeyRound,
      content: (
        <div className="space-y-6">
          <KeysPanel key={`keys-${user.uid}`} currentUid={user.uid} teams={teams} isAdmin={isAdmin} />
          <SlackLinksCard key={`slack-${user.uid}`} currentUid={user.uid} isAdmin={isAdmin} />
        </div>
      ),
    },
    { id: 'rates', label: 'Exchange rates', icon: Coins, content: <ExchangeRatesCard isAdmin={isAdmin} /> },
  ];
  return (
    <>
      <PageHeader title="Settings" description={isAdmin ? 'Your access, members, AxiomFlo keys and exchange rates.' : 'Your access, your AxiomFlo keys and exchange rates.'} />
      <RealWorkspaceNotice />
      <UrlTabs label="Settings sections" tabs={tabs} />
    </>
  );
}
