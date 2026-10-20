# Upgrade Analysis

**Where:** the **Upgrade Analysis** tab of the AI Cost Assistant (`/assistant/upgrade`), in the demo workspace (Acme sample data) and the live one. In the demo the assistant's chat also runs it as a guided conversation ("Can we upgrade to a newer model?"). In the live workspace Gemini points upgrade questions at the tab; it has no migration tool of its own yet.

It answers one question: *what would moving a model dependency to a newer, cheaper or faster version cost?* Every figure is a **modelled projection from observed usage and stated assumptions, never a guaranteed saving**, and nothing here changes routing, models or providers. A migration always needs a person's explicit approval outside AxiomFlo.

**Code:** one engine, shared by both workspaces so they calculate the same way.

| Part | Where |
| --- | --- |
| Types for every payload | `server/src/upgrade/types.ts` |
| Calculation, eligibility, risks, recommendation, rollout plan | `server/src/upgrade/engine.ts` (pure, no I/O) |
| Chat summary, Markdown and CSV reports | `server/src/upgrade/report.ts` |
| Live catalogue (gateway list prices) and usage mapping | `server/src/upgrade/realWorkspace.ts` |
| Saved analyses (Firestore, in-memory for tests) | `server/src/upgrade/firestoreStore.ts`, `server/src/upgrade/store.ts` |
| API | `server/src/routes/upgradeAnalysis.ts` |
| Demo catalogue, workflows, agents and default rules | `src/data/upgradeFixtures.ts` |
| Demo service (same shapes as the API) | `src/services/upgradeAnalysisService.ts` |
| Guided chat (demo) | `src/services/upgradeChat.ts` |
| View | `src/components/upgrade/UpgradeAnalysisView.tsx` |

The web app imports the engine through `src/lib/upgrade.ts`; the root `.dockerignore` lets `server/src/upgrade` (minus tests and server-only files) into the web image for that.

## Inputs

| Input | Rules |
| --- | --- |
| Current model | One model with observed usage in the last 92 days the viewer can see. Several models are analysed one at a time. |
| Candidate model | A model with a recorded upgrade path from the current one. A pair with no path is still analysed, but every call needs review. |
| Scope | Company, team, project, application, workflow, agent or environment. Only scopes the viewer can see are offered or accepted (403 otherwise). |
| Time window | Last 7 days, last 30 days, or a custom range of up to 92 days, not in the future. |
| Migration percentage | 0–100% of **eligible** calls. If it isn't given, the chat asks "Assuming 100% of eligible calls migrate. Continue?" before using 100%. |
| Assumptions (optional) | Input/output token change, cached share, reasoning tokens, request-volume change, candidate retry rate, latency change, one-off migration cost, quality threshold and evaluation score, business-critical. |
| Eligibility rules | Passed with each analysis (the workspace's defaults are pre-filled). Not stored as a workspace setting yet. |

## How the projection is worked out

For the calls in scope and window:

```
projected cost = Σ eligible calls × migration% × expected tokens × candidate price
               + eligible calls that don't migrate, at their current cost
               + ineligible and requires-review calls, at their current cost
```

- **Current cost** is the observed estimated cost of those calls (not invoiced). Calls with no cost are listed, never counted as $0, and the analysis says how many were left out.
- **Expected tokens** start from each call's own input, cached-input, output and reasoning tokens, adjusted by the candidate's published expectations or your overrides.
- **Request volume** is scaled by the volume change and by retries: `requests × (1 + volume change) ÷ (1 − candidate error rate)`.
- **Savings** = current − projected, also as a percentage, per month (`× 30.44 ÷ days in window`) and annualised (`monthly × 12`, labelled an extrapolation). A one-off migration cost is shown separately and never netted off.
- **What changed** splits the difference exactly into unit price, input, cached input, output, reasoning, request volume and retries, so the parts add up to the total.
- **Cost per successful request** is shown for today and the projection.
- If either model has no price, there is no cost projection: *"I can compare usage volume, but I cannot calculate a reliable cost saving because pricing for one or both models is unavailable."*

## Eligibility

Each call is **eligible**, **ineligible** or **requires review**, checked in this order:

1. The candidate isn't available in the call's region → ineligible.
2. The candidate isn't approved for the call's environment (for example a preview model in production) → ineligible.
3. The pair is marked not compatible → ineligible.
4. The call needs a feature the candidate lacks (vision, long context, tool use…) → ineligible.
5. An **exclude** rule matches → ineligible. Exclusions always win, most specific first.
6. An **eligible** rule matches → eligible.
7. Otherwise → requires review. These calls are never counted as savings.

Rules can target the company, a team, project, application, workflow, agent, environment, model or provider.

## Recommendation

| Class | When |
| --- | --- |
| Insufficient data | No usage in scope, pricing missing, no measured cost, or nothing eligible while calls still need review |
| Not recommended | Nothing eligible, costs increase, the saving is immaterial (under 5% **or** under $5 a month), or a high risk blocks it |
| Conditional | 25%+ of calls need review, the saving only holds under your assumptions, or the candidate's price has an expiry |
| Recommended with validation | Material saving, but at least one risk needs validating |
| Strongly recommended | Material saving, under 10% needing review, every risk low, a drop-in upgrade and not business-critical |

The risk section always covers quality, latency, reliability, tokens, compatibility, financial and governance. Without an evaluation score, quality says: *"Quality impact cannot be assessed from available data. Run an evaluation before production migration."* The two recommended classes come with a seven-step staged rollout plan (pilot scope, side-by-side evaluation, thresholds, 10–20% first, monitor 7–14 days, expand, keep a rollback). It's a proposal only.

## API

All routes need a signed-in, active member and are scoped to their company. View-only logins can list models, estimate and export, but not save.

| Route | Does |
| --- | --- |
| `GET /api/upgrade-analysis/models` | Current models with observed usage, candidates, scopes the viewer can use, default rules |
| `POST /api/upgrade-analysis/estimate` | Runs an analysis. Rejects unknown fields, invalid percentages or dates, unknown models and scopes the viewer can't see. |
| `POST /api/upgrade-analysis/save` | Re-runs the estimate on the server and saves it as a draft. Needs an `Idempotency-Key` header: a retry returns the same analysis (200); the same key with different inputs is a 409. |
| `GET /api/upgrade-analysis/:id` | A saved analysis. Admins see every one in their company, others only their own. |
| `POST /api/upgrade-analysis/:id/export` | Markdown (default) or CSV report, recorded in the analysis's audit history once per idempotency key |

A saved analysis keeps its inputs, the pricing version and source for both models, the scope, when it was calculated, who saved it and their role and teams at the time, and an append-only audit trail. It's never recalculated: a later price change doesn't rewrite it. Estimates are stored apart from usage and reports and never change historical totals. Saves and exports are also written to the company's audit events. No provider keys or credentials appear anywhere in an analysis.

## Demo data

The demo catalogue in `src/data/upgradeFixtures.ts` adds illustrative candidates (Gemini Flash 2, Claude Haiku 2, Claude Sonnet 2, a Gemini Pro 2 preview limited to one region and to development and staging, and a Flash-Lite preview with no pricing) and gives the sample records projects, workflows, agents, environments and regions. With the default rules, Sonnet → Sonnet 2 for the whole company over the last 30 days is *recommended with validation* at about $45 a month; Flash → Flash 2 is *not recommended* (immaterial); Pro → Pro 2 preview finds nothing eligible (region); Flash-Lite shows *insufficient data* (no pricing).

## Tests

- `server/src/upgrade/engine.test.ts`: savings and percentage, migration percentage, eligibility order, missing pricing, token categories, every recommendation class, invalid input.
- `server/src/routes/upgradeAnalysis.test.ts`: the five routes, tenancy and team scoping, view-only access, idempotent save and export, audit.
- `src/services/upgradeChat.test.ts`: the one-question-at-a-time chat, the 100% confirmation, the demo service and links.
- `src/pages/upgrade.test.tsx`: the page on Acme data, and a view-only login that can download but not save.
