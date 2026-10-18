/**
 * Requires `Authorization: Bearer <Firebase ID token>` and puts the verified identity
 * in `res.locals.identity`. Anything else that claims to say who the caller is (a
 * uid or email in the body, query string or other headers) is ignored.
 *
 *   401  no header, not a Bearer token, or the token is invalid/expired/revoked/disabled
 *   503  the token couldn't be checked right now (never treated as valid)
 */
import type { RequestHandler } from 'express';
import { ApiError } from '../http/errors.js';
import type { Logger } from '../http/logger.js';
import { TokenRejectedError, TokenVerificationUnavailableError, type TokenVerifier, type VerifiedIdentity } from './tokenVerifier.js';

// Firebase ID tokens are JWTs, about 1 KB. Anything far larger isn't one.
const MAX_TOKEN_LENGTH = 8192;
// header.payload.signature. The signature may be empty here only so the local Auth
// emulator's unsigned tokens reach the Admin SDK; the SDK rejects unsigned tokens in
// production, and config.ts refuses to run the emulator setting on Cloud Run.
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/;

export function getIdentity(locals: Record<string, unknown>): VerifiedIdentity {
  const identity = locals.identity as VerifiedIdentity | undefined;
  if (!identity) throw new Error('authenticate() must run before this handler');
  return identity;
}

export function authenticate({ verifier, logger }: { verifier: TokenVerifier; logger: Logger }): RequestHandler {
  return async (req, res, next) => {
    const header = req.get('authorization') ?? '';
    const match = header.length <= MAX_TOKEN_LENGTH ? BEARER.exec(header) : null;
    if (!match) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return next(new ApiError(401, 'unauthenticated', 'Sign in to continue.'));
    }
    try {
      res.locals.identity = await verifier.verify(match[1]);
      return next();
    } catch (error) {
      if (error instanceof TokenRejectedError) {
        logger.info('token rejected', { requestId: res.locals.requestId, reason: error.reason });
        res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
        return next(new ApiError(401, 'unauthenticated', 'Your sign-in has expired or is no longer valid. Sign in again.'));
      }
      if (error instanceof TokenVerificationUnavailableError) {
        logger.error('token verification unavailable', { requestId: res.locals.requestId, code: error.code });
      } else {
        logger.error('token verification failed unexpectedly', { requestId: res.locals.requestId, errorName: (error as Error)?.name });
      }
      return next(new ApiError(503, 'auth_unavailable', 'We couldn’t check your sign-in just now. Please try again.'));
    }
  };
}
