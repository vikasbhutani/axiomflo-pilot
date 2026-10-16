/**
 * Role and permission helpers for the DEMO role switcher.
 *
 * IMPORTANT: this is a client-side demonstration only. Anyone can change a
 * browser's JavaScript, so production authorization MUST be enforced by the
 * backend on every request. These helpers exist so the mock service layer and
 * the UI can show what each role is meant to see.
 */
import type { Role, User, UsageRecord, UserContext } from '../types';

export type Permission =
  | 'view_company_totals'
  | 'view_all_teams'
  | 'manage_teams'
  | 'invite_users'
  | 'view_provider_settings'
  | 'export_company_showback';

const rolePermissions: Record<Role, Permission[]> = {
  company_admin: ['view_company_totals', 'view_all_teams', 'manage_teams', 'invite_users', 'view_provider_settings', 'export_company_showback'],
  individual_user: [],
};

export function can(context: UserContext, permission: Permission): boolean {
  return rolePermissions[context.role].includes(permission);
}

export const roleLabels: Record<Role, string> = {
  company_admin: 'Company Admin',
  individual_user: 'Individual User',
};

/**
 * Which usage records a user may see.
 * - Company Admin: every record in the company.
 * - Individual User: only requests they made themselves, within their assigned team.
 *   Requests from shared applications and teammates are excluded.
 */
export function scopeUsageRecords<T extends UsageRecord>(records: T[], context: UserContext, allUsers: User[]): T[] {
  if (context.role === 'company_admin') return records;
  const user = allUsers.find((u) => u.id === context.userId);
  if (!user) return [];
  return records.filter((r) => r.principal.type === 'user' && r.principal.id === user.id && r.teamId === user.teamId);
}

/** Team IDs a user may filter by or see aggregated. */
export function visibleTeamIds(context: UserContext, allUsers: User[], allTeamIds: string[]): string[] {
  if (context.role === 'company_admin') return allTeamIds;
  const user = allUsers.find((u) => u.id === context.userId);
  return user ? [user.teamId] : [];
}
