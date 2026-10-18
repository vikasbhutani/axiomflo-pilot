/**
 * One usage record per AI request sent through the gateway, stored at
 * companies/{companyId}/usage/{requestId}. It matches the web app's UsageRecord shape
 * so the dashboards can use it directly.
 *
 * Prompts, answers and keys are never part of a record.
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export type CostStatus = 'estimated' | 'unavailable';

export interface UsageRecord {
  id: string;
  timestamp: string;
  principal: { type: 'user'; id: string };
  keyId: string;
  teamId: string;
  teamCode: string;
  providerId: 'anthropic' | 'gemini_vertex';
  modelId: string;
  /** null means the provider didn't report a measurement (for example a failed request). */
  inputTokens: number | null;
  outputTokens: number | null;
  cacheWriteTokens: number | null;
  cacheReadTokens: number | null;
  requestStatus: 'succeeded' | 'failed';
  /** HTTP status the provider returned, or null when it couldn't be reached. */
  providerStatus: number | null;
  costStatus: CostStatus;
  estimatedCostUsd: number | null;
  priceVersion: string | null;
  stream: boolean;
  latencyMs: number;
  /** The provider's own request ID, for matching against their logs. */
  providerRequestId: string | null;
}

export interface UsageRecorder {
  record(companyId: string, record: UsageRecord): Promise<void>;
}

export function createFirestoreUsageRecorder(db: Firestore): UsageRecorder {
  return {
    async record(companyId, record) {
      // create(), not set(): a request ID is never reused, so a duplicate write fails loudly.
      await db
        .collection('companies')
        .doc(companyId)
        .collection('usage')
        .doc(record.id)
        .create({ ...record, recordedAt: FieldValue.serverTimestamp() });
    },
  };
}
