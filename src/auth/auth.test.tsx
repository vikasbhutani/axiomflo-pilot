import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './api';
import { AuthProvider } from './AuthContext';
import { demoSession } from './demoSession';
import { RequireWorkspace } from './guards';
import { alice, bob, carol, FakeAuthClient, fakeMembershipService, membershipFor, renderApp, testSettings } from '../test/authTestUtils';
import { createHttpMembershipService, type MembershipService } from './membershipService';

beforeAll(() => {
  // Charts on the demo pages measure their container; jsdom has no layout engine.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  demoSession.exit();
  window.localStorage.clear();
});

const location = () => screen.getByTestId('location').textContent;

describe('protected workspace pages', () => {
  it('sends signed-out visitors to /login and remembers where they were going', async () => {
    renderApp({ path: '/usage' });
    expect(await screen.findByRole('heading', { name: 'Welcome back to AxiomFlo' })).toBeTruthy();
    expect(location()).toBe('/login?returnTo=%2Fusage');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('shows only a loading message while Firebase restores the session', () => {
    renderApp({ path: '/', client: new FakeAuthClient(/* never reports a user */) });
    expect(screen.getByText('Checking your access…')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByText(/sample data/i)).toBeNull();
  });

  it('shows only a loading message while membership is being checked', async () => {
    const slow: MembershipService = { getMembership: () => new Promise(() => {}) };
    renderApp({ path: '/', client: new FakeAuthClient(alice), membershipService: slow });
    await act(async () => {});
    expect(screen.getByText('Checking your access…')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('sends a newly signed-in person with no membership to Access pending', async () => {
    renderApp({ path: '/', client: new FakeAuthClient(alice) });
    expect(await screen.findByRole('heading', { name: 'Access pending' })).toBeTruthy();
    expect(screen.getByText('Alice Example')).toBeTruthy();
    expect(screen.getByText('alice@example.com')).toBeTruthy();
    expect(screen.getByText(/haven’t been assigned to an AxiomFlo workspace yet/)).toBeTruthy();
    expect(screen.queryByText(/request (was )?sent/i)).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('lets an approved member into the application, without sample data or the demo switcher', async () => {
    renderApp({ path: '/', client: new FakeAuthClient(alice), membershipService: fakeMembershipService({ [alice.uid]: membershipFor(alice) }) });
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy();
    expect(screen.getAllByRole('navigation', { name: 'Main' }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Demo role')).toBeNull();
    expect(screen.queryByText('Demo workspace — sample data')).toBeNull();
    expect(screen.getAllByText('Real Co').length).toBeGreaterThan(0);
  });

  it('shows the signed-in identity, company, role and assigned teams from the membership', async () => {
    renderApp({ path: '/settings', client: new FakeAuthClient(alice), membershipService: fakeMembershipService({ [alice.uid]: membershipFor(alice) }) });
    await screen.findByRole('heading', { name: 'Your workspace access is approved' });
    expect(screen.getAllByText(/alice@example\.com/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Individual User').length).toBeGreaterThan(0);
    expect(screen.getByText('Your teams')).toBeTruthy();
    expect(screen.getByText('Team One')).toBeTruthy();
  });

  it('returns an approved member to the page they originally asked for', async () => {
    renderApp({ path: '/login?returnTo=%2Fshowback', client: new FakeAuthClient(alice), membershipService: fakeMembershipService({ [alice.uid]: membershipFor(alice) }) });
    await screen.findByRole('heading', { name: 'Monthly Showback' });
    expect(location()).toBe('/showback');
  });

  it('ignores return addresses that point outside the app', async () => {
    renderApp({ path: '/login?returnTo=https%3A%2F%2Fevil.example', client: new FakeAuthClient(alice), membershipService: fakeMembershipService({ [alice.uid]: membershipFor(alice) }) });
    await screen.findByRole('heading', { name: 'Overview' });
    expect(location()).toBe('/');
  });

  it('keeps suspended members out of workspace pages', async () => {
    renderApp({ path: '/usage', client: new FakeAuthClient(alice), membershipService: fakeMembershipService({ [alice.uid]: membershipFor(alice, { status: 'suspended' }) }) });
    expect(await screen.findByRole('heading', { name: 'You don’t have access to AxiomFlo' })).toBeTruthy();
    expect(location()).toBe('/access-denied');
    expect(screen.queryByText('Real Co')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('treats a membership that belongs to someone else as an error, not as access', async () => {
    renderApp({ path: '/', client: new FakeAuthClient(alice), membershipService: fakeMembershipService({ [alice.uid]: membershipFor(bob) }) });
    expect(await screen.findByRole('heading', { name: 'We couldn’t check your access' })).toBeTruthy();
  });

  it('offers a retry when the membership lookup fails', async () => {
    const service = fakeMembershipService();
    service.getMembership.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(membershipFor(alice));
    renderApp({ path: '/', client: new FakeAuthClient(alice), membershipService: service });
    expect(await screen.findByRole('heading', { name: 'We couldn’t check your access' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy();
  });
});

describe('Google sign-in', () => {
  it('starts the Google popup from the button', async () => {
    const client = new FakeAuthClient(null);
    renderApp({ path: '/login', client });
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    expect(client.signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('uses the same Google flow on the sign-up page and explains approval', async () => {
    const client = new FakeAuthClient(null);
    renderApp({ path: '/signup', client });
    expect(await screen.findByRole('heading', { name: 'Get started with AxiomFlo' })).toBeTruthy();
    expect(screen.getByText('Company access needs approval')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign up with Google' }));
    expect(client.signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('ignores repeated clicks while the popup is open', async () => {
    const client = new FakeAuthClient(null);
    client.signInWithGoogle.mockImplementation(() => new Promise(() => {}));
    renderApp({ path: '/login', client });
    const button = await screen.findByRole('button', { name: 'Continue with Google' });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(client.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Waiting for Google/ }).hasAttribute('disabled')).toBe(true);
  });

  it('shows a gentle message when the person closes the popup', async () => {
    const client = new FakeAuthClient(null);
    client.signInWithGoogle.mockRejectedValue({ code: 'auth/popup-closed-by-user' });
    renderApp({ path: '/login', client });
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    expect((await screen.findByText(/Sign-in was cancelled/)).closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['auth/popup-blocked', /blocked the Google sign-in window/],
    ['auth/unauthorized-domain', /isn’t enabled for this web address/],
    ['auth/network-request-failed', /couldn’t reach Google/],
    ['auth/operation-not-allowed', /hasn’t been turned on/],
  ])('explains %s clearly', async (code, message) => {
    const client = new FakeAuthClient(null);
    client.signInWithGoogle.mockRejectedValue({ code });
    renderApp({ path: '/login', client });
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(message);
  });

  it('asks Google to show the account chooser for "Use another Google account"', async () => {
    const client = new FakeAuthClient(alice);
    renderApp({ path: '/access-pending', client });
    await userEvent.click(await screen.findByRole('button', { name: 'Use another Google account' }));
    expect(client.signInWithGoogle).toHaveBeenCalledWith({ selectAccount: true });
  });
});

describe('email and password', () => {
  it('logs in with email and password', async () => {
    const client = new FakeAuthClient(null);
    renderApp({ path: '/login', client });
    await userEvent.type(await screen.findByLabelText('Work email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(client.signInWithEmail).toHaveBeenCalledWith('alice@example.com', 'secret-pass');
  });

  it('checks the form before contacting Firebase', async () => {
    const client = new FakeAuthClient(null);
    renderApp({ path: '/signup', client });
    await userEvent.type(await screen.findByLabelText('Work email'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Work email'));
    await userEvent.type(screen.getByLabelText('Work email'), 'carol@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Use at least 8 characters.')).toBeTruthy();
    expect(client.signUpWithEmail).not.toHaveBeenCalled();
  });

  it('creates an account and asks the person to confirm their email before anything else', async () => {
    const client = new FakeAuthClient(null);
    client.signUpWithEmail.mockImplementation(async () => client.emit(carol));
    const service = fakeMembershipService();
    renderApp({ path: '/signup', client, membershipService: service });
    await userEvent.type(await screen.findByLabelText('Full name (optional)'), 'Carol Example');
    await userEvent.type(screen.getByLabelText('Work email'), 'carol@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'long-enough-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(client.signUpWithEmail).toHaveBeenCalledWith('carol@example.com', 'long-enough-pass', 'Carol Example');
    expect(await screen.findByRole('heading', { name: 'Confirm your email' })).toBeTruthy();
    expect(location()).toBe('/verify-email');
    expect(service.getMembership).not.toHaveBeenCalled();
  });

  it('keeps unverified accounts out of workspace pages', async () => {
    renderApp({ path: '/usage', client: new FakeAuthClient(carol), membershipService: fakeMembershipService({ [carol.uid]: membershipFor(carol) }) });
    expect(await screen.findByRole('heading', { name: 'Confirm your email' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('checks membership once the email is confirmed', async () => {
    const client = new FakeAuthClient(carol);
    client.reloadUser.mockResolvedValueOnce(carol).mockResolvedValueOnce({ ...carol, emailVerified: true });
    renderApp({ path: '/verify-email', client });
    await userEvent.click(await screen.findByRole('button', { name: 'I’ve confirmed my email' }));
    expect(await screen.findByText(/isn’t confirmed yet/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'I’ve confirmed my email' }));
    expect(await screen.findByRole('heading', { name: 'Access pending' })).toBeTruthy();
    expect(screen.getByText(carol.uid)).toBeTruthy();
  });

  it('shows the same message for any wrong email or password', async () => {
    const client = new FakeAuthClient(null);
    client.signInWithEmail.mockRejectedValue({ code: 'auth/invalid-credential' });
    renderApp({ path: '/login', client });
    await userEvent.type(await screen.findByLabelText('Work email'), 'alice@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/don’t match an AxiomFlo account/);
  });

  it('sends a password reset link without revealing whether the account exists', async () => {
    const client = new FakeAuthClient(null);
    client.sendPasswordReset.mockRejectedValue({ code: 'auth/user-not-found' });
    renderApp({ path: '/login', client });
    await userEvent.click(await screen.findByRole('link', { name: 'Forgot password?' }));
    await userEvent.type(await screen.findByLabelText('Email'), 'nobody@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If an AxiomFlo account uses that email/)).toBeTruthy();
    expect(client.sendPasswordReset).toHaveBeenCalledWith('nobody@example.com');
  });
});

describe('sign-out', () => {
  it('returns to /login from the workspace profile menu', async () => {
    const client = new FakeAuthClient(alice);
    renderApp({ path: '/', client, membershipService: fakeMembershipService({ [alice.uid]: membershipFor(alice) }) });
    await screen.findByRole('heading', { name: 'Overview' });
    await userEvent.click(screen.getByRole('button', { name: /Open profile menu/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back to AxiomFlo' })).toBeTruthy();
    expect(client.signOut).toHaveBeenCalled();
    expect(location()).toBe('/login');
  });

  it('throws away the previous person’s page state', async () => {
    function Counter() {
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => setCount((c) => c + 1)}>
          Clicked {count}
        </button>
      );
    }
    const client = new FakeAuthClient(alice);
    const service = fakeMembershipService({ [alice.uid]: membershipFor(alice), [bob.uid]: membershipFor(bob) });
    render(
      <MemoryRouter>
        <AuthProvider client={client} membershipService={service}>
          <Routes>
            <Route path="/" element={<RequireWorkspace><Counter /></RequireWorkspace>} />
            <Route path="/login" element={<p>Login page</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Clicked 0' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clicked 1' }));
    await act(async () => client.emit(bob));
    expect(await screen.findByRole('button', { name: 'Clicked 0' })).toBeTruthy();
  });

  it('ends a demo session on sign-out', async () => {
    const client = new FakeAuthClient(alice);
    renderApp({ path: '/access-pending', client });
    demoSession.enter();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Welcome back to AxiomFlo' });
    expect(demoSession.isActive()).toBe(false);
  });
});

describe('sign-in tokens', () => {
  it('are never written to localStorage or sessionStorage, even after API calls', async () => {
    const client = new FakeAuthClient(alice);
    const me = { user: { uid: alice.uid, email: alice.email, emailVerified: true, displayName: alice.displayName }, access: 'active', company: { id: 'co-real', name: 'Real Co', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' }, membership: { role: 'company_admin', teamIds: [] }, teams: [] };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      const body = path === '/api/me' ? me : path === '/api/members' ? { members: [] } : path === '/api/keys' ? { keys: [] } : path === '/api/exchange-rates' ? { currency: 'AUD', rates: [] } : { invitations: [] };
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    });
    const api = createApiClient({ baseUrl: 'https://app.example.com', getIdToken: () => client.getIdToken(), fetchImpl });
    renderApp({ path: '/settings', client, membershipService: createHttpMembershipService(api), api });
    await screen.findByRole('heading', { name: 'Your workspace access is approved' });
    await screen.findByText('No invitations yet.');
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname).sort()).toEqual(['/api/exchange-rates', '/api/invitations', '/api/keys', '/api/me', '/api/members']);
    const stored = [window.localStorage, window.sessionStorage].flatMap((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`)).join('\n');
    expect(stored).not.toContain('fake-id-token');
  });
});

describe('demo workspace', () => {
  it('cannot give a signed-in person without membership access, whatever demo role is saved', async () => {
    window.localStorage.setItem('axiomflo-demo:role', JSON.stringify('company_admin'));
    renderApp({ path: '/teams', client: new FakeAuthClient(alice) });
    expect(await screen.findByRole('heading', { name: 'Access pending' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('never changes a real member’s role', async () => {
    window.localStorage.setItem('axiomflo-demo:role', JSON.stringify('company_admin'));
    renderApp({ path: '/settings', client: new FakeAuthClient(alice), membershipService: fakeMembershipService({ [alice.uid]: membershipFor(alice, { role: 'individual_user' }) }) });
    await screen.findByRole('heading', { name: 'Your workspace access is approved' });
    expect(screen.queryByLabelText('Demo role')).toBeNull();
    expect(screen.queryByText('Company Admin')).toBeNull();
    expect(screen.getAllByText(/Individual User/).length).toBeGreaterThan(0);
  });

  it('opens the sample workspace only when chosen, clearly labelled', async () => {
    renderApp({ path: '/login' });
    await userEvent.click(await screen.findByRole('button', { name: 'Explore the demo workspace' }));
    expect(await screen.findByText('Demo workspace — sample data')).toBeTruthy();
    expect(screen.getByLabelText('Demo role')).toBeTruthy();
  });

  it('can be switched off', async () => {
    renderApp({ path: '/login', settings: { ...testSettings, demoEnabled: false } });
    await screen.findByRole('heading', { name: 'Welcome back to AxiomFlo' });
    expect(screen.queryByRole('button', { name: 'Explore the demo workspace' })).toBeNull();
  });
});

describe('missing Firebase configuration', () => {
  it('shows setup instructions instead of crashing or pretending to sign in', async () => {
    renderApp({ path: '/', client: null, missingConfig: ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID'] });
    expect(await screen.findByRole('heading', { name: 'Welcome back to AxiomFlo' })).toBeTruthy();
    const notice = screen.getByText('Sign-in isn’t set up yet').closest('[role="status"]') as HTMLElement;
    expect(within(notice).getByText('VITE_FIREBASE_API_KEY')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue with Google' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('legal links', () => {
  it('marks Terms and Privacy as setup requirements until real pages exist', async () => {
    renderApp({ path: '/login' });
    const legal = await screen.findByRole('navigation', { name: 'Legal' });
    expect(legal.textContent).toContain('Terms of Service (setup required');
    expect(within(legal).queryByRole('link')).toBeNull();
  });

  it('links to published pages when configured', async () => {
    renderApp({ path: '/login', settings: { ...testSettings, termsUrl: 'https://example.com/terms', privacyUrl: 'https://example.com/privacy' } });
    const legal = await screen.findByRole('navigation', { name: 'Legal' });
    expect(within(legal).getByRole('link', { name: 'Terms of Service' }).getAttribute('href')).toBe('https://example.com/terms');
  });
});

