import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alice, FakeAuthClient, fakeMembershipService, membershipFor, renderApp } from '../../test/authTestUtils';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const member = (role: 'company_admin' | 'individual_user' = 'individual_user') =>
  renderApp({ path: '/settings', client: new FakeAuthClient(alice), membershipService: fakeMembershipService({ [alice.uid]: membershipFor(alice, { role }) }) });

describe('collapsible main navigation', () => {
  it('collapses to icons, keeps every link reachable by name, and remembers the choice', async () => {
    member();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Collapse navigation' }));
    const expand = screen.getByRole('button', { name: 'Expand navigation' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Usage Explorer' })).toBeTruthy();
    expect(window.localStorage.getItem('axiomflo-demo:navCollapsed')).toBe('true');

    cleanup();
    member();
    await user.click(await screen.findByRole('button', { name: 'Expand navigation' }));
    expect(screen.getByRole('button', { name: 'Collapse navigation' }).getAttribute('aria-expanded')).toBe('true');
    expect(window.localStorage.getItem('axiomflo-demo:navCollapsed')).toBe('false');
  });
});

describe('Settings tabs', () => {
  it('opens on Keys & Slack for an Individual User, and switching tabs updates the link', async () => {
    member();
    const user = userEvent.setup();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Keys & Slack', 'Exchange rates']);
    expect(screen.getByRole('tab', { name: 'Keys & Slack' }).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('tab', { name: 'Exchange rates' }));
    expect(screen.getByRole('tab', { name: 'Exchange rates' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('location').textContent).toBe('/settings?tab=rates');
    expect(screen.getAllByRole('tabpanel').map((p) => p.getAttribute('aria-labelledby'))).toEqual([screen.getByRole('tab', { name: 'Exchange rates' }).id]);
  });

  it('puts Members first for a Company Admin and moves between tabs with the arrow keys', async () => {
    member('company_admin');
    const user = userEvent.setup();
    const first = await screen.findByRole('tab', { name: 'Members' });
    expect(first.getAttribute('aria-selected')).toBe('true');
    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Keys & Slack' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Keys & Slack' }));
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Exchange rates' }).getAttribute('aria-selected')).toBe('true');
  });
});
