# Running AxiomFlo on your computer

You need **Node.js 22** or newer. For the emulator tests you also need **Java 11** or newer. Everything here runs on your machine, and none of it changes your real Firebase project unless a step says so.

## 1. Run all the tests (no Google account needed)

From the repo's top folder:

```bash
npm ci                 # web app packages (first time only)
npm test               # web app tests
cd server
npm ci                 # API packages (first time only)
npm test               # API unit tests
npm run test:emulator  # API tests against local Firebase emulators
```

`test:emulator` starts throwaway copies of Firebase Authentication and Firestore under the project `demo-axiomflo`, which can't reach real data. It runs the [security checklist](security-checklist.md) tests, then shuts the emulators down. The first run downloads the Firestore emulator.

Other checks contributors run before pushing:

```bash
npm run build                         # top folder: types and production build
cd server && npm run typecheck && npm run build
```

## 2. Try the web app with sample data

```bash
npm run dev
```

Open http://localhost:5173 and choose **Explore the demo workspace**. This needs no API and no sign-in.

## 3. Run the web app and the API together (real sign-in)

This uses your **real** Firebase project for sign-in and Firestore, so it needs Google credentials on your computer. The simplest place to do this is **Cloud Shell**, which already has them. On your own computer it needs the gcloud CLI (`gcloud auth application-default login`).

1. In `server/`, run `cp .env.example .env.local` and set `PILOT_COMPANY_ID` to your company ID.
2. Start the API: `cd server && npm run dev`. It listens on http://localhost:8080. Check http://localhost:8080/health.
3. In another terminal, from the top folder, run `npm run dev`. The dev server forwards `/api` to port 8080, so the browser uses one address.
4. Add `localhost` under **Firebase console → Authentication → Settings → Authorized domains** if sign-in says the domain isn't authorized. It's usually there by default.

Anything you do here, like inviting someone or suspending a member, changes your real Firestore data.

## Where things live

| Folder | What it is |
| --- | --- |
| `src/` | The web app (React) |
| `server/` | The AxiomFlo API (Node + Express). See [server/README.md](../../server/README.md) |
| `backend/` | The AxiomFlo Agent (Python), separate and not yet connected. See [auth-contract.md](auth-contract.md) |
| `deploy/` | The web server config, including `/api` forwarding |
| `docs/backend/` | Plan, auth contract, security checklist, go-live steps |
