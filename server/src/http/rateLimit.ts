/**
 * A small fixed-window rate limiter for sensitive endpoints (invitations, member
 * changes). It counts per signed-in user, not per IP address: behind the web app's
 * forwarding every request comes from the same address.
 *
 * Counts live in this instance's memory, so the real limit is this number times the
 * number of Cloud Run instances. That's fine for a pilot with --max-instances kept low.
 */
import type { RequestHandler } from 'express';
import { ApiError } from './errors.js';

export function rateLimit({ name, limit, windowMs, key, now = () => Date.now() }: { name: string; limit: number; windowMs: number; key: (locals: Record<string, unknown>) => string; now?: () => number }): RequestHandler {
  const windows = new Map<string, { start: number; count: number }>();
  return (_req, res, next) => {
    const t = now();
    // Drop finished windows now and then so memory stays small.
    if (windows.size > 10_000) for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
    const k = `${name}:${key(res.locals)}`;
    const w = windows.get(k);
    if (!w || t - w.start >= windowMs) {
      windows.set(k, { start: t, count: 1 });
      return next();
    }
    if (w.count >= limit) {
      res.setHeader('Retry-After', String(Math.ceil((w.start + windowMs - t) / 1000)));
      return next(new ApiError(429, 'rate_limited', 'Too many requests. Please wait a minute and try again.'));
    }
    w.count++;
    return next();
  };
}
