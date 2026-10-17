/**
 * Firebase Admin SDK, initialised with Application Default Credentials (ADC):
 * - On Cloud Run: the service's runtime service account. No key file is needed.
 * - On your computer or in Cloud Shell: your own Google sign-in.
 *
 * Never use a downloaded service-account JSON key, and never commit one.
 *
 * The Admin SDK BYPASSES Firestore security rules. Everything the API reads or writes
 * is therefore protected only by the API's own checks (token, membership, role) and by
 * how narrowly the runtime service account's IAM roles are set.
 */
import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { ServerConfig } from './config.js';

export interface FirebaseServices {
  auth: Auth;
  db: Firestore;
}

export function initFirebase(config: ServerConfig): FirebaseServices {
  // projectId is set explicitly so token checks use the expected project, whatever ADC points at.
  const app: App = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId: config.firebaseProjectId });
  return { auth: getAuth(app), db: getFirestore(app, config.firestoreDatabaseId) };
}
