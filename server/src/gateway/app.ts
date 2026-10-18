/**
 * The AI gateway app: a separate Cloud Run service built from the same code as the API.
 * It is called by tools and scripts with an AxiomFlo key, never by the web app, so it
 * sends no CORS headers (browsers can't call it from other sites).
 */
import express from 'express';
import { errorHandler } from '../http/errors.js';
import type { Logger } from '../http/logger.js';
import { requestContext } from '../http/requestContext.js';
import { securityHeaders } from '../http/securityHeaders.js';
import type { KeyService } from '../keys/service.js';
import { healthRouter } from '../routes/health.js';
import { anthropicRouter, GATEWAY_BODY_LIMIT, sendAnthropicError } from './anthropic.js';
import type { GatewayConfig } from './config.js';
import type { UsageRecorder } from './usage.js';
import { vertexRouter, type TokenSource } from './vertex.js';

export interface GatewayDeps {
  config: GatewayConfig;
  logger: Logger;
  keys: KeyService;
  usage: UsageRecorder;
  /** Google Cloud access tokens for calling Vertex AI as the gateway's own identity. */
  googleTokens: TokenSource;
  fetchImpl?: typeof fetch;
}

export function createGatewayApp({ config, logger, keys, usage, googleTokens, fetchImpl }: GatewayDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('etag', false);

  app.use(requestContext({ logger, projectId: config.firebaseProjectId }));
  app.use(securityHeaders);
  app.use(healthRouter());
  app.use(express.json({ limit: GATEWAY_BODY_LIMIT }));

  app.use(anthropicRouter({ keys, usage, companyId: config.pilotCompanyId, apiKey: config.anthropicApiKey, baseUrl: config.anthropicBaseUrl, logger, fetchImpl }));
  app.use(vertexRouter({ keys, usage, companyId: config.pilotCompanyId, projectId: config.vertexProjectId, baseUrl: config.vertexBaseUrl, tokens: googleTokens, logger, fetchImpl }));

  app.use((_req, res) => sendAnthropicError(res, 404, 'not_found_error', 'Not found. AxiomFlo forwards POST /anthropic/v1/messages and POST /vertex/v1beta/models/{model}:generateContent.'));
  // Bad JSON and too-large bodies, in Anthropic's error shape; anything else falls through.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const type = (err as { type?: unknown })?.type;
    if (type === 'entity.too.large') return sendAnthropicError(res, 413, 'invalid_request_error', 'The request body is too large.');
    if ((typeof type === 'string' && type.startsWith('entity.')) || type === 'charset.unsupported' || (err as { status?: unknown })?.status === 400) {
      return sendAnthropicError(res, 400, 'invalid_request_error', 'The request body could not be read as JSON.');
    }
    return next(err);
  });
  app.use(errorHandler(logger));
  return app;
}
