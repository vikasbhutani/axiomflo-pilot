/**
 * Create (or reset) a VIEW-ONLY login for the pilot company, for example for
 * competition judges who should see the same data as the Company Admin.
 *
 *   npm run add-viewer -- --email judge@acme.example --company <PILOT_COMPANY_ID> --project axiomflo-pilot
 *
 * Runs with YOUR Google credentials (Application Default Credentials), for example in
 * Cloud Shell, like the bootstrap script. It is not part of the web API.
 *
 * Steps: check the company exists → find or plan the email/password account → ask you
 * to type "yes" → set a new random password, mark the email as verified, and write a
 * Company Admin membership with readOnly: true (the API refuses every change from it)
 * plus an audit event. The password is printed once, in your terminal only.
 *
 * Running it again for the same email gives the account a NEW password.
 * It refuses to touch an email that already belongs to a normal (non view-only) member.
 * To switch the login off, suspend it in Teams & Users, or delete the user in Firebase.
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const COMPANY_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function say(line = '') {
  process.stdout.write(line + '\n');
}

function fail(message: string): never {
  process.stderr.write(`\n✗ ${message}\n`);
  process.exit(1);
}

/** 20 letters and digits, without look-alikes (0/O, 1/l/I), so it can be typed from a slide. */
function newPassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(20);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      company: { type: 'string' },
      project: { type: 'string' },
      name: { type: 'string' },
      'database-id': { type: 'string' },
    },
  });

  const email = (values.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) fail('Give the login email with --email (for example judge@acme.example).');
  const companyId = values.company ?? process.env.PILOT_COMPANY_ID ?? '';
  if (!COMPANY_ID.test(companyId)) fail('Give the company ID with --company. It is PILOT_COMPANY_ID on the axiomflo-api service in Cloud Run.');
  const project = values.project ?? process.env.FIREBASE_PROJECT_ID ?? '';
  if (!PROJECT_ID.test(project)) fail('Give the Firebase project ID with --project (for example axiomflo-pilot).');
  const displayName = values.name?.trim() || 'AxiomFlo judge (view only)';

  // Imported here so a bad command line fails fast without loading the Admin SDK.
  const { applicationDefault, initializeApp } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ credential: applicationDefault(), projectId: project });
  const auth = getAuth(app);
  const db = getFirestore(app, values['database-id'] ?? '(default)');
  const company = db.collection('companies').doc(companyId);

  say(`Firebase project: ${project}`);
  const companySnap = await company.get();
  if (!companySnap.exists) fail(`There is no company "${companyId}". Check PILOT_COMPANY_ID on the axiomflo-api service.`);
  say(`Company:          ${String(companySnap.get('name'))}  (id: ${companyId})`);

  let uid: string | null = null;
  try {
    uid = (await auth.getUserByEmail(email)).uid;
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') {
      fail(`Could not look up ${email} (${(error as { code?: string }).code ?? 'unknown error'}). Check you are signed in to Google with access to ${project}.`);
    }
  }

  if (uid) {
    const existing = await company.collection('memberships').doc(uid).get();
    if (existing.exists && existing.get('readOnly') !== true) fail(`${email} is already a normal member of this company. Use a different email for the view-only login.`);
  }

  say();
  say('What will happen');
  say(uid ? `  ${email} already exists: it gets a NEW password (the old one stops working).` : `  Create the email/password login ${email}.`);
  say('  Mark its email as verified (no inbox is needed).');
  say('  Give it view-only access to every team: it can browse and ask the assistant, but not change anything.');
  say();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Type "yes" to continue: ')).trim().toLowerCase();
  rl.close();
  if (answer !== 'yes') fail('Cancelled. Nothing was changed.');

  const password = newPassword();
  if (uid) {
    await auth.updateUser(uid, { password, emailVerified: true, disabled: false });
  } else {
    uid = (await auth.createUser({ email, password, emailVerified: true, displayName })).uid;
  }

  const ref = company.collection('memberships').doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.get('readOnly') !== true) throw new Error('membership changed to a normal member while the script ran');
    const fields = { uid, role: 'company_admin', teamIds: [], status: 'active', readOnly: true, updatedAt: FieldValue.serverTimestamp() };
    if (snap.exists) tx.update(ref, fields);
    else tx.create(ref, { ...fields, createdAt: FieldValue.serverTimestamp() });
    tx.create(company.collection('auditEvents').doc(), {
      actorUid: 'add-viewer-script',
      action: 'viewer.granted',
      targetType: 'membership',
      targetId: uid,
      timestamp: FieldValue.serverTimestamp(),
      metadata: { readOnly: true, passwordReset: snap.exists },
    });
  });

  say();
  say('✓ Done. Copy these two lines into your submission (they are shown only now):');
  say();
  say(`  Email:    ${email}`);
  say(`  Password: ${password}`);
  say();
  say('Sign in on the AxiomFlo login page with "Email and password" (not Google).');
}

main().catch((error: unknown) => fail(`Unexpected error (${(error as { code?: string }).code ?? (error as Error)?.message ?? 'unknown'}). Run the script again; it is safe to repeat.`));
