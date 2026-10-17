/**
 * Verifies Firebase ID tokens with the Admin SDK and returns the caller's identity.
 *
 * `verifyIdToken(token, true)` checks the signature, expiry, and that the token was
 * issued for OUR Firebase project (audience and issuer). The `true` (checkRevoked)
 * also looks the user up in Firebase Authentication, so tokens are refused once
 * sessions are revoked or the account is disabled. We re-check the audience and
 * issuer ourselves as a second line of defence.
 *
 * Tokens are never logged, and neither are the Admin SDK's error messages (which can
 * quote token contents). Only the error code is read.
 */
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';

/** The only facts about the caller the API trusts. They come from the verified token, never the request body. */
export interface VerifiedIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  /** How they signed in, e.g. "google.com" or "password". */
  signInProvider: string | null;
}

export type TokenRejection = 'invalid' | 'expired' | 'revoked' | 'disabled' | 'wrong_project';

/** The token was checked and is not acceptable: respond 401. */
export class TokenRejectedError extends Error {
  constructor(readonly reason: TokenRejection) {
    super(`Token rejected: ${reason}`);
    this.name = 'TokenRejectedError';
  }
}

/** The token couldn't be checked (e.g. Google's servers unreachable): respond 503, never accept it. */
export class TokenVerificationUnavailableError extends Error {
  constructor(readonly code: string) {
    super('Token verification is unavailable');
    this.name = 'TokenVerificationUnavailableError';
  }
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}

const REJECTIONS: Record<string, TokenRejection> = {
  'auth/argument-error': 'invalid',
  'auth/invalid-id-token': 'invalid',
  'auth/id-token-expired': 'expired',
  'auth/id-token-revoked': 'revoked',
  'auth/user-disabled': 'disabled',
  // The account was deleted after the token was issued.
  'auth/user-not-found': 'revoked',
};

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return 'unknown';
}

export function identityFromToken(decoded: DecodedIdToken, projectId: string): VerifiedIdentity {
  if (decoded.aud !== projectId || decoded.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new TokenRejectedError('wrong_project');
  }
  if (typeof decoded.uid !== 'string' || decoded.uid.length === 0) throw new TokenRejectedError('invalid');
  return {
    uid: decoded.uid,
    email: typeof decoded.email === 'string' ? decoded.email : null,
    emailVerified: decoded.email_verified === true,
    displayName: typeof decoded.name === 'string' ? decoded.name : null,
    signInProvider: typeof decoded.firebase?.sign_in_provider === 'string' ? decoded.firebase.sign_in_provider : null,
  };
}

export function createFirebaseTokenVerifier(auth: Auth, projectId: string): TokenVerifier {
  return {
    async verify(token) {
      let decoded: DecodedIdToken;
      try {
        decoded = await auth.verifyIdToken(token, true);
      } catch (error) {
        const code = errorCode(error);
        const rejection = REJECTIONS[code];
        if (rejection) throw new TokenRejectedError(rejection);
        throw new TokenVerificationUnavailableError(code);
      }
      return identityFromToken(decoded, projectId);
    },
  };
}
