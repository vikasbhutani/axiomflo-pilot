import type { ReactNode } from 'react';
import { AlertCircle, Info, Settings2 } from 'lucide-react';
import { useAppSettings } from '../../auth/settings';
import type { SignInError } from '../../auth/errors';
import { Logo } from '../layout/Logo';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/** Centered card on a light background, shared by the sign-in and access pages. */
export function AuthLayout({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <main id="main" className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex justify-center">
            <Logo tone="dark" />
          </div>
          <section aria-labelledby="auth-title" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h1 id="auth-title" className="text-xl font-semibold tracking-tight text-navy-900 sm:text-2xl">
              {title}
            </h1>
            {description && <p className="mt-2 text-sm text-slate-600">{description}</p>}
            <div className="mt-6">{children}</div>
          </section>
          <LegalLinks />
        </div>
      </main>
    </div>
  );
}

/** Terms and Privacy links. Until real pages exist they are shown as setup requirements, not as finished policies. */
export function LegalLinks() {
  const { termsUrl, privacyUrl } = useAppSettings();
  const item = (label: string, url: string | null) =>
    url ? (
      <a href={url} className="rounded text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700">
        {label}
      </a>
    ) : (
      <span className="text-slate-500">{label} (setup required: not published yet)</span>
    );
  return (
    <nav aria-label="Legal" className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
      {item('Terms of Service', termsUrl)}
      {item('Privacy Policy', privacyUrl)}
    </nav>
  );
}

/** Sign-in problems. A closed popup is shown calmly as information, not as an error. */
export function SignInMessage({ error }: { error: SignInError | null }) {
  if (!error) return null;
  if (error.kind === 'cancelled') {
    return (
      <p role="status" className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden /> {error.message}
      </p>
    );
  }
  return (
    <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden /> {error.message}
    </p>
  );
}

/** Shown when the Firebase web configuration hasn't been added yet. */
export function SetupRequiredNotice({ missing }: { missing: string[] }) {
  return (
    <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-medium">
        <Settings2 className="h-4 w-4" aria-hidden /> Google sign-in isn’t set up yet
      </p>
      <p className="mt-1">
        Add the Firebase web configuration to this app’s environment, then rebuild it. Missing:
      </p>
      <ul className="mt-1 list-disc pl-5 font-mono text-xs">
        {missing.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs">See “Google sign-in setup” in the README for step-by-step instructions.</p>
    </div>
  );
}

/** Small name/email block for the signed-in person. */
export function SignedInIdentity({ name, email }: { name: string | null; email: string | null }) {
  const label = name || email || 'Signed-in user';
  const initials = label
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-700 text-sm font-semibold text-white" aria-hidden>
        {initials}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{name || 'Name not shared'}</p>
        <p className="truncate text-sm text-slate-600">{email || 'Email not shared'}</p>
      </div>
    </div>
  );
}
