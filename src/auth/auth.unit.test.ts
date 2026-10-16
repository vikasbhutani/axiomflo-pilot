import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, NotSignedInError } from './api';
import { readAppSettings, readFirebaseConfig } from './config';
import { describeSignInError } from './errors';
import { createHttpMembershipService, noBackendMembershipService, parseMembership } from './membershipService';
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
  it('gives nobody a membership while there is no backend', async () => {
    expect(await noBackendMembershipService.getMembership(user)).toBeNull();
  });

  it('reads membership from the backend and rejects malformed answers', async () => {
    const good = { userId: 'u1', companyId: 'c1', role: 'company_admin', teamIds: [], status: 'active' };
    const api = { fetch: vi.fn(async () => new Response(JSON.stringify(good))) };
    expect(await createHttpMembershipService(api).getMembership(user)).toMatchObject(good);
    expect(() => parseMembership({ ...good, role: 'super_admin' })).toThrow();
    api.fetch.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await createHttpMembershipService(api).getMembership(user)).toBeNull();
    api.fetch.mockResolvedValueOnce(new Response('', { status: 500 }));
    await expect(createHttpMembershipService(api).getMembership(user)).rejects.toThrow();
  });
});

describe('Firebase client', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('firebase/auth');
    vi.doUnmock('firebase/firestore');
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

  it('reads only the signed-in person’s own membership document from Firestore', async () => {
    const getDoc = vi.fn();
    const docFn = vi.fn((_db: unknown, ...path: string[]) => path.join('/'));
    vi.doMock('firebase/firestore', () => ({ getFirestore: () => ({}), doc: docFn, getDoc }));
    const { createFirestoreMembershipService } = await import('./membershipService');
    const service = createFirestoreMembershipService({} as never);

    getDoc.mockResolvedValueOnce({ exists: () => false });
    expect(await service.getMembership(user)).toBeNull();
    expect(docFn).toHaveBeenCalledWith(expect.anything(), 'memberships', 'u1');

    getDoc.mockResolvedValueOnce({ exists: () => true, id: 'u1', data: () => ({ userId: 'someone-else', companyId: 'c1', role: 'individual_user', teamIds: ['t1'], status: 'active' }) });
    expect(await service.getMembership(user)).toMatchObject({ userId: 'u1', role: 'individual_user', status: 'active' });

    getDoc.mockResolvedValueOnce({ exists: () => true, id: 'u1', data: () => ({ companyId: 'c1', role: 'owner', teamIds: [], status: 'active' }) });
    await expect(service.getMembership(user)).rejects.toThrow();
  });
});
