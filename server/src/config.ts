/**
 * Server settings, read once from environment variables at startup.
 *
 * None of these are secrets. Credentials come from Application Default Credentials
 * (your own Google sign-in locally, the runtime service account on Cloud Run), never
 * from a key file or an environment variable.
 *
 * A bad value stops the server from starting rather than running with a weaker setting.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ServerConfig {
  /** Firebase project whose ID tokens are accepted. Tokens for any other project are rejected. */
  firebaseProjectId: string;
  /** The single approved pilot company. Every database read and write is scoped to it. */
  pilotCompanyId: string;
  /** Firestore database ID. "(default)" unless the project uses a named database. */
  firestoreDatabaseId: string;
  /** Exact browser origins allowed by CORS. Empty means same-origin only. */
  allowedOrigins: string[];
  port: number;
  logLevel: LogLevel;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
// Firebase project IDs: 6-30 lowercase letters, digits and hyphens.
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
// Firestore document IDs we create ourselves: short, URL-safe, no slashes.
const DOC_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function value(env: Env, name: string): string {
  return (env[name] ?? '').trim();
}

function required(env: Env, name: string): string {
  const v = value(env, name);
  if (!v) throw new ConfigError(`${name} must be set (see server/.env.example).`);
  return v;
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** Each origin must be an exact scheme://host[:port]: https, or http only for localhost. */
export function parseAllowedOrigins(raw: string): string[] {
  if (!raw) return [];
  return raw.split(',').map((entry) => {
    const origin = entry.trim();
    if (origin.includes('*')) throw new ConfigError('ALLOWED_ORIGINS must list exact web addresses; wildcards are not allowed.');
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new ConfigError(`ALLOWED_ORIGINS contains an invalid address: "${origin}".`);
    }
    if (url.origin !== origin) throw new ConfigError(`ALLOWED_ORIGINS entries must be just scheme://host[:port], with no path or trailing slash: "${origin}".`);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost(url.hostname))) {
      throw new ConfigError(`ALLOWED_ORIGINS entries must use https (http is only allowed for localhost): "${origin}".`);
    }
    return origin;
  });
}

export function loadConfig(env: Env = process.env): ServerConfig {
  // The Auth emulator accepts unsigned tokens. It must never be switched on in a deployed service.
  if (value(env, 'FIREBASE_AUTH_EMULATOR_HOST') && value(env, 'K_SERVICE')) {
    throw new ConfigError('FIREBASE_AUTH_EMULATOR_HOST is set on Cloud Run. Remove it: it would accept fake sign-in tokens.');
  }
  const firebaseProjectId = required(env, 'FIREBASE_PROJECT_ID');
  if (!PROJECT_ID.test(firebaseProjectId)) throw new ConfigError('FIREBASE_PROJECT_ID is not a valid Firebase project ID.');

  const pilotCompanyId = required(env, 'PILOT_COMPANY_ID');
  if (!DOC_ID.test(pilotCompanyId)) {
    throw new ConfigError('PILOT_COMPANY_ID must be 1-63 lowercase letters, digits, "-" or "_", starting with a letter or digit.');
  }

  const firestoreDatabaseId = value(env, 'FIRESTORE_DATABASE_ID') || '(default)';

  const portText = value(env, 'PORT') || '8080';
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError('PORT must be a whole number between 1 and 65535.');

  const logLevelText = (value(env, 'LOG_LEVEL') || 'info').toLowerCase();
  if (!LOG_LEVELS.includes(logLevelText as LogLevel)) throw new ConfigError(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}.`);

  return {
    firebaseProjectId,
    pilotCompanyId,
    firestoreDatabaseId,
    allowedOrigins: parseAllowedOrigins(value(env, 'ALLOWED_ORIGINS')),
    port,
    logLevel: logLevelText as LogLevel,
  };
}
