# AxiomFlo pilot UI

A frontend-only prototype of **AxiomFlo**, an enterprise AI cost management platform, set up as a demo workspace for one pilot company (Acme Innovation). It shows which team is using AI, which provider and model they use, what that usage is estimated to cost, and how monthly totals map back to individual requests.

> **Everything here is sample data.** There is no backend, no live sign-in, no billing and no calls to any AI provider. Model names and prices are illustrative and are **not** current provider pricing.

## Run it locally

You need [Node.js](https://nodejs.org/) 20 or newer (the LTS installer is fine). Then, in a terminal:

```bash
# 1. Go into the project folder
cd axiomflo-pilot

# 2. Install dependencies (first time only, takes a minute)
npm install

# 3. Start the development server
npm run dev
```

Open the address it prints (usually http://localhost:5173). The page reloads automatically when you edit files. Press `Ctrl + C` in the terminal to stop it.

Other useful commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the automated tests once |
| `npm run typecheck` | Checks TypeScript types without building |
| `npm run build` | Makes a production build in `dist/` |
| `npm run preview` | Serves that production build locally |

## Host it on Google Cloud Run (optional)

The repo includes a `Dockerfile` that builds the site and serves it with nginx on the port Cloud Run provides. Unknown paths such as `/usage` fall back to `index.html`, so page refreshes and shared links work. Nothing in this repo deploys anything by itself: you run these commands in your own Google Cloud account. Cloud Run, Cloud Build and Artifact Registry can incur charges, so check your billing settings first.

**Before you start:** install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) and have a Google Cloud project with billing enabled.

```bash
# 1. Sign in and choose your project (replace YOUR_PROJECT_ID)
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# 2. Turn on the services Cloud Run needs to build from source (first time only)
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

# 3. Build and deploy from this folder
gcloud run deploy axiomflo-pilot \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated
```

When it finishes, it prints a `https://axiomflo-pilot-….run.app` address. `--allow-unauthenticated` makes that address public, which suits a sample-data demo. Leave the flag off if only people in your Google Cloud project should be able to open it. To ship a new version later, run step 3 again.

### Use your own domain

Cloud Run's built-in domain mapping is a Google preview feature and only works in [some regions](https://cloud.google.com/run/docs/mapping-custom-domains). That's why step 3 uses `asia-southeast1` (Singapore): it's the closest supported region to Sydney. Replace `demo.example.com` with your domain:

```bash
# 1. Prove you own the domain (skip if it was bought through Google)
gcloud domains verify example.com

# 2. Point the domain at the service
gcloud beta run domain-mappings create --service axiomflo-pilot --domain demo.example.com --region asia-southeast1

# 3. Show the DNS records to add
gcloud beta run domain-mappings describe --domain demo.example.com --region asia-southeast1
```

Add the records listed under `resourceRecords` at your domain registrar. For a subdomain like `demo.example.com` this is usually one CNAME record. DNS can take from a few minutes to several hours to update, and Google then issues the HTTPS certificate automatically. If your DNS is on Cloudflare, turn off "Always Use HTTPS" while the certificate is issued.

If you'd rather run in Sydney (`australia-southeast1`), use a global external Application Load Balancer or Firebase Hosting in front of the service instead of domain mapping. Both are described on the same Google page.

### Test the container on your computer (optional)

If you have Docker installed:

```bash
docker build -t axiomflo-pilot .
docker run --rm -p 8080:8080 axiomflo-pilot
```

Then open http://localhost:8080.

## Switching demo roles

Use the **View as** selector in the top bar:

- **Company Admin** (Maya Chen) sees both teams and company-wide totals.
- **Individual User** (Noah Williams, Product Experience) sees only their own requests.

The choice is remembered in your browser. Role filtering happens in the mock service layer (`src/services/mockService.ts`), not just in the UI, so every page gets the same scoped data. **This is a demonstration only:** in production, authorization must be enforced by the backend on every request, because anything in the browser can be changed by the user.

## Resetting the sample data

Admin changes in the demo (team names, invitations, team moves, suspensions, provider settings, simulated connection tests, the company name) are saved in your browser so they survive a refresh. To start over, go to **Settings → Reset demo data**. That restores the original workspace and clears saved preferences. Usage records are generated sample data and never change.

## What's simulated

- **Data:** one company, one department, two teams (`ENG-PLATFORM`, `ENG-PRODUCT`), six people, two applications and about 6,000 requests across August and September 2026, generated with a fixed seed so the numbers are identical everywhere.
- **Reporting date:** fixed at 30 September 2026, so the app never goes empty as real time passes. Currency is AUD and dates use Australia/Sydney.
- **Provider connections:** shown as “Connected — demo”. Nothing is actually connected. “Simulate connection test” lets you pick a success or failure outcome; no provider is contacted. The Anthropic API-key field is a disabled, masked sample, and no credential is ever entered or stored.
- **Admin actions:** invitations send no email, suspensions revoke nothing, and every change is recorded in a simulated audit log under Settings.
- **Reconciliation:** “Reconciled (sample)” and “Estimated” states are sample data. No provider billing records are compared.
- **Costs:** `(input tokens × input rate per million + output tokens × output rate per million) ÷ 1,000,000`, using illustrative rates. Requests with missing usage show “Not available” and are counted separately as unresolved, never as $0. Failed requests are costed from whatever usage was measured.

## Project structure

```
src/
  types/        Shared TypeScript types
  data/         The mock dataset (sample data only)
  lib/          Calculations, formatting, permissions, storage helpers
  services/     Mock service functions (replace these with real API calls later)
  context/      Demo role / period state and notifications
  components/   Shared UI and the application shell
  pages/        One component per screen
```

All totals (cards, charts, tables, and later the showback CSV and assistant) come from one module, `src/lib/calculations.ts`, so they always agree.

## Where a backend will connect later

The functions in `src/services/mockService.ts` (`getOverview`, `getUsage`, `getTeams`, `getProviderConnections`, and later `getMonthlyShowback` and `getAssistantResponse`) are the seam. Each one returns a Promise, so replacing its body with an HTTP call to a future API should not require page changes. When that happens, role checks, cost calculation and credential handling belong on the server.

## Build progress

- [x] **Milestone 1:** app shell, typed mock dataset, shared calculations, Overview page, tests
- [x] **Milestone 2:** Usage Explorer and request detail drawer
- [x] **Milestone 3:** Teams & Users, AI Providers, Settings (with demo reset)
- [x] **Milestone 4:** Monthly Showback, report preview and role-scoped CSV export
- [ ] Milestone 5: AI Cost Assistant
- [ ] Milestone 6: responsive and accessibility polish, remaining tests

Screens not built yet show a short “planned for milestone N” page so navigation never dead-ends.
