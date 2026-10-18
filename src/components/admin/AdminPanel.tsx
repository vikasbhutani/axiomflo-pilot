import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createAdminApi, type AdminApi, type InvitationView, type MemberChange, type MemberView } from '../../admin/adminApi';
import { useApiClient } from '../../auth/apiContext';
import type { TeamSummary } from '../../auth/types';
import { useToast } from '../../context/ToastContext';
import { roleLabels } from '../../lib/permissions';
import type { Role } from '../../types';
import { Card, CardHeader } from '../ui/Card';
import { SelectInput, TextField } from '../ui/FormFields';

const roleOptions = (Object.keys(roleLabels) as Role[]).map((r) => ({
  value: r,
  label: roleLabels[r],
}));
const expiryOptions = [7, 14, 30].map((d) => ({
  value: String(d),
  label: `${d} days`,
}));
const invitationStatusLabels: Record<InvitationView['status'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  revoked: 'Revoked',
  expired: 'Expired',
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Please try again.');

function teamNames(ids: string[], teams: TeamSummary[], role: Role): string {
  if (role === 'company_admin') return 'All teams';
  const names = ids.map((id) => teams.find((t) => t.id === id)?.name ?? id);
  return names.length ? names.join(', ') : 'None';
}

function TeamPicker({ teams, value, onChange, legend }: { teams: TeamSummary[]; value: string[]; onChange: (ids: string[]) => void; legend: string }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((t) => t !== id) : [...value, id]);
  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-medium text-slate-700">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {teams.map((t) => (
          <label key={t.id} className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={value.includes(t.id)} onChange={() => toggle(t.id)} className="rounded border-slate-300 text-teal-700 focus:ring-teal-600" />
            {t.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Admins see every team, so they have none assigned; individual users need at least one. */
function roleTeamsError(role: Role, teamIds: string[]): string | undefined {
  return role === 'individual_user' && teamIds.length === 0 ? 'Pick at least one team.' : undefined;
}

function InviteForm({ adminApi, teams, onCreated }: { adminApi: AdminApi; teams: TeamSummary[]; onCreated: () => void }) {
  const notify = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('individual_user');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [days, setDays] = useState('14');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const teamsError = touched ? roleTeamsError(role, teamIds) : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (roleTeamsError(role, teamIds)) return;
    setBusy(true);
    setError(null);
    try {
      const invitation = await adminApi.createInvitation({
        email: email.trim(),
        role,
        teamIds: role === 'company_admin' ? [] : teamIds,
        expiresInDays: Number(days),
      });
      notify(`Invitation for ${invitation.email} created. No email was sent: ask them to sign in to AxiomFlo with that address.`, 'success');
      setEmail('');
      setTeamIds([]);
      setTouched(false);
      onCreated();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-4" aria-label="Invite someone">
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Email" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        <SelectInput label="Role" value={role} onChange={(v) => setRole(v as Role)} options={roleOptions} />
        <SelectInput label="Expires after" value={days} onChange={setDays} options={expiryOptions} />
      </div>
      {role === 'individual_user' ? (
        <div>
          <TeamPicker legend="Teams" teams={teams} value={teamIds} onChange={setTeamIds} />
          {teamsError && <p className="mt-1 text-xs text-red-600">{teamsError}</p>}
        </div>
      ) : (
        <p className="text-xs text-slate-500">A Company Admin sees every team.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create invitation'}
        </button>
        <p className="text-xs text-slate-500">AxiomFlo doesn’t send invitation emails yet. Tell the person to sign in with this address.</p>
      </div>
    </form>
  );
}

function MemberRow({ member, isSelf, teams, onChange }: { member: MemberView; isSelf: boolean; teams: TeamSummary[]; onChange: (uid: string, change: MemberChange) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<Role>(member.role);
  const [teamIds, setTeamIds] = useState<string[]>(member.teamIds);
  const [busy, setBusy] = useState(false);
  const label = member.email ?? member.uid;
  const teamsError = roleTeamsError(role, teamIds);

  const act = async (change: MemberChange) => {
    setBusy(true);
    const ok = await onChange(member.uid, change);
    setBusy(false);
    if (ok) setEditing(false);
  };

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="break-words font-medium text-slate-900">
            {label}
            {isSelf && <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>}
          </p>
          <p className="text-slate-600">
            {roleLabels[member.role]} · {teamNames(member.teamIds, teams, member.role)} · {member.status === 'active' ? 'Active' : <span className="text-red-700">Suspended</span>}
          </p>
        </div>
        {!isSelf && !editing && (
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditing(true)} aria-label={`Change role or teams for ${label}`}>
              Change
            </button>
            {member.status === 'active' ? (
              <button type="button" className="btn-danger" disabled={busy} onClick={() => act({ status: 'suspended' })} aria-label={`Suspend ${label}`}>
                Suspend
              </button>
            ) : (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => act({ status: 'active' })} aria-label={`Reactivate ${label}`}>
                Reactivate
              </button>
            )}
          </div>
        )}
      </div>
      {editing && (
        <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="max-w-xs">
            <SelectInput label="Role" value={role} onChange={(v) => setRole(v as Role)} options={roleOptions} />
          </div>
          {role === 'individual_user' && (
            <div>
              <TeamPicker legend="Teams" teams={teams} value={teamIds} onChange={setTeamIds} />
              {teamsError && <p className="mt-1 text-xs text-red-600">{teamsError}</p>}
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={busy || !!teamsError} onClick={() => act(role === 'company_admin' ? { role, teamIds: [] } : { role, teamIds })}>
              Save
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setRole(member.role);
                setTeamIds(member.teamIds);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * The Company Admin's controls for members and invitations. Everything is checked
 * again by the API: hiding a button here is a convenience, not the protection.
 * Nothing is cached outside this component, so signing out clears it.
 */
export function AdminPanel({ currentUid, teams }: { currentUid: string; teams: TeamSummary[] }) {
  const api = useApiClient();
  const adminApi = useMemo(() => (api ? createAdminApi(api) : null), [api]);
  const notify = useToast();
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [invitations, setInvitations] = useState<InvitationView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!adminApi) return;
    setLoadError(null);
    try {
      const [m, i] = await Promise.all([adminApi.listMembers(), adminApi.listInvitations()]);
      setMembers(m);
      setInvitations(i);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [adminApi]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!adminApi) return null;

  const changeMember = async (uid: string, change: MemberChange) => {
    try {
      const updated = await adminApi.updateMember(uid, change);
      setMembers((list) => list?.map((m) => (m.uid === uid ? updated : m)) ?? null);
      notify(`Updated ${updated.email ?? 'member'}.`, 'success');
      return true;
    } catch (e) {
      notify(errorMessage(e), 'error');
      return false;
    }
  };

  const revoke = async (invitation: InvitationView) => {
    try {
      const updated = await adminApi.revokeInvitation(invitation.id);
      setInvitations((list) => list?.map((i) => (i.id === updated.id ? updated : i)) ?? null);
      notify(`Invitation for ${updated.email} revoked.`, 'success');
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  };

  if (loadError) {
    return (
      <Card className="mx-auto mt-6 max-w-3xl">
        <div className="px-5 py-6 text-center text-sm">
          <p className="text-red-700">Couldn’t load members and invitations. {loadError}</p>
          <button type="button" className="btn-secondary mt-3" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </Card>
    );
  }

  return (
    <div className="mx-auto mt-6 max-w-3xl space-y-6">
      <Card>
        <CardHeader title="Invite someone" description="They get access when they sign in with this email address and it’s verified." />
        <InviteForm adminApi={adminApi} teams={teams} onCreated={() => void load()} />
      </Card>

      <Card>
        <CardHeader title="Members" description="You can’t change your own role, teams or status. Ask another Company Admin." />
        {members === null ? (
          <p className="px-5 py-4 text-sm text-slate-500">Loading members…</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {members.map((m) => (
              <MemberRow key={`${m.uid}:${m.role}:${m.teamIds.join(',')}:${m.status}`} member={m} isSelf={m.uid === currentUid} teams={teams} onChange={changeMember} />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Invitations" />
        {invitations === null ? (
          <p className="px-5 py-4 text-sm text-slate-500">Loading invitations…</p>
        ) : invitations.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">No invitations yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="break-words font-medium text-slate-900">{i.email}</p>
                  <p className="text-slate-600">
                    {roleLabels[i.role]} · {teamNames(i.teamIds, teams, i.role)} · {invitationStatusLabels[i.status]}
                    {i.status === 'pending' && ` · expires ${new Date(i.expiresAt).toLocaleDateString()}`}
                  </p>
                  <p className="text-xs text-slate-500">{i.delivery}</p>
                </div>
                {i.status === 'pending' && (
                  <button type="button" className="btn-secondary" onClick={() => void revoke(i)} aria-label={`Revoke invitation for ${i.email}`}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
