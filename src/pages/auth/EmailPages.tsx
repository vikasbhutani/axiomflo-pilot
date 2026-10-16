import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, LogOut, MailCheck, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import type { SignInError } from '../../auth/errors';
import { useSignOutAndLeave } from '../../auth/useSignOutAndLeave';
import { AuthLayout, SignedInIdentity, SignInMessage } from '../../components/auth/AuthLayout';
import { TextField } from '../../components/ui/FormFields';

const linkClass = 'rounded font-medium text-teal-800 hover:text-teal-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700';

function asSignInError(error: unknown): SignInError {
  return error && typeof error === 'object' && 'kind' in error ? (error as SignInError) : { kind: 'unknown', message: 'Something went wrong. Please try again.' };
}

/** /reset-password: Firebase emails a link to choose a new password. */
export function ResetPasswordPage() {
  const { state, sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<SignInError | null>(null);
  const configMissing = state.status === 'config_missing';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return setError({ kind: 'invalid_email', message: 'Enter a valid email address.' });
    setBusy(true);
    setError(null);
    try {
      await sendPasswordReset(trimmed);
      setSent(true);
    } catch (err) {
      setError(asSignInError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Reset your password" description="Enter the email you signed up with and we’ll send you a link to choose a new password.">
      {sent ? (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          If an AxiomFlo account uses that email, a reset link is on its way. Check your inbox and spam folder.
        </p>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-3">
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={configMissing} />
          <button type="submit" className="btn-primary w-full" disabled={busy || configMissing} aria-busy={busy || undefined}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <SignInMessage error={error} />
      <p className="mt-6 text-center text-sm text-slate-600">
        <Link to="/login" className={linkClass}>
          Back to log in
        </Link>
      </p>
    </AuthLayout>
  );
}

/** /verify-email: email/password accounts confirm their address before any access check. */
export function VerifyEmailPage() {
  const { state, resendVerification, checkVerification } = useAuth();
  const signOut = useSignOutAndLeave();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [notYet, setNotYet] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<SignInError | null>(null);
  if (state.status !== 'verification_required') return null;
  const { user } = state;

  const check = async () => {
    setChecking(true);
    setNotYet(false);
    setError(null);
    try {
      const verified = await checkVerification();
      if (verified) navigate('/', { replace: true });
      else setNotYet(true);
    } catch (err) {
      setError(asSignInError(err));
    } finally {
      setChecking(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      await resendVerification();
      setResent(true);
    } catch (err) {
      setError(asSignInError(err));
    }
  };

  return (
    <AuthLayout title="Confirm your email" description={`We sent a confirmation link to ${user.email ?? 'your email address'}. Click it, then come back here.`}>
      <SignedInIdentity name={user.displayName} email={user.email} />
      <button type="button" className="btn-primary mt-6 w-full" onClick={check} disabled={checking} aria-busy={checking || undefined}>
        <RefreshCw className="h-4 w-4" aria-hidden /> {checking ? 'Checking…' : 'I’ve confirmed my email'}
      </button>
      {notYet && (
        <p role="status" className="mt-4 text-sm text-slate-700">
          Your email isn’t confirmed yet. Open the link in the email we sent, then try again.
        </p>
      )}
      {resent && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-emerald-800">
          <MailCheck className="h-4 w-4" aria-hidden /> We sent a new link. Check your inbox and spam folder.
        </p>
      )}
      <SignInMessage error={error} />
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn-secondary flex-1" onClick={resend}>
          <MailCheck className="h-4 w-4" aria-hidden /> Resend email
        </button>
        <button type="button" className="btn-secondary flex-1" onClick={signOut.run}>
          <LogOut className="h-4 w-4" aria-hidden /> Sign out
        </button>
      </div>
    </AuthLayout>
  );
}
