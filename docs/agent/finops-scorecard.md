# FinOps Scorecard

**Where:** the **FinOps Scorecard** page in the sidebar (`/scorecard`), in both the demo workspace (Acme sample data) and the live workspace, and in the AI Cost Assistant ("How can we cut our AI costs?", "What does each workflow cost in tokens?").

**Code:** `src/lib/finops.ts` works out every figure. The page (`src/components/finops/ScorecardView.tsx`) only displays it. The live assistant uses the Python port, `backend/axiomflo/reporting/finops.py`, through the `get_finops_scorecard` tool. `backend/tests/test_finops_parity.py` fails if the two ever disagree on the demo workspace or the sample snapshot (`backend/fixtures/finops-golden.json`, written by `npm run agent:fixtures`).

Everyone sees the scorecard for what they're allowed to see: a Company Admin scores the whole company, an Individual User only their own requests.

## What's on it

### Unit economics

| Figure | How it's worked out |
| --- | --- |
| Estimated spend | Sum of every request with a known cost |
| Cost per request | Spend ÷ requests with a known cost |
| Cost per successful request | Spend (failures included) ÷ successful requests: what each useful answer really cost |
| Cost per million tokens | Spend ÷ (input + output tokens) × 1,000,000 |
| Cost per active person | Spend ÷ people who sent at least one request |
| Spend on failed requests | Cost of requests that failed after using tokens, and its share of spend |

Each is compared with the month before when there's data for it. Requests without a cost are counted separately and never treated as $0.

### Token cost per workflow

Each application (for example the demo's **CI code-review bot** and **Support ticket summariser**) is its own *automated* workflow. People's own use is grouped per team as *interactive* use. In the live workspace every request comes from a person's AxiomFlo key, so workflows are each team's interactive use.

Input and output cost come from the price list when the workspace has one (the demo). Live records only carry a total, so it's split assuming output tokens cost five times input tokens, the ratio on every current Claude model. The page says which.

### Five optimisation levers, by savings potential

Thresholds and assumptions are in `FINOPS_RULES` (TypeScript) and at the top of `finops.py`. Change both together.

| Lever | Requests in scope | Estimated saving |
| --- | --- | --- |
| Model right-sizing | Successful requests on a higher-tier model (Opus, Fable, Sonnet, Gemini Pro) that returned under 600 output tokens | Re-priced on the next tier down that's already in use in the same provider, or at 50% of the price if none is |
| Prompt caching | Successful requests with 4,000+ input tokens and no cache reads | 50% of the prompt repeats; cached reads cost 10% of input price → 45% of the input cost |
| Batch processing | Requests from automated workflows | 50% batch discount |
| Context trimming | Successful requests with 50,000+ input tokens | 40% of input cost |
| Output limits | Requests with 2,000+ output tokens | 30% of output cost |

Each lever is estimated on its own, so they overlap. The combined figure allows for that: `spend × (1 − Π(1 − lever saving ÷ spend))`.

Like the savings suggestions, levers never claim a cheaper model gives the same quality. Right-sizing names the smaller model already in use only to price the estimate.

### Score (0–100) and grade

| Part | Points | Full marks when | Zero when |
| --- | --- | --- | --- |
| Savings headroom | 40 | No combined savings | Combined savings reach 75% of spend |
| Model fit | 20 | No short jobs on higher-tier models | They're 30% of spend |
| Failed-request waste | 20 | No spend on failed requests | It's 5% of spend |
| Cost visibility | 20 | Every request has a cost | 80% or fewer do |

Grades: A 85+, B 70+, C 55+, D 40+, otherwise E.
