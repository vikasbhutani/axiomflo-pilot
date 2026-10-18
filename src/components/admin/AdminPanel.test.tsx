import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { InvitationView, MemberView } from '../../admin/adminApi';
import type { ApiClient } from '../../auth/api';
import { alice, bob, FakeAuthClient, fakeMembershipService, membershipFor, renderApp } from '../../test/authTestUtils';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const teams = [
  { id: 'team-1', name: 'Team One', code: 'TEAM-1' },
  { id: 'team-2', name: 'Team Two', code: 'TEAM-2' },
];
const adminMembership = membershipFor(alice, { role: 'company_admin', teamIds: [], teams });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A stand-in AxiomFlo API with members and invitations kept in memory. */
function fakeApi({ fail }: { fail?: { path: string; status: number; message?: string; method?: string } } = {}) {
  const members: MemberView[] = [
    { uid: alice.uid, email: alice.email, displayName: alice.displayName, role: 'company_admin', teamIds: [], status: 'active' },
    { uid: bob.uid, email: bob.email, displayName: bob.displayName, role: 'individual_user', teamIds: ['team-1'], status: 'active' },
  ];
  const invitations: InvitationView[] = [];
  const fetch = vi.fn(async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (fail && path === fail.path && (!fail.method || fail.method === method)) return json({ error: { code: 'x', message: fail.message ?? 'Refused.' } }, fail.status);
    if (path === '/api/members' && method === 'GET') return json({ members });
    if (path === '/api/invitations' && method === 'GET') return json({ invitations });
    if (path === '/api/invitations' && method === 'POST') {
      const invitation: InvitationView = { id: `inv-${invitations.length + 1}`, email: body.email.toLowerCase(), role: body.role, teamIds: body.teamIds, status: 'pending', delivery: 'Created — email not sent', expiresAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-10-18T00:00:00.000Z' };
      invitations.unshift(invitation);
      return json({ invitation }, 201);
    }
    const revoke = path.match(/^\/api\/invitations\/([^/]+)\/revoke$/);
    if (revoke) {
      const invitation = invitations.find((i) => i.id === revoke[1])!;
      invitation.status = 'revoked';
      return json({ invitation });
    }
    const member = path.match(/^\/api\/members\/([^/]+)$/);
    if (member && method === 'PATCH') {
      const m = members.find((x) => x.uid === decodeURIComponent(member[1]))!;
      Object.assign(m, body);
      return json({ member: { ...m } });
    }
    return json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
  });
  return { api: { fetch } as ApiClient, fetch, members, invitations };
}

function renderAs(membership = adminMembership, api: ApiClient | null = fakeApi().api) {
  return renderApp({ path: '/', client: new FakeAuthClient(alice), membershipService: fakeMembershipService({ [alice.uid]: membership }), api });
}

const memberItem = async (email: string) => (await screen.findByText(email, { selector: 'p' })).closest('li') as HTMLElement;

describe('Admin members and invitations', () => {
  it('is not shown to an Individual User, and the admin API is never called', async () => {
    const { api, fetch } = fakeApi();
    renderAs(membershipFor(alice), api);
    await screen.findByRole('heading', { name: 'Your workspace access is approved' });
    expect(screen.queryByText('Invite someone')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lists members and offers no changes on your own row', async () => {
    renderAs();
    const me = await memberItem('alice@example.com');
    expect(within(me).getByText('(you)')).toBeTruthy();
    expect(within(me).queryByRole('button')).toBeNull();
    const other = await memberItem('bob@example.com');
    expect(within(other).getByText(/Individual User · Team One · Active/)).toBeTruthy();
    expect(within(other).getByRole('button', { name: 'Suspend bob@example.com' })).toBeTruthy();
  });

  it('creates an invitation, labelled as not emailed, without sending any uid or company', async () => {
    const { api, fetch } = fakeApi();
    renderAs(adminMembership, api);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'New.Person@Example.com');
    await user.click(screen.getByRole('checkbox', { name: 'Team Two' }));
    await user.click(screen.getByRole('button', { name: 'Create invitation' }));

    expect(await screen.findByText(/No email was sent/)).toBeTruthy();
    expect(await screen.findByText('new.person@example.com')).toBeTruthy();
    expect(screen.getByText('Created — email not sent')).toBeTruthy();
    const post = fetch.mock.calls.find(([p, i]) => p === '/api/invitations' && i?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ email: 'New.Person@Example.com', role: 'individual_user', teamIds: ['team-2'], expiresInDays: 14 });
  });

  it('asks for a team before inviting an Individual User', async () => {
    const { api, fetch } = fakeApi();
    renderAs(adminMembership, api);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'x@example.com');
    await user.click(screen.getByRole('button', { name: 'Create invitation' }));
    expect(await screen.findByText('Pick at least one team.')).toBeTruthy();
    expect(fetch.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  });

  it('shows the API’s reason when an invitation is refused', async () => {
    renderAs(adminMembership, fakeApi({ fail: { path: '/api/invitations', method: 'POST', status: 409, message: 'There is already a pending invitation for this email.' } }).api);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Role'), 'company_admin');
    await user.type(screen.getByLabelText('Email'), 'dup@example.com');
    await user.click(screen.getByRole('button', { name: 'Create invitation' }));
    expect((await screen.findByRole('alert')).textContent).toBe('There is already a pending invitation for this email.');
  });

  it('revokes a pending invitation', async () => {
    const fake = fakeApi();
    fake.invitations.push({ id: 'inv-9', email: 'pending@example.com', role: 'individual_user', teamIds: ['team-1'], status: 'pending', delivery: 'Created — email not sent', expiresAt: '2026-11-01T00:00:00.000Z', createdAt: null });
    renderAs(adminMembership, fake.api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Revoke invitation for pending@example.com' }));
    expect(await screen.findByText(/Individual User · Team One · Revoked/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revoke invitation for pending@example.com' })).toBeNull();
  });

  it('suspends and reactivates another member', async () => {
    const { api, fetch } = fakeApi();
    renderAs(adminMembership, api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Suspend bob@example.com' }));
    await user.click(await screen.findByRole('button', { name: 'Reactivate bob@example.com' }));
    await screen.findByRole('button', { name: 'Suspend bob@example.com' });
    const patches = fetch.mock.calls.filter(([, i]) => i?.method === 'PATCH');
    expect(patches.map(([p, i]) => [p, JSON.parse(String(i!.body))])).toEqual([
      ['/api/members/uid-bob', { status: 'suspended' }],
      ['/api/members/uid-bob', { status: 'active' }],
    ]);
  });

  it('changes a member’s teams, and shows the API’s refusal (for example the last admin)', async () => {
    const { api } = fakeApi();
    renderAs(adminMembership, api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change role or teams for bob@example.com' }));
    const row = await memberItem('bob@example.com');
    await user.click(within(row).getByRole('checkbox', { name: 'Team Two' }));
    await user.click(within(row).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Individual User · Team One, Team Two · Active/)).toBeTruthy();

    cleanup();
    renderAs(adminMembership, fakeApi({ fail: { path: '/api/members/uid-bob', status: 409, message: 'This would leave the company without an active Company Admin.' } }).api);
    await user.click(await screen.findByRole('button', { name: 'Suspend bob@example.com' }));
    expect(await screen.findByText('This would leave the company without an active Company Admin.')).toBeTruthy();
  });

  it('never shows server error details for a 5xx', async () => {
    renderAs(adminMembership, fakeApi({ fail: { path: '/api/members', status: 503, message: 'internal detail' } }).api);
    expect(await screen.findByText(/We couldn’t complete that just now/)).toBeTruthy();
    expect(screen.queryByText(/internal detail/)).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy());
  });
});
