# AxiomFlo pilot UI

A frontend-only prototype of **AxiomFlo**, an enterprise AI cost management platform, set up as a demo workspace for one pilot company (Acme Innovation). It shows which team is using AI, which provider and model they use, what that usage is estimated to cost, and how monthly totals map back to individual requests.

> **Everything here is sample data.** There is no backend, no live sign-in, no billing and no calls to any AI provider. Model names and prices are illustrative and are **not** current provider pricing.

## Run it locally

You need [Node.js](https://nodejs.org/) 20 or newer (the LTS installer is fine). Then, in a terminal:

```bash
# 1. Go into the project folder
cd axiomflo-pilot

# 2. Install dependencies (first time only, takes a minute)
npm install

# 3. Start the development server
npm run dev
```

Open the address it prints (usually http://localhost:5173). The page reloads automatically when you edit files. Press `Ctrl + C` in the terminal to stop it.

Other useful commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the automated tests once |
| `npm run typecheck` | Checks TypeScript types without building |
| `npm run build` | Makes a production build in `dist/` |
| `npm run preview` | Serves that production build locally |

## Switching demo roles

Use the **View as** selector in the top bar:

- **Company Admin** (Maya Chen) sees both teams and company-wide totals.
- **Individual User** (Noah Williams, Product Experience) sees only their own requests.

The choice is remembered in your browser. Role filtering happens in the mock service layer (`src/services/mockService.ts`), not just in the UI, so every page gets the same scoped data. **This is a demonstration only:** in production, authorization must be enforced by the backend on every request, because anything in the browser can be changed by the user.

## What's simulated

- **Data:** one company, one department, two teams (`ENG-PLATFORM`, `ENG-PRODUCT`), six people, two applications and about 6,000 requests across August and September 2026, generated with a fixed seed so the numbers are identical everywhere.
- **Reporting date:** fixed at 30 September 2026, so the app never goes empty as real time passes. Currency is AUD and dates use Australia/Sydney.
- **Provider connections:** shown as “Connected — demo”. Nothing is actually connected.
- **Reconciliation:** “Reconciled (sample)” and “Estimated” states are sample data. No provider billing records are compared.
- **Costs:** `(input tokens × input rate per million + output tokens × output rate per million) ÷ 1,000,000`, using illustrative rates. Requests with missing usage show “Not available” and are counted separately as unresolved, never as $0. Failed requests are costed from whatever usage was measured.

## Project structure

```
src/
  types/        Shared TypeScript types
  data/         The mock dataset (sample data only)
  lib/          Calculations, formatting, permissions, storage helpers
  services/     Mock service functions (replace these with real API calls later)
  context/      Demo role / period state and notifications
  components/   Shared UI and the application shell
  pages/        One component per screen
```

All totals (cards, charts, tables, and later the showback CSV and assistant) come from one module, `src/lib/calculations.ts`, so they always agree.

## Where a backend will connect later

The functions in `src/services/mockService.ts` (`getOverview`, `getUsage`, `getTeams`, `getProviderConnections`, and later `getMonthlyShowback` and `getAssistantResponse`) are the seam. Each one returns a Promise, so replacing its body with an HTTP call to a future API should not require page changes. When that happens, role checks, cost calculation and credential handling belong on the server.

## Build progress

- [x] **Milestone 1:** app shell, typed mock dataset, shared calculations, Overview page, tests
- [ ] Milestone 2: Usage Explorer and request detail drawer
- [ ] Milestone 3: Teams & Users, AI Providers, Settings (with demo reset)
- [ ] Milestone 4: Monthly Showback and CSV export
- [ ] Milestone 5: AI Cost Assistant
- [ ] Milestone 6: responsive and accessibility polish, remaining tests

Screens not built yet show a short “planned for milestone N” page so navigation never dead-ends.
