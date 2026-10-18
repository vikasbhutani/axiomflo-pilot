/**
 * Bootstrap the approved pilot company and its first Company Admin.
 *
 *   npm run bootstrap -- --config bootstrap.json --admin-uid <Firebase UID> --project axiomflo-pilot
 *
 * Runs with YOUR Google credentials (Application Default Credentials), for example in
 * Cloud Shell. It never uses or needs a service-account key, and it is not part of the
 * web API: there is no endpoint that can create a company or an admin.
 *
 * Steps: check the UID exists in Firebase Authentication, isn't disabled and has a
 * verified email → show the planned records → ask you to type "yes" → write them in
 * one transaction with an audit event.
 */
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { applyBootstrap, BootstrapConflictError, planBootstrap, type BootstrapPlan } from './bootstrap.js';
import { BootstrapInputError, parseAdminUid, parseBootstrapInput, type BootstrapInput } from './input.js';

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

function say(line = '') {
  process.stdout.write(line + '\n');
}

function fail(message: string): never {
  process.stderr.write(`\n✗ ${message}\n`);
  process.exit(1);
}

function describe(input: BootstrapInput, adminUid: string, email: string) {
  say('Planned configuration');
  say(`  Company      ${input.company.name}  (id: ${input.company.id}, ${input.company.reportingCurrency}, ${input.company.reportingTimezone})`);
  say(`  Department   ${input.department.name}  (id: ${input.department.id})`);
  for (const t of input.teams) say(`  Team         ${t.name}  (id: ${t.id}, code: ${t.code})`);
  say(`  First admin  ${email}  (UID: ${adminUid}, role: Company Admin)`);
}

function describePlan(plan: BootstrapPlan) {
  say();
  say('What will happen');
  for (const item of plan.items) {
    const label = item.action === 'create' ? 'create   ' : item.action === 'unchanged' ? 'unchanged' : 'CONFLICT ';
    say(`  ${label} ${item.path}${item.differences.length ? `  (differs: ${item.differences.join(', ')})` : ''}`);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      'admin-uid': { type: 'string' },
      project: { type: 'string' },
      'database-id': { type: 'string' },
    },
  });

  if (!values.config) fail('Give the configuration file with --config (copy bootstrap.example.json and fill it in).');
  const project = values.project ?? process.env.FIREBASE_PROJECT_ID ?? '';
  if (!PROJECT_ID.test(project)) fail('Give the Firebase project ID with --project (for example axiomflo-pilot).');

  let input: BootstrapInput;
  let adminUid: string;
  try {
    input = parseBootstrapInput(JSON.parse(await readFile(values.config, 'utf8')));
    adminUid = parseAdminUid(values['admin-uid']);
  } catch (error) {
    if (error instanceof BootstrapInputError) fail(error.message);
    if (error instanceof SyntaxError) fail(`${values.config} is not valid JSON.`);
    fail(`Could not read ${values.config}.`);
  }

  // Imported here so a bad command line fails fast without loading the Admin SDK.
  const { applicationDefault, initializeApp } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ credential: applicationDefault(), projectId: project });
  const db = getFirestore(app, values['database-id'] ?? '(default)');

  say(`Firebase project: ${project}`);
  if (process.env.FIRESTORE_EMULATOR_HOST) say(`(using the Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST})`);
  say();

  let email: string;
  try {
    const user = await getAuth(app).getUser(adminUid);
    if (user.disabled) fail('That Firebase account is disabled. Enable it in Firebase Authentication first.');
    if (!user.email) fail('That Firebase account has no email address.');
    if (!user.emailVerified) fail(`${user.email} hasn’t verified its email address yet. Sign in once with Google, or click the verification link, then try again.`);
    email = user.email;
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') fail(`No Firebase user has the UID ${adminUid}. Copy it from Authentication → Users.`);
    fail(`Could not look up the user (${(error as { code?: string }).code ?? 'unknown error'}). Check you are signed in to Google with access to ${project}.`);
  }

  describe(input, adminUid, email);
  const plan = await planBootstrap(db, input, adminUid);
  describePlan(plan);

  const legacy = await db.collection('memberships').doc(adminUid).get();
  if (legacy.exists) {
    say();
    say('Note: an old top-level memberships/' + adminUid + ' document exists. It is not copied or changed.');
    say('      Delete the old "memberships" collection once you have signed in through the API.');
  }

  if (plan.conflicts.length > 0) fail('Some existing records differ from this configuration. Nothing was changed. Fix the file (or the records) and run it again.');
  if (plan.toCreate.length === 0) {
    say();
    say('✓ Everything is already set up. Nothing to do.');
    return;
  }

  say();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Type "yes" to create these records: ')).trim().toLowerCase();
  rl.close();
  if (answer !== 'yes') fail('Cancelled. Nothing was changed.');

  try {
    const applied = await applyBootstrap(db, input, adminUid);
    say();
    say(`✓ Created ${applied.toCreate.length} record(s) and an audit event.`);
    say(`  Set PILOT_COMPANY_ID=${input.company.id} on the AxiomFlo API, then refresh AxiomFlo.`);
  } catch (error) {
    if (error instanceof BootstrapConflictError) fail('Records changed while the script was running and now conflict. Nothing was changed. Run it again to see what differs.');
    throw error;
  }
}

main().catch((error: unknown) => fail(`Unexpected error (${(error as { code?: string }).code ?? (error as Error)?.name ?? 'unknown'}). The changes are all-or-nothing; run the script again to see what exists.`));
