import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { KeyView } from '../../admin/keysApi';
import type { ApiClient } from '../../auth/api';
import { alice, FakeAuthClient, fakeMembershipService, membershipFor, renderApp } from '../../test/authTestUtils';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const SECRET = `axf_${'b'.repeat(24)}_${'S'.repeat(43)}`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fakeApi() {
  const keys: KeyView[] = [];
  const fetch = vi.fn(async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (path === '/api/keys' && method === 'GET') return json({ keys });
    if (path === '/api/keys' && method === 'POST') {
      const body = JSON.parse(String(init.body));
      const key: KeyView = { id: 'b'.repeat(24), name: body.name, ownerUid: alice.uid, ownerEmail: null, teamId: body.teamId, status: 'active', hint: 'SSSS', createdAt: null, revokedAt: null };
      keys.unshift(key);
      return json({ key, secret: SECRET }, 201);
    }
    const revoke = path.match(/^\/api\/keys\/([^/]+)\/revoke$/);
    if (revoke) {
      const key = keys.find((k) => k.id === revoke[1])!;
      key.status = 'revoked';
      return json({ key });
    }
    return json({ error: { message: 'Not found.' } }, 404);
  });
  return { api: { fetch } as ApiClient, fetch };
}

function renderAsAlice(api: ApiClient) {
  return renderApp({ path: '/', client: new FakeAuthClient(alice), membershipService: fakeMembershipService({ [alice.uid]: membershipFor(alice) }), api });
}

describe('AxiomFlo keys', () => {
  it('creates a key for one of the person’s teams and shows it once', async () => {
    const { api, fetch } = fakeApi();
    renderAsAlice(api);
    const user = userEvent.setup();
    expect(await screen.findByText('No keys yet.')).toBeTruthy();
    // An individual user can only pick their own teams.
    expect(within(screen.getByLabelText('Team')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Team One']);

    await user.type(screen.getByLabelText('Key name'), 'My laptop');
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByText(SECRET)).toBeTruthy();
    expect(screen.getByText(/You won’t be able to see it again/)).toBeTruthy();
    const post = fetch.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ name: 'My laptop', teamId: 'team-1' });

    await user.click(screen.getByRole('button', { name: 'I’ve saved it' }));
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.getByText('…SSSS')).toBeTruthy();
    const stored = [window.localStorage, window.sessionStorage].flatMap((s) => Object.keys(s).map((k) => String(s.getItem(k)))).join('\n');
    expect(stored).not.toContain(SECRET);
  });

  it('revokes a key', async () => {
    const { api } = fakeApi();
    renderAsAlice(api);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Key name'), 'Old key');
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    await user.click(await screen.findByRole('button', { name: 'Revoke key Old key' }));
    expect(await screen.findByText('Revoked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revoke key Old key' })).toBeNull();
  });
});
