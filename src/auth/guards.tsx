/**
 * Route guards. These decide which SCREEN to show; they are not security on their own.
 * Real company data must also be protected by the backend on every API request.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { FullPageStatus } from '../components/auth/FullPageStatus';
import { useAuth } from './AuthContext';
import { useDemoSession } from './demoSession';
import { destinationFor, loginPathFor } from './redirects';
import { WorkspaceSessionContext } from './WorkspaceSession';
import type { AuthStatus } from './types';

const CHECKING = 'Checking your access…';

/**
 * Wraps the workspace pages. Only an approved membership opens the real workspace;
 * otherwise only an explicitly chosen demo session shows sample data.
 *
 * The `key` on each provider throws away all page state (filters, assistant
 * conversations, open drawers) whenever the person or mode changes, e.g. on sign-out.
 */
export function RequireWorkspace({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const { demoActive } = useDemoSession();
  const location = useLocation();

  if (state.status === 'initializing' || state.status === 'membership_loading') return <FullPageStatus label={CHECKING} />;

  if (state.status === 'approved') {
    return (
      <WorkspaceSessionContext.Provider key={`real:${state.user.uid}`} value={{ mode: 'real', user: state.user, membership: state.membership }}>
        {children}
      </WorkspaceSessionContext.Provider>
    );
  }

  if (demoActive) {
    return (
      <WorkspaceSessionContext.Provider key="demo" value={{ mode: 'demo' }}>
        {children}
      </WorkspaceSessionContext.Provider>
    );
  }

  if (state.status === 'signed_out' || state.status === 'config_missing') {
    const justSignedOut = state.status === 'signed_out' && state.reason === 'signed_out';
    return <Navigate to={justSignedOut ? '/login' : loginPathFor(location.pathname + location.search + location.hash)} replace />;
  }
  return <Navigate to={destinationFor(state) ?? '/login'} replace />;
}

/**
 * For the sign-in and access pages: shows the page only in the states listed in
 * `allow`, and otherwise sends the person to the page that fits their state.
 */
export function AuthStatusRoute({ allow, children }: { allow: AuthStatus[]; children: ReactNode }) {
  const { state } = useAuth();
  const [params] = useSearchParams();

  if (allow.includes(state.status)) return <>{children}</>;
  const destination = destinationFor(state, params.get('returnTo') ?? '/');
  if (!destination) return <FullPageStatus label={CHECKING} />;
  return <Navigate to={destination} replace />;
}
