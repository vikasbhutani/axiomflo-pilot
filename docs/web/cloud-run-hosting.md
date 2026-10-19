# Hosting the web app on Cloud Run

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

No command line? Everything above can also be done in the [Google Cloud console](https://console.cloud.google.com/run), or by clicking the **>_** (Activate Cloud Shell) icon at the top right of the console, which opens a terminal in your browser with `gcloud` already installed.

## If the address shows a Google error page

These pages come from Google, not from the app. Open **Cloud Run → your service** in the console:

- **"Error: Page not found. The requested URL was not found on this server."** Open the **Networking** tab, set **Ingress** to **All**, make sure the default `run.app` URL isn't disabled, and save.
- **"Error: Forbidden. Your client does not have permission…"** Open the **Security** tab, choose **Allow unauthenticated access**, and save. Only do this if anyone with the link may see the demo.
- **"Service Unavailable"** or a timeout. Open the **Logs** tab and look for the first error after the latest deploy.

The service page also shows the exact URL to use; Cloud Run can show two `run.app` addresses for the same service, and both work.

## Use your own domain

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

## Test the container on your computer (optional)

If you have Docker installed:

```bash
docker build -t axiomflo-pilot .
docker run --rm -p 8080:8080 axiomflo-pilot
```

Then open http://localhost:8080.
