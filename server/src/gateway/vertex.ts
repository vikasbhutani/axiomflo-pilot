/**
 * The Gemini route: POST /vertex/{version}/models/{model}:generateContent
 * (and :streamGenerateContent?alt=sse).
 *
 * Callers use the Google Gen AI SDK (or plain HTTP) with the gateway's /vertex address
 * as the base URL and their AxiomFlo key as the API key. The gateway checks the key,
 * then calls Gemini on Vertex AI in the company's Google Cloud project as its own
 * service account (no key file), passes the answer back unchanged and records usage.
 * Only Google's own Gemini models can be called. Prompts and answers are never stored.
 *
 * The Vertex form of the path (/v1/projects/../locations/../publishers/google/models/..)
 * is accepted too, but the project and location in it are ignored: calls always go to
 * the company's project on the global endpoint.
 */
import { Router, type Response } from 'express';
import type { Logger } from '../http/logger.js';
import type { KeyService } from '../keys/service.js';
import { getPrincipal, HEADER_VALUE, keyGate, keyRateLimit, saveUsage, type Reject } from './common.js';
import { estimateVertexCostUsd, VERTEX_PRICE_VERSION } from './vertexPrices.js';
import type { UsageRecord, UsageRecorder } from './usage.js';
import { UPSTREAM_TIMEOUT_MS } from './anthropic.js';

const PATH = /^\/vertex\/(?:v1|v1beta|v1beta1)\/(?:projects\/[^/]+\/locations\/[^/]+\/publishers\/google\/)?models\/([^/:]+):(generateContent|streamGenerateContent)$/;
const GEMINI_MODEL = /^gemini-[a-z0-9.-]{1,80}$/;

/** A Google Cloud access token for the gateway's own identity. */
export interface TokenSource {
  token(): Promise<string>;
}

export function sendGoogleError(res: Response, status: number, googleStatus: string, message: string): void {
  if (res.headersSent) return;
  res.status(status).json({ error: { code: status, message, status: googleStatus }, requestId: res.locals.requestId });
}

const rejectGoogle: Reject = (res, why) => {
  if (why === 'missing') return sendGoogleError(res, 401, 'UNAUTHENTICATED', 'Send your AxiomFlo key in the x-goog-api-key header.');
  if (why === 'invalid') return sendGoogleError(res, 401, 'UNAUTHENTICATED', 'This AxiomFlo key is not valid. Create a new one in your AxiomFlo workspace.');
  if (why === 'forbidden') return sendGoogleError(res, 403, 'PERMISSION_DENIED', 'This AxiomFlo key can’t be used right now. Ask your company admin to check your access.');
  if (why === 'rate_limited') return sendGoogleError(res, 429, 'RESOURCE_EXHAUSTED', 'Too many requests with this AxiomFlo key. Please wait a minute.');
  return sendGoogleError(res, 503, 'UNAVAILABLE', 'AxiomFlo couldn’t check this key right now. Please try again shortly.');
};

interface UsageMetadata {
  promptTokenCount?: unknown;
  candidatesTokenCount?: unknown;
  thoughtsTokenCount?: unknown;
  cachedContentTokenCount?: unknown;
  promptTokensDetails?: { modality?: unknown; tokenCount?: unknown }[];
}

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/** Keeps the latest usage Vertex reported (the final chunk of a stream carries the totals). */
class GeminiTally {
  prompt: number | null = null;
  output: number | null = null;
  cached = 0;
  audio = 0;
  model: string | null = null;
  finished = false;
  add(chunk: { usageMetadata?: UsageMetadata; modelVersion?: unknown; candidates?: { finishReason?: unknown }[] } | null) {
    if (!chunk || typeof chunk !== 'object') return;
    if (typeof chunk.modelVersion === 'string') this.model = chunk.modelVersion;
    if (Array.isArray(chunk.candidates) && chunk.candidates.some((c) => typeof c?.finishReason === 'string')) this.finished = true;
    const u = chunk.usageMetadata;
    if (!u || typeof u !== 'object') return;
    const prompt = count(u.promptTokenCount);
    if (prompt !== null) this.prompt = prompt;
    const candidates = count(u.candidatesTokenCount);
    const thoughts = count(u.thoughtsTokenCount);
    if (candidates !== null || thoughts !== null) this.output = (candidates ?? 0) + (thoughts ?? 0);
    this.cached = count(u.cachedContentTokenCount) ?? this.cached;
    if (Array.isArray(u.promptTokensDetails)) {
      this.audio = u.promptTokensDetails.filter((d) => d?.modality === 'AUDIO').reduce((sum, d) => sum + (count(d.tokenCount) ?? 0), 0);
    }
  }
}

export interface VertexRouteDeps {
  keys: KeyService;
  usage: UsageRecorder;
  companyId: string;
  projectId: string;
  baseUrl: string;
  tokens: TokenSource;
  logger: Logger;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function vertexRouter({ keys, usage, companyId, projectId, baseUrl, tokens, logger, fetchImpl = fetch, now = () => Date.now() }: VertexRouteDeps): Router {
  const router = Router();
  const checkKey = keyGate({ keys, companyId, logger, reject: rejectGoogle });
  const rateLimited = keyRateLimit({ name: 'gateway-vertex', reject: rejectGoogle });

  router.post('/vertex/*rest', checkKey, rateLimited, async (req, res) => {
    const principal = getPrincipal(res);
    const match = PATH.exec(req.path);
    if (!match) return sendGoogleError(res, 404, 'NOT_FOUND', 'AxiomFlo forwards POST /vertex/v1beta/models/{model}:generateContent and :streamGenerateContent.');
    const [, requestedModel, method] = match;
    if (!GEMINI_MODEL.test(requestedModel)) return sendGoogleError(res, 400, 'INVALID_ARGUMENT', 'Only Google Gemini models can be called through AxiomFlo.');
    const stream = method === 'streamGenerateContent';
    if (stream && req.query.alt !== 'sse') return sendGoogleError(res, 400, 'INVALID_ARGUMENT', 'Streaming needs ?alt=sse (the Google Gen AI SDK adds it).');
    const body = req.body as unknown;
    if (!req.is('application/json') || !body || typeof body !== 'object' || Array.isArray(body)) return sendGoogleError(res, 400, 'INVALID_ARGUMENT', 'The request body must be a JSON object.');

    let accessToken: string;
    try {
      accessToken = await tokens.token();
    } catch (error) {
      logger.error('vertex credentials unavailable', { requestId: res.locals.requestId, errorName: error instanceof Error ? error.name : 'unknown' });
      return sendGoogleError(res, 503, 'UNAVAILABLE', 'AxiomFlo couldn’t get access to Vertex AI right now. Please try again shortly.');
    }

    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.on('close', onClose);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);
    const url = `${baseUrl}/v1/projects/${encodeURIComponent(projectId)}/locations/global/publishers/google/models/${encodeURIComponent(requestedModel)}:${method}${stream ? '?alt=sse' : ''}`;

    const started = now();
    const tally = new GeminiTally();
    let providerStatus: number | null = null;
    let providerRequestId: string | null = null;
    let succeeded = false;

    try {
      let upstream: globalThis.Response;
      try {
        upstream = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: JSON.stringify(body), signal });
      } catch {
        logger.warn('vertex unreachable', { requestId: res.locals.requestId });
        return sendGoogleError(res, 502, 'UNAVAILABLE', 'AxiomFlo couldn’t reach Vertex AI. Please try again.');
      }
      providerStatus = upstream.status;
      providerRequestId = upstream.headers.get('x-request-id') ?? upstream.headers.get('x-goog-request-id');
      res.status(upstream.status);
      for (const name of ['content-type', 'retry-after']) {
        const v = upstream.headers.get(name);
        if (v) res.setHeader(name, v);
      }

      if (stream && upstream.ok && upstream.body && (upstream.headers.get('content-type') ?? '').startsWith('text/event-stream')) {
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        const decoder = new TextDecoder();
        let buffer = '';
        const reader = upstream.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, nl).replace(/\r$/, '');
              buffer = buffer.slice(nl + 1);
              if (line.startsWith('data:')) {
                try {
                  tally.add(JSON.parse(line.slice(5).trim()));
                } catch {
                  // Not JSON: passed through, not counted.
                }
              }
            }
            if (buffer.length > 5_000_000) buffer = '';
            if (!res.write(value)) await new Promise<void>((resolve) => res.once('drain', resolve).once('close', resolve));
            if (res.destroyed) break;
          }
        } catch {
          // The caller left or Vertex dropped the connection: record what was reported so far.
        } finally {
          reader.cancel().catch(() => {});
        }
        succeeded = tally.finished;
        res.end();
      } else {
        const text = await upstream.text();
        if (upstream.ok) {
          try {
            tally.add(JSON.parse(text));
            succeeded = true;
          } catch {
            // Not JSON: pass it through, but don't count it as a success.
          }
        }
        res.send(text);
      }
    } catch {
      sendGoogleError(res, 502, 'UNAVAILABLE', 'The answer from Vertex AI was interrupted.');
    } finally {
      res.off('close', onClose);
      const reported = tally.prompt !== null && tally.output !== null;
      const modelId = tally.model && GEMINI_MODEL.test(tally.model) ? tally.model : requestedModel;
      const cached = Math.min(tally.cached, tally.prompt ?? 0);
      const cost = reported ? estimateVertexCostUsd(modelId, { promptTokens: tally.prompt!, cachedTokens: cached, audioPromptTokens: tally.audio, outputTokens: tally.output! }, new Date(started)) : null;
      const record: UsageRecord = {
        id: res.locals.requestId as string,
        timestamp: new Date(started).toISOString(),
        principal: { type: 'user', id: principal.uid },
        keyId: principal.keyId,
        teamId: principal.teamId,
        teamCode: principal.teamCode,
        providerId: 'gemini_vertex',
        modelId,
        // Stored like Anthropic's: input excludes cached prompt tokens, which are counted separately.
        inputTokens: reported ? tally.prompt! - cached : null,
        outputTokens: reported ? tally.output : null,
        cacheWriteTokens: reported ? 0 : null,
        cacheReadTokens: reported ? cached : null,
        requestStatus: succeeded ? 'succeeded' : 'failed',
        providerStatus,
        costStatus: cost === null ? 'unavailable' : 'estimated',
        estimatedCostUsd: cost,
        priceVersion: cost === null ? null : VERTEX_PRICE_VERSION,
        stream,
        latencyMs: Math.max(0, now() - started),
        providerRequestId: providerRequestId && HEADER_VALUE.test(providerRequestId) ? providerRequestId : null,
      };
      await saveUsage(usage, companyId, record, logger);
    }
  });

  return router;
}
