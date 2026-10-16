import { useState } from 'react';
import { Building2, Info, Lock, Mail, MoreHorizontal, Pencil, UserPlus } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { InfoTooltip } from '../components/ui/InfoTooltip';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { SelectInput, TextField } from '../components/ui/FormFields';
import { ErrorState, LoadingState } from '../components/ui/States';
import { useDemo } from '../context/DemoContext';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import {
  changeUserTeam,
  getLookups,
  getTeams,
  inviteUser,
  isDemoPersona,
  renameTeam,
  setUserStatus,
  ValidationError,
  type InviteInput,
  type TeamMember,
  type TeamOverview,
} from '../services/mockService';
import { roleLabels } from '../lib/permissions';
import { glossary } from '../lib/glossary';
import { formatCurrency, formatNumber, formatPeriod } from '../lib/format';
import type { Role, Team, UserStatus } from '../types';

const statusStyles: Record<UserStatus, string> = {
  active: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  invited: 'bg-sky-50 text-sky-800 ring-sky-200',
  suspended: 'bg-slate-100 text-slate-600 ring-slate-300',
};
const statusLabels: Record<UserStatus, string> = { active: 'Active', invited: 'Invited (demo)', suspended: 'Suspended' };

type PendingAction = { kind: 'move'; member: TeamMember } | { kind: 'status'; member: TeamMember; next: 'active' | 'suspended' } | null;

export function TeamsPage() {
  const { userContext, period, dataVersion } = useDemo();
  const notify = useToast();
  const state = useAsync(() => getTeams(period, userContext), [period, userContext.userId, userContext.role, dataVersion]);
  const [renaming, setRenaming] = useState<Team | null>(null);
  const [inviting, setInviting] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const [moveTarget, setMoveTarget] = useState('');

  const canManage = state.data?.canManage ?? false;

  return (
    <>
      <PageHeader
        title="Teams & Users"
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'Teams & Users' }]}
        description={`Teams, usage codes and members. Request counts and estimated spend are for ${formatPeriod(period)}.`}
        actions={
          canManage && (
            <button type="button" className="btn-primary" onClick={() => setInviting(true)}>
              <UserPlus className="h-4 w-4" aria-hidden /> Invite user
            </button>
          )
        }
      />

      {state.status === 'error' ? (
        <Card>
          <ErrorState message={state.error.message} onRetry={state.reload} />
        </Card>
      ) : !state.data ? (
        <Card>
          <LoadingState />
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="flex flex-wrap items-center gap-4 px-5 py-4">
            <span className="rounded-lg bg-slate-100 p-2.5 text-slate-600">
              <Building2 className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Department</p>
              <p className="text-base font-semibold text-slate-900">{state.data.departmentName}</p>
            </div>
            <p className="max-w-md text-xs text-slate-500">
              This pilot has one department with two teams. Adding companies, departments or teams isn’t available in this version.
            </p>
          </Card>

          {!canManage && (
            <p className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              You can see your own team. Team names, members and invitations are managed by a Company Admin.
            </p>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            {state.data.teams.map((t) => (
              <TeamCard
                key={t.team.id}
                data={t}
                canManage={canManage}
                currentUserId={userContext.userId}
                onRename={() => setRenaming(t.team)}
                onMove={(member) => {
                  setMoveTarget(getLookups().teams.find((x) => x.id !== member.teamId)?.id ?? member.teamId);
                  setPending({ kind: 'move', member });
                }}
                onStatus={(member, next) => setPending({ kind: 'status', member, next })}
              />
            ))}
          </div>
        </div>
      )}

      <RenameTeamDialog team={renaming} onClose={() => setRenaming(null)} />
      <InviteUserDialog open={inviting} onClose={() => setInviting(false)} />

      <ConfirmDialog
        open={pending?.kind === 'move'}
        onClose={() => setPending(null)}
        title="Change team?"
        confirmLabel="Change team"
        description={
          pending?.kind === 'move' && (
            <div className="space-y-3">
              <p>
                Move <strong className="text-slate-900">{pending.member.name}</strong> to another team. Their future requests will use the new team’s usage code.
              </p>
              <SelectInput
                label="New team"
                value={moveTarget}
                onChange={setMoveTarget}
                options={getLookups()
                  .teams.filter((t) => t.id !== pending.member.teamId)
                  .map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))}
              />
              <p className="text-xs text-slate-500">Past requests keep the team code they were made under, so historical showback doesn’t change.</p>
            </div>
          )
        }
        onConfirm={async () => {
          if (pending?.kind !== 'move') return;
          await changeUserTeam(pending.member.id, moveTarget, userContext);
          notify(`${pending.member.name} moved. This is a simulated change in the demo workspace.`, 'success');
        }}
      />

      <ConfirmDialog
        open={pending?.kind === 'status'}
        onClose={() => setPending(null)}
        tone={pending?.kind === 'status' && pending.next === 'suspended' ? 'danger' : 'default'}
        title={pending?.kind === 'status' && pending.next === 'suspended' ? 'Suspend user?' : 'Reactivate user?'}
        confirmLabel={pending?.kind === 'status' && pending.next === 'suspended' ? 'Suspend' : 'Reactivate'}
        description={
          pending?.kind === 'status' &&
          (pending.next === 'suspended' ? (
            <p>
              <strong className="text-slate-900">{pending.member.name}</strong> would lose access to AxiomFlo. Their past requests stay in reports. In this demo nothing is actually revoked.
            </p>
          ) : (
            <p>
              <strong className="text-slate-900">{pending.member.name}</strong> would regain access to AxiomFlo (simulated).
            </p>
          ))
        }
        onConfirm={async () => {
          if (pending?.kind !== 'status') return;
          await setUserStatus(pending.member.id, pending.next, userContext);
          notify(`${pending.member.name} ${pending.next === 'suspended' ? 'suspended' : 'reactivated'} (simulated).`, 'success');
        }}
      />
    </>
  );
}

function TeamCard({
  data,
  canManage,
  currentUserId,
  onRename,
  onMove,
  onStatus,
}: {
  data: TeamOverview;
  canManage: boolean;
  currentUserId: string;
  onRename: () => void;
  onMove: (member: TeamMember) => void;
  onStatus: (member: TeamMember, next: 'active' | 'suspended') => void;
}) {
  const { team, members, summary } = data;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-slate-900">{team.name}</h2>
            {canManage && (
              <button type="button" onClick={onRename} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600" aria-label={`Rename ${team.name}`}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
          <p className="mt-1 inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
            <Lock className="h-3 w-3 text-slate-400" aria-hidden />
            {team.code}
            <span className="sr-only">(read-only usage code)</span>
          </p>
          <span className="ml-1.5 align-middle">
            <InfoTooltip text={`${glossary.teamCode} Codes are read-only in the pilot so historical attribution stays clear.`} label="About team codes" />
          </span>
        </div>
        <dl className="grid grid-cols-3 gap-4 text-right">
          <div>
            <dt className="text-xs text-slate-500">Members</dt>
            <dd className="text-sm font-semibold tabular-nums text-slate-900">{formatNumber(members.length)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Requests</dt>
            <dd className="text-sm font-semibold tabular-nums text-slate-900">{formatNumber(summary.requestCount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Est. spend</dt>
            <dd className="text-sm font-semibold tabular-nums text-slate-900">{formatCurrency(summary.estimatedSpend)}</dd>
          </div>
        </dl>
      </div>
      {!canManage && <p className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-xs text-slate-500">Request count and spend above cover your own requests only.</p>}
      <ul className="divide-y divide-slate-100">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">
                {m.name}
                {m.id === currentUserId && <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>}
              </p>
              <p className="truncate text-xs text-slate-500">
                {m.email} · {roleLabels[m.role]}
              </p>
            </div>
            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[m.status]}`}>{statusLabels[m.status]}</span>
            <span className="w-20 text-right text-xs tabular-nums text-slate-500">{canManage || m.id === currentUserId ? `${formatNumber(m.requestCount)} req.` : '—'}</span>
            {canManage && <MemberActions member={m} onMove={() => onMove(m)} onStatus={(next) => onStatus(m, next)} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MemberActions({ member, onMove, onStatus }: { member: TeamMember; onMove: () => void; onStatus: (next: 'active' | 'suspended') => void }) {
  const [open, setOpen] = useState(false);
  const persona = isDemoPersona(member.id);
  const close = () => setOpen(false);
  return (
    <div className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${member.name}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg">
          {persona ? (
            <p className="px-3 py-2 text-xs text-slate-500">This person is a demo persona used by the role switcher, so their team and status can’t be changed.</p>
          ) : (
            <>
              <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none" onClick={() => { close(); onMove(); }}>
                Change team…
              </button>
              {member.status === 'suspended' ? (
                <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none" onClick={() => { close(); onStatus('active'); }}>
                  Reactivate…
                </button>
              ) : (
                <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-red-700 hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none" onClick={() => { close(); onStatus('suspended'); }}>
                  Suspend…
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RenameTeamDialog({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const { userContext } = useDemo();
  const notify = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [lastTeamId, setLastTeamId] = useState<string | null>(null);
  if (team && team.id !== lastTeamId) {
    setLastTeamId(team.id);
    setName(team.name);
    setError(undefined);
  }
  if (!team && lastTeamId !== null) setLastTeamId(null);

  const save = async () => {
    if (!team) return;
    setBusy(true);
    try {
      await renameTeam(team.id, name, userContext);
      notify('Team renamed. This is a simulated change saved in your browser.', 'success');
      onClose();
    } catch (e) {
      setError(e instanceof ValidationError ? e.fieldErrors.name : e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={team !== null}
      onClose={onClose}
      title="Rename team"
      description={team && <>The usage code <span className="font-mono">{team.code}</span> stays the same.</>}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="rename-team-form" className="btn-primary" disabled={busy}>
            Save name
          </button>
        </>
      }
    >
      <form
        id="rename-team-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <TextField label="Team name" value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={80} data-autofocus autoComplete="off" />
      </form>
    </Modal>
  );
}

const emptyInvite: InviteInput = { name: '', email: '', role: 'individual_user', teamId: 'team-platform' };

function InviteUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { userContext } = useDemo();
  const notify = useToast();
  const [form, setForm] = useState<InviteInput>(emptyInvite);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const close = () => {
    setForm(emptyInvite);
    setErrors({});
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    try {
      const user = await inviteUser(form, userContext);
      notify(`${user.name} added as invited. No email was sent: invitations are simulated in the demo.`, 'success');
      close();
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fieldErrors);
      else notify(e instanceof Error ? e.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof InviteInput>(key: K, value: InviteInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite user"
      description={
        <span className="inline-flex items-start gap-1.5">
          <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Demo only: no real email is sent. The person appears as “Invited” in this browser.
        </span>
      }
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" form="invite-form" className="btn-primary" disabled={busy}>
            Add invitation
          </button>
        </>
      }
    >
      <form
        id="invite-form"
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField label="Full name" value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name || undefined} autoComplete="off" data-autofocus />
        <TextField label="Work email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} error={errors.email || undefined} autoComplete="off" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectInput
            label="Role"
            value={form.role}
            onChange={(v) => set('role', v as Role)}
            error={errors.role || undefined}
            options={(Object.keys(roleLabels) as Role[]).map((r) => ({ value: r, label: roleLabels[r] }))}
          />
          <SelectInput label="Team" value={form.teamId} onChange={(v) => set('teamId', v)} error={errors.teamId || undefined} options={getLookups().teams.map((t) => ({ value: t.id, label: t.name }))} />
        </div>
      </form>
    </Modal>
  );
}
