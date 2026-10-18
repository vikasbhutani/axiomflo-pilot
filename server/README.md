# AxiomFlo API (`server/`)

The backend that decides who may enter an AxiomFlo workspace. A Google (or verified email) sign-in tells it **who** someone is; a membership record in Firestore tells it **which company, role and teams** they get. See [docs/backend/plan.md](../docs/backend/plan.md) for the full design and milestones.

> **Milestone 3: bootstrap and web app connection.** The API verifies Firebase ID tokens and reads memberships for `/api/me`, `/api/company` and `/api/teams`, and the web app now uses `/api/me`. The bootstrap script creates the company and first admin. It's tested against the local Firebase emulators, **not yet against your real project**, and nothing is deployed. To go live, follow [docs/backend/go-live.md](../docs/backend/go-live.md).

## What's real and what isn't yet

| Part | State |
| --- | --- |
| `GET /health` | Real |
| Config checks (project ID, company ID, origins, port) | Real; the server refuses to start on bad values |
| Request IDs, JSON logs with redaction, security headers, 16 KB body limit | Real |
| Firebase token verification (signature, expiry, project, revoked and disabled accounts) | Real code, tested with stand-ins |
| `/api/me`, `/api/company`, `/api/teams` and membership checks on every request | Real code, tested with stand-ins |
| Bootstrap script (`npm run bootstrap`) | Real code, tested against the Firestore emulator |
| Web app uses `/api/me` (and refreshes the sign-in token once after a 401) | Real code, tested |
| Invitations, member changes, audit events | Milestone 4 |
| Deployment | Milestone 5, with your approval |

## Run it on your computer

You need Node.js 22 or newer.

```bash
cd server            # go into the API folder
npm install          # download the packages it needs (first time only)
cp .env.example .env.local   # make your own settings file, then edit PILOT_COMPANY_ID
npm run dev          # start the API at http://localhost:8080, restarting on code changes
```

Then open http://localhost:8080/health and you should see `{"status":"ok"}`.

Other commands:

```bash
npm test             # run the automated tests (no Google account or internet needed)
npm run typecheck    # check the TypeScript types
npm run build        # compile to dist/ (what Cloud Run runs)
npm start            # run the compiled version
```

## Endpoints

| Endpoint | Who | Returns |
| --- | --- | --- |
| `GET /health` | anyone | `{"status":"ok"}` |
| `GET /api/me` | anyone signed in | Who you are and `access`: `active`, `pending` or `suspended`. Company, role and teams only when active |
| `GET /api/company` | active members | Company name, currency, timezone |
| `GET /api/teams` | active members | Admin: all teams. Individual user: assigned teams |

Every `/api` call needs `Authorization: Bearer <Firebase ID token>`. The response codes are `401` for no sign-in or an invalid one, `403` when you're signed in but not allowed, and `503` when the API can't check right now. See [docs/backend/auth-contract.md](../docs/backend/auth-contract.md) for the exact response shapes.

## Bootstrap the company and first admin

There's no web endpoint that can create a company or an administrator. You do it once, by hand, with your own Google credentials:

```bash
cp bootstrap.example.json bootstrap.json      # then replace every REPLACE… value
npm run bootstrap -- --config bootstrap.json --admin-uid YOUR_FIREBASE_UID --project axiomflo-pilot
```

It checks the UID exists, isn't disabled and has a verified email. It then shows the email and every record it will create, and waits for you to type `yes`. It's safe to run again: matching records are left alone, and if anything differs it refuses and writes nothing. The full walk-through, including running it in Cloud Shell, is step 1 of [go-live.md](../docs/backend/go-live.md).

## Tests against the Firebase emulators

```bash
npm run test:emulator
```

This starts local, throwaway copies of Firebase Authentication and Firestore (project `demo-axiomflo`, which can't touch real data) and runs the tests that need them. They cover the bootstrap's idempotency and conflict handling, plus real sign-in tokens going through `/api/me`, including disabled and revoked accounts. It needs Java 11+; the first run downloads the Firestore emulator.

The API on your computer can also use real Firestore as you, but only with the gcloud CLI (`gcloud auth application-default login`). Cloud Shell already has this set up.

## Settings

All settings are environment variables; [`.env.example`](.env.example) explains each one. **None of them are secrets.** The API never uses a service-account key file:

- On Cloud Run it uses the service's own runtime service account automatically.
- On your computer or in Cloud Shell it uses your own Google sign-in (Application Default Credentials).

| Variable | Required | Example | Meaning |
| --- | --- | --- | --- |
| `FIREBASE_PROJECT_ID` | yes | `axiomflo-pilot` | Only sign-in tokens from this Firebase project are accepted |
| `PILOT_COMPANY_ID` | yes | `your-company-id` | The one approved company; the browser can't change it |
| `ALLOWED_ORIGINS` | no | `https://app.example.com` | Exact web addresses allowed to call the API from a browser. Empty = same address only (recommended). `*` is refused |
| `FIRESTORE_DATABASE_ID` | no | `(default)` | Only if the project uses a named Firestore database |
| `PORT` | no | `8080` | Cloud Run sets this itself |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn` or `error` |

## Code map

| File | What it does |
| --- | --- |
| `src/index.ts` | Reads settings, starts listening on `0.0.0.0:$PORT`, shuts down cleanly on Cloud Run's SIGTERM |
| `src/app.ts` | Puts the Express app together (used by tests too) |
| `src/config.ts` | Reads and checks the settings |
| `src/firebase.ts` | Firebase Admin SDK with Application Default Credentials |
| `src/http/` | Request IDs and access log, redacting logger, CORS, security headers, error responses |
| `src/auth/tokenVerifier.ts` | Checks Firebase ID tokens with the Admin SDK (revocation and disabled accounts included) |
| `src/auth/authenticate.ts` | Reads the `Authorization: Bearer` header; 401/503 handling |
| `src/membership/records.ts` | Firestore record shapes and strict parsers |
| `src/membership/firestoreStore.ts` | Reads company, teams and memberships, always under the configured company |
| `src/membership/access.ts` | Decides active / pending / suspended and which teams are visible |
| `src/membership/requireMember.ts` | Route guards: active member, required role |
| `src/routes/` | `/health`, `/api/me`, `/api/company`, `/api/teams` |
| `src/bootstrap/` | The bootstrap script (`cli.ts`), its checks (`input.ts`) and the transaction (`bootstrap.ts`) |
| `src/test/fakes.ts` | Stand-ins for Firebase Auth and Firestore used by unit tests |
| `src/test/emulator.ts`, `*.emulator.test.ts` | Tests against the local Firebase emulators |
