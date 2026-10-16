/**
 * Where to send someone after sign-in, kept to internal app routes so a crafted
 * link like /login?returnTo=https://evil.example can't bounce people off-site.
 */
import type { AuthState } from './types';

const AUTH_PAGES = ['/login', '/signup', '/reset-password', '/verify-email', '/access-pending', '/access-denied'];
const PLACEHOLDER_ORIGIN = 'https://axiomflo.invalid';

export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  // Reject control characters (browsers strip some of them, which can change meaning).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return '/';
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return '/';
  }
  if (url.origin !== PLACEHOLDER_ORIGIN || AUTH_PAGES.includes(url.pathname)) return '/';
  return url.pathname + url.search + url.hash;
}

/** The /login address that brings someone back to `path` after signing in. */
export function loginPathFor(path: string): string {
  const target = safeReturnTo(path);
  return target === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(target)}`;
}

/** Which page fits a sign-in state, or null while it is still loading. */
export function destinationFor(state: AuthState, returnTo = '/'): string | null {
  switch (state.status) {
    case 'initializing':
    case 'membership_loading':
      return null;
    case 'config_missing':
    case 'signed_out':
      return '/login';
    case 'approved':
      return safeReturnTo(returnTo);
    case 'verification_required':
      return '/verify-email';
    case 'pending':
    case 'error':
      return '/access-pending';
    case 'denied':
      return '/access-denied';
  }
}
