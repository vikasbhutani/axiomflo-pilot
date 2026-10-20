/** Confirms linking the person's Slack account, from the one-time link the Slack bot sent them. */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, MessageSquare } from 'lucide-react';
import { createSlackLinksApi } from '../../admin/slackLinksApi';
import { useApiClient } from '../../auth/apiContext';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/ui/Card';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { useAsync } from '../../hooks/useAsync';
import { useRealMember } from '../../reports/useRealReport';

export function SlackLinkPage() {
  const api = useApiClient();
  const slackApi = useMemo(() => (api ? createSlackLinksApi(api) : null), [api]);
  const { user } = useRealMember();
  const [params] = useSearchParams();
  const code = params.get('code') ?? '';
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = useAsync(async () => {
    if (!slackApi) throw new Error('AxiomFlo isn’t connected in this build.');
    if (!code) throw new Error('This Slack link isn’t valid. Message the AxiomFlo bot in Slack to get a new one.');
    return slackApi.peek(code);
  }, [slackApi, code, user.uid]);

  const confirm = async () => {
    if (!slackApi) return;
    setBusy(true);
    setError(null);
    try {
      await slackApi.link(code);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Link your Slack account" />
      <Card>
        <div className="mx-auto max-w-lg px-5 py-8 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-teal-50 text-teal-700">
            {done ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <MessageSquare className="h-5 w-5" aria-hidden />}
          </span>
          {pending.status === 'loading' && <LoadingState label="Checking your link…" />}
          {pending.status === 'error' && <ErrorState message={pending.error.message} />}
          {pending.status === 'success' && done && (
            <>
              <h2 className="mt-3 text-base font-semibold text-slate-900">Your Slack account is linked</h2>
              <p className="mt-1 text-sm text-slate-600">Go back to Slack and ask your question again. You can unlink any time in Settings.</p>
              <Link to="/settings?tab=integrations" className="btn-secondary mt-4">
                Go to Settings
              </Link>
            </>
          )}
          {pending.status === 'success' && !done && (
            <>
              <h2 className="mt-3 text-base font-semibold text-slate-900">Link Slack user {pending.data.slackName ?? 'unknown'} to {user.email ?? 'your account'}?</h2>
              <p className="mt-1 text-sm text-slate-600">
                After this, the AxiomFlo bot in Slack answers that Slack user with what you can see in AxiomFlo. Only continue if that Slack account is yours.
              </p>
              {!pending.data.emailMatches && (
                <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  This Slack account’s email doesn’t match the email you signed in with, so it can’t be linked. Sign in with the same email you use in Slack.
                </p>
              )}
              {error && (
                <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              )}
              <button type="button" className="btn-primary mt-4" onClick={confirm} disabled={busy || !pending.data.emailMatches}>
                {busy ? 'Linking…' : 'Link my Slack account'}
              </button>
            </>
          )}
        </div>
      </Card>
    </>
  );
}
