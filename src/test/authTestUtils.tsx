/**
 * Test helpers: a fake Firebase sign-in client, so tests never need real Google
 * accounts, credentials or network access.
 */
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import type { AppSettings } from '../auth/config';
import type { MembershipService } from '../auth/membershipService';
import { AppSettingsProvider } from '../auth/settings';
import type { AuthClient, AuthUser, Membership } from '../auth/types';
import { DemoProvider } from '../context/DemoContext';
import { ToastProvider } from '../context/ToastContext';

export const alice: AuthUser = { uid: 'uid-alice', displayName: 'Alice Example', email: 'alice@example.com', emailVerified: true };
export const bob: AuthUser = { uid: 'uid-bob', displayName: 'Bob Example', email: 'bob@example.com', emailVerified: true };
/** Signed up with email/password and hasn't clicked the verification link yet. */
export const carol: AuthUser = { uid: 'uid-carol', displayName: 'Carol Example', email: 'carol@example.com', emailVerified: false };

export function membershipFor(user: AuthUser, overrides: Partial<Membership> = {}): Membership {
  return { userId: user.uid, companyId: 'co-real', companyName: 'Real Co', role: 'individual_user', teamIds: ['team-1'], status: 'active', ...overrides };
}

/** Shows the current address so tests can check where they ended up. */
function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

/** A stand-in for Firebase Authentication that tests drive by hand. */
export class FakeAuthClient implements AuthClient {
  private listener: ((user: AuthUser | null) => void) | null = null;
  signInWithGoogle = vi.fn<(options?: { selectAccount?: boolean }) => Promise<void>>(async () => {});
  signInWithEmail = vi.fn<(email: string, password: string) => Promise<void>>(async () => {});
  signUpWithEmail = vi.fn<(email: string, password: string, displayName?: string) => Promise<void>>(async () => {});
  sendPasswordReset = vi.fn<(email: string) => Promise<void>>(async () => {});
  sendVerificationEmail = vi.fn(async () => {});
  reloadUser = vi.fn<() => Promise<AuthUser | null>>(async () => null);
  signOut = vi.fn(async () => this.emit(null));
  getIdToken = vi.fn(async () => 'fake-id-token');

  /** `initialUser` undefined means Firebase hasn't finished restoring the session yet. */
  constructor(private initialUser?: AuthUser | null) {}

  onAuthStateChanged(callback: (user: AuthUser | null) => void) {
    this.listener = callback;
    if (this.initialUser !== undefined) queueMicrotask(() => callback(this.initialUser!));
    return () => {
      this.listener = null;
    };
  }

  emit(user: AuthUser | null) {
    this.listener?.(user);
  }
}

/** A membership service backed by a simple map from Firebase UID to membership. */
export function fakeMembershipService(memberships: Record<string, Membership | null> = {}): MembershipService & { getMembership: ReturnType<typeof vi.fn> } {
  return { getMembership: vi.fn(async (user: AuthUser) => memberships[user.uid] ?? null) };
}

export const testSettings: AppSettings = { demoEnabled: true, termsUrl: null, privacyUrl: null, apiBaseUrl: null };

export function renderApp({
  path = '/',
  client = new FakeAuthClient(null),
  membershipService = fakeMembershipService(),
  missingConfig,
  settings = testSettings,
}: {
  path?: string;
  client?: AuthClient | null;
  membershipService?: MembershipService;
  missingConfig?: string[];
  settings?: AppSettings;
} = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppSettingsProvider value={settings}>
        <AuthProvider client={client} missingConfig={missingConfig} membershipService={membershipService}>
          <DemoProvider>
            <ToastProvider>
              <App />
              <LocationDisplay />
            </ToastProvider>
          </DemoProvider>
        </AuthProvider>
      </AppSettingsProvider>
    </MemoryRouter>,
  );
}
