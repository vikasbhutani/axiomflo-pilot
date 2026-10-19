# The demo workspace (sample data)

## Switching demo roles

Open the demo with **Explore the demo workspace** on the sign-in page, then use the **View as** selector in the top bar:

- **Company Admin** (Maya Chen) sees both teams and company-wide totals.
- **Individual User** (Noah Williams, Product Experience) sees only their own requests.

The choice is remembered in your browser. Role filtering happens in the mock service layer (`src/services/mockService.ts`), not just in the UI, so every page gets the same scoped data. **This is a demonstration only:** in production, authorization must be enforced by the backend on every request, because anything in the browser can be changed by the user. The switcher only exists in the demo workspace: it never changes a real signed-in person's role or access.

## Resetting the sample data

Admin changes in the demo (team names, invitations, team moves, suspensions, provider settings, simulated connection tests, the company name) are saved in your browser so they survive a refresh. To start over, go to **Settings → Reset demo data**. That restores the original workspace and clears saved preferences. Usage records are generated sample data and never change.

## What's simulated

- **Data:** one company, one department, two teams (`ENG-PLATFORM`, `ENG-PRODUCT`), six people, two applications and about 6,000 requests across August and September 2026, generated with a fixed seed so the numbers are identical everywhere.
- **Reporting date:** fixed at 30 September 2026, so the app never goes empty as real time passes. Currency is AUD and dates use Australia/Sydney.
- **Provider connections:** shown as “Connected — demo”. Nothing is actually connected. “Simulate connection test” lets you pick a success or failure outcome; no provider is contacted. The Anthropic API-key field is a disabled, masked sample, and no credential is ever entered or stored.
- **Admin actions:** invitations send no email, suspensions revoke nothing, and every change is recorded in a simulated audit log under Settings.
- **Reconciliation:** “Reconciled (sample)” and “Estimated” states are sample data. No provider billing records are compared.
- **Showback:** explains allocated costs. It is not an invoice, takes no payment and posts nothing to finance systems. The CSV is built in your browser from the same role-scoped records.
- **AI Cost Assistant:** answers come from fixed rules over the sample data, not a live AI model. It supports the suggested questions (plus unavailable-cost questions), is read-only, only uses data the current role may see, and explains its scope instead of guessing.
- **Costs:** `(input tokens × input rate per million + output tokens × output rate per million) ÷ 1,000,000`, using illustrative rates. Requests with missing usage show “Not available” and are counted separately as unresolved, never as $0. Failed requests are costed from whatever usage was measured.
