/**
 * Checks that a request really came from Slack: an HMAC-SHA256 of
 * `v0:{timestamp}:{raw body}` with the app's Signing Secret, sent in X-Slack-Signature.
 * Requests older than five minutes are refused, so a captured request can't be replayed.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_AGE_SECONDS = 5 * 60;

export function slackSignature(secret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
}

export function isFromSlack({ secret, timestamp, signature, rawBody, now = () => Date.now() }: { secret: string; timestamp: string | undefined; signature: string | undefined; rawBody: string; now?: () => number }): boolean {
  if (!secret || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now() / 1000 - Number(timestamp)) > MAX_AGE_SECONDS) return false;
  const expected = Buffer.from(slackSignature(secret, timestamp, rawBody));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
