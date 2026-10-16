import { Link } from 'react-router-dom';
import { AuthEntry } from './AuthEntry';

const linkClass = 'rounded font-medium text-teal-800 hover:text-teal-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700';

export function LoginPage() {
  return (
    <AuthEntry
      title="Welcome back to AxiomFlo"
      description="Understand your company’s AI usage and costs."
      buttonLabel="Continue with Google"
      footer={
        <>
          New to AxiomFlo?{' '}
          <Link to="/signup" className={linkClass}>
            Sign up
          </Link>
        </>
      }
    />
  );
}

export function SignupPage() {
  return (
    <AuthEntry
      title="Get started with AxiomFlo"
      description="Sign up with Google to request access to the pilot."
      buttonLabel="Sign up with Google"
      footer={
        <>
          Already have access?{' '}
          <Link to="/login" className={linkClass}>
            Log in
          </Link>
        </>
      }
    >
      <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Company access needs approval</p>
        <p className="mt-1">
          Signing up confirms who you are with Google. It doesn’t give you access to any company’s data: an AxiomFlo administrator has to add you to your company’s workspace first.
        </p>
      </div>
    </AuthEntry>
  );
}
