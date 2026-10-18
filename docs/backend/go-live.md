# Going live with real workspace access

These steps switch AxiomFlo from "the browser reads its own membership" to "the AxiomFlo API decides access". Do them in order. Each step says whether it can be undone.

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

In Cloud Shell, from the repo's top folder:

```bash
gcloud run deploy axiomflo-pilot \
  --source . \
  --region asia-southeast1 \
  --set-env-vars API_ORIGIN=https://axiomflo-api-XXXX.a.run.app
```

(Use the address from step 3: no trailing slash, nothing after `.run.app`.)

Then open AxiomFlo, sign in, and you should see **Your workspace access is approved** with your company, the Company Admin role and both teams.

To undo, open Cloud Run → `axiomflo-pilot` → **Revisions**, and send 100% of traffic to the previous revision.

### Invite your team

Once step 4 works, the workspace page shows **Invite someone**, **Members** and **Invitations** to you as Company Admin. Invite each person by email with their role and teams. AxiomFlo doesn't send emails yet, so each invitation says "Created — email not sent": tell the person to sign in to AxiomFlo with that exact address. When they sign in with a verified email, they're let in with the role and teams you chose.

## 5. Lock Firestore against direct browser access

Do this **after** step 4 works. The old web app version still reads Firestore directly.

1. In the Firebase console, open **Firestore Database → Rules**.
2. Replace everything with the contents of [`firestore.rules`](../../firestore.rules), then click **Publish**.

To undo, paste the previous rules back (the Rules tab keeps a history).

## 6. Clean up the old membership

Once you've signed in through the API, delete the old top-level **`memberships`** collection in **Firestore Database → Data**. Nothing reads it any more.

## If something goes wrong

| You see | Likely cause |
| --- | --- |
| "We couldn't check your AxiomFlo access" | The web app can't reach the API. Check `API_ORIGIN` (step 4) and that `/health` works (step 3) |
| Access pending after the bootstrap | `PILOT_COMPANY_ID` on the API doesn't match the company ID in `bootstrap.json`, or you ran the bootstrap with a different UID |
| An API error mentioning permission in Cloud Run's logs | The service account is missing one of the two roles (step 2) |

In Cloud Run, the **Logs** tab for `axiomflo-api` shows one line per request with a request ID, and never shows tokens.
