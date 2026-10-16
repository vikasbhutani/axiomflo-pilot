# AxiomFlo Agent (backend), Milestone 1

AxiomFlo Agent is a cost assistant built with Google's [Agent Development Kit (ADK)](https://google.github.io/adk-docs/) for Python. Gemini on Vertex AI reads the question, picks a read-only tool, and explains the figures the tool calculated. Gemini never calculates or invents an amount.

> **Milestone 1 runs on sample data only.** Every figure comes from the demo workspace the web app already uses (Acme Innovation, Aug and Sep 2026), and every answer is labelled as sample data. Nothing is deployed, no database is used, and nothing can be changed through the agent.

How it fits together: [docs/agent/architecture.md](../docs/agent/architecture.md).

## What's real and what's mocked

| Piece | Status in Milestone 1 |
| --- | --- |
| Cost calculations | **Real.** A Python port of the web app's `src/lib/calculations.ts`. A test proves every total matches the web app. |
| Usage data | **Mocked.** Fixtures exported from the web app's sample dataset (`backend/fixtures/`), labelled `MOCK DATA`. |
| Gateway controls, notification subscriptions | **Mocked**, read-only, always shown as "Draft, not enforced" (`fixtures/controls.json`). |
| Sign-in / identity | **Mocked.** Local runs use a demo persona. Firebase token checks arrive in Milestone 2. |
| Gemini on Vertex AI | **Real, but off by default.** Only called if you set the three variables in "Try one live question". Tests use a scripted stand-in. |
| Live AxiomFlo reporting API | **Not built.** `AXIOMFLO_DATA_SOURCE=axiomflo_api` answers "unavailable" and never falls back to sample data. |
| Slack, Microsoft 365, Scheduler, Secret Manager | Not started (Milestones 3 to 6). |

## Run it on your computer

You need Python 3.11 or newer. In a terminal, from the repository folder:

```bash
cd backend

# 1. Create a private Python environment for this project (first time only)
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 2. Install the agent and its test tools (first time only)
pip install -e ".[dev]"

# 3. Run the tests (offline, free)
pytest
```

Each time you open a new terminal, run `cd backend` and `source .venv/bin/activate` again before using the commands below.

### Try the tools without any AI model (free)

These call the same tools the agent uses, as one of the demo people:

```bash
python -m axiomflo.cli tools                                                     # list the tools
python -m axiomflo.cli tool get_cost_summary --persona maya --arg period=2026-09
python -m axiomflo.cli tool compare_cost_periods --persona maya --arg period=2026-09 --arg group_by=provider
python -m axiomflo.cli tool get_cost_summary --persona noah --arg period=2026-09 --arg team=Platform  # denied: not Noah's team
python -m axiomflo.cli tool list_unresolved_records --persona maya --arg period=2026-09
```

Personas: `maya` is a Company Admin. `liam` (Platform Engineering) and `noah` (Product Experience) are Individual Users who only see their own requests.

## Try one live question with Gemini (optional, small charge)

This sends one question and the tool results (sample data only) to Gemini on Vertex AI in **your** Google Cloud project. It costs a small amount per question, billed to that project. Nothing else is created or deployed.

**One-time setup, in your own Google Cloud account:**

1. Choose the Google Cloud project to bill, for example the one hosting AxiomFlo.
2. Turn on the Vertex AI API for it: in the console go to *APIs & Services → Library*, search "Vertex AI API", and click **Enable**. Or run `gcloud services enable aiplatform.googleapis.com --project YOUR_PROJECT_ID`.
3. Make sure your own Google account can call it. Project Owners already can. Otherwise ask an Owner to give you the *Vertex AI User* role.
4. Let local code use your sign-in (this stores a credential on your computer, never in the repo):
   ```bash
   gcloud auth application-default login
   ```
5. Pick a region and a model:
   - Open Google's [Deployments and endpoints](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations) page and pick a Gemini model listed for the region you want. I haven't hard-coded a model because the list changes and differs by region.
   - For data kept in Australia, choose `australia-southeast1` (Sydney) or `australia-southeast2` (Melbourne) **only if** your chosen model is listed there. Otherwise the nearest option is a region such as `asia-southeast1` (Singapore), which is where your web app already runs.
   - Don't use the `global` location for the pilot. Google says it can't tell you which region processed a request.

**Run it:**

```bash
export AXIOMFLO_AGENT_MODEL="<a model ID from Google's page>"
export GOOGLE_CLOUD_PROJECT="<your project ID>"
export GOOGLE_CLOUD_LOCATION="<region, e.g. australia-southeast1>"

python -m axiomflo.cli ask --persona maya "What did each team spend this month?"
python -m axiomflo.cli ask --persona maya "Which provider contributed most to the increase?"
python -m axiomflo.cli ask --persona noah "How much did I spend on Gemini?"
```

After each answer the CLI prints the status, the tools used and the assistant's own token usage. If an answer contains an amount that no tool returned, it is withheld and you'll see `status: withheld`.

Prefer a chat window? Google's ADK developer UI works too (it runs only on your computer):

```bash
export AXIOMFLO_DEV_PERSONA=maya     # or liam / noah
adk web adk_apps                     # then open http://localhost:8000
```

If something is wrong, you get a clear message instead of an answer. For example: "model not configured", "could not reach its AI model", or a Google permission error in the terminal. That's usually step 2 or 3 above.

## Environment variables

None of these are secrets. Never put keys or tokens in this repo; later milestones keep those in Google Secret Manager.

| Variable | Default | Meaning |
| --- | --- | --- |
| `AXIOMFLO_DATA_SOURCE` | `fixtures` | `fixtures` = labelled sample data. `axiomflo_api` = live reporting (Milestone 2; "unavailable" for now). |
| `AXIOMFLO_AGENT_MODEL` | none | Gemini model ID on Vertex AI. Without it the agent says it isn't configured. |
| `GOOGLE_CLOUD_PROJECT` | none | Project billed for Gemini calls. |
| `GOOGLE_CLOUD_LOCATION` | none | Vertex AI region for Gemini calls. |
| `AXIOMFLO_WEB_BASE_URL` | `http://localhost:5173` | Where links to supporting records point. |
| `AXIOMFLO_DEV_PERSONA` | `maya` | Persona for `adk web` only. |

## Tools (all read-only)

| Tool | What it returns |
| --- | --- |
| `list_reporting_periods` | Months with data, the current period, timezone, currency, data freshness |
| `get_cost_summary` | Total estimated spend for a period, optionally by team, provider or model |
| `compare_cost_periods` | Change between two months, by provider, team or model, with request counts and average cost per request |
| `get_usage_breakdown` | One month split by team, provider or model |
| `get_request_references` | The requests behind a total (max 50), with links, never prompt or response content |
| `list_unresolved_records` | Requests whose cost can't be calculated yet |
| `get_team_controls` | Gateway controls per team, always "Draft, not enforced" until a gateway exists |
| `list_notification_subscriptions` | Cost-update subscriptions (yours, or all for an admin); nothing is sent yet |

Every result includes the period and timezone, currency, scope, cost status, unresolved count, data freshness (`data_as_of`) and links to the records in the AxiomFlo web app.

## Security rules built in from the start

- **No tool accepts a tenant, company or user ID.** Who is asking comes from a server-built `TrustedContext`, looked up by the conversation's session. If the model makes up extra arguments such as `tenant_id`, they are dropped.
- **Company Admins** see their own company. **Individual Users** see only their own requests in their own team, the same rule as the web app. Asking about another team gets "access denied", not an empty answer.
- **Sessions are separated** by company, channel and user, and a session's authority ends when its turn ends.
- **Fixed queries only.** No SQL, shell, web access or cloud-admin tools, and result sizes are capped.
- **Figures are checked.** An answer containing an amount or percentage that no tool returned is withheld.
- **Honest failures.** A missing model or data source gives an explicit "unavailable" message, never sample data in disguise.
- **Audit without content.** Each tool call and turn is logged with actor, tenant, channel, request ID, tool, scope, outcome, latency and the assistant's token usage. The question text and tool output are not logged.

## Acceptance tests for Milestone 1

`pytest` runs 45 tests. The important ones:

| Requirement | Test |
| --- | --- |
| Cost answers match the web app's calculations | `test_calculation_parity.py::test_every_total_matches_the_web_app` |
| Missing costs aren't treated as zero | `test_missing_costs_are_never_counted_as_zero`, `test_unresolved_records_are_listed` |
| Cross-tenant access is denied | `test_cross_tenant_access_is_denied` |
| Forged tenant IDs are ignored | `test_forged_tenant_argument_from_the_model_is_dropped`, `test_forged_tenant_and_user_arguments_are_ignored` |
| Individual Users only see their own data | `test_individual_user_sees_only_their_own_requests`, `test_individual_user_cannot_query_another_team` |
| Prompt injection can't reach other data or write tools | `test_prompt_injection_cannot_reach_other_teams_tenants_or_write_tools` |
| Unlinked users get no data | `test_unlinked_conversation_gets_no_data` |
| Missing live services say "unavailable" | `test_missing_model_gives_explicit_unavailable_response`, `test_model_failure_never_falls_back_to_fake_results`, `test_live_reporting_not_connected_is_unavailable_through_the_agent` |
| Gemini can't invent figures | `test_invented_figures_are_withheld`, `test_answer_with_figures_but_no_tool_call_is_withheld` |
| Controls never claim enforcement | `test_controls_are_drafts_and_never_claim_enforcement` |
| Assistant usage is its own workload | `test_assistant_usage_is_tracked_as_its_own_workload` |

Manual check, once you've done the live setup: ask the three questions above and confirm each answer starts with "[Sample data]", quotes the same totals as the web app's Overview page for September 2026, states the period, timezone, currency, scope, cost status and unresolved requests, and includes a `localhost:5173/usage` link.

## Updating the sample data

The fixtures are generated from the web app. If you change `src/data/mockData.ts` or `src/lib/calculations.ts`, run this from the repository root:

```bash
npm run agent:fixtures
```

The web app's own tests fail until you do, so the two sides can't silently drift apart.
