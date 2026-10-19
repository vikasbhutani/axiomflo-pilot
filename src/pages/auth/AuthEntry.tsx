import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, FlaskConical } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useDemoSession } from '../../auth/demoSession';
import { useAppSettings } from '../../auth/settings';
import { AuthLayout, SetupRequiredNotice, SignInMessage } from '../../components/auth/AuthLayout';
import { EmailPasswordForm, OrDivider } from '../../components/auth/EmailPasswordForm';
import { GoogleButton } from '../../components/auth/GoogleButton';

/** Shared body of /login and /signup: Google, or email and password. */
export function AuthEntry({ mode, title, description, buttonLabel, children, footer }: { mode: 'login' | 'signup'; title: string; description: string; buttonLabel: string; children?: ReactNode; footer: ReactNode }) {
  const { state, signIn, signingIn, signInError } = useAuth();
  const missing = state.status === 'config_missing' ? state.missing : null;

  return (
    <AuthLayout title={title} description={description}>
      {missing && <SetupRequiredNotice missing={missing} />}
      {children}
      {mode === 'login' && !missing && <JudgeLogin />}
      <GoogleButton label={buttonLabel} onClick={() => signIn()} busy={signingIn} disabled={!!missing} />
      <OrDivider />
      <EmailPasswordForm mode={mode} disabled={!!missing} />
      <SignInMessage error={signInError} />
      <p className="mt-6 text-center text-sm text-slate-600">{footer}</p>
      <DemoEntry />
    </AuthLayout>
  );
}

/** The public view-only judge login, when one is configured. It can only read the workspace. */
export function JudgeLogin() {
  const { judgeLogin } = useAppSettings();
  const { signInWithEmail, signingIn } = useAuth();
  if (!judgeLogin) return null;
  return (
    <section aria-labelledby="judge-login-title" className="mb-5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-slate-700">
      <h2 id="judge-login-title" className="flex items-center gap-1.5 font-medium text-slate-900">
        <Eye className="h-4 w-4 text-sky-800" aria-hidden /> AI Builder Cup judges
      </h2>
      <p className="mt-1">View-only access to the live workspace. Browse every page and ask the assistant; nothing can be changed.</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
        <dt className="text-slate-500">Email</dt>
        <dd className="select-all break-all text-slate-900">{judgeLogin.email}</dd>
        <dt className="text-slate-500">Password</dt>
        <dd className="select-all break-all text-slate-900">{judgeLogin.password}</dd>
      </dl>
      <button type="button" className="btn-primary mt-3 w-full" disabled={signingIn} aria-busy={signingIn || undefined} onClick={() => signInWithEmail(judgeLogin.email, judgeLogin.password)}>
        Sign in as judge
      </button>
    </section>
  );
}

/** Optional way into the sample-data demo. It never signs anyone in. */
export function DemoEntry() {
  const { demoAvailable, enterDemo } = useDemoSession();
  const navigate = useNavigate();
  if (!demoAvailable) return null;
  return (
    <div className="mt-6 border-t border-slate-100 pt-5 text-center">
      <button
        type="button"
        onClick={() => {
          enterDemo();
          navigate('/');
        }}
        className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-teal-800 hover:text-teal-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
      >
        <FlaskConical className="h-4 w-4" aria-hidden /> Explore the demo workspace
      </button>
      <p className="mt-1 text-xs text-slate-500">Sample data only. No sign-in needed.</p>
    </div>
  );
}
