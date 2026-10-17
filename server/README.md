# AxiomFlo API (`server/`)

The backend that decides who may enter an AxiomFlo workspace. A Google (or verified email) sign-in tells it **who** someone is; a membership record in Firestore tells it **which company, role and teams** they get. See [docs/backend/plan.md](../docs/backend/plan.md) for the full design and milestones.

> **Milestone 1: skeleton only.** The server starts, answers `GET /health`, and has the safety plumbing (request IDs, sanitized logs, size limits, exact-origin CORS, safe errors). It doesn't verify tokens or read memberships yet, so the web app doesn't use it. Nothing is deployed.

## What's real and what isn't yet

| Part | State |
| --- | --- |
| `GET /health` | Real |
| Config checks (project ID, company ID, origins, port) | Real; the server refuses to start on bad values |
| Request IDs, JSON logs with redaction, security headers, 16 KB body limit | Real |
| Firebase token verification, `/api/me`, membership checks | Milestone 2 |
| Bootstrap script, frontend connection | Milestone 3 |
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

## Settings

All settings are environment variables; [`.env.example`](.env.example) explains each one. **None of them are secrets.** The API never uses a service-account key file:

- On Cloud Run it uses the service's own runtime service account automatically.
- On your computer (from Milestone 2, when it starts talking to Firebase) it uses your own Google sign-in via Application Default Credentials.

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
| `src/routes/health.ts` | `GET /health` |
