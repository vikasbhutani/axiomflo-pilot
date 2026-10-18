/**
 * The Claude route: POST /anthropic/v1/messages.
 *
 * Tools and SDKs point their Anthropic base URL at the gateway and use an AxiomFlo key
 * instead of an Anthropic key. For each request the gateway:
 *   1. checks the AxiomFlo key (and, through it, the person's membership and team),
 *   2. forwards the request to Anthropic with the company's key,
 *   3. passes the answer back unchanged, streamed or not, and
 *   4. records who, which team, which model, how many tokens and the estimated cost.
 *
 * Prompts and answers pass through but are never stored or logged. Only the
 * `anthropic-version` and `anthropic-beta` headers are forwarded; everything else the
 * caller sends (cookies, their own keys) stays here.
 *
 * Errors the gateway itself returns use Anthropic's error shape, so SDKs show them normally.
 */
import { Router, type Request, type Response } from 'express';
import type { Logger } from '../http/logger.js';
import { rateLimit } from '../http/rateLimit.js';
import { KeyRejectedError, type KeyPrincipal, type KeyService } from '../keys/service.js';
import { estimateAnthropicCostUsd, PRICE_VERSION, type TokenCounts } from './prices.js';
import type { UsageRecord, UsageRecorder } from './usage.js';

/** Largest request accepted. Requests with images or documents can be large. */
export const GATEWAY_BODY_LIMIT = '20mb';
/** Longest a single Claude request may run (long answers stream for minutes). */
export const UPSTREAM_TIMEOUT_MS = 10 * 60_000;
/** Requests per key per minute, as a guard against a leaked key or a runaway script. */
export const REQUESTS_PER_KEY_PER_MINUTE = 60;

const DEFAULT_VERSION = '2023-06-01';
const HEADER_VALUE = /^[\x21-\x7e][\x20-\x7e]{0,199}$/;
const MODEL_ID = /^[a-z0-9][a-z0-9.@_-]{0,99}$/i;
/** Response headers passed back to the caller; the rest stay here. */
const PASS_BACK = ['content-type', 'request-id', 'retry-after'];
/** Reasons that mean "this key is fine, but its owner isn't allowed right now". */
const FORBIDDEN_REASONS = new Set(['company_inactive', 'no_membership', 'member_suspended', 'team_inactive', 'team_not_assigned']);

type AnthropicErrorType = 'invalid_request_error' | 'authentication_error' | 'permission_error' | 'not_found_error' | 'rate_limit_error' | 'api_error';

export function sendAnthropicError(res: Response, status: number, type: AnthropicErrorType, message: string): void {
  if (res.headersSent) return;
  res.status(status).json({ type: 'error', error: { type, message }, request_id: res.locals.requestId });
}

/** The AxiomFlo key, from `x-api-key` (what Anthropic SDKs send) or `Authorization: Bearer`. */
function presentedKey(req: Request): string | null {
  const header = req.get('x-api-key')?.trim();
  if (header) return header;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(req.get('authorization') ?? '');
  return match ? match[1] : null;
}

interface UsageNumbers {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
}

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/** Collects the token counts Anthropic reports, keeping the latest value for each. */
class UsageTally {
  input: number | null = null;
  output: number | null = null;
  cacheWrite: number | null = null;
  cacheRead: number | null = null;
  model: string | null = null;
  add(usage: UsageNumbers | undefined) {
    if (!usage || typeof usage !== 'object') return;
    this.input = count(usage.input_tokens) ?? this.input;
    this.output = count(usage.output_tokens) ?? this.output;
    this.cacheWrite = count(usage.cache_creation_input_tokens) ?? this.cacheWrite;
    this.cacheRead = count(usage.cache_read_input_tokens) ?? this.cacheRead;
  }
  /** Both counts are needed for a cost estimate. */
  get reported() {
    return this.input !== null && this.output !== null;
  }
}

/**
 * Reads a streamed (server-sent events) answer as it passes through, picking out the
 * usage from `message_start` and `message_delta` events. The text itself is ignored.
 */
class StreamWatcher {
  private buffer = '';
  private readonly decoder = new TextDecoder();
  finished = false;
  errored = false;
  constructor(private readonly tally: UsageTally) {}
  push(chunk: Uint8Array) {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      if (line.startsWith('data:')) this.event(line.slice(5).trim());
    }
    // A line this long is answer text, not a usage event; drop it to keep memory small.
    if (this.buffer.length > 1_000_000) this.buffer = '';
  }
  private event(data: string) {
    // Only the few event types that carry usage are parsed.
    if (!/"type"\s*:\s*"(message_start|message_delta|message_stop|error)"/.test(data.slice(0, 200))) return;
    let event: { type?: string; message?: { model?: unknown; usage?: UsageNumbers }; usage?: UsageNumbers };
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event.type === 'message_start') {
      if (typeof event.message?.model === 'string') this.tally.model = event.message.model;
      this.tally.add(event.message?.usage);
    } else if (event.type === 'message_delta') {
      this.tally.add(event.usage);
    } else if (event.type === 'message_stop') {
      this.finished = true;
    } else if (event.type === 'error') {
      this.errored = true;
    }
  }
}

export interface AnthropicRouteDeps {
  keys: KeyService;
  usage: UsageRecorder;
  companyId: string;
  apiKey: string;
  baseUrl: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function anthropicRouter({ keys, usage, companyId, apiKey, baseUrl, logger, fetchImpl = fetch, now = () => Date.now() }: AnthropicRouteDeps): Router {
  const router = Router();
  const perKeyLimit = rateLimit({ name: 'gateway', limit: REQUESTS_PER_KEY_PER_MINUTE, windowMs: 60_000, key: (l) => (l.principal as KeyPrincipal).keyId });

  const checkKey = async (req: Request, res: Response, next: (err?: unknown) => void) => {
    const raw = presentedKey(req);
    if (!raw) return sendAnthropicError(res, 401, 'authentication_error', 'Send your AxiomFlo key in the x-api-key header.');
    try {
      res.locals.principal = await keys.resolveKey(companyId, raw);
      return next();
    } catch (error) {
      if (error instanceof KeyRejectedError) {
        logger.warn('gateway key rejected', { requestId: res.locals.requestId, reason: error.reason });
        if (FORBIDDEN_REASONS.has(error.reason)) return sendAnthropicError(res, 403, 'permission_error', 'This AxiomFlo key can’t be used right now. Ask your company admin to check your access.');
        return sendAnthropicError(res, 401, 'authentication_error', 'This AxiomFlo key is not valid. Create a new one in your AxiomFlo workspace.');
      }
      // Never let a database problem through as "allowed".
      logger.error('gateway key check unavailable', { requestId: res.locals.requestId, errorName: error instanceof Error ? error.name : 'unknown' });
      return sendAnthropicError(res, 503, 'api_error', 'AxiomFlo couldn’t check this key right now. Please try again shortly.');
    }
  };

  const rateLimited = (req: Request, res: Response, next: (err?: unknown) => void) =>
    perKeyLimit(req, res, (err?: unknown) => (err ? sendAnthropicError(res, 429, 'rate_limit_error', 'Too many requests with this AxiomFlo key. Please wait a minute.') : next()));

  router.post('/anthropic/v1/messages', checkKey, rateLimited, async (req, res) => {
    const principal = res.locals.principal as KeyPrincipal;
    const body = req.body as Record<string, unknown> | undefined;
    if (!req.is('application/json') || !body || typeof body !== 'object' || Array.isArray(body)) {
      return sendAnthropicError(res, 400, 'invalid_request_error', 'The request body must be a JSON object.');
    }
    if (typeof body.model !== 'string' || !MODEL_ID.test(body.model)) return sendAnthropicError(res, 400, 'invalid_request_error', 'model: a model name is required.');
    if (body.stream !== undefined && typeof body.stream !== 'boolean') return sendAnthropicError(res, 400, 'invalid_request_error', 'stream: must be true or false.');
    const requestedModel = body.model;
    const stream = body.stream === true;

    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-api-key': apiKey };
    for (const name of ['anthropic-version', 'anthropic-beta']) {
      const v = req.get(name);
      if (v !== undefined && !HEADER_VALUE.test(v)) return sendAnthropicError(res, 400, 'invalid_request_error', `${name}: invalid header value.`);
      if (v) headers[name] = v;
    }
    headers['anthropic-version'] ??= DEFAULT_VERSION;

    // Stop the Anthropic request if the caller goes away or it runs too long.
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.on('close', onClose);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);

    const started = now();
    const tally = new UsageTally();
    let providerStatus: number | null = null;
    let providerRequestId: string | null = null;
    let succeeded = false;

    try {
      let upstream: globalThis.Response;
      try {
        upstream = await fetchImpl(`${baseUrl}/v1/messages`, { method: 'POST', headers, body: JSON.stringify(body), signal });
      } catch {
        logger.warn('anthropic unreachable', { requestId: res.locals.requestId });
        return sendAnthropicError(res, 502, 'api_error', 'AxiomFlo couldn’t reach Anthropic. Please try again.');
      }
      providerStatus = upstream.status;
      providerRequestId = upstream.headers.get('request-id');

      res.status(upstream.status);
      for (const name of PASS_BACK) {
        const v = upstream.headers.get(name);
        if (v) res.setHeader(name, v);
      }

      const isStream = (upstream.headers.get('content-type') ?? '').startsWith('text/event-stream');
      if (isStream && upstream.body) {
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        const watcher = new StreamWatcher(tally);
        const reader = upstream.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            watcher.push(value);
            if (!res.write(value)) await new Promise<void>((resolve) => res.once('drain', resolve).once('close', resolve));
            if (res.destroyed) break;
          }
        } catch {
          // The caller left or Anthropic dropped the connection: record what was reported so far.
        } finally {
          reader.cancel().catch(() => {});
        }
        succeeded = upstream.ok && watcher.finished && !watcher.errored;
        res.end();
      } else {
        const text = await upstream.text();
        if (upstream.ok) {
          try {
            const parsed = JSON.parse(text) as { model?: unknown; usage?: UsageNumbers };
            if (typeof parsed.model === 'string') tally.model = parsed.model;
            tally.add(parsed.usage);
            succeeded = true;
          } catch {
            // Not JSON: pass it through, but don't count it as a success.
          }
        }
        res.send(text);
      }
    } catch {
      sendAnthropicError(res, 502, 'api_error', 'The answer from Anthropic was interrupted.');
    } finally {
      res.off('close', onClose);
      await recordUsage();
    }

    async function recordUsage() {
      const tokens: TokenCounts | null = tally.reported
        ? { inputTokens: tally.input!, outputTokens: tally.output!, cacheWriteTokens: tally.cacheWrite ?? 0, cacheReadTokens: tally.cacheRead ?? 0 }
        : null;
      const modelId = tally.model && MODEL_ID.test(tally.model) ? tally.model : requestedModel;
      const cost = tokens ? estimateAnthropicCostUsd(modelId, tokens) : null;
      const record: UsageRecord = {
        id: res.locals.requestId as string,
        timestamp: new Date(started).toISOString(),
        principal: { type: 'user', id: principal.uid },
        keyId: principal.keyId,
        teamId: principal.teamId,
        teamCode: principal.teamCode,
        providerId: 'anthropic',
        modelId,
        inputTokens: tokens ? tally.input : null,
        outputTokens: tokens ? tally.output : null,
        cacheWriteTokens: tokens ? tally.cacheWrite : null,
        cacheReadTokens: tokens ? tally.cacheRead : null,
        requestStatus: succeeded ? 'succeeded' : 'failed',
        providerStatus,
        costStatus: cost === null ? 'unavailable' : 'estimated',
        estimatedCostUsd: cost,
        priceVersion: cost === null ? null : PRICE_VERSION,
        stream,
        latencyMs: Math.max(0, now() - started),
        providerRequestId: providerRequestId && HEADER_VALUE.test(providerRequestId) ? providerRequestId : null,
      };
      try {
        await usage.record(companyId, record);
      } catch (error) {
        // The answer has already gone back; the log line is how a missing record is found.
        logger.error('usage record failed', { requestId: record.id, keyId: record.keyId, modelId, errorName: error instanceof Error ? error.name : 'unknown' });
      }
    }
  });

  return router;
}
