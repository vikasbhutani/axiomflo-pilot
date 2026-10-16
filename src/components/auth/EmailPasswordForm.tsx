import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { TextField } from '../ui/FormFields';

const MIN_PASSWORD = 8;

/**
 * Email and password sign-in (mode "login") or account creation (mode "signup").
 * The password goes straight to Firebase Authentication; AxiomFlo never stores it.
 */
export function EmailPasswordForm({ mode, disabled }: { mode: 'login' | 'signup'; disabled?: boolean }) {
  const { signInWithEmail, signUpWithEmail, signingIn } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<{ field: 'email' | 'password'; message: string } | null>(null);
  const isSignup = mode === 'signup';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return setProblem({ field: 'email', message: 'Enter a valid email address.' });
    if (!password) return setProblem({ field: 'password', message: 'Enter your password.' });
    if (isSignup && password.length < MIN_PASSWORD) return setProblem({ field: 'password', message: `Use at least ${MIN_PASSWORD} characters.` });
    setProblem(null);
    if (isSignup) signUpWithEmail(trimmed, password, name.trim() || undefined);
    else signInWithEmail(trimmed, password);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label={isSignup ? 'Sign up with email' : 'Log in with email'}>
      {isSignup && <TextField label="Full name (optional)" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} />}
      <TextField
        label="Work email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={problem?.field === 'email' ? problem.message : undefined}
        disabled={disabled}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete={isSignup ? 'new-password' : 'current-password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={isSignup ? `At least ${MIN_PASSWORD} characters.` : undefined}
        error={problem?.field === 'password' ? problem.message : undefined}
        disabled={disabled}
      />
      {!isSignup && (
        <p className="text-right text-sm">
          <Link to="/reset-password" className="rounded font-medium text-teal-800 hover:text-teal-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700">
            Forgot password?
          </Link>
        </p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={disabled || signingIn} aria-busy={signingIn || undefined}>
        {signingIn ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}
      </button>
    </form>
  );
}

export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-500" aria-hidden>
      <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}
