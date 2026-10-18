/**
 * Creates the approved pilot company, its department, two teams and the first
 * Company Admin membership. Run by hand only (see cli.ts); never exposed over HTTP.
 *
 * - Idempotent: records that already exist with the same values are left alone, so
 *   running it twice changes nothing the second time.
 * - Never overwrites: if any existing record differs, nothing at all is written.
 * - All-or-nothing: the checks and writes happen in one Firestore transaction, and
 *   one audit event records what was created.
 */
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { BootstrapInput } from './input.js';

export type PlanAction = 'create' | 'unchanged' | 'conflict';

export interface PlanItem {
  path: string;
  action: PlanAction;
  /** Fields whose stored value differs from the requested one (conflicts only). */
  differences: string[];
}

export interface BootstrapPlan {
  items: PlanItem[];
  conflicts: PlanItem[];
  toCreate: PlanItem[];
}

export class BootstrapConflictError extends Error {
  constructor(readonly conflicts: PlanItem[]) {
    super(`Existing records differ from the requested setup: ${conflicts.map((c) => c.path).join(', ')}`);
    this.name = 'BootstrapConflictError';
  }
}

interface Desired {
  ref: DocumentReference;
  /** Fields compared with an existing record. */
  compare: Record<string, unknown>;
  /** Everything written when the record is created. */
  create: Record<string, unknown>;
}

function desiredRecords(db: Firestore, input: BootstrapInput, adminUid: string): Desired[] {
  const company = db.collection('companies').doc(input.company.id);
  const created = { createdAt: FieldValue.serverTimestamp() };
  const companyFields = { name: input.company.name, status: 'active', reportingCurrency: input.company.reportingCurrency, reportingTimezone: input.company.reportingTimezone };
  const membershipFields = { uid: adminUid, role: 'company_admin', status: 'active' };
  return [
    { ref: company, compare: companyFields, create: { ...companyFields, ...created, updatedAt: FieldValue.serverTimestamp() } },
    { ref: company.collection('departments').doc(input.department.id), compare: { name: input.department.name }, create: { name: input.department.name, ...created } },
    ...input.teams.map((t) => {
      const fields = { departmentId: input.department.id, name: t.name, code: t.code, status: 'active' };
      return { ref: company.collection('teams').doc(t.id), compare: fields, create: { ...fields, ...created } };
    }),
    {
      ref: company.collection('memberships').doc(adminUid),
      compare: membershipFields,
      // An admin sees every team, so no team assignment is needed.
      create: { ...membershipFields, teamIds: [], ...created, updatedAt: FieldValue.serverTimestamp() },
    },
  ];
}

async function readPlan(db: Firestore, input: BootstrapInput, adminUid: string, tx?: Transaction): Promise<{ plan: BootstrapPlan; desired: Desired[] }> {
  const desired = desiredRecords(db, input, adminUid);
  const get = (ref: DocumentReference) => (tx ? tx.get(ref) : ref.get());
  const teamsQuery = db.collection('companies').doc(input.company.id).collection('teams');
  const [snaps, existingTeams] = await Promise.all([Promise.all(desired.map((d) => get(d.ref))), tx ? tx.get(teamsQuery) : teamsQuery.get()]);

  const items: PlanItem[] = desired.map((d, i) => {
    const snap = snaps[i];
    if (!snap.exists) return { path: d.ref.path, action: 'create', differences: [] };
    const data = snap.data() ?? {};
    const differences = Object.entries(d.compare)
      .filter(([field, value]) => data[field] !== value)
      .map(([field]) => field);
    return { path: d.ref.path, action: differences.length ? 'conflict' : 'unchanged', differences };
  });

  // Team codes must be unique within the company, including teams this script doesn't manage.
  const ours = new Set(input.teams.map((t) => t.id));
  for (const team of input.teams) {
    const clash = existingTeams.docs.find((doc) => !ours.has(doc.id) && doc.get('code') === team.code);
    if (clash) items.push({ path: clash.ref.path, action: 'conflict', differences: [`code ${team.code} is already used`] });
  }

  return {
    plan: { items, conflicts: items.filter((i) => i.action === 'conflict'), toCreate: items.filter((i) => i.action === 'create') },
    desired,
  };
}

/** Read-only preview of what applyBootstrap would do. */
export async function planBootstrap(db: Firestore, input: BootstrapInput, adminUid: string): Promise<BootstrapPlan> {
  return (await readPlan(db, input, adminUid)).plan;
}

/**
 * Re-checks everything inside a transaction and creates only missing records.
 * Throws BootstrapConflictError (writing nothing) if anything differs.
 */
export async function applyBootstrap(db: Firestore, input: BootstrapInput, adminUid: string): Promise<BootstrapPlan> {
  return db.runTransaction(async (tx) => {
    const { plan, desired } = await readPlan(db, input, adminUid, tx);
    if (plan.conflicts.length > 0) throw new BootstrapConflictError(plan.conflicts);
    if (plan.toCreate.length === 0) return plan;

    const creating = new Set(plan.toCreate.map((i) => i.path));
    for (const d of desired) if (creating.has(d.ref.path)) tx.create(d.ref, d.create);

    tx.create(db.collection('companies').doc(input.company.id).collection('auditEvents').doc(), {
      actorUid: 'bootstrap-script',
      action: 'company.bootstrapped',
      targetType: 'company',
      targetId: input.company.id,
      timestamp: FieldValue.serverTimestamp(),
      metadata: { adminUid, created: [...creating] },
    });
    return plan;
  });
}
