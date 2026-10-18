# Auth contract: AxiomFlo API and other services

How the web app, the AxiomFlo API (`server/`) and the AxiomFlo Agent (`backend/`) share one sign-in and one membership source. Code in `server/src/auth/` and `server/src/membership/` implements the API side.

## Who decides what

| Question | Answered by | From |
| --- | --- | --- |
| Who is this person? | Firebase Authentication | A Firebase ID token for project `axiomflo-pilot`, verified with the Admin SDK |
| May they enter the workspace, with which role and teams? | **AxiomFlo API only** | `companies/{PILOT_COMPANY_ID}/memberships/{uid}` in Firestore, read on every request |
| What may the agent show them? | AxiomFlo Agent, using **only** the trusted context the API passes | Never from the model, the browser or the agent's own lookup |

## Browser → AxiomFlo API

- Header: `Authorization: Bearer <Firebase ID token>`. No cookies. Tokens never go in URLs.
- The API calls `verifyIdToken(token, checkRevoked = true)`. That checks the signature, expiry and project, rejects revoked sessions and disabled or deleted accounts, and then re-checks `aud` and `iss` against `FIREBASE_PROJECT_ID`.
- The caller is the token's `uid`. Any uid, email, role, company or team sent in the body, query or headers is ignored.
- Membership is looked up only when `email_verified` is true.
- Statuses: `401` the token is missing or not acceptable; `403` signed in but not allowed; `503` sign-in or membership couldn't be checked. A `503` never means access.

### `GET /api/me` response

```json
{
  "user": { "uid": "…", "email": "…", "emailVerified": true, "displayName": "…" },
  "access": "active",
  "company": { "id": "…", "name": "…", "reportingCurrency": "AUD", "reportingTimezone": "Australia/Sydney" },
  "membership": { "role": "company_admin", "teamIds": ["…"] },
  "teams": [{ "id": "…", "name": "…", "code": "…", "departmentId": "…", "status": "active" }]
}
```

When access isn't active the response has only `user`, `access` and `reason`:

| access | reason |
| --- | --- |
| `pending` | `email_unverified`, `no_membership`, `company_not_set_up` |
| `suspended` | `membership_suspended`, `company_suspended` |

`teams` lists what the caller may see: every team for a `company_admin`, and only assigned, active teams for an `individual_user`. `membership.teamIds` leaves out IDs that don't exist in the company.

## Invitations and member changes

| Call | Who | Notes |
| --- | --- | --- |
| `GET /api/members` | active `company_admin` | `{ "members": [{ uid, email, displayName, role, teamIds, status }] }` |
| `PATCH /api/members/:uid` | active `company_admin` | Body: any of `role`, `teamIds`, `status`. `403` for your own uid, `404` unknown member, `409` if it would leave no active admin |
| `GET /api/invitations` | active `company_admin` | `{ "invitations": [{ id, email, role, teamIds, status, delivery, expiresAt, createdAt }] }`; `delivery` is always `"Created — email not sent"` |
| `POST /api/invitations` | active `company_admin` | Body: `email`, `role`, `teamIds`, optional `expiresInDays`. `201`, or `409` if a pending invitation or membership already exists for the email |
| `POST /api/invitations/:id/revoke` | active `company_admin` | `409` if it isn't pending |
| `POST /api/invitations/accept` | any valid token | Body ignored. `200 { result: "accepted" \| "already_member", role, teamIds }`; `403` unverified email, suspended member, or the company isn't set up or active; `404` no unexpired invitation for the token's email |

A `company_admin` has `teamIds: []` and sees every team; an `individual_user` needs at least one team. Unknown body fields are refused with `400`.

The web app calls `accept` once, only when `/api/me` says `pending` with reason `no_membership`, then reloads `/api/me`. A `403`, `404`, `409` or `429` from accept simply leaves the person on Access pending; a `5xx` shows the retryable error page.

## AxiomFlo keys (for the gateway)

- Format: `axf_<24 hex>_<43 base64url>`. Only a SHA-256 hash of the secret part is stored, at `companies/{id}/apiKeys/{keyId}`. The full key is returned once, by `POST /api/keys`, with `Cache-Control: no-store`.
- Each key belongs to one person and one team. Individual users can only choose their own teams.
- `resolveKey` re-checks everything on every use: the key is active, the secret matches (constant-time), the company is active, the owner is an active member, and the team is still theirs. Suspension or a team change stops the key on the next request.
- Individual users see and revoke only their own keys. Admins see all keys, with owner emails. At most 10 active keys per person. Creating and revoking keys are audited, and the secret never appears in audit events.

## Usage reports

- `GET /api/usage?month=YYYY-MM` returns the usage records for one calendar month in the company's reporting timezone. Scope is decided on the server from the verified member: a Company Admin gets every record in the company, and an individual user gets only records where they are the principal. Query parameters other than `month` are ignored.
- Each record carries tokens, model, team, status and the gateway's USD estimate. Records hold no prompts or answers. A cost is only returned when both token counts are present; otherwise `costStatus` is `unavailable` and the cost is `null`.
- Records that don't match the expected shape are left out and counted in `skipped`. More than 20,000 records sets `truncated`.
- Exchange rates live at `companies/{id}/exchangeRates/{YYYY-MM}`. Any member can read them. Only an active Company Admin can set one (checked in the route and again in the transaction), and every change is audited with the previous value.

## AxiomFlo API → AxiomFlo Agent (when the agent's reporting API is built)

1. **The agent's Cloud Run service is private.** Only the API's runtime service account has `Cloud Run Invoker` on it, and the API calls it with a Google-signed ID token for that service (service-to-service auth). The agent never accepts a browser's Firebase token.
2. The API sends the trusted context in the request body. It builds this context itself, after verifying the user and loading their membership in the same request:

   ```json
   { "context": { "companyId": "…", "uid": "…", "role": "individual_user", "teamIds": ["…"], "requestId": "…", "channel": "web" } }
   ```

   This maps one-to-one onto the agent's `TrustedContext` (`tenant_id` = `companyId`, `user_id` = `uid`).
3. The agent trusts that context **only because** Cloud Run IAM proves the caller is the API service account. It still applies its own role and team scoping to every tool call.
4. The agent never writes memberships and keeps no copy of them. If it ever needs to be called directly from a browser, it must verify the Firebase token the same way and read the same `companies/{companyId}/memberships/{uid}` document. It must never trust a company or role supplied by the browser.

## What stays out of logs

The following are never logged: tokens, Authorization headers, credential objects, Admin SDK error messages (only the error code is logged), request bodies, and query strings. Log lines carry the request ID, method, path, status, latency and, for refusals, a short reason code.
