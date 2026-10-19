/**
 * Starts the AxiomFlo Slack bot (a separate Cloud Run service from the API).
 * Deploy the same image with the container command `node dist/slack/index.js`.
 */
import { agentClientFor } from '../assistant/agentClient.js';
import { ConfigError } from '../config.js';
import { initFirebase } from '../firebase.js';
import { createLogger } from '../http/logger.js';
import { createFirestoreMembershipStore } from '../membership/firestoreStore.js';
import { createFirestoreUsageService } from '../reports/firestoreUsageService.js';
import { createSlackApp } from './app.js';
import { loadSlackConfig } from './config.js';
import { createSlackResponder } from './handler.js';
import { createFirestoreSlackLinkService } from './links.js';
import { createSlackApi } from './slackApi.js';

function main() {
  let config;
  try {
    config = loadSlackConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(JSON.stringify({ severity: 'CRITICAL', message: `Configuration error: ${error.message}` }) + '\n');
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({ level: config.logLevel });
  const { auth, db } = initFirebase(config);
  const slack = createSlackApi({ botToken: config.botToken });
  const answer = createSlackResponder({
    companyId: config.pilotCompanyId,
    allowedTeamId: config.teamId,
    webAppUrl: config.webAppUrl,
    store: createFirestoreMembershipStore(db),
    usage: createFirestoreUsageService({ db, auth, logger }),
    agent: agentClientFor(config.agentUrl)!,
    links: createFirestoreSlackLinkService({ db }),
    slack,
    users: {
      async get(uid) {
        try {
          const u = await auth.getUser(uid);
          return { email: u.email ?? null, emailVerified: u.emailVerified, displayName: u.displayName ?? null, disabled: u.disabled };
        } catch (error) {
          if ((error as { code?: string })?.code === 'auth/user-not-found') return null;
          throw error;
        }
      },
    },
    logger,
  });
  const app = createSlackApp({ signingSecret: config.signingSecret, firebaseProjectId: config.firebaseProjectId, slack, answer, logger });

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('AxiomFlo Slack bot listening', { port: config.port, companyId: config.pilotCompanyId });
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down');
    server.close(() => process.exit(0));
  });
}

main();
