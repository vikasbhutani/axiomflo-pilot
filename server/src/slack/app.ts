/**
 * The Slack bot: a separate Cloud Run service (`axiomflo-slack`) built from the same
 * code as the API. Slack calls it directly; every request must carry Slack's signature.
 *
 *   POST /slack/events     Events API: direct messages to the bot, and @mentions
 *   POST /slack/commands   the /axiomflo slash command
 *   GET  /health
 *
 * Slack wants an answer within three seconds, so each request is acknowledged at once
 * and answered afterwards. (The service runs with CPU always allocated for that.)
 * Answers are private: in direct messages, or "only visible to you" in channels.
 */
import express, { type Request, type Response } from 'express';
import type { Logger } from '../http/logger.js';
import { requestContext } from '../http/requestContext.js';
import { securityHeaders } from '../http/securityHeaders.js';
import { healthRouter } from '../routes/health.js';
import type { SlackQuestion } from './handler.js';
import { isFromSlack } from './signature.js';
import type { SlackApi } from './slackApi.js';

export const SLACK_BODY_LIMIT = '256kb';
const PER_USER_PER_MINUTE = 20;

export interface SlackAppDeps {
  signingSecret: string;
  firebaseProjectId: string;
  slack: SlackApi;
  answer: (q: SlackQuestion) => Promise<void>;
  logger: Logger;
  now?: () => number;
}

export function createSlackApp({ signingSecret, firebaseProjectId, slack, answer, logger, now = () => Date.now() }: SlackAppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestContext({ logger, projectId: firebaseProjectId }));
  app.use(securityHeaders);
  app.use(healthRouter());

  const seenEvents = new Map<string, number>();
  const perUser = new Map<string, { start: number; count: number }>();

  function firstTime(eventId: string): boolean {
    const t = now();
    for (const [id, at] of seenEvents) if (t - at > 15 * 60_000) seenEvents.delete(id);
    if (seenEvents.has(eventId)) return false;
    seenEvents.set(eventId, t);
    return true;
  }

  function allowed(key: string): boolean {
    const t = now();
    const w = perUser.get(key);
    if (!w || t - w.start >= 60_000) {
      perUser.set(key, { start: t, count: 1 });
      if (perUser.size > 5_000) for (const [k, v] of perUser) if (t - v.start >= 60_000) perUser.delete(k);
      return true;
    }
    w.count++;
    return w.count <= PER_USER_PER_MINUTE;
  }

  function verified(req: Request, res: Response): string | null {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!isFromSlack({ secret: signingSecret, timestamp: req.get('x-slack-request-timestamp'), signature: req.get('x-slack-signature'), rawBody, now })) {
      res.status(401).json({ error: { code: 'unauthenticated', message: 'Not a signed Slack request.' } });
      return null;
    }
    return rawBody;
  }

  /** Runs after the response has gone, so Slack isn't kept waiting. */
  function later(work: () => Promise<void>, requestId: string) {
    setImmediate(() => void work().catch((error) => logger.error('slack work failed', { requestId, errorName: (error as Error)?.name })));
  }

  const raw = express.raw({ type: () => true, limit: SLACK_BODY_LIMIT });

  app.post('/slack/events', raw, (req, res) => {
    const rawBody = verified(req, res);
    if (rawBody === null) return;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: { code: 'bad_request', message: 'Not JSON.' } });
      return;
    }
    if (body.type === 'url_verification' && typeof body.challenge === 'string') {
      res.json({ challenge: body.challenge });
      return;
    }
    // Slack retries when we were slow; the first delivery is already being handled.
    if (req.get('x-slack-retry-num') || body.type !== 'event_callback' || typeof body.event_id !== 'string' || !firstTime(body.event_id)) {
      res.sendStatus(200);
      return;
    }
    res.sendStatus(200);

    const event = (body.event ?? {}) as Record<string, unknown>;
    const teamId = typeof body.team_id === 'string' ? body.team_id : '';
    const userId = typeof event.user === 'string' ? event.user : '';
    const channel = typeof event.channel === 'string' ? event.channel : '';
    const text = typeof event.text === 'string' ? event.text : '';
    const threadTs = typeof event.thread_ts === 'string' ? event.thread_ts : undefined;
    // Never answer bots (including ourselves) or edits, joins and other message subtypes.
    if (!userId || !channel || event.bot_id || event.subtype) return;
    const isDm = event.type === 'message' && event.channel_type === 'im';
    const isMention = event.type === 'app_mention';
    if (!isDm && !isMention) return;
    if (!allowed(`${teamId}:${userId}`)) return;

    const question = text.replace(/<@[A-Z0-9]+>/g, '').trim();
    later(
      () =>
        answer({
          teamId,
          userId,
          text: question,
          // In a channel, only the person who asked sees the answer.
          reply: (m) => (isDm ? slack.postMessage(channel, m, threadTs) : slack.postEphemeral(channel, userId, m, threadTs)),
        }),
      res.locals.requestId,
    );
  });

  app.post('/slack/commands', raw, (req, res) => {
    const rawBody = verified(req, res);
    if (rawBody === null) return;
    const form = new URLSearchParams(rawBody);
    const teamId = form.get('team_id') ?? '';
    const userId = form.get('user_id') ?? '';
    const responseUrl = form.get('response_url') ?? '';
    if (!teamId || !userId || !responseUrl) {
      res.status(400).json({ error: { code: 'bad_request', message: 'Missing command fields.' } });
      return;
    }
    if (!allowed(`${teamId}:${userId}`)) {
      res.json({ response_type: 'ephemeral', text: 'Too many questions in a short time. Please wait a minute.' });
      return;
    }
    res.json({ response_type: 'ephemeral', text: 'Looking that up…' });
    later(() => answer({ teamId, userId, text: form.get('text') ?? '', reply: (m) => slack.respond(responseUrl, m) }), res.locals.requestId);
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
  });
  return app;
}
