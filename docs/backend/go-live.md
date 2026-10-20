# Going live with real workspace access

These steps switch AxiomFlo from "the browser reads its own membership" to "the AxiomFlo API decides access". Do them in order. Each step says whether it can be undone.

> **Status (2026-10-18):** steps 1 to 5 are done. The company ID is `pilot`, the API is `axiomflo-api` in `axiomflo-pilot`, and the web app `axiomflo` forwards `/api` to it. Steps 6 and 7 are left.

**Nothing here has been done for you.** Steps 2 to 4 create a Google Cloud resource and change who may call it, so they wait for your go-ahead. Cloud Run, Cloud Build and Artifact Registry can incur small charges.

You'll use two places:

- The **Google Cloud console** (console.cloud.google.com), with project `axiomflo-pilot` selected at the top.
- **Cloud Shell**, a terminal inside your browser. Click the **>_** icon at the top right of the console. It already has Node.js and `gcloud`, and it's signed in as you, so you never download a key file. Some steps need typed commands, and this is the only terminal you need.

## 1. Create the company and your admin membership (bootstrap)

This writes records that nothing reads yet, so it's safe to do first. If you need to undo it, delete the `companies` collection in Firestore.

1. Sign in to AxiomFlo once with Google. You'll land on **Access pending**.
2. In the Firebase console, open **Authentication → Users** and copy your **User UID**.
3. Get the code into Cloud Shell. Either:
   - on GitHub, click **Code → Download ZIP**, then in Cloud Shell use **⋮ → Upload** and run `unzip axiomflo-pilot-main.zip && cd axiomflo-pilot-main/server`; or
   - run `git clone https://github.com/vikasbhutani/axiomflo-pilot.git && cd axiomflo-pilot/server`. GitHub asks you to sign in if the repo is private.
4. Install the packages:

   ```bash
   npm ci
   ```

5. Make your settings file and open it in the editor:

   ```bash
   cp bootstrap.example.json bootstrap.json
   cloudshell edit bootstrap.json
   ```

   Replace every `REPLACE…` value with your real company, department and team details. IDs use lowercase letters, digits and `-`, for example `acme`, `engineering`, `platform`. Team codes use capitals, for example `PLAT`. The script refuses to run while any placeholder is left.

6. Run it, with your UID:

   ```bash
   npm run bootstrap -- --config bootstrap.json --admin-uid YOUR_UID --project axiomflo-pilot
   ```

   It checks your account exists and your email is verified, shows your email and every record it will create, and waits for you to type `yes`. Running it again is safe: it reports "Everything is already set up". If an existing record differs, it refuses and changes nothing.

   If it says it can't look up the user because of a missing "quota project", run `gcloud auth application-default login` in Cloud Shell, follow the link, then run the script again.

7. Note the company ID you used. The API needs it as `PILOT_COMPANY_ID`.

## 2. Create the API's own service account (needs your approval)

This gives the API its own narrow identity. It's not Owner or Editor, and it has no key file.

1. In the console, open **IAM & Admin → Service accounts → Create service account**.
2. Name it `axiomflo-api`, then click **Create and continue**.
3. Add two roles: **Cloud Datastore User** (read and write Firestore) and **Firebase Authentication Viewer** (look up accounts, which is needed to spot revoked or disabled ones). Click **Done**.

To undo, delete the service account.

## 3. Deploy the AxiomFlo API (needs your approval)

**Before you start, check two things in `axiomflo-pilot`.** On the 2026-10-18 go-live, both stopped the first deploy:

- **A billing account must be linked**, even though usage stays within free allowances. Without one, deploying fails with `Billing account … is not found`, and the Cloud Run page says the API "is not enabled". To fix it, open **Billing → Link a billing account** for the project. You can also add a budget alert: **Billing → Budgets & alerts**, for example 5 a month, which emails you and doesn't stop anything.
- **The build account needs Cloud Run Builder.** Newer projects give the default compute account no permissions, so builds fail with `default service account is missing required IAM permissions`. Grant this one narrow role. It's not Owner or Editor, and the running API doesn't use it:

  ```bash
  gcloud projects add-iam-policy-binding axiomflo-pilot \
    --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com \
    --role=roles/run.builder --condition=None
  ```

  `PROJECT_NUMBER` is on the console's home page. It's `154167701875` for `axiomflo-pilot`. To undo, remove the role in **IAM & Admin → IAM**.

In Cloud Shell, from the repo's top folder (`cd ..` if you're still in `server`):

```bash
gcloud run deploy axiomflo-api \
  --source server \
  --region asia-southeast1 \
  --service-account axiomflo-api@axiomflo-pilot.iam.gserviceaccount.com \
  --set-env-vars FIREBASE_PROJECT_ID=axiomflo-pilot,PILOT_COMPANY_ID=YOUR_COMPANY_ID \
  --max-instances 2 \
  --allow-unauthenticated
```

**About `--allow-unauthenticated`.** Browsers can't send Google Cloud credentials, so the API has to accept requests from the internet, just like your web app does today. That's not the same as accepting *users*: every `/api` route still demands a valid Firebase sign-in **and** an active membership, checked on each request. Only `/health` is open, and it says nothing but `ok`.

When it finishes it prints the API's address, `https://axiomflo-api-….run.app`. Open `…/health` in your browser: you should see `{"status":"ok"}`.

To undo, delete the `axiomflo-api` service in Cloud Run.

## 4. Point the web app at the API (needs your approval)

The web app's server forwards `/api` to the API, so the browser keeps using one address.

**The web app is in a different Google Cloud project.** Its Cloud Run service is called `axiomflo`, and it lives in the project with number `603572706266`, not in `axiomflo-pilot`. Its address is `https://axiomflo-603572706266.asia-southeast1.run.app`. `gcloud` needs that project's ID, not its number, so this command looks up the ID first. It then checks the API is healthy and that the `axiomflo` service exists before updating it.

In Cloud Shell, from the repo's top folder:

```bash
WEB=$(gcloud projects describe 603572706266 --format='value(projectId)')
API=$(gcloud run services describe axiomflo-api --region asia-southeast1 --project axiomflo-pilot --format='value(status.url)')
curl -s "$API/health" && echo
gcloud run services describe axiomflo --region asia-southeast1 --project "$WEB" --format='value(status.url)' && \
gcloud run deploy axiomflo --source . --region asia-southeast1 --project "$WEB" --update-env-vars API_ORIGIN=$API
```

`API_ORIGIN` must be the API's address with no trailing slash and nothing after `.run.app`.

Then open AxiomFlo and sign in. You should land on the **Overview**. **Settings** shows your name with **Company Admin** and **Access approved** at the top, with your company and both teams.

To undo, open Cloud Run → `axiomflo` (in the web app's project) → **Revisions**, and send 100% of traffic to the previous revision.

### Invite your team

Once step 4 works, the workspace page shows **Invite someone**, **Members** and **Invitations** to you as Company Admin. Invite each person by email with their role and teams. AxiomFlo doesn't send emails yet, so each invitation says "Created — email not sent": tell the person to sign in to AxiomFlo with that exact address. When they sign in with a verified email, they're let in with the role and teams you chose.

## 5. Lock Firestore against direct browser access

Do this **after** step 4 works. The old web app version still reads Firestore directly.

1. In the Firebase console, open **Firestore Database → Rules**.
2. Replace everything with the contents of [`firestore.rules`](../../firestore.rules), then click **Publish**.

To undo, paste the previous rules back (the Rules tab keeps a history).

## 6. Clean up the old membership

Once you've signed in through the API, delete the old top-level **`memberships`** collection in **Firestore Database → Data**. Nothing reads it any more.

## 7. Check it works

These are the same rules the [security checklist](security-checklist.md) tests automatically, checked once by hand on the real deployment. Use a private browser window for the second account.

| Do this | You should see |
| --- | --- |
| Open `https://axiomflo-api-….run.app/api/me` directly in a browser | `{"error":{"code":"unauthenticated",…}}` with status 401 |
| Sign in to AxiomFlo as yourself | **Your workspace access is approved**, Company Admin, both teams, and the Invite, Members and Invitations panels |
| Sign in with a second Google account that hasn't been invited | **Access pending** |
| Invite that second account as an Individual User on one team, then sign that account out and in again | It's let in, sees only that team, and has no admin panels |
| Suspend it from **Members**, then reload its page | **You don’t have access to AxiomFlo** |
| Try to suspend yourself | There's no button for it. The API refuses it too |
| In Firestore, open `companies → your company → auditEvents` | One event per change, with no email addresses |
| In Cloud Run → `axiomflo-api` → **Logs** | One line per request with a request ID, and no tokens |
| In **IAM & Admin → IAM**, find `axiomflo-api@…` | Only **Cloud Datastore User** and **Firebase Authentication Viewer**. No Owner or Editor |

If any row looks different, stop and ask before inviting more people.

## Updating after a change is merged

New features need the services redeployed: the API first, then the agent (when `backend/` changed), then the web app. In Cloud Shell, from the repo's top folder:

```bash
git pull
gcloud run deploy axiomflo-api --source server --region asia-southeast1 --project axiomflo-pilot
gcloud run deploy axiomflo-agent --source backend --region asia-southeast1 --project axiomflo-pilot
WEB=$(gcloud projects describe 603572706266 --format='value(projectId)')
gcloud run deploy axiomflo --source . --region asia-southeast1 --project "$WEB"
```

A redeploy keeps each service's settings: its service account, environment variables and instance limits. To undo, send traffic back to the previous revision, as in step 4.

## If something goes wrong

| You see | Likely cause |
| --- | --- |
| "We couldn't check your AxiomFlo access" | The web app can't reach the API. Check `API_ORIGIN` (step 4) and that `/health` works (step 3) |
| Access pending after the bootstrap | `PILOT_COMPANY_ID` on the API doesn't match the company ID in `bootstrap.json`, or you ran the bootstrap with a different UID |
| An API error mentioning permission in Cloud Run's logs | The service account is missing one of the two roles (step 2) |

In Cloud Run, the **Logs** tab for `axiomflo-api` shows one line per request with a request ID, and never shows tokens.
