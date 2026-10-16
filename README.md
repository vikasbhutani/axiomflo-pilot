# AxiomFlo pilot UI

A frontend-only prototype of **AxiomFlo**, an enterprise AI cost management platform, set up as a demo workspace for one pilot company (Acme Innovation). It shows which team is using AI, which provider and model they use, what that usage is estimated to cost, and how monthly totals map back to individual requests.

> **All reporting data here is sample data.** There is no backend, no billing and no calls to any AI provider. Google sign-in is real once you set it up (see [Google sign-in setup](#google-sign-in-setup)), but it doesn't unlock any company data yet. Model names and prices are illustrative and are **not** current provider pricing.

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

Open the address it prints (usually http://localhost:5173). You'll see the sign-in page; click **Explore the demo workspace** to open the sample data, or follow [Google sign-in setup](#google-sign-in-setup) to sign in with Google. The page reloads automatically when you edit files. Press `Ctrl + C` in the terminal to stop it.

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

## Google sign-in setup

AxiomFlo can sign people in with their Google account using **Firebase Authentication**. Two ideas are kept apart:

- **Google identity** answers *who is this person?* Google and Firebase confirm it.
- **AxiomFlo membership** answers *which company, teams and role may they see?* Only a trusted backend may answer this. Signing in never creates a membership, and nobody becomes an administrator by signing up first.

There is no membership backend yet, so **everyone who signs in sees "Access pending"**. That is intentional, not a bug. The sample-data demo is still available through **Explore the demo workspace** on the sign-in page and is always labelled "Demo workspace — sample data".

Nothing below is done automatically. Each step is something you do in your own Google Cloud / Firebase account.

### 1. Add Firebase to your existing Google Cloud project

You don't need a second project. Firebase can be switched on inside the Google Cloud project you already deploy Cloud Run to.

1. Open the [Firebase console](https://console.firebase.google.com/) signed in with the same Google account you use for Google Cloud.
2. Choose the option to **add Firebase to an existing Google Cloud project** (instead of creating a new project) and pick your project from the list.
3. Google Analytics is optional; you can turn it off.

Adding Firebase turns on a few Google APIs in the project (for example the Identity Toolkit API that Firebase Authentication uses). Plain Firebase Authentication with Google sign-in is enough for AxiomFlo, so you don't need the optional "Identity Platform" upgrade. If your Cloud project already has billing enabled, Firebase shows it on the pay-as-you-go (Blaze) plan; check the [Firebase pricing page](https://firebase.google.com/pricing) if you want to confirm costs.

### 2. Register the web app

1. In the Firebase console, open **Project settings** (the gear icon) → **General**.
2. Under **Your apps**, click the web icon (`</>`).
3. Give it a nickname such as `AxiomFlo web`. Leave **Firebase Hosting** unticked, because the app is hosted on Cloud Run.
4. Click **Register app**. Firebase shows a `firebaseConfig` block; keep that page open for step 4.

### 3. Turn on Google as a sign-in provider

1. In the Firebase console, open **Authentication** (under Build) and click **Get started** if you haven't used it before.
2. Open the **Sign-in method** tab, choose **Google**, switch it to **Enabled**, pick a support email, and click **Save**.

AxiomFlo only asks Google for the person's basic profile and email address. It never requests Drive, Gmail, Calendar or other access, and people type their Google password into Google's own window, never into AxiomFlo.

If your Google Cloud project belongs to a Google Workspace organization, also check the OAuth consent screen in the Google Cloud console (**Google Auth Platform → Audience**). "Internal" means only accounts in your organization can sign in; choose "External" if pilot users have other Google accounts.

### 4. Copy the Firebase web configuration

Copy the example file and fill in the four values from the `firebaseConfig` block (you can find it again under **Project settings → General → Your apps**):

```bash
cp .env.example .env.local
```

| `firebaseConfig` field | Put it in |
| --- | --- |
| `apiKey` | `VITE_FIREBASE_API_KEY` |
| `authDomain` (looks like `your-project.firebaseapp.com`) | `VITE_FIREBASE_AUTH_DOMAIN` |
| `projectId` | `VITE_FIREBASE_PROJECT_ID` |
| `appId` | `VITE_FIREBASE_APP_ID` |

Some things worth knowing about these values:

- **They are not secrets.** Firebase web configuration identifies your project to the browser, and anyone visiting the site can see it. It does not decide who may see company data; the membership backend does.
- **Anything starting with `VITE_` is copied into the browser JavaScript.** Never put a Google OAuth client secret, a service-account private key or Firebase Admin SDK credentials in a `VITE_` variable or anywhere in this frontend.
- **Vite reads them when it builds.** After changing them, restart `npm run dev`, or rebuild and redeploy.
- `.env.local` is ignored by git, so your local values stay on your computer.

If the values are missing, the sign-in page explains which ones and the Google button stays off. The app never pretends someone signed in.

### 5. Authorize localhost

In the Firebase console go to **Authentication → Settings → Authorized domains** and check that `localhost` is listed. New projects usually include it, but don't assume so: if it's missing, click **Add domain** and enter `localhost`. Note that `127.0.0.1` counts as a different domain, so open the app at `http://localhost:5173`.

### 6. Authorize your deployed web address

On the same **Authorized domains** list, add the exact hostname people use to open AxiomFlo, without `https://` or any path. For your Cloud Run service that is the `….run.app` hostname shown in the Cloud Run console (for example `axiomflo-123456789012.asia-southeast1.run.app`). Cloud Run can show two `run.app` addresses for one service; add each one people actually use, plus any custom domain such as `app.example.com`. Without this, sign-in shows "Google sign-in isn't enabled for this web address".

**Deploying with the values:** because Vite builds them in, the Cloud Run build needs them too. Before running `gcloud run deploy --source .`, create `.env.production` in the project folder with the same four `VITE_FIREBASE_…` lines. That file isn't in `.gitignore` or `.dockerignore`, so the build picks it up. It holds only public values, so committing it is fine, but you don't have to.

**Why a popup and not a redirect:** sign-in opens Google in a popup started directly by the button click. This works on Cloud Run with no extra hosting setup, including on phones, where the "popup" usually opens as a new tab. Firebase's redirect sign-in (`signInWithRedirect`) is not used: on sites not hosted by Firebase Hosting, modern browsers block the storage it relies on unless you follow Firebase's [redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices), such as proxying `/__/auth/` from nginx to Firebase and changing `authDomain`. That is worth doing later only if popups cause real problems. Google also blocks sign-in inside some in-app browsers (for example links opened inside social media apps); people should open AxiomFlo in their normal browser. If you ever add a `Cross-Origin-Opener-Policy` header in `deploy/nginx.conf.template`, use `same-origin-allow-popups`, otherwise the popup can't report back.

### 7. Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. You'll land on the sign-in page.

### 8. Try sign-up, sign-in, refresh and sign-out

1. Click **Sign up** (or **Continue with Google** on the sign-in page) and choose a Google account in the window that opens.
2. You should arrive at **Access pending**, showing your name and email.
3. Refresh the page. You should stay signed in on **Access pending**: Firebase restores the session itself (it stores it in the browser's IndexedDB; AxiomFlo never stores tokens).
4. Click **Use another Google account** to see Google's account chooser.
5. Click **Sign out**. You return to the sign-in page; refreshing keeps you signed out.
6. Start sign-in and close the Google window. You should see a calm "Sign-in was cancelled" note.

### 9. Why a signed-in person sees "Access pending"

Signing in only proves who someone is. Access to company data needs an **active AxiomFlo membership** from a trusted backend, and that backend doesn't exist yet, so `src/auth/membershipService.ts` returns "no membership" for everyone. Memberships are never taken from the demo role switcher, URL parameters, browser storage or an email domain. A suspended membership leads to **Access denied** instead.

### 10. What's needed before real company data is shown

The frontend is ready to plug into a backend, but these pieces still have to be built:

1. **A backend API** (for example a second Cloud Run service) that verifies every request's Firebase ID token with the **Firebase Admin SDK** on the server. The Admin SDK never goes in this frontend.
2. **A protected membership store** (for example Cloud SQL, or Firestore with security rules that block all client writes) with `userId` (Firebase UID), `companyId`, `role` (`company_admin` or `individual_user`), `teamIds` and `status` (`active`, `pending` or `suspended`). Only administrators, through the backend, can change it. Create the first admin yourself, directly in that store.
3. **A membership endpoint**, `GET /v1/me/membership`, that returns the membership for the verified token's UID (404 when there is none). Then set `VITE_API_BASE_URL` to the backend's `https://` address and rebuild; the app switches to `createHttpMembershipService` automatically.
4. **Real reporting endpoints** that check company and team membership on every request. Hiding pages in the browser is not security on its own. Until those exist, approved members see a "reporting data isn't connected yet" notice instead of sample data.

`src/auth/api.ts` has a small helper that sends the signed-in user's ID token as an `Authorization: Bearer` header over HTTPS. It never puts tokens in URLs and never logs them.

### Other settings

| Variable | What it does |
| --- | --- |
| `VITE_DEMO_MODE` | Set to `disabled` to remove "Explore the demo workspace". The demo is on by default so the current site keeps working. |
| `VITE_TERMS_URL`, `VITE_PRIVACY_URL` | Links to your published Terms of Service and Privacy Policy (`https://`). These pages don't exist yet, so the sign-in pages mark them as "setup required". AxiomFlo doesn't include any policy text. |
| `VITE_API_BASE_URL` | The future backend's address. Leave empty until it exists. |

### Where the code lives

- `src/auth/`: Firebase sign-in (`firebaseClient.ts`), the `AuthProvider` / `useAuth` state (`AuthContext.tsx`), membership (`membershipService.ts`), route guards (`guards.tsx`), safe return-to links (`redirects.ts`), demo mode (`demoSession.ts`) and the API helper (`api.ts`).
- `src/pages/auth/`: `/login`, `/signup`, `/access-pending` and `/access-denied`.
- `src/auth/auth.test.tsx` and `src/auth/auth.unit.test.ts`: tests, with Firebase replaced by a fake so no Google account is needed.

## Switching demo roles

Open the demo with **Explore the demo workspace** on the sign-in page, then use the **View as** selector in the top bar:

- **Company Admin** (Maya Chen) sees both teams and company-wide totals.
- **Individual User** (Noah Williams, Product Experience) sees only their own requests.

The choice is remembered in your browser. Role filtering happens in the mock service layer (`src/services/mockService.ts`), not just in the UI, so every page gets the same scoped data. **This is a demonstration only:** in production, authorization must be enforced by the backend on every request, because anything in the browser can be changed by the user. The switcher only exists in the demo workspace: it never changes a real signed-in person's role or access.

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
