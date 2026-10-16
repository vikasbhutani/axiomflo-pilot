/**
 * Browser persistence for HARMLESS demo preferences only (role, period, and later
 * simulated team edits). Never store credentials or secrets here.
 */
const PREFIX = 'axiomflo-demo:';

export function readPreference<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePreference<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode, blocked). The demo still works without it.
  }
}

export function clearPreferences(): void {
  try {
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // ignore
  }
}
