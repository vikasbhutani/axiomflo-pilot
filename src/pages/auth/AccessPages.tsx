import { LogOut, RefreshCw, UserRoundPlus } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useSignOutAndLeave } from '../../auth/useSignOutAndLeave';
import { AuthLayout, SignedInIdentity, SignInMessage } from '../../components/auth/AuthLayout';
import { DemoEntry } from './AuthEntry';

function AccountActions() {
  const { signIn, signingIn, signInError } = useAuth();
  const signOut = useSignOutAndLeave();
  return (
    <>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn-secondary flex-1" onClick={() => signIn({ selectAccount: true })} disabled={signingIn} aria-busy={signingIn || undefined}>
          <UserRoundPlus className="h-4 w-4" aria-hidden /> {signingIn ? 'Waiting for Google…' : 'Use another Google account'}
        </button>
        <button type="button" className="btn-secondary flex-1" onClick={signOut.run}>
          <LogOut className="h-4 w-4" aria-hidden /> Sign out
        </button>
      </div>
      <SignInMessage error={signInError} />
      {signOut.failed && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          We couldn’t sign you out. Check your connection and try again.
        </p>
      )}
    </>
  );
}

/** Signed in with Google, but no approved AxiomFlo membership (or the check failed). */
export function AccessPendingPage() {
  const { state, retryMembership } = useAuth();
  if (state.status !== 'pending' && state.status !== 'error') return null;
  const { user } = state;

  if (state.status === 'error') {
    return (
      <AuthLayout title="We couldn’t check your access" description={state.message}>
        <SignedInIdentity name={user.displayName} email={user.email} />
        <button type="button" className="btn-primary mt-6 w-full" onClick={retryMembership}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Try again
        </button>
        <AccountActions />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Access pending" description="You’re signed in, but you haven’t been assigned to an AxiomFlo workspace yet.">
      <SignedInIdentity name={user.displayName} email={user.email} />
      <p className="mt-4 text-sm text-slate-600">
        {state.membership
          ? 'Your AxiomFlo membership is waiting for an administrator to approve it.'
          : 'If you expected access, ask your company’s AxiomFlo administrator to invite this email address, then sign out and sign in again.'}
      </p>
      <p className="mt-3 text-sm text-slate-600">
        Your AxiomFlo user ID: <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">{user.uid}</code>
      </p>
      <AccountActions />
      <DemoEntry />
    </AuthLayout>
  );
}

/** Signed in, but the membership is suspended or not authorized. Shows no company details. */
export function AccessDeniedPage() {
  const { state } = useAuth();
  if (state.status !== 'denied') return null;
  return (
    <AuthLayout title="You don’t have access to AxiomFlo" description="Your AxiomFlo membership is disabled, or this account isn’t authorized to use the workspace.">
      <SignedInIdentity name={state.user.displayName} email={state.user.email} />
      <p className="mt-4 text-sm text-slate-600">If you think this is a mistake, contact your company’s AxiomFlo administrator.</p>
      <AccountActions />
    </AuthLayout>
  );
}
