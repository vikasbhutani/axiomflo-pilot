import { ApiError } from '../http/errors.js';
import type { NewKey } from './service.js';

const bad = (message: string) => new ApiError(400, 'bad_request', message);
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function parseNewKey(value: unknown): NewKey {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad('Send a JSON object.');
  const unknown = Object.keys(value).filter((k) => k !== 'name' && k !== 'teamId');
  if (unknown.length) throw bad(`Unknown field(s): ${unknown.slice(0, 5).join(', ')}.`);
  const { name, teamId } = value as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 60) throw bad('Give the key a name of 1 to 60 characters.');
  if (typeof teamId !== 'string' || !ID.test(teamId)) throw bad('Choose a team for this key.');
  return { name: name.trim(), teamId };
}

/** Key IDs are 24 hex characters. */
export function parseKeyId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/.test(value)) throw bad('Invalid key ID.');
  return value;
}
