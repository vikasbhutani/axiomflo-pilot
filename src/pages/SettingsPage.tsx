import { useState } from 'react';
import { Building2, FlaskConical, History, Lock, RotateCcw } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/Modal';
import { TextField } from '../components/ui/FormFields';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { useDemo } from '../context/DemoContext';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import { getAuditEvents, getLookups, resetDemoWorkspace, saveCompanyName, ValidationError } from '../services/mockService';
import { can, roleLabels } from '../lib/permissions';
import { clearPreferences } from '../lib/storage';
import { formatDateTime } from '../lib/format';
import { TableScroll } from '../components/ui/TableScroll';
import { UrlTabs, type TabItem } from '../components/ui/Tabs';
import { ProfileSummary } from '../components/settings/ProfileSummary';

export function SettingsPage() {
  const { workspace, currentUser, role, userContext, dataVersion, setRole, setPeriod } = useDemo();
  const notify = useToast();
  const isAdmin = can(userContext, 'manage_teams');
  const [companyName, setCompanyName] = useState(workspace.companyName);
  const [companyError, setCompanyError] = useState<string>();
  const [savingName, setSavingName] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [lastVersion, setLastVersion] = useState(dataVersion);
  if (dataVersion !== lastVersion) {
    // Keep the field in sync after a reset or another edit.
    setLastVersion(dataVersion);
    setCompanyName(workspace.companyName);
  }

  const team = getLookups().teams.find((t) => t.id === currentUser.teamId);

  const saveName = async () => {
    setSavingName(true);
    setCompanyError(undefined);
    try {
      await saveCompanyName(companyName, userContext);
      notify('Company name saved in the demo workspace.', 'success');
    } catch (e) {
      setCompanyError(e instanceof ValidationError ? e.fieldErrors.name : e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSavingName(false);
    }
  };

  const tabs: TabItem[] = [
    {
      id: 'company',
      label: 'Company',
      icon: Building2,
      content: (
        <Card className="max-w-3xl">
          <CardHeader title="Company" description={isAdmin ? 'Only the company name can change in the pilot.' : 'Managed by a Company Admin.'} />
          <form
            className="space-y-5 px-5 py-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <TextField label="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} error={companyError} disabled={!isAdmin} readOnly={!isAdmin} maxLength={100} autoComplete="organization" />
              </div>
              {isAdmin && (
                <button type="submit" className="btn-primary sm:mt-6" disabled={savingName || companyName.trim() === workspace.companyName}>
                  Save company name
                </button>
              )}
            </div>
            <div className="rounded-lg border border-slate-200">
              <dl className="grid divide-y divide-slate-100 text-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <Detail label="Reporting currency" value="AUD (Australian dollar)" />
                <Detail label="Reporting timezone" value="Australia/Sydney" />
                <Detail label="Department" value={workspace.departmentName} />
              </dl>
              <p className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden /> Fixed for the pilot. The timezone sets the edges of daily and monthly totals.
              </p>
            </div>
          </form>
        </Card>
      ),
    },
    ...(isAdmin ? [{ id: 'audit', label: 'Audit events', icon: History, content: <AuditLogCard /> }] : []),
    {
      id: 'demo',
      label: 'Demo data',
      icon: FlaskConical,
      content: (
        <Card className="max-w-3xl">
          <CardHeader title={<span className="text-red-700">Danger zone</span>} description="Start over with the original sample workspace" />
          <div className="flex flex-col gap-4 px-5 py-5 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl">Resetting restores team names, people, provider connections, the company name and the audit log, and clears saved preferences such as the selected role and period. Usage records are sample data and never change.</p>
            <button type="button" className="btn-danger shrink-0" onClick={() => setConfirmReset(true)}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Reset demo data
            </button>
          </div>
        </Card>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Settings" breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'Settings' }]} description="Workspace details, your profile and demo controls." />
      <ProfileSummary
        name={currentUser.name}
        email={currentUser.email}
        role={roleLabels[role]}
        badge={<span className="text-xs text-slate-500">Demo persona · switch with “View as” in the top bar</span>}
        facts={[
          { label: 'Title', value: currentUser.title },
          { label: 'Team', value: team ? `${team.name} (${team.code})` : 'Not assigned' },
        ]}
      />
      <UrlTabs label="Settings sections" tabs={tabs} />

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        tone="danger"
        title="Reset demo data?"
        confirmLabel="Reset"
        description={<p>All simulated changes made in this browser will be lost. This only affects the demo workspace on this device.</p>}
        onConfirm={async () => {
          await resetDemoWorkspace();
          clearPreferences();
          setRole('company_admin');
          setPeriod(workspace.defaultPeriod);
          notify('Demo data reset to the original sample workspace.', 'success');
        }}
      />
    </>
  );
}

function AuditLogCard() {
  const { userContext, dataVersion } = useDemo();
  const state = useAsync(() => getAuditEvents(userContext), [userContext.userId, userContext.role, dataVersion]);
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            <History className="h-4 w-4 text-slate-400" aria-hidden /> Audit events
          </span>
        }
        description="Simulated admin actions in this demo workspace, newest first"
      />
      {state.status === 'error' ? (
        <ErrorState message={state.error.message} onRetry={state.reload} />
      ) : !state.data ? (
        <LoadingState />
      ) : state.data.length === 0 ? (
        <EmptyState title="No audit events yet" />
      ) : (
        <TableScroll label="Audit events table">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="whitespace-nowrap bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">When</th>
                <th scope="col" className="px-3 py-2 font-medium">Who</th>
                <th scope="col" className="px-3 py-2 font-medium">Action</th>
                <th scope="col" className="px-5 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state.data.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-slate-600">{formatDateTime(e.at)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-800">{e.actorName}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-800">{e.action}</td>
                  <td className="px-5 py-2.5 text-slate-600">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-900">{value}</dd>
    </div>
  );
}
