/**
 * One error shape for every failure: `{ "error": { "code", "message", "requestId" } }`.
 *
 * Clients get a short, safe message. Details (stack traces, database errors) go to the
 * server log only, tagged with the request ID so a report can be traced.
 *
 *   401 unauthenticated          missing, malformed, expired or revoked sign-in
 *   403 forbidden                signed in, but not allowed to do this
 *   503 membership_unavailable   the membership database couldn't be reached
 *
 * A database failure is never turned into "no membership" and never grants access.
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from './logger.js';

export type ErrorCode =
  | 'bad_request'
  | 'payload_too_large'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'membership_unavailable'
  | 'internal';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function sendError(res: Parameters<RequestHandler>[1], status: number, code: ErrorCode, message: string): void {
  res.status(status).json({ error: { code, message, requestId: res.locals.requestId } });
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, 404, 'not_found', 'Not found.');
};

/** Errors thrown by Express's JSON body parser carry a `type` and an HTTP `status`. */
function bodyParserError(err: unknown): { status: number; type: string } | null {
  if (typeof err !== 'object' || err === null) return null;
  const { status, type } = err as { status?: unknown; type?: unknown };
  return typeof status === 'number' && typeof type === 'string' ? { status, type } : null;
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, next) => {
    if (res.headersSent) return next(err);

    if (err instanceof ApiError) {
      if (err.status >= 500) logger.error('request failed', { requestId: res.locals.requestId, code: err.code });
      return sendError(res, err.status, err.code, err.message);
    }

    const parser = bodyParserError(err);
    if (parser?.type === 'entity.too.large') return sendError(res, 413, 'payload_too_large', 'The request body is too large.');
    if (parser && parser.status >= 400 && parser.status < 500) return sendError(res, 400, 'bad_request', 'The request body could not be read.');

    // Only the error's name and stack are logged, never the object itself (it may hold request data).
    const e = err instanceof Error ? err : new Error('Non-error thrown');
    logger.error('unhandled error', { requestId: res.locals.requestId, errorName: e.name, stack: e.stack });
    return sendError(res, 500, 'internal', 'Something went wrong. Please try again.');
  };
}
