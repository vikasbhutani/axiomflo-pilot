# Sign-in setup (Google and email)

AxiomFlo signs people in with **Firebase Authentication**, using either their **Google account** or an **email and password**. Memberships are stored in **Cloud Firestore**. Two ideas are kept apart:

- **Identity** answers *who is this person?* Google or Firebase confirms it. Email/password accounts must click a confirmation link before anything else happens.
- **AxiomFlo membership** answers *which company, teams and role may they see?* It comes from a Firestore record under `companies/{company}/memberships/{user ID}` that only the AxiomFlo API reads, created by the bootstrap script (for the first admin) or by an administrator. Signing in never creates a membership, and nobody becomes an administrator by signing up first.

Until you add a membership document for someone, **they see "Access pending"** after signing in. That is intentional, not a bug. The sample-data demo is still available through **Explore the demo workspace** on the sign-in page and is always labelled "Demo workspace — sample data".

Nothing below is done automatically. Each step is something you do in your own Google Cloud / Firebase account.

## 1. Add Firebase to your existing Google Cloud project

You don't need a second project. Firebase can be switched on inside the Google Cloud project you already deploy Cloud Run to.

1. Open the [Firebase console](https://console.firebase.google.com/) signed in with the same Google account you use for Google Cloud.
2. Choose the option to **add Firebase to an existing Google Cloud project** (instead of creating a new project) and pick your project from the list.
3. Google Analytics is optional; you can turn it off.

Adding Firebase turns on a few Google APIs in the project (for example the Identity Toolkit API that Firebase Authentication uses). Plain Firebase Authentication with Google sign-in is enough for AxiomFlo, so you don't need the optional "Identity Platform" upgrade. If your Cloud project already has billing enabled, Firebase shows it on the pay-as-you-go (Blaze) plan; check the [Firebase pricing page](https://firebase.google.com/pricing) if you want to confirm costs.

## 2. Register the web app

1. In the Firebase console, open **Project settings** (the gear icon) → **General**.
2. Under **Your apps**, click the web icon (`</>`).
3. Give it a nickname such as `AxiomFlo web`. Leave **Firebase Hosting** unticked, because the app is hosted on Cloud Run.
4. Click **Register app**. Firebase shows a `firebaseConfig` block; keep that page open for step 4.

## 3. Turn on Google and email/password sign-in

1. In the Firebase console, open **Authentication** (under Build) and click **Get started** if you haven't used it before. **Don't skip this:** until it's done, every sign-in shows "Firebase Authentication isn't set up for this project yet" (Google's error code is `CONFIGURATION_NOT_FOUND`).
2. Open the **Sign-in method** tab, choose **Google**, switch it to **Enabled**, pick a support email, and click **Save**.
3. Still on **Sign-in method**, click **Add new provider**, choose **Email/Password**, switch on the first **Enable** toggle (leave "Email link (passwordless sign-in)" off), and click **Save**.

Firebase sends the confirmation and password-reset emails itself. You can change their wording under **Authentication → Templates**.

Firebase links accounts by email: if someone signs up with email and password and later uses Google with the same address, Google takes over that account. If they used Google first, creating a password account with the same email shows "An account already exists for this email".

AxiomFlo only asks Google for the person's basic profile and email address. It never requests Drive, Gmail, Calendar or other access, and people type their Google password into Google's own window, never into AxiomFlo.

If your Google Cloud project belongs to a Google Workspace organization, also check the OAuth consent screen in the Google Cloud console (**Google Auth Platform → Audience**). "Internal" means only accounts in your organization can sign in; choose "External" if pilot users have other Google accounts.

## 4. Copy the Firebase web configuration

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

## 5. Authorize localhost

In the Firebase console go to **Authentication → Settings → Authorized domains** and check that `localhost` is listed. New projects usually include it, but don't assume so: if it's missing, click **Add domain** and enter `localhost`. Note that `127.0.0.1` counts as a different domain, so open the app at `http://localhost:5173`.

## 6. Authorize your deployed web address

On the same **Authorized domains** list, add the exact hostname people use to open AxiomFlo, without `https://` or any path. For your Cloud Run service that is the `….run.app` hostname shown in the Cloud Run console (for example `axiomflo-123456789012.asia-southeast1.run.app`). Cloud Run can show two `run.app` addresses for one service; add each one people actually use, plus any custom domain such as `app.example.com`. Without this, sign-in shows "Google sign-in isn't enabled for this web address".

**Deploying with the values:** because Vite builds them in, the Cloud Run build needs them too. Before running `gcloud run deploy --source .`, create `.env.production` in the project folder with the same four `VITE_FIREBASE_…` lines. That file isn't in `.gitignore` or `.dockerignore`, so the build picks it up. It holds only public values, so committing it is fine, but you don't have to.

**Why a popup and not a redirect:** sign-in opens Google in a popup started directly by the button click. This works on Cloud Run with no extra hosting setup, including on phones, where the "popup" usually opens as a new tab. Firebase's redirect sign-in (`signInWithRedirect`) is not used: on sites not hosted by Firebase Hosting, modern browsers block the storage it relies on unless you follow Firebase's [redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices), such as proxying `/__/auth/` from nginx to Firebase and changing `authDomain`. That is worth doing later only if popups cause real problems. Google also blocks sign-in inside some in-app browsers (for example links opened inside social media apps); people should open AxiomFlo in their normal browser. If you ever add a `Cross-Origin-Opener-Policy` header in `deploy/nginx.conf.template`, use `same-origin-allow-popups`, otherwise the popup can't report back.

## 7. Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. You'll land on the sign-in page.

## 8. Try sign-up, sign-in, refresh and sign-out

1. Click **Sign up** (or **Continue with Google** on the sign-in page) and choose a Google account in the window that opens.
2. You should arrive at **Access pending**, showing your name, email and AxiomFlo user ID.
3. Refresh the page. You should stay signed in on **Access pending**: Firebase restores the session itself (it stores it in the browser's IndexedDB; AxiomFlo never stores tokens).
4. Click **Use another Google account** to see Google's account chooser.
5. Click **Sign out**. You return to the sign-in page; refreshing keeps you signed out.
6. Start sign-in and close the Google window. You should see a calm "Sign-in was cancelled" note.
7. On **Sign up**, create an email/password account. You should see **Confirm your email**. Open the link Firebase emails you, then click **I've confirmed my email**: you move on to **Access pending**.
8. On **Log in**, click **Forgot password?** and send yourself a reset link.

## Set up Firestore and workspace access

Workspace access is decided by the **AxiomFlo API** (`server/`), not by the browser. The API checks each person's Firebase sign-in and reads their membership from Firestore under `companies/{companyId}/memberships/{uid}`. Browsers have no direct access to Firestore at all (see [`firestore.rules`](../../firestore.rules)).

1. If you haven't already, open **Firestore Database** (under Build) in the Firebase console and click **Create database**. Choose **Standard edition** if asked, a location close to your users (for example `asia-southeast1`; it can't be changed later), and **Start in production mode**.
2. Follow **[docs/backend/go-live.md](../backend/go-live.md)**. It covers creating the company and your admin membership with the bootstrap script, deploying the API, pointing the web app at it, and publishing the locked-down rules, in that order.

To run everything on your computer, see [docs/backend/local-development.md](../backend/local-development.md). In short: start the API (`cd server && npm run dev`) and then `npm run dev` here; the dev server forwards `/api` to the API on port 8080. Every security rule and the test that proves it is listed in [docs/backend/security-checklist.md](../backend/security-checklist.md).

## 9. Why a signed-in person sees "Access pending"

Signing in only proves who someone is. Access needs an **active membership** in the approved company. Only the bootstrap script (for the first admin) or, later, an admin invitation creates one. Memberships are never taken from the demo role switcher, URL parameters, browser storage or an email domain. A suspended membership or company leads to **Access denied**. If the API can't be reached, you see a "couldn't check your access" page with **Try again**, never access.

## Other settings

| Variable | What it does |
| --- | --- |
| `VITE_DEMO_MODE` | Set to `disabled` to remove "Explore the demo workspace". The demo is on by default so the current site keeps working. |
| `VITE_TERMS_URL`, `VITE_PRIVACY_URL` | Links to your published Terms of Service and Privacy Policy (`https://`). These pages don't exist yet, so the sign-in pages mark them as "setup required". AxiomFlo doesn't include any policy text. |
| `VITE_API_BASE_URL` | Optional address of the AxiomFlo API. Leave empty: the app then uses its own address, and the web server (or `npm run dev`) forwards `/api` to the API. |

## Where the code lives

- `src/auth/`: Firebase sign-in for Google and email/password (`firebaseClient.ts`), the `AuthProvider` / `useAuth` state (`AuthContext.tsx`), membership from the AxiomFlo API's `/api/me` (`membershipService.ts`), route guards (`guards.tsx`), safe return-to links (`redirects.ts`), demo mode (`demoSession.ts`) and the API helper (`api.ts`).
- `src/pages/auth/`: `/login`, `/signup`, `/reset-password`, `/verify-email`, `/access-pending` and `/access-denied`.
- `firestore.rules` (with `firebase.json` and `.firebaserc` for the Firebase CLI, if you ever use it): blocks all direct browser access to Firestore.
- `src/auth/auth.test.tsx` and `src/auth/auth.unit.test.ts`: tests, with Firebase replaced by a fake so no Google account is needed.
