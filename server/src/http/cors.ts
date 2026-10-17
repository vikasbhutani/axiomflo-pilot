/**
 * CORS for an exact list of web addresses. CORS only controls which websites a browser
 * lets read our responses; it is NOT authorization. Every protected route still
 * verifies the Firebase ID token and the caller's membership.
 *
 * - No wildcard origins, and no cookies: auth travels in the Authorization header.
 * - With an empty list (the recommended same-origin setup) no CORS headers are sent,
 *   so browsers on other sites can't read responses.
 */
import type { RequestHandler } from 'express';

const ALLOWED_HEADERS = 'Authorization, Content-Type';
const ALLOWED_METHODS = 'GET, POST, PATCH, OPTIONS';

export function cors(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.get('origin');
    res.vary('Origin');
    const permitted = origin !== undefined && allowed.has(origin);
    if (permitted) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
    }
    if (req.method === 'OPTIONS' && req.get('access-control-request-method')) {
      if (permitted) {
        res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
        res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
        res.setHeader('Access-Control-Max-Age', '600');
      }
      res.status(204).end();
      return;
    }
    next();
  };
}
