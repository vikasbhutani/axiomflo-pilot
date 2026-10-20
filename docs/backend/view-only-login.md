# A view-only login for judges

This gives people outside the company (for example AI Builder Cup judges) an email and password that opens **your real AxiomFlo workspace** with the same data you see as Company Admin, but **can't change anything**.

What the login can do:

- See every page: Overview, Usage Explorer, Teams & Users, AI Providers, Monthly Showback, Settings.
- Download showback CSVs and ask the AI Cost Assistant.
- Run an Upgrade Analysis and download its report.

What it can't do (the API answers "This is a view-only account, so nothing can be changed."):

- Invite, suspend or change members.
- Create or revoke AxiomFlo keys, so it can never send paid AI requests through the gateway.
- Change exchange rates or link Slack.
- Save an Upgrade Analysis.

The top bar shows **View-only access** while signed in with it.

## Before you start

- The latest code must be live. Do Part A of the next-steps guide (redeploy **axiomflo-api** first, then the **axiomflo** website). An older API ignores the view-only setting, so never skip this.
- **Email/Password** must be switched on in Firebase: [console.firebase.google.com](https://console.firebase.google.com) → **axiomflo-pilot** → **Authentication → Sign-in method**. It should say *Enabled* next to Email/Password.

## Create the login (Cloud Shell)

1. Open Cloud Shell with a fresh copy of the code (the same ZIP steps as in "Before you start" of the next-steps guide), then:

   ```bash
   cd ~/axiomflo-pilot-main/server && npm ci
   ```

2. Look up your company ID from the API's settings:

   ```bash
   COMPANY=$(gcloud run services describe axiomflo-api --region asia-southeast1 --project axiomflo-pilot --format=json | jq -r '.spec.template.spec.containers[0].env[] | select(.name=="PILOT_COMPANY_ID") | .value')
   echo "$COMPANY"
   ```

   The `echo` line should print one word, such as `pilot`.

3. Create the login:

   ```bash
   npm run add-viewer -- --email judge@acme.example --company "$COMPANY" --project axiomflo-pilot
   ```

   It shows what it will do and waits for you to type `yes`. Then it prints the email and a new random password **once**. Copy both straight into your submission. The password is never stored anywhere you can read it again.

   If it complains about a missing "quota project", run `gcloud auth application-default login`, follow the link, then run step 3 again.

4. Test it in a private browser window: open AxiomFlo, enter the email and password under **Work email** and **Password** (not the Google button), and check you see **View-only access** at the top. If you don't, stop and redeploy the API (Part A) before sharing the login.

## Text for the submission

```
Live app: https://axiomflo-603572706266.asia-southeast1.run.app
Sign in with email and password (not Google):
  Email:    judge@acme.example
  Password: <paste the password the script printed>
This is a view-only account on the live workspace. You can browse every page,
export showback and ask the AI Cost Assistant; changes are blocked.
No login needed for the sample data: click "Explore the demo workspace" on the sign-in page.
```

## Change the password or switch it off

- **New password:** run step 3 again. The old password stops working straight away.
- **Switch it off:** in AxiomFlo go to **Teams & Users** and suspend the judge, or delete the user in Firebase **Authentication → Users**.

The script refuses to touch an email that already belongs to a normal member, so it can't downgrade your own account.
