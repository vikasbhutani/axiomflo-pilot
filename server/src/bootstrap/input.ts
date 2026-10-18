/**
 * The bootstrap configuration file: the approved company, its department and its two
 * teams. Values are checked strictly, and the placeholders in bootstrap.example.json
 * are refused, so nothing invented ends up in production.
 */

export interface TeamInput {
  id: string;
  name: string;
  code: string;
}

export interface BootstrapInput {
  company: { id: string; name: string; reportingCurrency: string; reportingTimezone: string };
  department: { id: string; name: string };
  teams: [TeamInput, TeamInput];
}

export class BootstrapInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapInputError';
  }
}

const DOC_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const TEAM_CODE = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
const CURRENCY = /^[A-Z]{3}$/;
const FIREBASE_UID = /^[A-Za-z0-9_-]{1,128}$/;
const PLACEHOLDER = /REPLACE/i;

type Data = Record<string, unknown>;

function obj(value: unknown, where: string): Data {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BootstrapInputError(`${where} must be an object.`);
  return value as Data;
}

function text(data: Data, field: string, where: string, pattern?: RegExp, hint?: string): string {
  const v = data[field];
  if (typeof v !== 'string' || v.trim() === '' || v.length > 100) throw new BootstrapInputError(`${where}.${field} must be text of 1-100 characters.`);
  if (PLACEHOLDER.test(v)) throw new BootstrapInputError(`${where}.${field} still has a placeholder ("${v}"). Replace it with your real value.`);
  if (pattern && !pattern.test(v)) throw new BootstrapInputError(`${where}.${field} "${v}" is not valid: ${hint}.`);
  return v.trim();
}

function timezone(value: string, where: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    throw new BootstrapInputError(`${where} "${value}" is not a known time zone (for example Australia/Sydney).`);
  }
}

const ID_HINT = 'use lowercase letters, digits, "-" or "_"';

export function parseBootstrapInput(raw: unknown): BootstrapInput {
  const root = obj(raw, 'The file');
  const company = obj(root.company, 'company');
  const department = obj(root.department, 'department');
  if (!Array.isArray(root.teams) || root.teams.length !== 2) throw new BootstrapInputError('teams must list exactly two teams for the pilot.');

  // Checked in file order, so the first problem reported is the first one in the file.
  const parsedCompany = {
    id: text(company, 'id', 'company', DOC_ID, ID_HINT),
    name: text(company, 'name', 'company'),
    reportingCurrency: text(company, 'reportingCurrency', 'company', CURRENCY, 'use a 3-letter currency code such as AUD'),
    reportingTimezone: timezone(text(company, 'reportingTimezone', 'company'), 'company.reportingTimezone'),
  };
  const parsedDepartment = { id: text(department, 'id', 'department', DOC_ID, ID_HINT), name: text(department, 'name', 'department') };

  const teams = root.teams.map((t, i) => {
    const team = obj(t, `teams[${i}]`);
    return {
      id: text(team, 'id', `teams[${i}]`, DOC_ID, ID_HINT),
      name: text(team, 'name', `teams[${i}]`),
      code: text(team, 'code', `teams[${i}]`, TEAM_CODE, 'use 2-32 capital letters, digits or "-"'),
    };
  }) as [TeamInput, TeamInput];
  if (teams[0].id === teams[1].id) throw new BootstrapInputError('The two teams must have different ids.');
  if (teams[0].code === teams[1].code) throw new BootstrapInputError('The two teams must have different codes.');

  return { company: parsedCompany, department: parsedDepartment, teams };
}

export function parseAdminUid(value: string | undefined): string {
  const uid = (value ?? '').trim();
  if (!FIREBASE_UID.test(uid) || PLACEHOLDER.test(uid)) {
    throw new BootstrapInputError('Give the admin’s Firebase User UID with --admin-uid (Firebase console → Authentication → Users → User UID).');
  }
  return uid;
}
