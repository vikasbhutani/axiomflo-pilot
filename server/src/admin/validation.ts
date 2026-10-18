/**
 * Strict checks for admin request bodies. Unknown fields are refused rather than
 * ignored, so a client can't slip in extra values (an inviter, a company, a uid) and
 * have them silently dropped or, worse, used later.
 */
import { ApiError } from '../http/errors.js';
import { ROLES, type MemberStatus, type Role } from '../membership/records.js';

export const DEFAULT_INVITATION_DAYS = 14;
export const MAX_INVITATION_DAYS = 30;
const MAX_TEAMS = 20;
// Deliberately simple: one @, no spaces, a dot in the domain. Firebase decides real deliverability.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface InvitationInput {
  normalizedEmail: string;
  role: Role;
  teamIds: string[];
  expiresInDays: number;
}

export interface MemberPatch {
  role?: Role;
  teamIds?: string[];
  status?: MemberStatus;
}

const bad = (message: string) => new ApiError(400, 'bad_request', message);

function body(value: unknown, allowed: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad('Send a JSON object.');
  const unknown = Object.keys(value).filter((k) => !allowed.includes(k));
  if (unknown.length) throw bad(`Unknown field(s): ${unknown.slice(0, 5).join(', ')}.`);
  return value as Record<string, unknown>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function teamIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_TEAMS || !value.every((t) => typeof t === 'string' && ID.test(t))) {
    throw bad('teamIds must be a list of team IDs.');
  }
  return [...new Set(value as string[])];
}

function role(value: unknown): Role {
  if (!ROLES.includes(value as Role)) throw bad('role must be "company_admin" or "individual_user".');
  return value as Role;
}

/** Admins see every team, so they get none assigned; individual users need at least one. */
export function checkRoleTeams(r: Role, ids: string[]): void {
  if (r === 'company_admin' && ids.length > 0) throw bad('A Company Admin sees every team, so teamIds must be empty.');
  if (r === 'individual_user' && ids.length === 0) throw bad('An Individual User needs at least one team.');
}

export function parseInvitationInput(value: unknown): InvitationInput {
  const b = body(value, ['email', 'role', 'teamIds', 'expiresInDays']);
  if (typeof b.email !== 'string' || b.email.length > 254 || !EMAIL.test(b.email.trim())) throw bad('Enter a valid email address.');
  const r = role(b.role);
  const ids = teamIds(b.teamIds ?? []);
  checkRoleTeams(r, ids);
  const days = b.expiresInDays ?? DEFAULT_INVITATION_DAYS;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_INVITATION_DAYS) {
    throw bad(`expiresInDays must be a whole number from 1 to ${MAX_INVITATION_DAYS}.`);
  }
  return { normalizedEmail: normalizeEmail(b.email), role: r, teamIds: ids, expiresInDays: days };
}

export function parseMemberPatch(value: unknown): MemberPatch {
  const b = body(value, ['role', 'teamIds', 'status']);
  const patch: MemberPatch = {};
  if (b.role !== undefined) patch.role = role(b.role);
  if (b.teamIds !== undefined) patch.teamIds = teamIds(b.teamIds);
  if (b.status !== undefined) {
    if (b.status !== 'active' && b.status !== 'suspended') throw bad('status must be "active" or "suspended".');
    patch.status = b.status;
  }
  if (Object.keys(patch).length === 0) throw bad('Nothing to change: send role, teamIds or status.');
  return patch;
}

export function parseId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw bad(`Invalid ${what}.`);
  return value;
}
