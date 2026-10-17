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
import { authenticate } from './auth/authenticate.js';
import type { TokenVerifier } from './auth/tokenVerifier.js';
import { requireActiveMember } from './membership/requireMember.js';
import type { MembershipStore } from './membership/store.js';
import { healthRouter } from './routes/health.js';
import { meRouter } from './routes/me.js';
import { workspaceRouter } from './routes/workspace.js';

/** Largest JSON body accepted. The API's requests are small (an email, a role, a few team IDs). */
export const BODY_LIMIT = '16kb';

export interface AppDeps {
  config: ServerConfig;
  logger: Logger;
  verifier: TokenVerifier;
  store: MembershipStore;
}

export function createApp({ config, logger, verifier, store }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Cloud Run puts one Google front end in front of the container; trust exactly that hop
  // so req.ip (used for rate limiting) is the caller, not the proxy.
  app.set('trust proxy', 1);

  app.use(requestContext({ logger, projectId: config.firebaseProjectId }));
  app.use(securityHeaders);
  app.use(cors(config.allowedOrigins));
  app.use(express.json({ limit: BODY_LIMIT }));

  // Every /api route verifies the Firebase ID token; workspace routes also re-check
  // the membership on each request. The company is always the configured pilot company.
  const companyId = config.pilotCompanyId;
  const auth = authenticate({ verifier, logger });
  const requireMember = requireActiveMember({ store, companyId, logger });

  app.use(healthRouter());
  app.use(meRouter({ authenticate: auth, store, companyId, logger }));
  app.use(workspaceRouter({ authenticate: auth, requireMember }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
