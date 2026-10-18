# Deploying the AxiomFlo gateway (R5)

These steps put the gateway live as its own Cloud Run service, `axiomflo-gateway`, in `axiomflo-pilot`. After this, people's Claude and Gemini requests made with an AxiomFlo key show up on the real report pages.

**Nothing here has been done for you, and every step needs your go-ahead.** From step 3 on, real AI calls cost money:

- Claude calls come out of your Claude Console credit.
- Gemini calls are billed to `axiomflo-pilot`'s billing account.

The gateway itself is one more Cloud Run service that scales to zero, so it costs very little when idle.

Use **Cloud Shell** (the **>_** icon in the console) with the latest code: `cd axiomflo-pilot && git pull`.

## 1. Switch on two Google APIs

```bash
gcloud services enable aiplatform.googleapis.com secretmanager.googleapis.com --project axiomflo-pilot
```

- **Vertex AI** is for Gemini. Usage is paid per request.
- **Secret Manager** holds your Claude key. It has a small free allowance.

To undo, open **APIs & Services → Enabled APIs**, choose the API, and click **Disable**.

## 2. Create the gateway's own service account

This gives the gateway its own narrow identity, separate from the API's. It's not Owner or Editor, and it has no key file.

```bash
P=axiomflo-pilot
SA=axiomflo-gateway@$P.iam.gserviceaccount.com
gcloud iam service-accounts create axiomflo-gateway --project $P --display-name "AxiomFlo gateway"
gcloud projects add-iam-policy-binding $P --member serviceAccount:$SA --role roles/datastore.user --condition=None
gcloud projects add-iam-policy-binding $P --member serviceAccount:$SA --role roles/aiplatform.user --condition=None
```

- **Cloud Datastore User** lets it check AxiomFlo keys and write usage records.
- **Vertex AI User** lets it call Gemini.

To undo, delete the service account in **IAM & Admin → Service accounts**.

## 3. Store your Claude Console key in Secret Manager

1. In the Claude Console, open **API keys → Create key**, name it `axiomflo-gateway` and copy it.
2. While you're there, set a spend limit under **Billing → Limits**. Your $20 credit is a natural cap anyway.
3. Then, in Cloud Shell:

```bash
read -rsp "Paste the Claude key, then press Enter: " KEY && echo
printf '%s' "$KEY" | gcloud secrets create anthropic-api-key --project axiomflo-pilot --data-file=-
unset KEY
gcloud secrets add-iam-policy-binding anthropic-api-key --project axiomflo-pilot \
  --member serviceAccount:axiomflo-gateway@axiomflo-pilot.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor
```

The key isn't shown while you paste it, and it isn't saved in Cloud Shell's history. Only the gateway can read the secret.

To undo, delete the secret in **Security → Secret Manager** and revoke the key in the Claude Console.

**Skipping Claude for now?** You can leave this step out, and also drop the `--set-secrets` line in step 4. Gemini will still work, and Claude requests will answer "not set up".

## 4. Deploy the gateway

```bash
gcloud run deploy axiomflo-gateway \
  --source server \
  --region asia-southeast1 \
  --project axiomflo-pilot \
  --service-account axiomflo-gateway@axiomflo-pilot.iam.gserviceaccount.com \
  --command node --args dist/gateway/index.js \
  --set-env-vars FIREBASE_PROJECT_ID=axiomflo-pilot,PILOT_COMPANY_ID=pilot \
  --set-secrets ANTHROPIC_API_KEY=anthropic-api-key:latest \
  --max-instances 2 \
  --timeout 900 \
  --allow-unauthenticated
```

- It's the same code as the API, started with the gateway's entry point instead.
- **About `--allow-unauthenticated`:** tools call the gateway from people's laptops, which can't send Google Cloud credentials. Every request still needs a valid AxiomFlo key. Only `/health` is open, and it says nothing but `ok`.

When it finishes, it prints the gateway's address, `https://axiomflo-gateway-….run.app`. Check `…/health` shows `{"status":"ok"}`.

To undo, delete the `axiomflo-gateway` service in Cloud Run. Everyone's AxiomFlo keys then stop working, and nothing else changes.

## 5. Try it (this makes two small paid calls)

1. In AxiomFlo, open **Settings → AxiomFlo keys**, create a key for one of your teams, and copy it.
2. In Cloud Shell:

```bash
GW=$(gcloud run services describe axiomflo-gateway --region asia-southeast1 --project axiomflo-pilot --format='value(status.url)')
read -rsp "Paste your AxiomFlo key: " AXF && echo

curl -s "$GW/anthropic/v1/messages" -H "x-api-key: $AXF" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"claude-haiku-5-5","max_tokens":30,"messages":[{"role":"user","content":"Say hello in five words"}]}'; echo

curl -s "$GW/vertex/v1beta/models/gemini-2.5-flash:generateContent" -H "x-goog-api-key: $AXF" -H "content-type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Say hello in five words"}]}]}'; echo
unset AXF
```

3. Open **Usage Explorer** in AxiomFlo. Both requests should be listed with your name, your team, the token counts and an estimated cost, each a fraction of a cent.

If a call fails, the reply says why:

| Reply | Meaning |
| --- | --- |
| `401` | The key was mistyped or revoked. |
| `403` | Your membership or team doesn't allow the key. |
| Vertex `403 PERMISSION_DENIED` | Step 2's Vertex AI User role is missing or still taking effect. Wait a minute and try again. |
| Claude `503 … isn’t set up` | Step 3's secret wasn't attached in step 4. |

## 6. Tell your teams

Send them the gateway address and these two settings, from [gateway.md](gateway.md#pointing-a-tool-at-it-after-deployment):

- **Claude:** base URL `https://<gateway>/anthropic` and their AxiomFlo key as the API key.
- **Gemini (Google Gen AI SDK):** base URL `https://<gateway>/vertex` and their AxiomFlo key as the API key.

Each person creates their own key in **Settings**.
