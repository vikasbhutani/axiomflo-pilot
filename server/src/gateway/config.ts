/**
 * Settings for the AI gateway service. It shares the API's base settings (project,
 * pilot company, database, port, log level) and adds the provider settings.
 *
 * ANTHROPIC_API_KEY is the company's Claude Console key. On Cloud Run it is injected
 * from Secret Manager, never typed into the service's plain environment variables or
 * committed anywhere. It is never logged and never sent back to a caller. Without it,
 * the Claude route answers "not set up" and the Gemini route still works.
 *
 * Gemini needs no key: the gateway calls Vertex AI as its own service account
 * (Application Default Credentials), in VERTEX_PROJECT_ID (the Firebase project by default).
 */
import { ConfigError, loadConfig, type ServerConfig } from '../config.js';

export interface GatewayConfig extends ServerConfig {
  /** Empty when Claude isn't set up on this gateway. */
  anthropicApiKey: string;
  /** Where Claude requests are forwarded. Only changed for tests. */
  anthropicBaseUrl: string;
  /** Google Cloud project whose Vertex AI the Gemini route calls. */
  vertexProjectId: string;
  /** Vertex AI's global endpoint. Only changed for tests. */
  vertexBaseUrl: string;
}

type Env = Record<string, string | undefined>;

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_VERTEX_BASE_URL = 'https://aiplatform.googleapis.com';
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** https only, except http for a local test server; no path, query or credentials. */
export function parseBaseUrl(name: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} is not a valid web address.`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new ConfigError(`${name} must use https.`);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new ConfigError(`${name} must be just scheme://host[:port].`);
  }
  return url.origin;
}

export function loadGatewayConfig(env: Env = process.env): GatewayConfig {
  const base = loadConfig(env);
  const anthropicApiKey = (env.ANTHROPIC_API_KEY ?? '').trim();
  const anthropicBaseUrl = parseBaseUrl('ANTHROPIC_BASE_URL', (env.ANTHROPIC_BASE_URL ?? '').trim() || DEFAULT_ANTHROPIC_BASE_URL);
  if (env.K_SERVICE && anthropicBaseUrl !== DEFAULT_ANTHROPIC_BASE_URL) throw new ConfigError('ANTHROPIC_BASE_URL can only be changed for local tests.');
  const vertexProjectId = (env.VERTEX_PROJECT_ID ?? '').trim() || base.firebaseProjectId;
  if (!PROJECT_ID.test(vertexProjectId)) throw new ConfigError('VERTEX_PROJECT_ID is not a valid Google Cloud project ID.');
  const vertexBaseUrl = parseBaseUrl('VERTEX_BASE_URL', (env.VERTEX_BASE_URL ?? '').trim() || DEFAULT_VERTEX_BASE_URL);
  if (env.K_SERVICE && vertexBaseUrl !== DEFAULT_VERTEX_BASE_URL) throw new ConfigError('VERTEX_BASE_URL can only be changed for local tests.');
  return { ...base, anthropicApiKey, anthropicBaseUrl, vertexProjectId, vertexBaseUrl };
}
