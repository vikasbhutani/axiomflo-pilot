import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../auth/api';
import { demoSession } from '../auth/demoSession';
import { DEMO_PERSONAS } from '../data/mockData';
import { buildDemoUpgradeEstimate, buildDemoUpgradeModels, resetDemoUpgrades } from '../services/upgradeAnalysisService';
import { alice, FakeAuthClient, fakeMembershipService, membershipFor, renderApp } from '../test/authTestUtils';
import * as csv from '../lib/csv';

beforeAll(() => {
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
  resetDemoUpgrades();
  vi.restoreAllMocks();
});

const LINK = '/assistant/upgrade?current=claude-sonnet-demo&candidate=claude-sonnet-2-demo&scope=company&window=last_30_days&pct=100';

describe('Upgrade Analysis page', () => {
  it('runs an analysis on the Acme sample data from a link, with the required labels, and saves it', async () => {
    demoSession.enter();
    renderApp({ path: LINK });
    expect(await screen.findByRole('heading', { name: 'Upgrade Analysis' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Chat' })).toBeTruthy();
    expect((await screen.findAllByText(/Recommendation: Recommended with validation/, undefined, { timeout: 3000 })).length).toBeGreaterThan(0);
    for (const label of ['Estimated savings', 'Modelled projection', 'Based on observed usage', 'Requires validation']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not a guaranteed saving').length).toBeGreaterThan(0);
    expect(screen.getByText(/Quality impact cannot be assessed from available data/)).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Risks' })).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText('Suggested rollout plan')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /Save analysis/ }));
    expect(await screen.findByText(/Saved as a draft for review/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Saved/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets a view-only login run and download an analysis but not save it', async () => {
    const admin = { userId: DEMO_PERSONAS.company_admin, role: 'company_admin' as const };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const fetch = vi.fn(async (path: string, init: RequestInit = {}) => {
      if (path === '/api/upgrade-analysis/models') return json(buildDemoUpgradeModels(admin));
      if (path === '/api/upgrade-analysis/estimate' && init.method === 'POST') return json({ analysis: buildDemoUpgradeEstimate(JSON.parse(String(init.body)), admin) });
      if (path.startsWith('/api/usage?')) return json({ records: [], month: '2026-10', startIso: '', endIso: '', timezone: 'Australia/Sydney', truncated: false });
      return json({ error: { message: 'Not found.' } }, 404);
    });
    const download = vi.spyOn(csv, 'downloadText').mockImplementation(() => {});
    const judge = membershipFor(alice, { role: 'company_admin', teamIds: [], teams: [], readOnly: true });
    renderApp({ path: LINK, client: new FakeAuthClient(alice), membershipService: fakeMembershipService({ [alice.uid]: judge }), api: { fetch } as unknown as ApiClient });
    expect((await screen.findAllByText(/Recommendation: Recommended with validation/, undefined, { timeout: 3000 })).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: /Save analysis/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/view-only login/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Export report/ }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(fetch.mock.calls.some(([p]) => String(p).includes('/save') || String(p).includes('/export'))).toBe(false);
  });
});
