/**
 * Build-time settings for sign-in, read from Vite environment variables.
 *
 * Anything prefixed with VITE_ is copied into the JavaScript sent to every browser,
 * so only PUBLIC values belong here. Firebase web configuration is public client
 * configuration (it identifies your Firebase project); it is not a password and it
 * does not decide who may see data. Never put OAuth client secrets, service-account
 * keys or Firebase Admin credentials in VITE_ variables.
 */

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

type Env = Record<string, string | boolean | undefined>;

const FIREBASE_ENV_NAMES: Record<keyof FirebaseWebConfig, string> = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  appId: 'VITE_FIREBASE_APP_ID',
};

function text(env: Env, name: string): string {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

/** Returns the Firebase config, or the names of the variables that still need values. */
export function readFirebaseConfig(env: Env = import.meta.env): { config: FirebaseWebConfig | null; missing: string[] } {
  const entries = Object.entries(FIREBASE_ENV_NAMES) as [keyof FirebaseWebConfig, string][];
  const missing = entries.filter(([, name]) => !text(env, name)).map(([, name]) => name);
  if (missing.length > 0) return { config: null, missing };
  const config = Object.fromEntries(entries.map(([key, name]) => [key, text(env, name)])) as unknown as FirebaseWebConfig;
  return { config, missing: [] };
}

export interface AppSettings {
  /** Whether the "Explore the demo workspace" sample-data mode is offered. */
  demoEnabled: boolean;
  /** Published Terms of Service page, or null while it is still a setup requirement. */
  termsUrl: string | null;
  /** Published Privacy Policy page, or null while it is still a setup requirement. */
  privacyUrl: string | null;
  /** Base URL of the AxiomFlo API, or null to use the web app's own address (the default). */
  apiBaseUrl: string | null;
  /**
   * A view-only judge login shown on the sign-in page, or null to show none.
   * Deliberately public: it can only read the workspace (the API refuses every change).
   */
  judgeLogin: { email: string; password: string } | null;
}

/** Only allow https links or same-site paths, so a bad value can't become a javascript: link. */
function safeLink(value: string): string | null {
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export function readAppSettings(env: Env = import.meta.env): AppSettings {
  return {
    demoEnabled: text(env, 'VITE_DEMO_MODE').toLowerCase() !== 'disabled',
    termsUrl: safeLink(text(env, 'VITE_TERMS_URL')),
    privacyUrl: safeLink(text(env, 'VITE_PRIVACY_URL')),
    apiBaseUrl: text(env, 'VITE_API_BASE_URL') || null,
    judgeLogin: text(env, 'VITE_JUDGE_EMAIL') && text(env, 'VITE_JUDGE_PASSWORD') ? { email: text(env, 'VITE_JUDGE_EMAIL'), password: text(env, 'VITE_JUDGE_PASSWORD') } : null,
  };
}
