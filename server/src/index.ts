/** Starts the AxiomFlo API. Cloud Run sets PORT; we listen on all interfaces (0.0.0.0). */
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createFirestoreAdminService } from './admin/firestoreAdminService.js';
import { createFirestoreKeyService } from './keys/firestoreKeyService.js';
import { createFirebaseTokenVerifier } from './auth/tokenVerifier.js';
import { initFirebase } from './firebase.js';
import { createLogger } from './http/logger.js';
import { createFirestoreMembershipStore } from './membership/firestoreStore.js';
import { createFirestoreUsageService } from './reports/firestoreUsageService.js';
import { agentClientFor } from './assistant/agentClient.js';
import { createFirestoreSlackLinkService } from './slack/links.js';

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(JSON.stringify({ severity: 'CRITICAL', message: `Configuration error: ${error.message}` }) + '\n');
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({ level: config.logLevel });
  const { auth, db } = initFirebase(config);
  const app = createApp({
    config,
    logger,
    verifier: createFirebaseTokenVerifier(auth, config.firebaseProjectId),
    store: createFirestoreMembershipStore(db),
    admin: createFirestoreAdminService({ db, auth }),
    keys: createFirestoreKeyService({ db, auth }),
    usage: createFirestoreUsageService({ db, auth, logger }),
    agent: agentClientFor(config.agentUrl),
    slackLinks: createFirestoreSlackLinkService({ db }),
  });

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('AxiomFlo API listening', { port: config.port, companyId: config.pilotCompanyId, assistant: config.agentUrl ? 'connected' : 'not set up' });
  });

  // Cloud Run sends SIGTERM before stopping an instance: finish in-flight requests, then exit.
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down');
    server.close(() => process.exit(0));
  });
}

main();
