import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY = /^axf_([a-f0-9]{24})_([A-Za-z0-9_-]{43})$/;

export function generateKey(): { id: string; secret: string; full: string } {
  const id = randomBytes(12).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { id, secret, full: `axf_${id}_${secret}` };
}

export function parseKey(raw: string): { id: string; secret: string } | null {
  const match = KEY.exec(raw);
  return match ? { id: match[1], secret: match[2] } : null;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Constant-time comparison of a secret with a stored hash. */
export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
