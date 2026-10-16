/**
 * Turns Firebase sign-in errors into calm, plain-language messages.
 * Only the error `code` is read: Firebase errors can carry token data in other
 * fields, so error objects are never logged or displayed.
 */

export type SignInErrorKind =
  | 'cancelled'
  | 'popup_blocked'
  | 'unauthorized_domain'
  | 'network'
  | 'provider_disabled'
  | 'configuration'
  | 'too_many_requests'
  | 'user_disabled'
  | 'unknown';

export interface SignInError {
  kind: SignInErrorKind;
  message: string;
}

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export function describeSignInError(error: unknown, hostname: string = window.location.hostname): SignInError {
  switch (errorCode(error)) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return { kind: 'cancelled', message: 'Sign-in was cancelled. You can try again whenever you’re ready.' };
    case 'auth/popup-blocked':
      return { kind: 'popup_blocked', message: 'Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.' };
    case 'auth/unauthorized-domain':
      return {
        kind: 'unauthorized_domain',
        message: `Google sign-in isn’t enabled for this web address (${hostname}) yet. An administrator needs to add it to the authorized domains in Firebase Authentication.`,
      };
    case 'auth/network-request-failed':
    case 'auth/timeout':
      return { kind: 'network', message: 'We couldn’t reach Google. Check your internet connection and try again.' };
    case 'auth/operation-not-allowed':
      return { kind: 'provider_disabled', message: 'Google sign-in hasn’t been turned on for AxiomFlo yet. An administrator needs to enable the Google provider in Firebase Authentication.' };
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
    case 'auth/configuration-not-found':
    case 'auth/app-not-authorized':
    case 'auth/invalid-app-id':
      return { kind: 'configuration', message: 'AxiomFlo’s sign-in settings don’t match the Firebase project. An administrator needs to check the Firebase configuration values.' };
    case 'auth/too-many-requests':
      return { kind: 'too_many_requests', message: 'There have been too many sign-in attempts. Please wait a few minutes and try again.' };
    case 'auth/user-disabled':
      return { kind: 'user_disabled', message: 'This account has been disabled for AxiomFlo sign-in. Contact your AxiomFlo administrator.' };
    default:
      return { kind: 'unknown', message: 'Something went wrong while signing in with Google. Please try again.' };
  }
}
