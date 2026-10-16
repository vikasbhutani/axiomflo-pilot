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
  signInWithEmail: (email: string, password: string) => void;
  /** Creates an email/password account; Firebase then emails a verification link. */
  signUpWithEmail: (email: string, password: string, displayName?: string) => void;
  /** Sends a reset link. Rejects with a friendly SignInError. */
  sendPasswordReset: (email: string) => Promise<void>;
  /** Re-sends the verification link. Rejects with a friendly SignInError. */
  resendVerification: () => Promise<void>;
  /** Re-reads the account after the person clicks the link. Resolves true once verified. */
  checkVerification: () => Promise<boolean>;
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
        if (user.emailVerified) {
          void loadMembership(user);
        } else {
          // An unconfirmed email could belong to someone else, so no membership is looked up yet.
          lookupId.current++;
          setState({ status: 'verification_required', user });
        }
      } else {
        lookupId.current++;
        setState({ status: 'signed_out', reason: explicitSignOut.current ? 'signed_out' : undefined });
      }
    });
  }, [client, loadMembership]);

  /** Runs one sign-in attempt at a time and turns failures into friendly messages. */
  const runSignIn = useCallback(
    (attempt: (client: AuthClient) => Promise<void>) => {
      if (!client || signingInRef.current) return;
      signingInRef.current = true;
      setSigningIn(true);
      setSignInError(null);
      // No `await` before this call: Google's popup must open in the same click.
      attempt(client)
        .catch((error: unknown) => setSignInError(describeSignInError(error)))
        .finally(() => {
          signingInRef.current = false;
          setSigningIn(false);
        });
    },
    [client],
  );

  const signIn = useCallback((options?: { selectAccount?: boolean }) => runSignIn((c) => c.signInWithGoogle(options)), [runSignIn]);
  const signInWithEmail = useCallback((email: string, password: string) => runSignIn((c) => c.signInWithEmail(email, password)), [runSignIn]);
  const signUpWithEmail = useCallback(
    (email: string, password: string, displayName?: string) => runSignIn((c) => c.signUpWithEmail(email, password, displayName)),
    [runSignIn],
  );

  const sendPasswordReset = useCallback(
    async (email: string) => {
      if (!client) return;
      try {
        await client.sendPasswordReset(email);
      } catch (error) {
        // "No such account" is not revealed, so nobody can probe which emails are registered.
        if ((error as { code?: unknown })?.code === 'auth/user-not-found') return;
        throw describeSignInError(error);
      }
    },
    [client],
  );

  const resendVerification = useCallback(async () => {
    if (!client) return;
    try {
      await client.sendVerificationEmail();
    } catch (error) {
      throw describeSignInError(error);
    }
  }, [client]);

  const checkVerification = useCallback(async () => {
    if (!client) return false;
    const user = await client.reloadUser();
    if (!user?.emailVerified) return false;
    currentUser.current = user;
    void loadMembership(user);
    return true;
  }, [client, loadMembership]);

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
    () => ({
      state,
      signingIn,
      signInError,
      clearSignInError: () => setSignInError(null),
      signIn,
      signInWithEmail,
      signUpWithEmail,
      sendPasswordReset,
      resendVerification,
      checkVerification,
      signOut,
      retryMembership,
      getIdToken,
    }),
    [state, signingIn, signInError, signIn, signInWithEmail, signUpWithEmail, sendPasswordReset, resendVerification, checkVerification, signOut, retryMembership, getIdToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
