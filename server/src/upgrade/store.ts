/**
 * Saved Upgrade Analyses.
 *
 * - Always under one company; another company's analysis looks the same as a missing one.
 * - Company Admins see every saved analysis in their company; individual users only their own.
 * - A saved analysis is never edited. It keeps the pricing version, pricing source,
 *   calculation time, inputs and the viewer's access at the time, so a later price
 *   change can't rewrite it. Running it again saves a new one.
 * - Saving and every export are added to its audit history, which is append-only.
 * - An Idempotency-Key makes a retried save or export return the first result.
 */
import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from '../http/errors.js';
import type { Role } from '../membership/records.js';
import type { SavedUpgradeAnalysis, UpgradeAnalysis, UpgradeAuditEntry } from './types.js';

export interface UpgradeViewer {
  uid: string;
  role: Role;
}

export interface NewSavedAnalysis {
  title: string;
  status: SavedUpgradeAnalysis['status'];
  analysis: UpgradeAnalysis;
  authorisation: SavedUpgradeAnalysis['authorisation'];
}

export interface UpgradeAnalysisStore {
  /** Saves once per Idempotency-Key; `replayed` is true when an earlier save is returned. */
  save(companyId: string, viewer: UpgradeViewer, input: NewSavedAnalysis, idempotencyKey: string | null, now: Date): Promise<{ saved: SavedUpgradeAnalysis; replayed: boolean }>;
  get(companyId: string, viewer: UpgradeViewer, id: string): Promise<SavedUpgradeAnalysis | null>;
  /** Records an export once per Idempotency-Key and returns the analysis with the entry that applies. */
  recordExport(companyId: string, viewer: UpgradeViewer, id: string, detail: string, idempotencyKey: string | null, now: Date): Promise<{ saved: SavedUpgradeAnalysis; entry: UpgradeAuditEntry }>;
}

export const SAVED_ID = /^ua_[0-9a-f]{24}$/;
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

export const conflict = () => new ApiError(409, 'conflict', 'That Idempotency-Key was already used for a different analysis.');

/** Same key from the same person in the same company → same ID. */
export function savedIdFor(companyId: string, uid: string, idempotencyKey: string | null): string {
  if (!idempotencyKey) return `ua_${randomBytes(12).toString('hex')}`;
  return `ua_${createHash('sha256').update(`${companyId}\u0000${uid}\u0000${idempotencyKey}`).digest('hex').slice(0, 24)}`;
}

/** What makes two saves "the same": the inputs and title, not the timestamp. */
export function contentHash(input: NewSavedAnalysis): string {
  return createHash('sha256').update(JSON.stringify([input.title, input.status, input.analysis.inputs])).digest('hex');
}

export function canSee(viewer: UpgradeViewer, saved: Pick<SavedUpgradeAnalysis, 'createdBy'>): boolean {
  return viewer.role === 'company_admin' || saved.createdBy === viewer.uid;
}

export function newSaved(id: string, companyId: string, viewer: UpgradeViewer, input: NewSavedAnalysis, now: Date): SavedUpgradeAnalysis {
  const { analysis } = input;
  return {
    id,
    companyId,
    title: input.title,
    status: input.status,
    createdBy: viewer.uid,
    createdAt: now.toISOString(),
    authorisation: input.authorisation,
    pricing: {
      current: { version: analysis.current.pricing?.pricingVersion ?? null, source: analysis.current.pricing?.pricingSource ?? null },
      candidate: { version: analysis.candidate.pricing?.pricingVersion ?? null, source: analysis.candidate.pricing?.pricingSource ?? null },
    },
    analysis,
    audit: [{ at: now.toISOString(), actorUid: viewer.uid, action: 'saved', detail: `Saved as ${input.status === 'draft' ? 'a draft' : 'submitted for review'}.` }],
  };
}

/** In-memory store, for tests and local runs without Firestore. */
export function createMemoryUpgradeStore(): UpgradeAnalysisStore & { readonly docs: Map<string, { saved: SavedUpgradeAnalysis; hash: string; exportKeys: Map<string, UpgradeAuditEntry> }> } {
  const docs = new Map<string, { saved: SavedUpgradeAnalysis; hash: string; exportKeys: Map<string, UpgradeAuditEntry> }>();
  const key = (c: string, id: string) => `${c}/${id}`;
  const copy = <T>(v: T): T => structuredClone(v);
  return {
    docs,
    async save(c, viewer, input, idempotencyKey, now) {
      const id = savedIdFor(c, viewer.uid, idempotencyKey);
      const hash = contentHash(input);
      const existing = docs.get(key(c, id));
      if (existing) {
        if (existing.hash !== hash) throw conflict();
        return { saved: copy(existing.saved), replayed: true };
      }
      const saved = newSaved(id, c, viewer, input, now);
      docs.set(key(c, id), { saved: copy(saved), hash, exportKeys: new Map() });
      return { saved, replayed: false };
    },
    async get(c, viewer, id) {
      const doc = docs.get(key(c, id));
      return doc && canSee(viewer, doc.saved) ? copy(doc.saved) : null;
    },
    async recordExport(c, viewer, id, detail, idempotencyKey, now) {
      const doc = docs.get(key(c, id));
      if (!doc || !canSee(viewer, doc.saved)) throw new ApiError(404, 'not_found', 'Analysis not found.');
      const previous = idempotencyKey ? doc.exportKeys.get(`${viewer.uid}:${idempotencyKey}`) : undefined;
      if (previous) return { saved: copy(doc.saved), entry: previous };
      const entry: UpgradeAuditEntry = { at: now.toISOString(), actorUid: viewer.uid, action: 'exported', detail };
      doc.saved.audit.push(entry);
      if (idempotencyKey) doc.exportKeys.set(`${viewer.uid}:${idempotencyKey}`, entry);
      return { saved: copy(doc.saved), entry };
    },
  };
}
