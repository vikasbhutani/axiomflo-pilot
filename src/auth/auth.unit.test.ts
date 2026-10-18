import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, NotSignedInError } from './api';
import { readAppSettings, readFirebaseConfig } from './config';
import { describeSignInError } from './errors';
import { createHttpMembershipService, noBackendMembershipService, parseMeResponse } from './membershipService';
import { destinationFor, loginPathFor, safeReturnTo } from './redirects';

const user = { uid: 'u1', displayName: 'A', email: 'a@example.com', emailVerified: true };

describe('safeReturnTo', () => {
  it.each([
    ['/usage', '/usage'],
    ['/usage?team=t1#x', '/usage?team=t1#x'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example/path', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/\tevil', '/'],
    ['/login', '/'],
    ['/access-pending', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it('builds login links that come back to the page', () => {
    expect(loginPathFor('/usage')).toBe('/login?returnTo=%2Fusage');
    expect(loginPathFor('/')).toBe('/login');
  });

  it('never sends a signed-in person without membership into the app', () => {
    expect(destinationFor({ status: 'pending', user, membership: null }, '/teams')).toBe('/access-pending');
    expect(destinationFor({ status: 'denied', user }, '/teams')).toBe('/access-denied');
    expect(destinationFor({ status: 'initializing' })).toBeNull();
    expect(destinationFor({ status: 'verification_required', user: { ...user, emailVerified: false } }, '/teams')).toBe('/verify-email');
  });
});

describe('describeSignInError', () => {
  it('treats a closed popup as a cancellation', () => {
    expect(describeSignInError({ code: 'auth/popup-closed-by-user' }, 'x').kind).toBe('cancelled');
    expect(describeSignInError({ code: 'auth/cancelled-popup-request' }, 'x').kind).toBe('cancelled');
  });

  it('explains when Firebase Authentication was never set up', () => {
    expect(describeSignInError({ code: 'auth/configuration-not-found' }, 'x').kind).toBe('auth_not_set_up');
  });

  it('gives one message for a wrong email or password, so accounts can’t be probed', () => {
    const a = describeSignInError({ code: 'auth/user-not-found' }, 'x');
    const b = describeSignInError({ code: 'auth/wrong-password' }, 'x');
    const c = describeSignInError({ code: 'auth/invalid-credential' }, 'x');
    expect(a.message).toBe(b.message);
    expect(b.message).toBe(c.message);
  });

  it('names the hostname that needs authorizing', () => {
    expect(describeSignInError({ code: 'auth/unauthorized-domain' }, 'axiomflo-abc.a.run.app').message).toContain('axiomflo-abc.a.run.app');
  });

  it('never shows details from unknown errors', () => {
    const error = describeSignInError({ code: 'auth/weird', customData: { _tokenResponse: { idToken: 'secret' } } }, 'x');
    expect(error.kind).toBe('unknown');
    expect(error.message).not.toContain('secret');
  });
});

describe('configuration', () => {
  it('lists every missing Firebase variable', () => {
    expect(readFirebaseConfig({ VITE_FIREBASE_API_KEY: 'k' }).missing).toEqual(['VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']);
  });

  it('returns the config when everything is present', () => {
    const env = { VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_AUTH_DOMAIN: 'p.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'p', VITE_FIREBASE_APP_ID: '1:2:web:3' };
    expect(readFirebaseConfig(env)).toEqual({ config: { apiKey: 'k', authDomain: 'p.firebaseapp.com', projectId: 'p', appId: '1:2:web:3' }, missing: [] });
  });

  it('only accepts https or same-site legal links', () => {
    expect(readAppSettings({ VITE_TERMS_URL: 'javascript:alert(1)', VITE_PRIVACY_URL: 'https://example.com/p' })).toMatchObject({ termsUrl: null, privacyUrl: 'https://example.com/p' });
    expect(readAppSettings({}).demoEnabled).toBe(true);
    expect(readAppSettings({ VITE_DEMO_MODE: 'disabled' }).demoEnabled).toBe(false);
  });
});

describe('createApiClient', () => {
  it('sends the ID token as a bearer header, never in the URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const api = createApiClient({ baseUrl: 'https://api.example.com', getIdToken: async () => 'tok', fetchImpl });
    await api.fetch('/v1/thing?x=1');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/thing?x=1');
    expect(url).not.toContain('tok');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('refuses plain http except on localhost', async () => {
    const fetchImpl = vi.fn();
    await expect(createApiClient({ baseUrl: 'http://api.example.com', getIdToken: async () => 'tok', fetchImpl }).fetch('/x')).rejects.toThrow(/HTTPS/);
    await expect(createApiClient({ baseUrl: 'https://api.example.com', getIdToken: async () => 'tok', fetchImpl }).fetch('//evil.example/x')).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses to call the API when signed out', async () => {
    await expect(createApiClient({ baseUrl: 'https://api.example.com', getIdToken: async () => null, fetchImpl: vi.fn() }).fetch('/x')).rejects.toBeInstanceOf(NotSignedInError);
  });
});

describe('membership services', () => {
  const me = {
    user: { uid: 'u1', email: 'a@example.com', emailVerified: true, displayName: 'A' },
    access: 'active',
    company: { id: 'c1', name: 'Co', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' },
    membership: { role: 'company_admin', teamIds: [] },
    teams: [{ id: 't1', name: 'Team 1', code: 'T-1', departmentId: 'd1', status: 'active' }],
  };

  it('gives nobody a membership while there is no backend', async () => {
    expect(await noBackendMembershipService.getMembership(user)).toBeNull();
  });

  it('reads an active membership from GET /api/me', async () => {
    const api = { fetch: vi.fn(async () => new Response(JSON.stringify(me))) };
    expect(await createHttpMembershipService(api).getMembership(user)).toEqual({
      userId: 'u1',
      companyId: 'c1',
      companyName: 'Co',
      role: 'company_admin',
      teamIds: [],
      teams: [{ id: 't1', name: 'Team 1', code: 'T-1' }],
      status: 'active',
    });
    expect(api.fetch).toHaveBeenCalledWith('/api/me', expect.anything());
  });

  it('maps pending to no membership and suspended to a suspended membership', () => {
    expect(parseMeResponse({ user: me.user, access: 'pending', reason: 'no_membership' })).toBeNull();
    expect(parseMeResponse({ user: me.user, access: 'suspended', reason: 'company_suspended' })).toMatchObject({ status: 'suspended' });
  });

  it('rejects malformed answers rather than guessing', () => {
    expect(() => parseMeResponse({ ...me, membership: { role: 'super_admin', teamIds: [] } })).toThrow();
    expect(() => parseMeResponse({ ...me, access: 'approved' })).toThrow();
    expect(() => parseMeResponse({ ...me, user: undefined })).toThrow();
    expect(() => parseMeResponse({ ...me, teams: 'all' })).toThrow();
  });

  it('treats any error status, including 403 and 503, as a failed lookup, never as access', async () => {
    for (const status of [401, 403, 404, 500, 503]) {
      const api = { fetch: vi.fn(async () => new Response('{}', { status })) };
      await expect(createHttpMembershipService(api).getMembership(user)).rejects.toThrow();
    }
  });
});

describe('createApiClient token refresh', () => {
  it('refreshes the token and retries exactly once after a 401', async () => {
    const getIdToken = vi.fn(async (force?: boolean) => (force ? 'fresh' : 'stale'));
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    const res = await createApiClient({ baseUrl: 'https://api.example.com', getIdToken, fetchImpl }).fetch('/api/me');
    expect(res.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(getIdToken.mock.calls).toEqual([[false], [true]]);
    const second = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(new Headers(second[1].headers).get('Authorization')).toBe('Bearer fresh');
  });

  it('never retries a 403 and sends no cookies', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403 }));
    await createApiClient({ baseUrl: 'https://api.example.com', getIdToken: async () => 'tok', fetchImpl }).fetch('/api/me');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].credentials).toBe('omit');
  });
});

describe('Firebase client', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('firebase/auth');
  });

  function mockAuth() {
    const fns = {
      setCustomParameters: vi.fn(),
      addScope: vi.fn(),
      signInWithPopup: vi.fn(async () => ({ user: {} })),
      createUserWithEmailAndPassword: vi.fn(async () => ({ user: { uid: 'new' } })),
      updateProfile: vi.fn(async () => {}),
      sendEmailVerification: vi.fn(async () => {}),
      signInWithEmailAndPassword: vi.fn(async () => ({})),
      sendPasswordResetEmail: vi.fn(async () => {}),
    };
    vi.doMock('firebase/auth', () => ({
      getAuth: () => ({ currentUser: null, useDeviceLanguage: vi.fn() }),
      GoogleAuthProvider: class {
        setCustomParameters = fns.setCustomParameters;
        addScope = fns.addScope;
      },
      onAuthStateChanged: vi.fn(),
      signOut: vi.fn(),
      ...fns,
    }));
    return fns;
  }

  it('uses a Google popup with no extra scopes, and the account chooser on request', async () => {
    const fns = mockAuth();
    const { createFirebaseAuthClient } = await import('./firebaseClient');
    const client = createFirebaseAuthClient({} as never);
    await client.signInWithGoogle();
    expect(fns.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(fns.setCustomParameters).not.toHaveBeenCalled();
    await client.signInWithGoogle({ selectAccount: true });
    expect(fns.setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' });
    expect(fns.addScope).not.toHaveBeenCalled();
    expect(await client.getIdToken()).toBeNull();
  });

  it('creates email accounts with a name and sends the verification email', async () => {
    const fns = mockAuth();
    const { createFirebaseAuthClient } = await import('./firebaseClient');
    const client = createFirebaseAuthClient({} as never);
    await client.signUpWithEmail('a@example.com', 'long-password', 'Ann');
    expect(fns.createUserWithEmailAndPassword).toHaveBeenCalledWith(expect.anything(), 'a@example.com', 'long-password');
    expect(fns.updateProfile).toHaveBeenCalledWith({ uid: 'new' }, { displayName: 'Ann' });
    expect(fns.sendEmailVerification).toHaveBeenCalledWith({ uid: 'new' });
  });
});
