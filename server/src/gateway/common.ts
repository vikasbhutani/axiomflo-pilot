/**
 * Pieces every provider route on the gateway shares: reading and checking the
 * AxiomFlo key, the per-key request limit, and saving a usage record. Each route
 * supplies its own `reject` so errors come back in that provider's error format.
 */
import type { Request, RequestHandler, Response } from 'express';
import type { Logger } from '../http/logger.js';
import { rateLimit } from '../http/rateLimit.js';
import { KeyRejectedError, type KeyPrincipal, type KeyService } from '../keys/service.js';
import type { UsageRecord, UsageRecorder } from './usage.js';

/** Requests per key per minute, per provider, as a guard against a leaked key or a runaway script. */
export const REQUESTS_PER_KEY_PER_MINUTE = 60;

/** Reasons that mean "this key is fine, but its owner isn't allowed right now". */
const FORBIDDEN_REASONS = new Set(['company_inactive', 'no_membership', 'member_suspended', 'team_inactive', 'team_not_assigned']);

export type Rejection = 'missing' | 'invalid' | 'forbidden' | 'unavailable' | 'rate_limited';
export type Reject = (res: Response, why: Rejection) => void;

/**
 * The AxiomFlo key, from whichever header the caller's SDK uses: `x-api-key` (Anthropic),
 * `x-goog-api-key` (Google Gen AI) or `Authorization: Bearer`. Never from the URL, so keys
 * can't end up in access logs.
 */
export function presentedKey(req: Request): string | null {
  for (const name of ['x-api-key', 'x-goog-api-key']) {
    const v = req.get(name)?.trim();
    if (v) return v;
  }
  const match = /^Bearer\s+(\S+)\s*$/i.exec(req.get('authorization') ?? '');
  return match ? match[1] : null;
}

export function getPrincipal(res: Response): KeyPrincipal {
  const p = res.locals.principal as KeyPrincipal | undefined;
  if (!p) throw new Error('keyGate() must run before this handler');
  return p;
}

/** Checks the key, and through it the owner's membership and team, on every request. */
export function keyGate({ keys, companyId, logger, reject }: { keys: KeyService; companyId: string; logger: Logger; reject: Reject }): RequestHandler {
  return async (req, res, next) => {
    const raw = presentedKey(req);
    if (!raw) return reject(res, 'missing');
    try {
      res.locals.principal = await keys.resolveKey(companyId, raw);
      return next();
    } catch (error) {
      if (error instanceof KeyRejectedError) {
        logger.warn('gateway key rejected', { requestId: res.locals.requestId, reason: error.reason });
        return reject(res, FORBIDDEN_REASONS.has(error.reason) ? 'forbidden' : 'invalid');
      }
      // Never let a database problem through as "allowed".
      logger.error('gateway key check unavailable', { requestId: res.locals.requestId, errorName: error instanceof Error ? error.name : 'unknown' });
      return reject(res, 'unavailable');
    }
  };
}

export function keyRateLimit({ name, reject }: { name: string; reject: Reject }): RequestHandler {
  const limit = rateLimit({ name, limit: REQUESTS_PER_KEY_PER_MINUTE, windowMs: 60_000, key: (l) => (l.principal as KeyPrincipal).keyId });
  return (req, res, next) => limit(req, res, (err?: unknown) => (err ? reject(res, 'rate_limited') : next()));
}

/** Saves a usage record. The answer has already gone back, so a failure is logged, not returned. */
export async function saveUsage(usage: UsageRecorder, companyId: string, record: UsageRecord, logger: Logger): Promise<void> {
  try {
    await usage.record(companyId, record);
  } catch (error) {
    logger.error('usage record failed', { requestId: record.id, keyId: record.keyId, modelId: record.modelId, errorName: error instanceof Error ? error.name : 'unknown' });
  }
}

/** Header values we pass on or store: printable ASCII, bounded length. */
export const HEADER_VALUE = /^[\x21-\x7e][\x20-\x7e]{0,199}$/;
