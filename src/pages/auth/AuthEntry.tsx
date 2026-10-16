import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useDemoSession } from '../../auth/demoSession';
import { AuthLayout, SetupRequiredNotice, SignInMessage } from '../../components/auth/AuthLayout';
import { GoogleButton } from '../../components/auth/GoogleButton';

/** Shared body of /login and /signup. Both start the same Google sign-in flow. */
export function AuthEntry({ title, description, buttonLabel, children, footer }: { title: string; description: string; buttonLabel: string; children?: ReactNode; footer: ReactNode }) {
  const { state, signIn, signingIn, signInError } = useAuth();
  const missing = state.status === 'config_missing' ? state.missing : null;

  return (
    <AuthLayout title={title} description={description}>
      {missing && <SetupRequiredNotice missing={missing} />}
      {children}
      <GoogleButton label={buttonLabel} onClick={() => signIn()} busy={signingIn} disabled={!!missing} />
      <SignInMessage error={signInError} />
      <p className="mt-6 text-center text-sm text-slate-600">{footer}</p>
      <DemoEntry />
    </AuthLayout>
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
