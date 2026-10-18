/**
 * Starts the AxiomFlo AI gateway (a separate Cloud Run service from the API).
 * Deploy the same image with the container command `node dist/gateway/index.js`.
 */
import { applicationDefault } from 'firebase-admin/app';
import { ConfigError } from '../config.js';
import { initFirebase } from '../firebase.js';
import { createLogger } from '../http/logger.js';
import { createFirestoreKeyService } from '../keys/firestoreKeyService.js';
import { createGatewayApp } from './app.js';
import { loadGatewayConfig } from './config.js';
import { credentialTokenSource } from './googleTokens.js';
import { createFirestoreUsageRecorder } from './usage.js';

function main() {
  let config;
  try {
    config = loadGatewayConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(JSON.stringify({ severity: 'CRITICAL', message: `Configuration error: ${error.message}` }) + '\n');
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({ level: config.logLevel });
  const { auth, db } = initFirebase(config);
  const app = createGatewayApp({ config, logger, keys: createFirestoreKeyService({ db, auth }), usage: createFirestoreUsageRecorder(db), googleTokens: credentialTokenSource(applicationDefault()) });

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('AxiomFlo gateway listening', { port: config.port, companyId: config.pilotCompanyId });
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down');
    server.close(() => process.exit(0));
  });
}

main();
