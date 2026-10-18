# Real usage and cost data: plan

**Status:** proposal for review, revised 2026-10-18 for per-person and per-request detail. Nothing is built, and no provider is connected.

**Goal:** the real workspace's tabs (Overview, Usage Explorer, Teams, Providers, Monthly Showback, Assistant) show the company's real AI usage and costs. Each team sees only its own data, and nothing is invented.

## 1. What the tabs need

The demo is built on one record per AI request: who made it, which team code, which model, tokens in and out, whether it succeeded, and its cost. Real data can come from two places, and they give different levels of detail.

| Tab | Needs | From provider reports (A) | From a gateway (B) |
| --- | --- | --- | --- |
| Overview | Spend by team, provider and model, plus a trend | Yes, daily | Yes |
| Monthly Showback and CSV | Spend per team per month | Yes | Yes |
| Teams | Spend per team; spend per person | Per team only | Per team and per person |
| Usage Explorer | A list of individual requests, with a detail drawer | Daily rows only, with no single requests | Yes |
| Providers | Connection setup and status | Yes | Yes |
| Assistant | Answers from the same figures | Yes, at the level of detail above | Yes |

## 2. Two ways to get the data

**A. Read the providers' own usage and cost reports (recommended first).** AxiomFlo calls each provider's reporting API every hour and stores daily totals per team. Your teams change nothing about how they call AI.

- **Anthropic (Claude API):** the [Usage and Cost Admin API](https://platform.claude.com/docs/en/build-with-claude/usage-cost-api). It reports tokens by model, API key and workspace in 1-minute, 1-hour or 1-day buckets, and costs in USD by day. It needs an **Admin API key** (`sk-ant-admin…`), which only an organisation admin can create. Data usually appears within 5 minutes, and sustained polling is limited to once a minute.
  - **Team attribution:** give each team its own **workspace** in the Claude Console, or its own API key. AxiomFlo maps workspace or key → team.
- **Gemini on Vertex AI:** Google has no per-request usage API. Cost comes from the **Cloud Billing export to BigQuery**. Vertex lets each Gemini call carry [custom labels](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/add-labels-to-api-calls), and those labels appear in the billing export.
  - **Team attribution:** either every call carries a label such as `axiomflo_team=plat`, or each team uses its own Google Cloud project. Billing data arrives later than Anthropic's, often hours later (to be confirmed on your account).

**B. A gateway that teams send their AI requests through.** AxiomFlo forwards each request to the provider and records it. This gives per-person and per-request detail, and lets AxiomFlo enforce budgets later. It is a bigger change: every team's code or tools must point at AxiomFlo, AxiomFlo then sits in the path of every AI call, and it must be fast and highly available.

**Decision (Vikas, 2026-10-18):** the providers are Gemini on Vertex AI and Anthropic (Claude API). Detail is needed per team, per person and per request, so **the gateway (B) is the main design**. Option A can't attribute usage to a person.

The gateway also avoids the Anthropic Admin API, which needs a Claude Console *organisation* and isn't available to individual accounts. The gateway records usage from each response itself, so an ordinary API key is enough.

**What the gateway can't see:** anything people do directly in the Claude or Gemini chat apps (claude.ai, gemini.google.com), or calls made with their own provider keys. Only requests sent through AxiomFlo are counted. The Providers tab will say so.

## 3. Design for option B (gateway)

### How people and tools call AI

- Each person, or app such as a CI bot, gets an **AxiomFlo key** from the web app, tied to their membership and team. They never get the company's provider credentials.
- Their code or tools point at the AxiomFlo gateway instead of the provider:
  - **Anthropic:** set the SDK's base URL to `https://<gateway>/anthropic` and use the AxiomFlo key as the API key. The request and response formats are exactly Anthropic's Messages API, including streaming.
  - **Gemini on Vertex:** call `https://<gateway>/vertex/.../models/{model}:generateContent` (and `:streamGenerateContent`) with the AxiomFlo key. The request and response formats are Vertex's own.
- The gateway checks the key, the membership (active, not suspended) and the team, then forwards the call:
  - to Anthropic with the company's Anthropic API key, held in Secret Manager;
  - to Vertex as the gateway's own service account, with no key file.
- From each response it reads the token counts and records **one usage record**: time, person or app, team and team code, provider, model, input and output tokens, success or failure, and latency. **Prompts and answers are never stored or logged.**

### Keys

- An AxiomFlo key is shown once when created, and only a hash of it is stored.
- Keys can be revoked from the web app. Suspending a member stops their keys on the next request.
- Admins see and manage every key. Individual users see and manage only their own.

### Storage and cost

- Usage records go to `companies/{id}/usage/{requestId}` in Firestore, matching the demo's `UsageRecord` shape, so Usage Explorer, the request drawer and per-person views work as they do in the demo.
- Daily totals are kept alongside the records for fast dashboards.
- **Cost** is estimated from tokens and a dated price table that admins can see (`estimated`), and shown in AUD at a monthly rate set by the admin. Monthly reconciliation against provider bills (`reconciled`) comes later.
- If a provider doesn't report tokens, cost is `unavailable` and is never counted as zero.

### Running it

- The gateway is a **separate Cloud Run service** (`axiomflo-gateway`), so AI traffic can't slow the web app's API. It uses the same Firestore and membership checks.
- Per-key rate limits apply. Later, team budgets can block calls once a limit is reached.

### Reporting and the assistant

- New read-only routes such as `/api/reports/overview`, `/api/reports/usage`, `/api/reports/showback` and `/api/keys` use the same sign-in, membership and team scoping as today.
- The real workspace's pages switch to these routes. The demo is unchanged.
- The Python assistant reads the same routes through the trusted-context contract.

## 4. Milestones

| # | What's built | What you configure |
| --- | --- | --- |
| R1 ✓ | AxiomFlo keys: create, list, revoke, hashed storage, membership checks; key screen in the web app | Nothing |
| R2 ✓ | Anthropic route on the gateway, streaming included; usage records; price table; tested against a fake Anthropic server ([gateway.md](gateway.md)) | Nothing |
| R3 | Reports: Overview, Usage Explorer, request detail, Teams (per person) and Showback on real data | Nothing |
| R4 | Gemini on Vertex route | Nothing |
| R5 | Deploy the gateway; store the Anthropic key in Secret Manager; give the gateway Vertex access; docs for your teams on pointing tools at AxiomFlo | With your approval: Secret Manager, gateway service, Vertex AI User role. An Anthropic API key from the Claude Console |

## 5. Costs (estimates, to confirm against your bill)

- **The gateway** is one more Cloud Run service that scales to zero.
- **Firestore** does one write per AI request and stays within the free daily allowance (about 20,000 writes a day) at pilot volumes.
- **Secret Manager** has a small free allowance.
- **The AI calls themselves** cost the same as today, because the gateway just forwards them.

## 6. Open questions

1. **How do people use Claude today:** in their own code or tools with an API key, or in the claude.ai chat app? Only API use can go through the gateway.
2. **Do you have a Claude Console account with an API key?** A personal Console account works for the gateway. The claude.ai chat subscription doesn't include API access.
3. **Gemini:** is it called from code on Vertex AI in one of your Google Cloud projects, and which one?
