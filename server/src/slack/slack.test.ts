import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AgentUnavailableError, type AgentAnswer, type AgentClient } from '../assistant/agentClient.js';
import { silentLogger } from '../http/logger.js';
import { FakeStore, FakeUsage, pilotData, COMPANY_ID } from '../test/fakes.js';
import { createSlackApp } from './app.js';
import { answerMessage, escapeSlack, linkPromptMessage } from './format.js';
import { createSlackResponder, HELP_TEXT, type DirectoryUser, type SlackQuestion } from './handler.js';
import type { PendingLink, SlackLinkService } from './links.js';
import { isFromSlack, slackSignature } from './signature.js';
import type { SlackApi, SlackMessage } from './slackApi.js';

const SECRET = 'a'.repeat(32);
const NOW = 1_800_000_000_000;
const TEAM = 'T0001';

function signed(body: string, at = NOW) {
  const ts = String(Math.floor(at / 1000));
  return { 'x-slack-request-timestamp': ts, 'x-slack-signature': slackSignature(SECRET, ts, body) };
}

describe('Slack signatures', () => {
  const body = '{"type":"event_callback"}';
  it('accepts a fresh, correctly signed request', () => {
    const h = signed(body);
    expect(isFromSlack({ secret: SECRET, timestamp: h['x-slack-request-timestamp'], signature: h['x-slack-signature'], rawBody: body, now: () => NOW })).toBe(true);
  });
  it('refuses a wrong secret, a changed body, or an old request', () => {
    const h = signed(body);
    const check = (o: Partial<{ secret: string; rawBody: string; now: () => number }>) =>
      isFromSlack({ secret: SECRET, timestamp: h['x-slack-request-timestamp'], signature: h['x-slack-signature'], rawBody: body, now: () => NOW, ...o });
    expect(check({ secret: 'b'.repeat(32) })).toBe(false);
    expect(check({ rawBody: body.replace('event', 'evil') })).toBe(false);
    expect(check({ now: () => NOW + 6 * 60_000 })).toBe(false);
    expect(isFromSlack({ secret: SECRET, timestamp: undefined, signature: undefined, rawBody: body })).toBe(false);
  });
});

class FakeSlack implements SlackApi {
  readonly sent: { kind: string; to: string; user?: string; message: SlackMessage; threadTs?: string }[] = [];
  profile = { name: 'Alice Slack', email: 'alice@example.com', isBot: false, deleted: false };
  async postMessage(channel: string, message: SlackMessage, threadTs?: string) {
    this.sent.push({ kind: 'message', to: channel, message, threadTs });
  }
  async postEphemeral(channel: string, user: string, message: SlackMessage, threadTs?: string) {
    this.sent.push({ kind: 'ephemeral', to: channel, user, message, threadTs });
  }
  async respond(url: string, message: SlackMessage) {
    this.sent.push({ kind: 'respond', to: url, message });
  }
  async userProfile() {
    return this.profile;
  }
}

describe('Slack events and commands', () => {
  function setup() {
    const slack = new FakeSlack();
    const asked: SlackQuestion[] = [];
    const app = createSlackApp({
      signingSecret: SECRET,
      firebaseProjectId: 'axiomflo-test',
      slack,
      logger: silentLogger,
      now: () => NOW,
      answer: async (q) => {
        asked.push(q);
        await q.reply({ text: 'answer' });
      },
    });
    const post = (path: string, body: string, headers: Record<string, string> = signed(body)) => request(app).post(path).set(headers).set('content-type', path.endsWith('commands') ? 'application/x-www-form-urlencoded' : 'application/json').send(body);
    return { slack, asked, post };
  }
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const event = (e: Record<string, unknown>, id = 'Ev1') => JSON.stringify({ type: 'event_callback', team_id: TEAM, event_id: id, event: e });

  it('answers Slack’s URL check', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'xyz' });
    expect((await setup().post('/slack/events', body)).body).toEqual({ challenge: 'xyz' });
  });

  it('refuses unsigned or forged requests', async () => {
    const { post, asked } = setup();
    const body = event({ type: 'message', channel_type: 'im', channel: 'D1', user: 'U1', text: 'hi' });
    expect((await post('/slack/events', body, {})).status).toBe(401);
    expect((await post('/slack/events', body, { ...signed(body), 'x-slack-signature': 'v0=' + '0'.repeat(64) })).status).toBe(401);
    expect((await post('/slack/commands', 'team_id=T0001', {})).status).toBe(401);
    await settle();
    expect(asked).toEqual([]);
  });

  it('answers a direct message in the same conversation', async () => {
    const { post, asked, slack } = setup();
    expect((await post('/slack/events', event({ type: 'message', channel_type: 'im', channel: 'D1', user: 'U1', text: 'What did I spend?' }))).status).toBe(200);
    await settle();
    expect(asked.map(({ teamId, userId, text }) => ({ teamId, userId, text }))).toEqual([{ teamId: TEAM, userId: 'U1', text: 'What did I spend?' }]);
    expect(slack.sent).toEqual([{ kind: 'message', to: 'D1', message: { text: 'answer' }, threadTs: undefined }]);
  });

  it('answers an @mention privately, only to the person who asked', async () => {
    const { post, asked, slack } = setup();
    await post('/slack/events', event({ type: 'app_mention', channel: 'C1', user: 'U1', text: '<@UBOT> spend this month?', thread_ts: '1.2' }));
    await settle();
    expect(asked[0].text).toBe('spend this month?');
    expect(slack.sent).toEqual([{ kind: 'ephemeral', to: 'C1', user: 'U1', message: { text: 'answer' }, threadTs: '1.2' }]);
  });

  it('ignores bots, message edits, channel chatter, retries and repeats', async () => {
    const { post, asked } = setup();
    await post('/slack/events', event({ type: 'message', channel_type: 'im', channel: 'D1', user: 'U1', bot_id: 'B1', text: 'hi' }, 'Ev2'));
    await post('/slack/events', event({ type: 'message', channel_type: 'im', channel: 'D1', user: 'U1', subtype: 'message_changed', text: 'hi' }, 'Ev3'));
    await post('/slack/events', event({ type: 'message', channel_type: 'channel', channel: 'C1', user: 'U1', text: 'hi' }, 'Ev4'));
    const body = event({ type: 'message', channel_type: 'im', channel: 'D1', user: 'U1', text: 'hi' }, 'Ev5');
    await post('/slack/events', body, { ...signed(body), 'x-slack-retry-num': '1' });
    const once = event({ type: 'message', channel_type: 'im', channel: 'D1', user: 'U1', text: 'hi' }, 'Ev6');
    await post('/slack/events', once);
    await post('/slack/events', once);
    await settle();
    expect(asked).toHaveLength(1);
  });

  it('acknowledges /axiomflo at once and answers through Slack’s response URL', async () => {
    const { post, slack } = setup();
    const body = new URLSearchParams({ team_id: TEAM, user_id: 'U1', text: 'how can we save?', response_url: 'https://hooks.slack.com/commands/x' }).toString();
    const res = await post('/slack/commands', body);
    expect(res.body).toEqual({ response_type: 'ephemeral', text: 'Looking that up…' });
    await settle();
    expect(slack.sent).toEqual([{ kind: 'respond', to: 'https://hooks.slack.com/commands/x', message: { text: 'answer' } }]);
  });
});

class FakeLinks implements SlackLinkService {
  readonly codes: PendingLink[] = [];
  readonly linked: Record<string, string> = {};
  async createCode(_c: string, pending: PendingLink) {
    this.codes.push(pending);
    return `code-${this.codes.length}`;
  }
  async peekCode(): Promise<PendingLink> {
    throw new Error('not used');
  }
  async redeemCode(): Promise<never> {
    throw new Error('not used');
  }
  async findUid(_c: string, s: { teamId: string; userId: string }) {
    return this.linked[`${s.teamId}_${s.userId}`] ?? null;
  }
  async listLinks() {
    return [];
  }
  async deleteLink() {}
}

class FakeAgent implements AgentClient {
  readonly asked: Parameters<AgentClient['ask']>[0][] = [];
  failWith: Error | null = null;
  async ask(input: Parameters<AgentClient['ask']>[0]): Promise<AgentAnswer> {
    this.asked.push(input);
    if (this.failWith) throw this.failWith;
    return { status: 'ok', text: 'You spent **$1.00**.', requestId: 'r', sessionId: `s_${'c'.repeat(32)}`, links: [{ label: 'Requests', url: 'https://app.example/usage?month=2026-10' }], toolsCalled: [] };
  }
  async suggestions() {
    return {};
  }
}

describe('answering a Slack question', () => {
  function setup(users: Record<string, DirectoryUser | null> = {}) {
    const links = new FakeLinks();
    const agent = new FakeAgent();
    const slack = new FakeSlack();
    const usage = new FakeUsage();
    const replies: SlackMessage[] = [];
    const answer = createSlackResponder({
      companyId: COMPANY_ID,
      allowedTeamId: TEAM,
      webAppUrl: 'https://app.example',
      store: new FakeStore(pilotData()),
      usage,
      agent,
      links,
      slack,
      users: { get: async (uid) => (uid in users ? users[uid] : { email: `${uid}@example.com`, emailVerified: true, displayName: uid, disabled: false }) },
      logger: silentLogger,
      now: () => new Date('2026-10-19T03:00:00Z'),
    });
    const ask = (text: string, userId = 'U1', teamId = TEAM) => answer({ teamId, userId, text, reply: async (m) => void replies.push(m) });
    return { links, agent, slack, usage, replies, ask };
  }

  it('asks an unlinked person to link their account, privately, with a one-time code', async () => {
    const { ask, replies, links, agent } = setup();
    await ask('What did I spend?');
    expect(links.codes).toEqual([{ slackTeamId: TEAM, slackUserId: 'U1', slackName: 'Alice Slack', slackEmail: 'alice@example.com' }]);
    expect(JSON.stringify(replies[0].blocks)).toContain('https://app.example/slack/link?code=code-1');
    expect(agent.asked).toEqual([]);
  });

  it('answers a linked, active member with their own context and usage only', async () => {
    const { ask, replies, links, agent, usage } = setup();
    links.linked[`${TEAM}_U1`] = 'alice';
    await ask('What did I spend?');
    expect(agent.asked[0].context).toEqual({ tenantId: COMPANY_ID, userId: 'alice', role: 'individual_user', teamIds: ['team-a'], channel: 'slack', verifiedBy: 'slack_signature_and_linked_account' });
    expect(agent.asked[0].snapshot.usage.map((u) => u.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    for (const c of usage.calls.filter((c) => c.method === 'listUsage')) expect(c.args[1]).toEqual({ uid: 'alice', role: 'individual_user' });
    expect(replies[0].text).toBe('You spent *$1.00*.\n<https://app.example/usage?month=2026-10|Requests>');
    // A follow-up continues the same conversation.
    await ask('And last month?');
    expect(agent.asked[1].sessionId).toBe(`s_${'c'.repeat(32)}`);
  });

  it('refuses a suspended member, a disabled account, and another Slack workspace', async () => {
    const { ask, replies, links, agent } = setup({ bob: { email: 'bob@example.com', emailVerified: true, displayName: 'Bob', disabled: true } });
    links.linked[`${TEAM}_U1`] = 'sam';
    links.linked[`${TEAM}_U2`] = 'bob';
    await ask('hi', 'U1');
    await ask('hi', 'U2');
    await ask('hi', 'U3', 'T9999');
    expect(agent.asked).toEqual([]);
    expect(replies.map((r) => r.text)).toEqual([
      expect.stringContaining('don’t have access'),
      expect.stringContaining('isn’t active'),
      expect.stringContaining('only works in its own Slack workspace'),
    ]);
  });

  it('gives help for an empty question, and says so when the agent is down', async () => {
    const { ask, replies, links, agent } = setup();
    links.linked[`${TEAM}_U1`] = 'admin';
    await ask('  ');
    expect(replies[0].text).toBe(escapeSlack(HELP_TEXT));
    agent.failWith = new AgentUnavailableError('timeout');
    await ask('What did we spend?');
    expect(replies[1].text).toMatch(/no answer was generated/);
  });
});

describe('Slack formatting', () => {
  it('escapes control characters and keeps only https links', () => {
    const m = answerMessage({ status: 'ok', text: 'a < b & c', requestId: 'r', sessionId: null, links: [{ label: 'x|y', url: 'javascript:alert(1)' }, { label: 'ok', url: 'https://a.example/u' }], toolsCalled: [] });
    expect(m.text).toBe('a &lt; b &amp; c\n<https://a.example/u|ok>');
  });
  it('marks withheld answers and drops their links', () => {
    const m = answerMessage({ status: 'withheld', text: 'withheld', requestId: 'r', sessionId: null, links: [{ label: 'ok', url: 'https://a.example/u' }], toolsCalled: [] });
    expect(m.text).toBe(':warning: withheld');
  });
  it('the link prompt says not to forward it', () => {
    expect(JSON.stringify(linkPromptMessage('https://app.example/slack/link?code=x'))).toContain('Don’t forward it');
  });
});
