/**
 * Helpers for tests that run against the local Firebase emulators (`npm run test:emulator`).
 * The project ID starts with "demo-", so nothing can reach a real Firebase project.
 */
import { initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const PROJECT = 'demo-axiomflo';

function hosts() {
  const firestore = process.env.FIRESTORE_EMULATOR_HOST;
  const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!firestore || !auth) throw new Error('Run these tests with `npm run test:emulator` so the emulators are started.');
  return { firestore, auth };
}

let counter = 0;
export function emulatorApp(): { app: App; auth: ReturnType<typeof getAuth>; db: ReturnType<typeof getFirestore> } {
  hosts();
  const app = initializeApp({ projectId: PROJECT }, `emulator-test-${++counter}`);
  return { app, auth: getAuth(app), db: getFirestore(app) };
}

export async function resetEmulators() {
  const { firestore, auth } = hosts();
  await fetch(`http://${firestore}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${auth}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

/** Signs in through the Auth emulator's REST API, like the browser SDK would, and returns a real ID token. */
export async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`http://${hosts().auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = (await res.json()) as { idToken?: string };
  if (!body.idToken) throw new Error('Emulator sign-in failed');
  return body.idToken;
}
