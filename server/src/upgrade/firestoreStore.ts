/**
 * Saved Upgrade Analyses on Firestore, under companies/{companyId}/upgradeAnalyses/{id}.
 *
 * The analysis is stored as JSON text exactly as calculated, so nothing about its
 * shape or numbers can drift. Audit entries are appended in the same transaction as
 * the change and mirrored to the company's auditEvents collection, like other admin actions.
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { ApiError } from '../http/errors.js';
import { canSee, conflict, contentHash, newSaved, savedIdFor, type UpgradeAnalysisStore } from './store.js';
import type { SavedUpgradeAnalysis, UpgradeAuditEntry } from './types.js';

function fromDoc(data: FirebaseFirestore.DocumentData): SavedUpgradeAnalysis {
  const { analysisJson, audit, ...rest } = data as { analysisJson: string; audit: UpgradeAuditEntry[] } & Omit<SavedUpgradeAnalysis, 'analysis' | 'audit'>;
  return { ...rest, analysis: JSON.parse(analysisJson), audit: audit ?? [] } as SavedUpgradeAnalysis;
}

export function createFirestoreUpgradeStore({ db }: { db: Firestore }): UpgradeAnalysisStore {
  const company = (c: string) => db.collection('companies').doc(c);
  const docRef = (c: string, id: string) => company(c).collection('upgradeAnalyses').doc(id);
  const auditEvent = (tx: FirebaseFirestore.Transaction, c: string, actorUid: string, action: string, targetId: string, metadata: Record<string, unknown>) =>
    tx.create(company(c).collection('auditEvents').doc(), { actorUid, action, targetType: 'upgradeAnalysis', targetId, metadata, timestamp: FieldValue.serverTimestamp() });

  return {
    async save(c, viewer, input, idempotencyKey, now) {
      const id = savedIdFor(c, viewer.uid, idempotencyKey);
      const hash = contentHash(input);
      const ref = docRef(c, id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          if (snap.get('contentHash') !== hash) throw conflict();
          return { saved: fromDoc(snap.data()!), replayed: true };
        }
        const saved = newSaved(id, c, viewer, input, now);
        const { analysis, ...rest } = saved;
        tx.create(ref, { ...rest, analysisJson: JSON.stringify(analysis), contentHash: hash, exportKeys: [] });
        auditEvent(tx, c, viewer.uid, 'upgradeAnalysis.saved', id, { currentModelId: analysis.current.modelId, candidateModelId: analysis.candidate.modelId, scope: analysis.scope.level });
        return { saved, replayed: false };
      });
    },

    async get(c, viewer, id) {
      const snap = await docRef(c, id).get();
      if (!snap.exists) return null;
      const saved = fromDoc(snap.data()!);
      return canSee(viewer, saved) ? saved : null;
    },

    async recordExport(c, viewer, id, detail, idempotencyKey, now) {
      const ref = docRef(c, id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const saved = snap.exists ? fromDoc(snap.data()!) : null;
        if (!saved || !canSee(viewer, saved)) throw new ApiError(404, 'not_found', 'Analysis not found.');
        const exportKey = idempotencyKey ? `${viewer.uid}:${idempotencyKey}` : null;
        const keys = (snap.get('exportKeys') as { key: string; entry: UpgradeAuditEntry }[] | undefined) ?? [];
        const previous = exportKey ? keys.find((k) => k.key === exportKey) : undefined;
        if (previous) return { saved, entry: previous.entry };
        const entry: UpgradeAuditEntry = { at: now.toISOString(), actorUid: viewer.uid, action: 'exported', detail };
        tx.update(ref, { audit: FieldValue.arrayUnion(entry), ...(exportKey ? { exportKeys: FieldValue.arrayUnion({ key: exportKey, entry }) } : {}) });
        auditEvent(tx, c, viewer.uid, 'upgradeAnalysis.exported', id, { detail });
        return { saved: { ...saved, audit: [...saved.audit, entry] }, entry };
      });
    },
  };
}
