import { useCallback, useEffect, useMemo, useState } from 'react';
import { createAdminApi } from '../../admin/adminApi';
import { createSlackLinksApi, type SlackLinkView } from '../../admin/slackLinksApi';
import { useApiClient } from '../../auth/apiContext';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../lib/format';
import { Card, CardHeader } from '../ui/Card';

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** Linked Slack accounts: your own, or everyone's for a Company Admin, with Unlink. */
export function SlackLinksCard({ currentUid, isAdmin }: { currentUid: string; isAdmin: boolean }) {
  const api = useApiClient();
  const slackApi = useMemo(() => (api ? createSlackLinksApi(api) : null), [api]);
  const notify = useToast();
  const [links, setLinks] = useState<SlackLinkView[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slackApi || !api) return;
    try {
      setLinks(await slackApi.list());
      setError(null);
      if (isAdmin) {
        const members = await createAdminApi(api).listMembers();
        setNames(Object.fromEntries(members.map((m) => [m.uid, m.displayName || m.email || 'Unnamed member'])));
      }
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t load linked Slack accounts.'));
    }
  }, [slackApi, api, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const unlink = async (link: SlackLinkView) => {
    if (!slackApi) return;
    setBusy(link.id);
    try {
      await slackApi.unlink(link.id);
      notify(`Slack user ${link.slackName ?? link.slackUserId} unlinked. The bot stops answering them straight away.`, 'success');
      await load();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t unlink that account.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Slack"
        description={
          isAdmin
            ? 'Slack accounts linked to AxiomFlo members. The Slack bot answers each one with what that member can see.'
            : 'Message the AxiomFlo bot in Slack to link your account. It answers you with what you can see here.'
        }
      />
      <div className="px-5 py-4 text-sm">
        {error && (
          <p role="alert" className="mb-3 text-red-700">
            {error}
          </p>
        )}
        {links === null && !error && <p className="text-slate-500">Loading…</p>}
        {links?.length === 0 && <p className="text-slate-600">{isAdmin ? 'No Slack accounts are linked yet.' : 'Your Slack account isn’t linked.'}</p>}
        {links && links.length > 0 && (
          <ul className="divide-y divide-slate-100" aria-label="Linked Slack accounts">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{l.slackName ?? l.slackUserId}</p>
                  <p className="text-xs text-slate-500">
                    {l.uid === currentUid ? 'You' : (names[l.uid] ?? 'Another member')} · linked {formatDateTime(l.linkedAt)}
                  </p>
                </div>
                <button type="button" className="btn-secondary" onClick={() => unlink(l)} disabled={busy === l.id} aria-label={`Unlink Slack user ${l.slackName ?? l.slackUserId}`}>
                  {busy === l.id ? 'Unlinking…' : 'Unlink'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
