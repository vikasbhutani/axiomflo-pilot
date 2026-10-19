# AxiomFlo API (`server/`)

The backend that decides who may enter an AxiomFlo workspace. A Google (or verified email) sign-in tells it **who** someone is; a membership record in Firestore tells it **which company, role and teams** they get. See [docs/backend/plan.md](../docs/backend/plan.md) for the full design and milestones.

> **Milestone 5: tested and documented.** The API verifies Firebase ID tokens, decides access from memberships, and lets a Company Admin invite people and change members. The bootstrap script creates the company and first admin. It's tested against the local Firebase emulators, **not yet against your real project**, and nothing is deployed. To go live, follow [docs/backend/go-live.md](../docs/backend/go-live.md). Each security rule and the test that proves it is in [docs/backend/security-checklist.md](../docs/backend/security-checklist.md).

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
| Invitations (create, list, revoke, accept), member changes, audit events, rate limits | Real code, tested against the emulators, including two admins acting at once |
| Invitation emails | **Not built.** Invitations say "Created — email not sent"; the admin tells the person to sign in |
| Deployment | Documented in [go-live.md](../docs/backend/go-live.md); waits for your approval |

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
| `GET /api/members` | Company Admin | Members with email, name, role, teams and status |
| `PATCH /api/members/:uid` | Company Admin | Change someone else's role, teams or status (`active` / `suspended`) |
| `GET /api/invitations` | Company Admin | Invitations, newest first |
| `POST /api/invitations` | Company Admin | Invite `{email, role, teamIds, expiresInDays}` (1 to 30 days, default 14) |
| `POST /api/invitations/:id/revoke` | Company Admin | Revoke a pending invitation |
| `POST /api/invitations/accept` | anyone signed in with a verified email | Accept the invitation for **your own** email. The body is ignored |
| `GET /api/keys` | active members | Your AxiomFlo keys (Company Admin: every key) |
| `POST /api/keys` | active members | Create a key `{name, teamId}` for one of your teams. The full key is returned **once** |
| `POST /api/keys/:id/revoke` | active members | Revoke your key (Company Admin: any key) |
| `GET /api/usage?month=YYYY-MM` | active members | Usage records for a Sydney calendar month. Company Admin: everyone's. Individual user: their own |
| `GET /api/exchange-rates` | active members | USD → reporting-currency rates, by month |
| `PUT /api/exchange-rates/:month` | Company Admin | Set a month's rate `{rate}`. Audited |
| `POST /api/assistant/ask` | active members | Ask the AI Cost Assistant `{question, sessionId?}`. `503` until the agent is set up |
| `GET /api/assistant/suggestions?month=YYYY-MM` | active members | Savings suggestions for that month, from what you can see |
| `GET /api/slack/link?code=…` | active members | Which Slack user a link code is for, and whether its email matches yours |
| `POST /api/slack/link` | active members | Link that Slack user to **your own** account `{code}`. Refused unless the emails match. Audited |
| `GET /api/slack/links` | active members | Your Slack link (Company Admin: everyone's) |
| `DELETE /api/slack/links/:id` | active members | Unlink yours (Company Admin: anyone's). Audited |

Every `/api` call needs `Authorization: Bearer <Firebase ID token>`. The response codes are `401` for no sign-in or an invalid one, `403` when you're signed in but not allowed, `400` for a bad request body, `404` when there's nothing to act on, `409` when a rule would be broken, `429` for too many changes, and `503` when the API can't check right now. See [docs/backend/auth-contract.md](../docs/backend/auth-contract.md) for the exact response shapes.

### Rules the admin endpoints enforce

- Nobody can change their own role, teams or status, not even an admin.
- The company always keeps at least one active Company Admin. Two admins demoting each other at the same moment leaves exactly one.
- One pending invitation per email address. Revoke it, or let it expire, to send a new one.
- Inviting someone who is already a member (active or suspended) is refused, and a suspended member can't accept an invitation to get back in.
- Accepting uses the email and verification status from the sign-in token, and the role and teams from the invitation. Nothing the browser sends is used.
- Every change writes an audit event (`invitation.created`, `invitation.revoked`, `invitation.accepted`, `member.updated`) in the same transaction, under `companies/{id}/auditEvents`. Audit events don't contain email addresses.
- Writes are limited to 30 a minute per admin, and accept to 10 a minute per person. The limit is kept in memory, per server instance.

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

This starts local, throwaway copies of Firebase Authentication and Firestore (project `demo-axiomflo`, which can't touch real data) and runs the tests that need them. They cover the bootstrap, real sign-in tokens (including disabled and revoked accounts), invitations and member changes under concurrent requests, and every rule in the [security checklist](../docs/backend/security-checklist.md). It needs Java 11+; the first run downloads the Firestore emulator.

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
| `src/routes/` | `/health`, `/api/me`, `/api/company`, `/api/teams`, and the member and invitation routes (`admin.ts`) |
| `src/admin/` | Request checks (`validation.ts`) and the member and invitation operations, each in a Firestore transaction (`firestoreAdminService.ts`) |
| `src/http/rateLimit.ts` | Per-user request limits |
| `src/gateway/` | The AI gateway, a separate service started by `src/gateway/index.ts`: the Claude route (`anthropic.ts`), the Gemini on Vertex AI route (`vertex.ts`), shared key checks (`common.ts`), prices (`prices.ts`, `vertexPrices.ts`) and usage records (`usage.ts`). See [docs/reporting/gateway.md](../docs/reporting/gateway.md) |
| `src/reports/` | Usage reads (`firestoreUsageService.ts`), Sydney month boundaries (`months.ts`) and exchange rates |
| `src/assistant/` | Calls the private AxiomFlo Agent (`agentClient.ts`) with the usage snapshot for the verified member (`snapshot.ts`); routes in `src/routes/assistant.ts`. See [docs/agent/deploy.md](../docs/agent/deploy.md) |
| `src/slack/` | The Slack bot, a separate service started by `src/slack/index.ts`: signature checks, account linking (`links.ts`, routes in `src/routes/slackLinks.ts`) and replies. See [docs/agent/slack.md](../docs/agent/slack.md) |
| `src/keys/` | AxiomFlo keys for the gateway: format and hashing, create, list and revoke, and `resolveKey`, which the gateway runs on every request |
| `src/bootstrap/` | The bootstrap script (`cli.ts`), its checks (`input.ts`) and the transaction (`bootstrap.ts`) |
| `src/test/fakes.ts` | Stand-ins for Firebase Auth and Firestore used by unit tests |
| `src/test/fakeAnthropic.ts` | A pretend Anthropic API on a local port, so gateway tests never call the real one |
| `src/test/emulator.ts`, `*.emulator.test.ts` | Tests against the local Firebase emulators |
| `src/security.emulator.test.ts` | The brief's security rules, end to end |
| `src/repo.test.ts` | Fails if a private key or service-account file is ever committed |
