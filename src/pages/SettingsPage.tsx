import { useState } from 'react';
import { History, Lock, RotateCcw } from 'lucide-react';
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

  return (
    <>
      <PageHeader title="Settings" breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'Settings' }]} description="Workspace details, your profile and demo controls." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Company" description={isAdmin ? 'Reporting settings are fixed for the pilot.' : 'Managed by a Company Admin.'} />
          <form
            className="space-y-4 px-5 py-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <TextField label="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} error={companyError} disabled={!isAdmin} readOnly={!isAdmin} maxLength={100} autoComplete="organization" />
            <ReadOnlyField label="Reporting currency" value="AUD (Australian dollar)" note="Read-only in the pilot." />
            <ReadOnlyField label="Reporting timezone" value="Australia/Sydney" note="Used for daily and monthly totals. Read-only in the pilot." />
            <ReadOnlyField label="Department" value={workspace.departmentName} />
            {isAdmin && (
              <div className="flex justify-end">
                <button type="submit" className="btn-primary" disabled={savingName || companyName.trim() === workspace.companyName}>
                  Save company name
                </button>
              </div>
            )}
          </form>
        </Card>

        <Card>
          <CardHeader title="Your profile" description="Demo persona for the selected role" />
          <dl className="grid gap-4 px-5 py-5 text-sm sm:grid-cols-2">
            <Detail label="Name" value={currentUser.name} />
            <Detail label="Email" value={currentUser.email} />
            <Detail label="Role" value={roleLabels[role]} />
            <Detail label="Team" value={team ? `${team.name} (${team.code})` : 'Not assigned'} />
            <Detail label="Title" value={currentUser.title} />
            <Detail label="Sign-in" value="Not available in the demo" />
          </dl>
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Use the “View as” selector in the top bar to switch between the Company Admin and Individual User personas.</p>
        </Card>

        <Card>
          <CardHeader title="Demo data" description="Start over with the original sample workspace" />
          <div className="space-y-3 px-5 py-5 text-sm text-slate-600">
            <p>Resetting restores team names, people, provider connections, the company name and the audit log, and clears saved preferences such as the selected role and period. Usage records are sample data and never change.</p>
            <button type="button" className="btn-secondary" onClick={() => setConfirmReset(true)}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Reset demo data
            </button>
          </div>
        </Card>

        {isAdmin ? <AuditLogCard /> : null}
      </div>

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
    <Card className="lg:col-span-2">
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

function ReadOnlyField({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">{label}</p>
      <p className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
        {value}
      </p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-900">{value}</dd>
    </div>
  );
}
