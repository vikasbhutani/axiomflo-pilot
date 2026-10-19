/**
 * Types for real Google sign-in (Firebase Authentication) and AxiomFlo membership.
 *
 * Two separate ideas live here:
 * - Google identity (`AuthUser`): WHO the person is, confirmed by Google via Firebase.
 * - AxiomFlo membership (`Membership`): WHICH company, teams and role they may access.
 *   Only a trusted backend may say a membership is active. Signing in never creates one.
 */
import type { Role } from '../types';

/** The few profile fields the UI needs. Never holds tokens or credentials. */
export interface AuthUser {
  /** Firebase user ID (UID). The stable key a backend should use for membership. */
  uid: string;
  displayName: string | null;
  email: string | null;
  /** Whether the email address has been confirmed (Google does this; email/password users click a link). */
  emailVerified: boolean;
}

export type MembershipStatus = 'active' | 'pending' | 'suspended';

/** A team the member may see, as returned by the AxiomFlo API. */
export interface TeamSummary {
  id: string;
  name: string;
  code: string;
}

export interface Membership {
  /** Firebase UID this membership belongs to. */
  userId: string;
  companyId: string;
  /** Display name of the company, if the backend provides it. */
  companyName?: string;
  role: Role;
  teamIds: string[];
  /** The teams this member may see (all teams for a Company Admin), when the API provides them. */
  teams?: TeamSummary[];
  status: MembershipStatus;
  /** A view-only login: the API refuses every change it tries to make. */
  readOnly?: boolean;
}

/**
 * Every state the sign-in flow can be in. Pages and route guards switch on `status`
 * so nothing protected renders while we are still finding out who someone is.
 */
export type AuthState =
  /** Firebase web configuration is missing, so Google sign-in can't start. */
  | { status: 'config_missing'; missing: string[] }
  /** Firebase is restoring a previous session (e.g. after a page refresh). */
  | { status: 'initializing' }
  /** `reason: 'signed_out'` means the person just clicked Sign out. */
  | { status: 'signed_out'; reason?: 'signed_out' }
  /** Signed in with email/password, but the email address isn't confirmed yet. No membership is checked. */
  | { status: 'verification_required'; user: AuthUser }
  /** Signed in; asking the membership service what they may access. */
  | { status: 'membership_loading'; user: AuthUser }
  | { status: 'approved'; user: AuthUser; membership: Membership }
  /** Signed in, but no approved membership (none exists, or it awaits approval). */
  | { status: 'pending'; user: AuthUser; membership: Membership | null }
  /** Signed in, but the membership is suspended or the person is not authorized. */
  | { status: 'denied'; user: AuthUser }
  /** Signed in, but the membership check failed (e.g. network). Can be retried. */
  | { status: 'error'; user: AuthUser; message: string };

export type AuthStatus = AuthState['status'];

/**
 * The small surface of Firebase Authentication the app uses. Production code gets
 * the Firebase implementation (`firebaseClient.ts`); tests pass a fake.
 */
export interface AuthClient {
  /** Calls back with the current user now and whenever they sign in or out. Returns an unsubscribe function. */
  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void;
  /** Opens the Google sign-in popup. Must be called directly from a click handler. */
  signInWithGoogle(options?: { selectAccount?: boolean }): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  /** Creates an email/password account and sends the verification email. */
  signUpWithEmail(email: string, password: string, displayName?: string): Promise<void>;
  /** Sends a password reset email. Resolves the same way whether or not the account exists. */
  sendPasswordReset(email: string): Promise<void>;
  sendVerificationEmail(): Promise<void>;
  /** Fetches the latest profile (e.g. after the person clicks the verification link). */
  reloadUser(): Promise<AuthUser | null>;
  signOut(): Promise<void>;
  /**
   * A Firebase ID token for the signed-in user, or null when signed out. Never log or store it.
   * `forceRefresh` asks Firebase for a brand-new token (used once after a 401).
   */
  getIdToken(forceRefresh?: boolean): Promise<string | null>;
}
