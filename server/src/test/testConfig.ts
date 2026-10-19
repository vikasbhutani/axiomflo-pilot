import type { ServerConfig } from '../config.js';

export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    firebaseProjectId: 'axiomflo-test',
    pilotCompanyId: 'test-company',
    firestoreDatabaseId: '(default)',
    allowedOrigins: [],
    port: 8080,
    logLevel: 'error',
    agentUrl: null,
    ...overrides,
  };
}
