import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { demoSession } from './demoSession';
import { describeSignInError, type SignInError } from './errors';
import type { MembershipService } from './membershipService';
import type { AuthClient, AuthState, AuthUser, Membership } from './types';

interface AuthContextValue {
  state: AuthState;
  /** True while the Google popup is open. Extra clicks are ignored meanwhile. */
  signingIn: boolean;
  /** The last sign-in problem, already turned into a friendly message. */
  signInError: SignInError | null;
  clearSignInError: () => void;
  /** Opens the Google popup. Call it directly from a click handler, or browsers may block the popup. */
  signIn: (options?: { selectAccount?: boolean }) => void;
  signOut: () => Promise<void>;
  /** Asks the membership service again after a failed lookup. */
  retryMembership: () => void;
  /** A Firebase ID token for calls to the AxiomFlo backend. Never log or store it. */
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function stateForMembership(user: AuthUser, membership: Membership | null): AuthState {
  if (!membership) return { status: 'pending', user, membership: null };
  if (membership.userId !== user.uid) {
    return { status: 'error', user, message: 'The membership returned for this account didn’t match who is signed in.' };
  }
  if (membership.status === 'active') return { status: 'approved', user, membership };
  if (membership.status === 'pending') return { status: 'pending', user, membership };
  return { status: 'denied', user };
}

const MEMBERSHIP_ERROR = 'We couldn’t check your AxiomFlo access just now. Check your connection and try again.';

/**
 * Tracks the Google sign-in session (via Firebase) and the person's AxiomFlo membership.
 * Pass `client={null}` with `missingConfig` when Firebase isn't configured: the app then
 * shows setup instructions instead of crashing or pretending someone signed in.
 */
export function AuthProvider({
  client,
  missingConfig = [],
  membershipService,
  children,
}: {
  client: AuthClient | null;
  missingConfig?: string[];
  membershipService: MembershipService;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>(() => (client ? { status: 'initializing' } : { status: 'config_missing', missing: missingConfig }));
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<SignInError | null>(null);
  const signingInRef = useRef(false);
  const explicitSignOut = useRef(false);
  // Each lookup gets a number so a slow, outdated answer can't overwrite a newer one.
  const lookupId = useRef(0);
  const currentUser = useRef<AuthUser | null>(null);

  const loadMembership = useCallback(
    async (user: AuthUser) => {
      const id = ++lookupId.current;
      setState({ status: 'membership_loading', user });
      try {
        const membership = await membershipService.getMembership(user);
        if (id === lookupId.current) setState(stateForMembership(user, membership));
      } catch {
        if (id === lookupId.current) setState({ status: 'error', user, message: MEMBERSHIP_ERROR });
      }
    },
    [membershipService],
  );

  useEffect(() => {
    if (!client) return;
    return client.onAuthStateChanged((user) => {
      currentUser.current = user;
      if (user) {
        explicitSignOut.current = false;
        setSignInError(null);
        void loadMembership(user);
      } else {
        lookupId.current++;
        setState({ status: 'signed_out', reason: explicitSignOut.current ? 'signed_out' : undefined });
      }
    });
  }, [client, loadMembership]);

  const signIn = useCallback(
    (options?: { selectAccount?: boolean }) => {
      if (!client || signingInRef.current) return;
      signingInRef.current = true;
      setSigningIn(true);
      setSignInError(null);
      // No `await` before this call: the popup must open in the same click.
      client
        .signInWithGoogle(options)
        .catch((error: unknown) => setSignInError(describeSignInError(error)))
        .finally(() => {
          signingInRef.current = false;
          setSigningIn(false);
        });
    },
    [client],
  );

  const signOut = useCallback(async () => {
    if (!client) return;
    explicitSignOut.current = true;
    demoSession.exit();
    await client.signOut();
    currentUser.current = null;
    lookupId.current++;
    setSignInError(null);
    setState({ status: 'signed_out', reason: 'signed_out' });
  }, [client]);

  const retryMembership = useCallback(() => {
    if (currentUser.current) void loadMembership(currentUser.current);
  }, [loadMembership]);

  const getIdToken = useCallback(async () => (client ? client.getIdToken() : null), [client]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, signingIn, signInError, clearSignInError: () => setSignInError(null), signIn, signOut, retryMembership, getIdToken }),
    [state, signingIn, signInError, signIn, signOut, retryMembership, getIdToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
