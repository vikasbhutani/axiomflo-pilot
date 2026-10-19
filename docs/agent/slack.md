# Turning on the AxiomFlo Slack bot

These steps add an **AxiomFlo** bot to your Slack workspace. People can then ask it about AI spend in three ways, and only the person who asked sees the answer:

- **Direct message** the bot: it replies in that conversation.
- **@AxiomFlo** in a channel: the reply is visible only to the person who asked.
- **/axiomflo** followed by a question, anywhere: also visible only to them.

The bot gives the same answers as the **AI Cost Assistant** page, from the same figures, and each person only gets what they can see in AxiomFlo.

**Nothing here has been done for you.** You need to be able to install apps in your Slack workspace (a Slack workspace admin, or someone they allow). The bot runs as its own Cloud Run service, `axiomflo-slack`, which scales to zero when nobody is asking.

Before you start:

- The AI Cost Assistant must already work ([deploy.md](deploy.md)). The bot answers through the same agent.
- Use **Cloud Shell** (the **>_** icon in the Google Cloud console) with the latest code: `cd axiomflo-pilot && git pull`.

## How linking works

The first time someone messages the bot, it doesn't know who they are in AxiomFlo. It privately sends them a **Link my account** button. That opens AxiomFlo, where they sign in and click **Link my Slack account**. From then on the bot answers them as that AxiomFlo member.

Linking only works when **the email on their Slack profile is the same as the email they sign in to AxiomFlo with**. This stops someone from tricking a colleague into linking the wrong Slack account. A link button works once and expires after 15 minutes. Anyone can unlink themselves in **Settings → Slack**, and a Company Admin can unlink anyone there. If a person is removed from AxiomFlo, the bot stops answering them straight away.

## 1. Create the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App → From a manifest**.
2. Pick your workspace, then **Next**.
3. Choose the **YAML** tab, delete what's there, and paste the whole of [`deploy/slack/manifest-start.yaml`](../../deploy/slack/manifest-start.yaml). Click **Next**, then **Create**.
4. On the left, click **Install App → Install to Workspace**, then **Allow**.

You now have three values to copy. Keep the tab open:

| Value | Where | Looks like |
| --- | --- | --- |
| Signing Secret | **Basic Information → App Credentials → Signing Secret → Show** | 32 letters and numbers |
| Bot token | **OAuth & Permissions → Bot User OAuth Token** | starts with `xoxb-` |
| Workspace ID | Open Slack in a browser: the part of the address starting with `T`, for example `app.slack.com/client/T0123ABCD/…` | starts with `T` |

## 2. Store the two secrets

The Signing Secret and Bot token go in Secret Manager, never in a file or a setting. Each `read` command waits for you to paste the value (nothing shows as you paste), then press Enter:

```bash
P=axiomflo-pilot
gcloud services enable secretmanager.googleapis.com --project $P
read -s -p "Signing Secret: " V && printf %s "$V" | gcloud secrets create slack-signing-secret --project $P --data-file=- && unset V; echo
read -s -p "Bot token: " V && printf %s "$V" | gcloud secrets create slack-bot-token --project $P --data-file=- && unset V; echo
for S in slack-signing-secret slack-bot-token; do
  gcloud secrets add-iam-policy-binding $S --project $P \
    --member serviceAccount:axiomflo-api@$P.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor
done
```

The bot runs as the API's own identity, `axiomflo-api`, which can already read AxiomFlo's data and call the agent. Only it can read these secrets.

## 3. Deploy the bot service

Fill in your Workspace ID from step 1, your company ID (the `PILOT_COMPANY_ID` you gave the API in [go-live.md](../backend/go-live.md)), and the project that hosts your web app:

```bash
P=axiomflo-pilot
SLACK_TEAM_ID=T0123ABCD
COMPANY=YOUR_COMPANY_ID
WEB_URL=$(gcloud run services describe axiomflo --region asia-southeast1 --project YOUR_WEB_PROJECT --format='value(status.url)')
AGENT_URL=$(gcloud run services describe axiomflo-agent --region asia-southeast1 --project $P --format='value(status.url)')
echo "$WEB_URL $AGENT_URL"

gcloud run deploy axiomflo-slack \
  --source server \
  --command node --args dist/slack/index.js \
  --region asia-southeast1 \
  --project $P \
  --service-account axiomflo-api@$P.iam.gserviceaccount.com \
  --set-env-vars FIREBASE_PROJECT_ID=$P,PILOT_COMPANY_ID=$COMPANY,SLACK_TEAM_ID=$SLACK_TEAM_ID,WEB_APP_URL=$WEB_URL,AGENT_URL=$AGENT_URL \
  --set-secrets SLACK_SIGNING_SECRET=slack-signing-secret:latest,SLACK_BOT_TOKEN=slack-bot-token:latest \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --max-instances 1 \
  --timeout 60
```

Check the `echo` line shows two addresses before deploying. If you've forgotten the company ID, it's `PILOT_COMPANY_ID` on the `axiomflo-api` service's **Variables & Secrets** tab in Cloud Run.

- **`--allow-unauthenticated`** is needed because Slack calls this service. Every request is still checked: anything not signed with your Signing Secret, or from another Slack workspace, is refused.
- **`--no-cpu-throttling`** lets the bot keep working after it tells Slack "got it". Slack needs that reply within 3 seconds, and the answer takes longer.
- **`--max-instances 1`** keeps follow-up questions in the same conversation, and caps cost.

## 4. Redeploy the API and the web app

The API gets the routes for linking, and the web app gets the link page and **Settings → Slack**:

```bash
gcloud run deploy axiomflo-api --source server --region asia-southeast1 --project axiomflo-pilot
gcloud run deploy axiomflo --source . --region asia-southeast1 --project YOUR_WEB_PROJECT
```

## 5. Point Slack at the bot

Print the full manifest with your bot's address filled in:

```bash
SLACK_URL=$(gcloud run services describe axiomflo-slack --region asia-southeast1 --project axiomflo-pilot --format='value(status.url)')
sed "s#SLACK_URL#$SLACK_URL#g" deploy/slack/manifest.yaml
```

In your Slack app's tab, click **App Manifest** on the left, choose **YAML**, replace everything with what that printed, and click **Save Changes**. If Slack asks to verify the events URL, click **Verify**; it should say **Verified**. Slack then asks you to reinstall the app: click the banner (or **Install App → Reinstall to Workspace**) and **Allow**.

## 6. Try it

1. In Slack, open the **AxiomFlo** app under **Apps** and send `What did I spend this month?`.
2. It replies privately with **Link my account**. Click it, sign in to AxiomFlo with the same email as your Slack profile, and click **Link my Slack account**.
3. Back in Slack, ask again. The answer should match the AI Cost Assistant page.
4. Try `/axiomflo how can we lower our AI spend?` in any channel, and `@AxiomFlo` in a channel the bot has been added to (type `/invite @AxiomFlo` there first).

If something's wrong:

| You see | What it means |
| --- | --- |
| Nothing happens at all | Slack can't reach the bot. Check step 5 saved, and the `axiomflo-slack` service's **Logs** tab in Cloud Run. A "Configuration error" line there names the setting from step 3 to fix. |
| `/axiomflo failed with the error "dispatch_failed"` | Same as above, for the slash command. |
| "This Slack account's email doesn't match" | Your Slack profile email and AxiomFlo sign-in email differ. Sign in to AxiomFlo with your Slack email, or ask an admin to invite that email. |
| "couldn't be reached just now" | The bot can't reach the agent. Check that the API's identity can call the agent (step 5 of [deploy.md](deploy.md)). |
| `@AxiomFlo` in a channel does nothing | Invite the bot to that channel with `/invite @AxiomFlo`. |

## How to undo anything

| Undo what | How |
| --- | --- |
| One person's link | **Settings → Slack → Unlink** in AxiomFlo. |
| The bot | **Cloud Run** → `axiomflo-slack` → **Delete**. Slack messages to it then go unanswered. |
| The Slack app | [api.slack.com/apps](https://api.slack.com/apps) → AxiomFlo → **Basic Information → Delete App**. This also cancels the bot token. |
| The secrets | **Security → Secret Manager** → delete `slack-signing-secret` and `slack-bot-token`. |
| A leaked token or secret | Slack app → **OAuth & Permissions → Revoke tokens** (then reinstall), or **Basic Information → Regenerate** the Signing Secret. Add the new value with `gcloud secrets versions add NAME --data-file=-` and redeploy `axiomflo-slack` with the same command as step 3. |
