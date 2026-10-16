/**
 * Firebase Authentication with two sign-in methods: Google and email/password.
 *
 * - Google uses a popup started straight from the button click (no redirect flow, see README),
 *   and asks only for basic profile and email. No Drive, Gmail or Calendar scopes.
 * - Email/password accounts must confirm their email address before AxiomFlo checks membership.
 * - Firebase keeps the session itself (in IndexedDB), so a refresh restores it. We never
 *   copy tokens into localStorage, and never log credentials or tokens.
 */
import type { FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import type { AuthClient, AuthUser } from './types';

function toAuthUser(user: User): AuthUser {
  return { uid: user.uid, displayName: user.displayName, email: user.email, emailVerified: user.emailVerified };
}

export function createFirebaseAuthClient(app: FirebaseApp): AuthClient {
  const auth = getAuth(app);
  auth.useDeviceLanguage();

  return {
    onAuthStateChanged: (callback) => onAuthStateChanged(auth, (user) => callback(user ? toAuthUser(user) : null)),

    async signInWithGoogle({ selectAccount = false } = {}) {
      const provider = new GoogleAuthProvider();
      // "Use another Google account" forces Google's account chooser to appear.
      if (selectAccount) provider.setCustomParameters({ prompt: 'select_account' });
      // The result (which includes OAuth credentials) is deliberately not kept or logged.
      await signInWithPopup(auth, provider);
    },

    async signInWithEmail(email, password) {
      await signInWithEmailAndPassword(auth, email, password);
    },

    async signUpWithEmail(email, password, displayName) {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) await updateProfile(user, { displayName });
      await sendEmailVerification(user);
    },

    sendPasswordReset: (email) => sendPasswordResetEmail(auth, email),

    async sendVerificationEmail() {
      if (auth.currentUser) await sendEmailVerification(auth.currentUser);
    },

    async reloadUser() {
      const user = auth.currentUser;
      if (!user) return null;
      await user.reload();
      // Refresh the ID token so Firestore security rules see the new email_verified value.
      await user.getIdToken(true);
      return toAuthUser(user);
    },

    signOut: () => signOut(auth),

    async getIdToken() {
      return auth.currentUser ? auth.currentUser.getIdToken() : null;
    },
  };
}
