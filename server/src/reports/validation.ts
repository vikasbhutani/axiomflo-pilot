import { ApiError } from '../http/errors.js';
import { MONTH } from './months.js';

const bad = (message: string) => new ApiError(400, 'bad_request', message);

export function parseMonth(value: unknown): string {
  if (typeof value !== 'string' || !MONTH.test(value)) throw bad('month must look like 2026-10.');
  const year = Number(value.slice(0, 4));
  if (year < 2020 || year > 2100) throw bad('month is out of range.');
  return value;
}

/** Body of PUT /api/exchange-rates/:month: exactly `{ rate }`. */
export function parseRate(body: unknown): number {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw bad('Send { "rate": number }.');
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'rate') throw bad('Only "rate" can be set.');
  const rate = (body as { rate: unknown }).rate;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0.0001 || rate > 100_000) throw bad('rate must be a positive number.');
  return Math.round(rate * 1_000_000) / 1_000_000;
}
