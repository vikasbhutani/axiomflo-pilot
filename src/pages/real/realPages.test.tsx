import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../auth/api';
import { parseCsv } from '../../lib/csv';
import { buildDataset, modelDisplayName, rateFor, recentMonths } from '../../reports/realData';
import type { ExchangeRateView, UsageResponse, UsageView } from '../../reports/reportsApi';
import { alice, bob, FakeAuthClient, fakeMembershipService, membershipFor, renderApp } from '../../test/authTestUtils';
import { realShowbackCsv } from './RealShowbackPage';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  Object.assign(assistantReply, defaultAssistantReply);
  slack.links = [];
  slack.peek = { slackName: 'ava', emailMatches: true };
});

/** Pages offer the last 12 months, so the tests use the current one. */
const MONTH = recentMonths()[0];

const teams = [
  { id: 'team-1', name: 'Team One', code: 'TEAM-1' },
  { id: 'team-2', name: 'Team Two', code: 'TEAM-2' },
];

function usage(id: string, overrides: Partial<UsageView> = {}): UsageView {
  return {
    id,
    timestamp: `${MONTH}-10T01:00:00.000Z`,
    principal: { type: 'user', id: alice.uid },
    keyId: 'k'.repeat(24),
    teamId: 'team-1',
    teamCode: 'TEAM-1',
    providerId: 'anthropic',
    modelId: 'claude-sonnet-5-5',
    inputTokens: 1000,
    outputTokens: 500,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    requestStatus: 'succeeded',
    providerStatus: 200,
    costStatus: 'estimated',
    estimatedCostUsd: 0.007,
    priceVersion: 'anthropic-2026-10-18',
    stream: false,
    latencyMs: 800,
    ...overrides,
  };
}

const response = (records: UsageView[]): UsageResponse => ({
  month: MONTH,
  startIso: '2026-09-30T14:00:00.000Z',
  endIso: '2026-10-31T13:00:00.000Z',
  records,
  people: { [alice.uid]: { name: 'Alice Example', email: alice.email }, [bob.uid]: { name: 'Bob Example', email: bob.email } },
  truncated: false,
  skipped: 0,
});
const rate = (month: string, value: number): ExchangeRateView => ({ month, rate: value, currency: 'AUD', setBy: 'x', setAt: null });

describe('turning usage records into report figures', () => {
  it('converts USD estimates with the month’s rate, falling back to the latest earlier one', () => {
    expect(rateFor('2026-10', [rate('2026-08', 1.4), rate('2026-09', 1.5), rate('2026-11', 1.6)])).toBe(1.5);
    expect(rateFor('2026-01', [rate('2026-08', 1.4)])).toBe(1.4);
    const data = buildDataset(response([usage('r1')]), [rate(MONTH, 1.5)], 'AUD', teams);
    expect(data.money).toEqual({ currency: 'AUD', usingUsdFallback: false, reportingCurrency: 'AUD' });
    expect(data.records[0]).toMatchObject({
      estimatedCost: 0.007 * 1.5,
      estimatedCostUsd: 0.007,
      exchangeRate: 1.5,
      teamName: 'Team One',
      modelName: 'Claude Sonnet 5.5',
      principalName: 'Alice Example',
      localDate: `${MONTH}-10`,
    });
  });

  it('stays in USD, and says so, when no rate is set', () => {
    const data = buildDataset(response([usage('r1')]), [], 'AUD', teams);
    expect(data.money).toMatchObject({ currency: 'USD', usingUsdFallback: true });
    expect(data.records[0].estimatedCost).toBe(0.007);
  });

  it('never turns a missing cost into zero', () => {
    const data = buildDataset(response([usage('r1', { inputTokens: null, estimatedCostUsd: null, costStatus: 'unavailable' })]), [rate(MONTH, 1.5)], 'AUD', teams);
    expect(data.records[0].estimatedCost).toBeNull();
    const rows = parseCsv(realShowbackCsv(data));
    expect(rows[1][rows[0].indexOf('estimated_cost')]).toBe('');
    expect(rows[1][rows[0].indexOf('cost_status')]).toBe('unavailable');
  });

  it('names models readably', () => {
    expect(modelDisplayName('claude-opus-5-5')).toBe('Claude Opus 5.5');
    expect(modelDisplayName('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet 4.5');
    expect(modelDisplayName('claude-fable-5-1')).toBe('Claude Fable 5.1');
    expect(modelDisplayName('gemini-2.5-pro')).toBe('Gemini 2.5 Pro');
    expect(modelDisplayName('something-else')).toBe('something-else');
  });
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** What the fake API answers for the assistant; tests replace these. */
const assistantReply = {
  suggestions: (): Response => json({ status: 'ok', suggestions: [], message: 'Nothing stands out for this period under AxiomFlo’s rules.' }),
  ask: (_body: unknown): Response => json({ status: 'ok', text: 'Done.', sessionId: null, links: [] }),
};
const defaultAssistantReply = { ...assistantReply };

/** Slack links the fake API holds, and what it says about a link code. */
const slack = {
  links: [] as { id: string; uid: string; slackTeamId: string; slackUserId: string; slackName: string | null; linkedAt: string | null }[],
  peek: { slackName: 'ava' as string | null, emailMatches: true },
};

function fakeApi(records: UsageView[], rates: ExchangeRateView[] = []) {
  const fetch = vi.fn(async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (path.startsWith('/api/usage?')) return json({ ...response(records), month: new URLSearchParams(path.split('?')[1]).get('month') });
    if (path === '/api/exchange-rates' && method === 'GET') return json({ currency: 'AUD', rates });
    if (path.startsWith('/api/exchange-rates/') && method === 'PUT') {
      const view = rate(path.split('/').pop()!, JSON.parse(String(init.body)).rate);
      rates.push(view);
      return json({ rate: view });
    }
    if (path.startsWith('/api/assistant/suggestions?')) return assistantReply.suggestions();
    if (path === '/api/assistant/ask' && method === 'POST') return assistantReply.ask(JSON.parse(String(init.body)));
    if (path.startsWith('/api/slack/link?')) return json(slack.peek);
    if (path === '/api/slack/link' && method === 'POST') {
      const link = { id: 'T1_U1', uid: alice.uid, slackTeamId: 'T1', slackUserId: 'U1', slackName: slack.peek.slackName, linkedAt: '2026-10-18T00:00:00.000Z' };
      slack.links.push(link);
      return json({ link }, 201);
    }
    if (path === '/api/slack/links') return json({ links: slack.links });
    if (path.startsWith('/api/slack/links/') && method === 'DELETE') {
      slack.links = slack.links.filter((l) => l.id !== decodeURIComponent(path.split('/').pop()!));
      return json({ deleted: true });
    }
    if (path === '/api/keys') return json({ keys: [] });
    if (path === '/api/members') return json({ members: [] });
    if (path === '/api/invitations') return json({ invitations: [] });
    return json({ error: { message: 'Not found.' } }, 404);
  });
  return { api: { fetch } as ApiClient, fetch };
}

const admin = membershipFor(alice, { role: 'company_admin', teamIds: [], teams });
const render = (path: string, api: ApiClient, membership = admin) => renderApp({ path, client: new FakeAuthClient(alice), membershipService: fakeMembershipService({ [alice.uid]: membership }), api });

describe('real workspace pages', () => {
  const records = [usage('r1'), usage('r2', { principal: { type: 'user', id: bob.uid }, teamId: 'team-2', teamCode: 'TEAM-2', modelId: 'claude-opus-5-5', estimatedCostUsd: 0.03 })];

  it('Overview shows the month’s real totals by team and person, never sample data', async () => {
    const { api, fetch } = fakeApi(records, [rate(MONTH, 1.5)]);
    render(`/?month=${MONTH}`, api);
    expect(await screen.findByText('Spend by person')).toBeTruthy();
    // (0.007 + 0.03) USD × 1.5
    expect(screen.getAllByText('$0.06').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bob Example').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Team Two').length).toBeGreaterThan(0);
    expect(screen.queryByText(/sample/i)).toBeNull();
    expect(fetch.mock.calls.map(([p]) => p)).toContain(`/api/usage?month=${MONTH}`);
  });

  it('FinOps Scorecard scores the real month without sample data', async () => {
    const { api } = fakeApi([...records, usage('r3', { modelId: 'claude-opus-5-5', inputTokens: 60_000, outputTokens: 100, estimatedCostUsd: 0.5 })], [rate(MONTH, 1.5)]);
    render(`/scorecard?month=${MONTH}`, api);
    expect(await screen.findByText('FinOps score')).toBeTruthy();
    const levers = screen.getByText('Five optimisation levers, by savings potential').closest('section')!;
    expect(within(levers).getAllByRole('listitem')).toHaveLength(5);
    const table = screen.getByRole('table');
    expect(within(table).getByText('Interactive use · Team One')).toBeTruthy();
    expect(within(table).getByText('Interactive use · Team Two')).toBeTruthy();
    expect(screen.getByText(/split assuming output tokens cost five times/)).toBeTruthy();
    expect(screen.queryByText(/sample/i)).toBeNull();
  });

  it('says plainly when there are no requests yet', async () => {
    const { api } = fakeApi([]);
    render('/', api);
    expect(await screen.findByText(/No AI requests in .* yet/)).toBeTruthy();
  });

  it('warns that amounts are USD until an admin sets a rate', async () => {
    const { api } = fakeApi(records);
    render(`/?month=${MONTH}`, api);
    expect(await screen.findByText(/Amounts are in USD/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set one in Settings' })).toBeTruthy();
  });

  it('Usage Explorer lists requests and opens one without any prompt or answer', async () => {
    const { api } = fakeApi(records, [rate(MONTH, 1.5)]);
    render(`/usage?month=${MONTH}`, api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Open details for request r2' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('r2')).toBeTruthy();
    expect(within(drawer).getByText('Claude Opus 5.5 (claude-opus-5-5)')).toBeTruthy();
    expect(within(drawer).getByText(/never stored/)).toBeTruthy();
  });

  it('Usage Explorer filters by team for an admin', async () => {
    const { api } = fakeApi(records);
    render(`/usage?month=${MONTH}&team=team-2`, api);
    await screen.findByRole('button', { name: 'Open details for request r2' });
    expect(screen.queryByRole('button', { name: 'Open details for request r1' })).toBeNull();
  });

  it('an individual user gets no team filter or per-person ranking', async () => {
    const { api } = fakeApi([usage('r1')]);
    render(`/?month=${MONTH}`, api, membershipFor(alice, { teams: [teams[0]] }));
    expect(await screen.findByText('Spend by your teams')).toBeTruthy();
    expect(screen.queryByText('Spend by person')).toBeNull();
  });

  it('an admin sets a month’s exchange rate; nothing else is sent', async () => {
    const { api, fetch } = fakeApi([]);
    render('/settings', api);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('AUD per 1 USD'), '1.52');
    await user.click(screen.getByRole('button', { name: 'Save rate' }));
    expect(await screen.findByText('1.52')).toBeTruthy();
    const put = fetch.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(put[0]).toMatch(/^\/api\/exchange-rates\/\d{4}-\d{2}$/);
    expect(JSON.parse(String(put[1]!.body))).toEqual({ rate: 1.52 });
  });

  it('an individual user can see rates but not set them', async () => {
    const { api } = fakeApi([], [rate(MONTH, 1.5)]);
    render('/settings', api, membershipFor(alice));
    expect(await screen.findByText('1.5')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save rate' })).toBeNull();
  });
});

describe('real AI Cost Assistant', () => {
  it('shows savings suggestions for the month, with links that stay in the app', async () => {
    assistantReply.suggestions = () =>
      json({
        status: 'ok',
        suggestions: [
          { kind: 'spend_jump', title: 'Team Two spend jumped', detail: 'Team Two spent $10.71, up from $3.33 (+221.4%).', link: { label: 'Requests this month', url: `https://evil.example/usage?month=${MONTH}&team=team-2` } },
        ],
      });
    const { api, fetch } = fakeApi([]);
    render('/assistant', api);
    expect(await screen.findByText('Team Two spend jumped')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Requests this month' }).getAttribute('href')).toBe(`/usage?month=${MONTH}&team=team-2`);
    expect(fetch.mock.calls.map(([p]) => p)).toContain(`/api/assistant/suggestions?month=${MONTH}`);
  });

  it('sends only the question, then keeps the conversation going', async () => {
    const asked: unknown[] = [];
    assistantReply.ask = (body) => {
      asked.push(body);
      return json({ status: 'ok', text: 'Team One spent $0.06 AUD in October.', sessionId: `s_${'b'.repeat(32)}`, links: [{ label: 'Supporting requests', url: `/usage?month=${MONTH}` }] });
    };
    const { api } = fakeApi([]);
    render('/assistant', api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'What did each team spend this month?' }));
    expect(await screen.findByText('Team One spent $0.06 AUD in October.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Supporting requests' })).toBeTruthy();
    await user.type(screen.getByLabelText('Ask a question about AI costs'), 'And last month?{Enter}');
    await screen.findAllByText('Team One spent $0.06 AUD in October.');
    expect(asked).toEqual([{ question: 'What did each team spend this month?' }, { question: 'And last month?', sessionId: `s_${'b'.repeat(32)}` }]);
  });

  it('shows a withheld answer as a warning, not as figures', async () => {
    assistantReply.ask = () => json({ status: 'withheld', text: 'I couldn’t verify every figure, so I’ve withheld it.', sessionId: null, links: [] });
    const { api } = fakeApi([]);
    render('/assistant', api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'How can we lower our AI spend?' }));
    expect(await screen.findByText(/withheld it/)).toBeTruthy();
  });

  it('says plainly when the assistant isn’t set up', async () => {
    assistantReply.suggestions = () => json({ error: { code: 'assistant_unavailable', message: 'The AI Cost Assistant isn’t set up yet. A Company Admin can follow docs/agent/deploy.md.' } }, 503);
    const { api } = fakeApi([]);
    render('/assistant', api);
    expect(await screen.findByText('The assistant isn’t set up yet')).toBeTruthy();
  });

  it('opens from any page as a side panel, without leaving it', async () => {
    assistantReply.ask = () => json({ status: 'ok', text: 'Team One spent $0.06 AUD in October.', sessionId: null, links: [] });
    const { api } = fakeApi([]);
    render(`/teams?month=${MONTH}`, api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ask AI' }));
    const panel = screen.getByRole('complementary', { name: 'AI Cost Assistant' });
    await user.type(within(panel).getByLabelText('Ask a question about AI costs'), 'What did each team spend?{Enter}');
    expect(await within(panel).findByText('Team One spent $0.06 AUD in October.')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe(`/teams?month=${MONTH}`);
  });

  it('an individual user gets questions about their own spend', async () => {
    const { api } = fakeApi([]);
    render('/assistant', api, membershipFor(alice, { teams: [teams[0]] }));
    expect(await screen.findByRole('button', { name: 'What did I spend this month?' })).toBeTruthy();
  });
});

describe('linking a Slack account', () => {
  it('links after the person confirms, then lists it in Settings with Unlink', async () => {
    const { api, fetch } = fakeApi([]);
    render('/slack/link?code=abc123', api);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: `Link Slack user ava to ${alice.email}?` })).toBeTruthy();
    expect(fetch.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Link my Slack account' }));
    expect(await screen.findByRole('heading', { name: 'Your Slack account is linked' })).toBeTruthy();
    const post = fetch.mock.calls.find(([p, i]) => p === '/api/slack/link' && i?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ code: 'abc123' });

    await user.click(screen.getByRole('link', { name: 'Go to Settings' }));
    await user.click(await screen.findByRole('button', { name: 'Unlink Slack user ava' }));
    expect(await screen.findByText('No Slack accounts are linked yet.')).toBeTruthy();
  });

  it('won’t link when the Slack email doesn’t match the sign-in email', async () => {
    slack.peek = { slackName: 'someone', emailMatches: false };
    const { api } = fakeApi([]);
    render('/slack/link?code=abc123', api);
    expect(await screen.findByText(/email doesn’t match/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Link my Slack account' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains a link with no code', async () => {
    const { api } = fakeApi([]);
    render('/slack/link', api);
    expect(await screen.findByText(/isn’t valid/)).toBeTruthy();
  });
});
