# Real usage and cost data: plan

**Status:** proposal for review. Nothing is built, and no provider is connected.

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

**Recommendation:** build A first. It gives real numbers for Overview, Showback, Teams (per team) and Providers without changing how anyone works. Add B later only if you need per-person or per-request detail.

## 3. Design for option A

- **Storage (Firestore, tenant-scoped like memberships):**
  - `companies/{id}/providerConnections/{id}`: provider, status, last sync, and what maps to which team. No secrets are stored here.
  - `companies/{id}/usageDaily/{date_provider_model_team}`: date (Australia/Sydney), provider, model, team, input and output tokens, provider cost in USD, AUD cost, and cost status (`reconciled` when the provider reported the cost, `estimated` when calculated from tokens and a price table, `unavailable` when it can't be calculated). Totals never count unknown cost as zero, matching the demo rules.
  - `companies/{id}/syncRuns/{id}`: when each sync ran and what it fetched. Audited.
- **Unattributed usage:** usage that maps to no team, such as the default workspace or an unlabelled call, is shown to admins as **Unassigned**, never silently dropped or guessed.
- **Currency:** providers report USD and your reporting currency is AUD. **Default:** store the USD amount and convert at a monthly rate the admin enters, shown on every page. An automatic exchange-rate feed can come later.
- **Sync:** a private **Cloud Run job** run hourly by **Cloud Scheduler**. It re-fetches the last 3 days each time, so late or corrected provider data overwrites earlier figures. Running a sync twice gives the same result.
- **Secrets:**
  - The Anthropic Admin key lives in **Secret Manager**, readable only by the sync job's service account. Admins enter it once in the Providers tab, the API writes it to Secret Manager, and it is never shown again or sent back to any browser.
  - Vertex and BigQuery need no key: the job's own service account gets read access to the billing export dataset.
- **API:** new read-only routes such as `/api/reports/overview`, `/api/reports/showback` and `/api/reports/usage`, with the same checks as today: sign-in, active membership, and team scoping for individual users. The web app's existing pages switch from sample data to these routes in the real workspace only. The demo is unchanged.
- **Assistant:** the Python agent reads the same report routes through the trusted-context contract in [auth-contract.md](../backend/auth-contract.md).

## 4. Milestones

| # | What's built | What you configure |
| --- | --- | --- |
| R1 | This plan; data model and parsers; Anthropic sync tested against recorded sample responses | Nothing |
| R2 | Report routes; Overview, Teams and Showback use real data in the real workspace, showing "No data yet" until a sync runs | Nothing |
| R3 | Providers tab: connect Anthropic (key goes to Secret Manager), map workspaces or keys to teams; sync job | With your approval: Secret Manager, the job and Scheduler. Create the Admin key and team workspaces in the Claude Console |
| R4 | Gemini on Vertex via the billing export; label or project mapping | With your approval: billing export to BigQuery, dataset access |
| R5 | Usage Explorer daily view; assistant on real data; docs and checks | Nothing new |

## 5. Costs (estimates, to confirm against your bill)

Cloud Scheduler includes a few free jobs a month, and Secret Manager has a small free allowance. An hourly Cloud Run job of a few seconds stays within free compute. The BigQuery billing export stores and queries small amounts of data, likely cents a month at pilot size. The provider APIs themselves don't charge for usage reports.

## 6. Questions for you

1. Which providers do your teams use today: Anthropic (Claude API), Gemini on Vertex AI, or others?
2. Is per-team detail enough for now, or do you need per-person and per-request detail (gateway, option B)?
3. For Anthropic: can you create an Admin API key, and is a workspace per team acceptable?
