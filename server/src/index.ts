/** Starts the AxiomFlo API. Cloud Run sets PORT; we listen on all interfaces (0.0.0.0). */
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { initFirebase } from './firebase.js';
import { createLogger } from './http/logger.js';

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
  // Initialised now so a broken setup fails at startup; routes start using it in Milestone 2.
  initFirebase(config);
  const app = createApp({ config, logger });

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('AxiomFlo API listening', { port: config.port, companyId: config.pilotCompanyId });
  });

  // Cloud Run sends SIGTERM before stopping an instance: finish in-flight requests, then exit.
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down');
    server.close(() => process.exit(0));
  });
}

main();
