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
import type { AdminService } from './admin/service.js';
import type { KeyService } from './keys/service.js';
import type { UsageService } from './reports/service.js';
import type { AgentClient } from './assistant/agentClient.js';
import { assistantRouter } from './routes/assistant.js';
import { slackLinksRouter } from './routes/slackLinks.js';
import type { SlackLinkService } from './slack/links.js';
import { adminRouter } from './routes/admin.js';
import { healthRouter } from './routes/health.js';
import { keysRouter } from './routes/keys.js';
import { meRouter } from './routes/me.js';
import { reportsRouter } from './routes/reports.js';
import { workspaceRouter } from './routes/workspace.js';
import { upgradeAnalysisRouter } from './routes/upgradeAnalysis.js';
import { createMemoryUpgradeStore, type UpgradeAnalysisStore } from './upgrade/store.js';

/** Largest JSON body accepted. The API's requests are small (an email, a role, a few team IDs). */
export const BODY_LIMIT = '16kb';

export interface AppDeps {
  config: ServerConfig;
  logger: Logger;
  verifier: TokenVerifier;
  store: MembershipStore;
  admin: AdminService;
  keys: KeyService;
  usage: UsageService;
  /** The AxiomFlo Agent; absent or null when AGENT_URL isn't set. */
  agent?: AgentClient | null;
  /** Slack account links; absent in tests that don't need them. */
  slackLinks?: SlackLinkService | null;
  /** Saved Upgrade Analyses; in memory when absent (tests). */
  upgradeStore?: UpgradeAnalysisStore;
}

export function createApp({ config, logger, verifier, store, admin, keys, usage, agent = null, slackLinks = null, upgradeStore = createMemoryUpgradeStore() }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Cloud Run puts one Google front end in front of the container; trust exactly that hop.
  // (Rate limits count per signed-in user, not per IP.)
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
  app.use(adminRouter({ authenticate: auth, requireMember, admin, companyId, logger }));
  app.use(keysRouter({ authenticate: auth, requireMember, keys, companyId, logger }));
  app.use(reportsRouter({ authenticate: auth, requireMember, usage, companyId, logger }));
  app.use(assistantRouter({ authenticate: auth, requireMember, usage, agent, companyId, logger }));
  app.use(upgradeAnalysisRouter({ authenticate: auth, requireMember, usage, store: upgradeStore, companyId, logger }));
  if (slackLinks) app.use(slackLinksRouter({ authenticate: auth, requireMember, links: slackLinks, companyId, logger }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
