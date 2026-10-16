import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import type { FirebaseWebConfig } from './config';

/** The single Firebase app instance, shared by Authentication and Firestore. */
export function getFirebaseApp(config: FirebaseWebConfig): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(config);
}
