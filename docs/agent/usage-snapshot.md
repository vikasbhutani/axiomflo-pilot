# Real data for the agent: the usage snapshot

**Status:** built and tested on both sides: the API builds the snapshot (`server/src/assistant/snapshot.ts`) and the agent reads it (`backend/axiomflo/reporting/snapshot.py`). Turning it on: [deploy.md](deploy.md).

## The idea

The agent never reads the database. When someone asks a question about real data, the AxiomFlo API:

1. verifies who they are and their membership (exactly as for every other page);
2. loads the usage records **that person may see** for the last few months, with the same code as the real Overview, Teams and Showback pages (admins: everyone's requests; individual users: only their own);
3. sends the question, the trusted context and this **snapshot** to the agent.

The agent answers from the snapshot only, then forgets it. So:

- the agent needs no database access at all, and a mistake in the agent can't widen what anyone sees;
- every figure matches the real pages, because both start from the same records and the same money rules;
- Slack and later Microsoft Teams get the same behaviour, because the API builds the snapshot for them too.

The agent still re-applies the visibility rules to whatever it is sent, as a second line of defence, and refuses a snapshot made for a different person or company.

## Shape (version 1)

```jsonc
{
  "snapshotVersion": 1,
  "generatedAt": "2026-10-19T03:30:00.000Z",
  "company": { "id": "pilot", "name": "…", "reportingCurrency": "AUD", "reportingTimezone": "Australia/Sydney" },
  // The verified person asking. Must match the trusted context sent alongside.
  "viewer": { "uid": "…", "role": "company_admin", "teamIds": ["…"], "status": "active", "name": "…", "email": "…" },
  // GET /api/teams for this person: admins every team, individual users their own.
  "teams": [{ "id": "…", "name": "…", "code": "ENG-PLATFORM" }],
  "currentMonth": "2026-10",
  // One GET /api/usage?month=… response per month, oldest first, at most 6 months.
  "usage": [{ "month": "2026-08", "startIso": "…", "endIso": "…", "records": [/* UsageView */], "people": { "uid": { "name": "…", "email": "…" } }, "truncated": false, "skipped": 0 }],
  // GET /api/exchange-rates
  "exchangeRates": [{ "month": "2026-09", "rate": 1.51, "currency": "AUD" }]
}
```

`UsageView` is the record shape the API already returns to the web app (`server/src/reports/service.ts`). Prompts and answers are never in it.

A full example is in [`backend/fixtures/sample-snapshot.json`](../../backend/fixtures/sample-snapshot.json). Its records are invented, but shaped so every savings suggestion has something to find.

## Money rules (same as `src/reports/realData.ts`)

- Each record carries the gateway's USD estimate.
- It is converted at the month's exchange rate; a month without its own rate uses the latest earlier month's rate (or, before the first rate, the earliest one). The answer says which rate it used.
- With no rate in the company's currency at all, amounts stay in USD and the answer says so.
- A record without a cost is "unresolved": left out of totals and counted separately, never treated as zero.

`npm run agent:fixtures` writes the sample snapshot and the totals the web app calculates for it (`sample-snapshot-golden.json`). `backend/tests/test_snapshot.py` fails if the agent's totals or model names differ from the web app's.

## Savings suggestions

`get_savings_suggestions` runs fixed rules over the same records. The thresholds are in `backend/axiomflo/reporting/suggestions.py` (`SuggestionRules`):

| Suggestion | Fires when |
| --- | --- |
| Costly model used for small jobs | At least 10 successful requests to a top-tier model (Opus, Fable, Mythos, Gemini Pro) in a team returned under 300 output tokens, they're at least a quarter of that model's requests, and they cost at least 1.00 |
| Spend jumped | A team's spend (or an individual user's own) is at least 1.5 times the month before and up by at least 1.00. Names the models and, for admins, the people behind most of the increase |
| Long Claude prompts without caching | At least 10 successful Claude requests sent 4,000+ input tokens with no cache reads or writes, costing at least 1.00 |
| Failed requests still cost money | At least 5 failed requests used tokens worth at least 1.00 |
| Some requests have no cost yet | Any unresolved request in the month |
| Exchange rate not set | The month uses another month's rate, or none |

Amounts are in the reporting currency. Suggestions say where to look. They never name a replacement model, never claim a cheaper model gives the same quality, and never guess why spending changed.
