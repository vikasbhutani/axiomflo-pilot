import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createKeysApi, type KeyView } from '../../admin/keysApi';
import { useApiClient } from '../../auth/apiContext';
import type { TeamSummary } from '../../auth/types';
import { useToast } from '../../context/ToastContext';
import { Card, CardHeader } from '../ui/Card';
import { SelectInput, TextField } from '../ui/FormFields';

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Please try again.');

/**
 * AxiomFlo keys for the gateway. A new key's full value is shown once, here, and is
 * kept only in this component's state: it disappears when dismissed or on sign-out,
 * and is never stored in the browser.
 */
export function KeysPanel({ currentUid, teams, isAdmin }: { currentUid: string; teams: TeamSummary[]; isAdmin: boolean }) {
  const api = useApiClient();
  const keysApi = useMemo(() => (api ? createKeysApi(api) : null), [api]);
  const notify = useToast();
  const [keys, setKeys] = useState<KeyView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!keysApi) return;
    setLoadError(null);
    try {
      setKeys(await keysApi.listKeys());
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [keysApi]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!keysApi) return null;
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? id;

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const created = await keysApi.createKey({ name: name.trim(), teamId });
      setNewSecret(created.secret);
      setCopied(false);
      setName('');
      setKeys((list) => [created.key, ...(list ?? [])]);
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (key: KeyView) => {
    try {
      const updated = await keysApi.revokeKey(key.id);
      setKeys((list) => list?.map((k) => (k.id === updated.id ? { ...k, ...updated, ownerEmail: k.ownerEmail } : k)) ?? null);
      notify(`Key “${updated.name}” revoked. It stops working immediately.`, 'success');
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(newSecret ?? '');
      setCopied(true);
    } catch {
      notify('Couldn’t copy automatically. Select the key and copy it by hand.', 'error');
    }
  };

  return (
    <Card className="mx-auto mt-6 max-w-3xl">
      <CardHeader title="AxiomFlo keys" description="Use a key in your AI tools instead of a provider key, so AxiomFlo can record usage for your team." />
      <div className="space-y-4 px-5 py-4">
        {newSecret && (
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-900">Copy your new key now. You won’t be able to see it again.</p>
            <code className="mt-2 block break-all rounded bg-white px-2 py-1 font-mono text-xs text-slate-900">{newSecret}</code>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy key'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setNewSecret(null)}>
                I’ve saved it
              </button>
            </div>
          </div>
        )}

        <form onSubmit={create} className="grid gap-4 sm:grid-cols-[1fr,1fr,auto] sm:items-end" aria-label="Create a key">
          <TextField label="Key name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My laptop" />
          <SelectInput label="Team" value={teamId} onChange={setTeamId} options={teams.map((t) => ({ value: t.id, label: t.name }))} />
          <button type="submit" className="btn-primary" disabled={busy || !teamId}>
            {busy ? 'Creating…' : 'Create key'}
          </button>
        </form>
        {formError && (
          <p role="alert" className="text-sm text-red-600">
            {formError}
          </p>
        )}
      </div>

      {loadError ? (
        <div className="border-t border-slate-100 px-5 py-4 text-sm">
          <p className="text-red-700">Couldn’t load keys. {loadError}</p>
          <button type="button" className="btn-secondary mt-2" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : keys === null ? (
        <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-500">Loading keys…</p>
      ) : keys.length === 0 ? (
        <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-500">No keys yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="break-words font-medium text-slate-900">
                  {k.name} <span className="font-mono text-xs font-normal text-slate-500">…{k.hint}</span>
                </p>
                <p className="text-slate-600">
                  {teamName(k.teamId)}
                  {isAdmin && k.ownerUid !== currentUid && ` · ${k.ownerEmail ?? k.ownerUid}`} · {k.status === 'active' ? 'Active' : <span className="text-red-700">Revoked</span>}
                </p>
              </div>
              {k.status === 'active' && (
                <button type="button" className="btn-secondary" onClick={() => void revoke(k)} aria-label={`Revoke key ${k.name}`}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
