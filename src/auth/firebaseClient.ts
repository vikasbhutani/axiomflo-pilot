/**
 * Firebase Authentication with Google as the only sign-in provider.
 *
 * - Uses a popup started straight from the button click (no redirect flow, see README).
 * - Asks Google only for basic profile and email (Firebase's default). No Drive,
 *   Gmail, Calendar or other scopes are requested.
 * - Firebase keeps the session itself (in IndexedDB), so a refresh restores it. We never
 *   copy tokens into localStorage, and never log credentials or tokens.
 */
import { getApp, getApps, initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import type { FirebaseWebConfig } from './config';
import type { AuthClient, AuthUser } from './types';

function toAuthUser(user: User): AuthUser {
  return { uid: user.uid, displayName: user.displayName, email: user.email };
}

export function createFirebaseAuthClient(config: FirebaseWebConfig): AuthClient {
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  const auth = getAuth(app);

  return {
    onAuthStateChanged: (callback) => onAuthStateChanged(auth, (user) => callback(user ? toAuthUser(user) : null)),

    async signInWithGoogle({ selectAccount = false } = {}) {
      const provider = new GoogleAuthProvider();
      // "Use another Google account" forces Google's account chooser to appear.
      if (selectAccount) provider.setCustomParameters({ prompt: 'select_account' });
      // The result (which includes OAuth credentials) is deliberately not kept or logged.
      await signInWithPopup(auth, provider);
    },

    signOut: () => signOut(auth),

    async getIdToken() {
      return auth.currentUser ? auth.currentUser.getIdToken() : null;
    },
  };
}
