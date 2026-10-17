/**
 * Builds the Express app. Kept separate from `index.ts` (which starts listening) so
 * tests can create an app with fake dependencies.
 */
import express from 'express';
import type { ServerConfig } from './config.js';
import { cors } from './http/cors.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import type { Logger } from './http/logger.js';
import { requestContext } from './http/requestContext.js';
import { securityHeaders } from './http/securityHeaders.js';
import { healthRouter } from './routes/health.js';

/** Largest JSON body accepted. The API's requests are small (an email, a role, a few team IDs). */
export const BODY_LIMIT = '16kb';

export interface AppDeps {
  config: ServerConfig;
  logger: Logger;
}

export function createApp({ config, logger }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Cloud Run puts one Google front end in front of the container; trust exactly that hop
  // so req.ip (used for rate limiting) is the caller, not the proxy.
  app.set('trust proxy', 1);

  app.use(requestContext({ logger, projectId: config.firebaseProjectId }));
  app.use(securityHeaders);
  app.use(cors(config.allowedOrigins));
  app.use(express.json({ limit: BODY_LIMIT }));

  app.use(healthRouter());
  // Milestone 2 adds /api routes here, behind Firebase token verification.

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
