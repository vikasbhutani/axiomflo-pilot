import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseAllowedOrigins } from './config.js';

const base = { FIREBASE_PROJECT_ID: 'axiomflo-pilot', PILOT_COMPANY_ID: 'acme' };

describe('loadConfig', () => {
  it('reads a minimal configuration with safe defaults', () => {
    expect(loadConfig(base)).toEqual({
      firebaseProjectId: 'axiomflo-pilot',
      pilotCompanyId: 'acme',
      firestoreDatabaseId: '(default)',
      allowedOrigins: [],
      port: 8080,
      logLevel: 'info',
    });
  });

  it('uses the PORT Cloud Run provides', () => {
    expect(loadConfig({ ...base, PORT: '9000' }).port).toBe(9000);
  });

  it.each([
    [{ PILOT_COMPANY_ID: 'acme' }, /FIREBASE_PROJECT_ID/],
    [{ FIREBASE_PROJECT_ID: 'axiomflo-pilot' }, /PILOT_COMPANY_ID/],
    [{ ...base, PILOT_COMPANY_ID: 'companies/other' }, /PILOT_COMPANY_ID/],
    [{ ...base, FIREBASE_PROJECT_ID: 'Not A Project' }, /FIREBASE_PROJECT_ID/],
    [{ ...base, PORT: 'eighty' }, /PORT/],
    [{ ...base, LOG_LEVEL: 'verbose' }, /LOG_LEVEL/],
  ])('refuses to start with a bad setting (%o)', (env, message) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(message);
  });
});

describe('parseAllowedOrigins', () => {
  it('accepts exact https origins and http://localhost', () => {
    expect(parseAllowedOrigins('https://app.example.com, http://localhost:5173')).toEqual(['https://app.example.com', 'http://localhost:5173']);
  });

  it.each(['*', 'https://*.run.app', 'http://app.example.com', 'https://app.example.com/', 'https://app.example.com/path', 'not a url'])(
    'rejects %s',
    (origin) => {
      expect(() => parseAllowedOrigins(origin)).toThrow(ConfigError);
    },
  );
});
