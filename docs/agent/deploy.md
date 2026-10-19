# Turning on the AI Cost Assistant

These steps put the AxiomFlo Agent live as its own private Cloud Run service, `axiomflo-agent`, and connect it to the AxiomFlo API. Afterwards, the **AI Cost Assistant** page in the real workspace answers questions and shows savings suggestions from your real usage.

**Nothing here has been done for you.** Each question to the assistant calls Gemini on Vertex AI once or twice, billed to `axiomflo-pilot`'s billing account. With a Flash-class model that is a fraction of a cent per question; check the price of the model you choose. The service itself scales to zero when nobody is asking.

Before you start:

- The gateway should be deployed ([gateway-deploy.md](../reporting/gateway-deploy.md)). That's where real usage comes from. Without it the assistant works but has nothing to talk about.
- Use **Cloud Shell** (the **>_** icon in the Google Cloud console) with the latest code: `cd axiomflo-pilot && git pull`.

## 1. Switch on Vertex AI

Skip this if you did step 1 of the gateway guide.

```bash
gcloud services enable aiplatform.googleapis.com --project axiomflo-pilot
```

## 2. Pick a Gemini model

Open Google's [Deployments and endpoints](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations) page and pick a **Flash** model listed for `asia-southeast1` (Singapore), where your app already runs. Use Sydney (`australia-southeast1`) instead only if your model is listed there. Write down the model ID, for example `gemini-2.5-flash`.

## 3. Create the agent's own service account

The agent gets its own narrow identity. It can call Gemini and nothing else: **it has no access to Firestore**, because the API sends it the records for each question.

```bash
P=axiomflo-pilot
AGENT_SA=axiomflo-agent@$P.iam.gserviceaccount.com
gcloud iam service-accounts create axiomflo-agent --project $P --display-name "AxiomFlo agent"
gcloud projects add-iam-policy-binding $P --member serviceAccount:$AGENT_SA --role roles/aiplatform.user --condition=None
```

To undo, delete the service account in **IAM & Admin → Service accounts**.

## 4. Deploy the agent (private)

Find your web app's address first, so links in answers point at it. Replace `YOUR_WEB_PROJECT` with the project that hosts the `axiomflo` web service:

```bash
WEB_URL=$(gcloud run services describe axiomflo --region asia-southeast1 --project YOUR_WEB_PROJECT --format='value(status.url)')
echo $WEB_URL
```

Then deploy, putting your model ID from step 2 in place of `gemini-2.5-flash`:

```bash
gcloud run deploy axiomflo-agent \
  --source backend \
  --region asia-southeast1 \
  --project axiomflo-pilot \
  --service-account axiomflo-agent@axiomflo-pilot.iam.gserviceaccount.com \
  --set-env-vars AXIOMFLO_AGENT_MODEL=gemini-2.5-flash,GOOGLE_CLOUD_PROJECT=axiomflo-pilot,GOOGLE_CLOUD_LOCATION=asia-southeast1,AXIOMFLO_WEB_BASE_URL=$WEB_URL,AXIOMFLO_AGENT_ALLOWED_CALLERS=axiomflo-api@axiomflo-pilot.iam.gserviceaccount.com \
  --no-allow-unauthenticated \
  --max-instances 1 \
  --memory 1Gi \
  --timeout 120
```

- **`--no-allow-unauthenticated`** makes the service private. Google refuses every request unless the caller has the Cloud Run Invoker role, which only the API gets in the next step.
- **`AXIOMFLO_AGENT_ALLOWED_CALLERS`** is a second check inside the agent: only the API's own identity is accepted.
- **`--max-instances 1`** keeps follow-up questions in the same conversation, and caps cost.

When it finishes it prints `Service URL: https://axiomflo-agent-….run.app`. Save it for the next step:

```bash
AGENT_URL=$(gcloud run services describe axiomflo-agent --region asia-southeast1 --project axiomflo-pilot --format='value(status.url)')
```

## 5. Let the API call the agent

```bash
gcloud run services add-iam-policy-binding axiomflo-agent --region asia-southeast1 --project axiomflo-pilot \
  --member serviceAccount:axiomflo-api@axiomflo-pilot.iam.gserviceaccount.com --role roles/run.invoker
gcloud run deploy axiomflo-api --source server --region asia-southeast1 --project axiomflo-pilot --update-env-vars AGENT_URL=$AGENT_URL
```

The second command also redeploys the API with this version's assistant routes. Then redeploy the web app so it has the new assistant page:

```bash
gcloud run deploy axiomflo --source . --region asia-southeast1 --project YOUR_WEB_PROJECT
```

## 6. Try it

1. Sign in to AxiomFlo and open **AI Cost Assistant**.
2. The **Savings suggestions** panel loads first. It doesn't use Gemini, so it works even if step 2 went wrong. With little usage it says "Nothing stands out", which is fine.
3. Click **What did each team spend this month?** The answer should match the Overview page for this month, and name the currency and exchange rate.
4. Try **How can we lower our AI spend?** It should pass on the suggestions from the panel, in its own words.

If you see an error instead:

| You see | What it means |
| --- | --- |
| "The assistant isn't set up yet" | The API doesn't have `AGENT_URL`. Rerun the second command in step 5. |
| "couldn't be reached just now" | The agent refused the API's call. Check step 5's first command, and that `AGENT_URL` on the API is exactly the agent's Service URL. The agent's **Logs** tab in Cloud Run shows a 401 or 403. |
| "could not reach its AI model" | Gemini refused. Check step 1, step 3, and that the model ID from step 2 is listed for your region. |

## How to undo anything

| Undo what | How |
| --- | --- |
| The assistant | `gcloud run services update axiomflo-api --region asia-southeast1 --project axiomflo-pilot --remove-env-vars AGENT_URL`. The page goes back to "isn't set up yet". |
| The agent service | **Cloud Run** → `axiomflo-agent` → **Delete**. |
| The agent's identity | **IAM & Admin → Service accounts** → delete `axiomflo-agent`. |
