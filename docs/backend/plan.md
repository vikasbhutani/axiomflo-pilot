# AxiomFlo API: membership and access plan

This is the plan for connecting the AxiomFlo web app to a real backend that decides who may enter the workspace. It covers what exists today, the smallest safe change, and the five milestones. It does **not** cover live AI usage metering or real reporting data.

## 1. What exists today

| Area | What's there | Where |
| --- | --- | --- |
| Framework | React 18 + TypeScript + Vite, React Router 6, Tailwind, Vitest | `package.json`, `vite.config.ts` |
| Hosting | Static site in an nginx container on Cloud Run (`asia-southeast1`). No server code runs in it. | `Dockerfile`, `deploy/nginx.conf.template` |
| Firebase project | `axiomflo-pilot`. Public web config is built into the app. | `.env.production`, `.firebaserc` |
| Sign-in | Google popup and email/password via the Firebase modular SDK. Email accounts must verify before any membership check. Tokens are never stored or logged by the app. | `src/auth/firebaseClient.ts` |
| Auth state | `AuthProvider` tracks sign-in plus membership as one state machine: `initializing`, `signed_out`, `verification_required`, `membership_loading`, `approved`, `pending`, `denied`, `error`. | `src/auth/AuthContext.tsx`, `src/auth/types.ts` |
| Protected routes | `RequireWorkspace` only opens the workspace for `approved` (real) or an explicitly chosen demo session. `AuthStatusRoute` sends people to Access pending, Access denied or a retryable error page. | `src/auth/guards.tsx`, `src/pages/auth/AccessPages.tsx` |
| Membership lookup | **The browser reads Firestore directly** at the top-level `memberships/{uid}` document. `firestore.rules` lets a verified user read only their own document and blocks all browser writes. If `VITE_API_BASE_URL` is set, the app instead calls `GET /v1/me/membership` on a backend (not built yet). | `src/auth/membershipService.ts`, `src/auth/setup.ts`, `firestore.rules` |
| API helper | `createApiClient` adds `Authorization: Bearer <Firebase ID token>`, requires HTTPS (http only for localhost), never puts tokens in URLs. | `src/auth/api.ts` |
| Demo mode | "Explore the demo workspace" is a separate, per-tab mode with sample data and a role switcher (role saved in localStorage). It never grants real access. Real members see a "reporting not connected yet" notice instead of sample data. | `src/auth/demoSession.ts`, `src/context/DemoContext.tsx`, `src/components/auth/RealWorkspaceNotice.tsx` |
| Reporting data | All sample data, behind `src/services/mockService.ts` and `assistantService.ts`. | `src/services/` |
| Python agent | `backend/` holds the ADK cost assistant (merged in PR #10), local only, sample data, mocked identity. Its next milestone is an authenticated reporting API. | `backend/`, `docs/agent/architecture.md` |
| Server/API | **None.** No Node backend, no Admin SDK, no service account set up for an API. | |

The frontend is already shaped for a backend: the state machine, the pages and the token-attaching API helper all exist. What's missing is the server that verifies tokens and owns the membership data.

## 2. Proposed approach (smallest safe change)

1. **Add one new Cloud Run service, `axiomflo-api`**, in a new `server/` folder: Node 22 + TypeScript + Express + Firebase Admin SDK. It stays separate from `backend/` (Python) so the two never collide.
2. **Keep Firebase Authentication as the only sign-in provider** and the existing Firestore database as the only database. Nothing is replaced.
3. **Move membership data to a tenant-scoped layout** (`companies/{companyId}/...`, section 4) that only the API can read or write.
4. **Switch the frontend** from reading Firestore directly to calling `GET /api/me`. The existing `createHttpMembershipService` seam makes this a small change; the pages and guards stay.
5. **Close Firestore to browsers entirely** (`allow read, write: if false` everywhere) once the frontend uses the API.

Why not keep the browser reading Firestore? Rules can protect a single document, but invitations, admin changes, the last-admin rule and audit events need server-side transactions and checks. One server that owns all access decisions is simpler to reason about than rules plus a server.

## 3. How a request is authenticated and authorized

1. The browser gets a Firebase ID token from the SDK (`getIdToken()`) and sends `Authorization: Bearer <token>`.
2. The API verifies it with the Admin SDK `verifyIdToken(token, true)`:
   - signature, expiry, and that it was issued **for project `axiomflo-pilot`** (`aud`/`iss`); the project is pinned by `FIREBASE_PROJECT_ID`, so a token from any other Firebase project is rejected;
   - `checkRevoked = true` also rejects tokens revoked after a password change or "revoke sessions", and accounts **disabled** in Firebase Authentication.
3. The **verified UID** is the caller. Any `uid`, `email`, `role`, `companyId` or `teamIds` in the body, query or headers is ignored for identity.
4. Activation (accepting an invitation) requires `email_verified = true` in the verified token. Protected routes also require it.
5. The API loads `companies/{PILOT_COMPANY_ID}` and `companies/{PILOT_COMPANY_ID}/memberships/{uid}` **on every protected request**, so a suspension takes effect on the very next request.
6. Responses: **401** missing/invalid/expired/revoked token, **403** signed in but not allowed (no membership, suspended, wrong role, unverified email), **503** Firestore unavailable. A database error is never treated as "no membership" and never grants access.

Tokens, the Authorization header and credential objects are never logged (the logger also redacts any key that looks sensitive, as a backstop).

## 4. Database model (Firestore, tenant-scoped)

```
companies/{companyId}                         name, status (active|suspended), reportingCurrency,
                                              reportingTimezone, createdAt, updatedAt
companies/{companyId}/departments/{deptId}    name, createdAt
companies/{companyId}/teams/{teamId}          departmentId, name, code, status, createdAt
companies/{companyId}/memberships/{uid}       uid, role (company_admin|individual_user), teamIds,
                                              status (active|suspended), createdAt, updatedAt
companies/{companyId}/invitations/{id}        normalizedEmail, role, teamIds, status (pending|accepted|revoked),
                                              deliveryStatus ("not_sent"), expiresAt, invitedBy,
                                              acceptedByUid, createdAt, acceptedAt
companies/{companyId}/auditEvents/{id}        actorUid, action, targetType, targetId, timestamp, metadata
```

Pilot rules:

- The approved company ID is **configured on the server** (`PILOT_COMPANY_ID`). The browser never sends a company ID that the server trusts.
- Only `company_admin` and `individual_user` exist. Every `teamId` written is checked to exist under that company.
- Nobody can change their own role, teams or status through the API (admins included), and the last active admin can't be demoted or suspended.
- Timestamps use Firestore server time. Audit `metadata` holds only safe fields (for example the role changed from/to), never tokens or invitation emails in full.
- "Access pending" is not stored: it simply means "no membership document exists for this UID".

### Migrating from today's `memberships/{uid}`

Your hand-made document at the top-level `memberships/{uid}` keeps working until Milestone 3. Then:

1. The bootstrap script creates the company, department, teams and **your admin membership under `companies/{companyId}/memberships/{uid}`**. It reads the old top-level document only to tell you it exists; it never copies roles from it automatically.
2. The frontend switches to `/api/me`, and `firestore.rules` closes all browser access, **in the same release**, so there is no gap where you're locked out or where both paths are live.
3. After you've confirmed you can sign in through the API, you delete the old `memberships` collection in the Firebase console. Nothing reads it any more.

## 5. API endpoints

| Endpoint | Who | What it does |
| --- | --- | --- |
| `GET /health` | anyone | `{ "status": "ok" }`. No config or versions. |
| `GET /api/me` | any valid token | Identity (uid, email, emailVerified, name) and `access: active / pending / suspended`. Company, role and teams only when active. Unknown users get `pending`; a database error is a 503. |
| `GET /api/company` | active members | Company name, currency, timezone. |
| `GET /api/teams` | active members | Admin: all teams. Individual user: assigned teams only. |
| `GET /api/members` | admin | Memberships with email and name from Firebase Auth. |
| `GET /api/invitations` | admin | Invitations, newest first, with status pending / accepted / revoked / expired. |
| `POST /api/invitations` | admin | Validates email, role, teamIds, expiry (default 14 days, max 30). Refuses a second pending invitation for the same email. Status shows **"Created — email not sent"**; there's no email delivery. Audited. |
| `POST /api/invitations/accept` | valid token, verified email | Finds an unexpired pending invitation for the **token's** email. Role and teams come only from the invitation. One transaction creates the membership and marks the invitation accepted. A retry after success returns the existing membership. A suspended member can't use an invitation to get back in. |
| `POST /api/invitations/:id/revoke` | admin | Revokes a pending invitation, which frees the email for a new one. Audited. |
| `PATCH /api/members/:uid` | admin | Validated role, teams or status change. Transaction keeps at least one active admin. Audited. |

Defence in depth on every route: JSON body limit (16 KB), strict validation that rejects unknown fields, request IDs in responses and logs, rate limits on invitation and member-change endpoints, and exact-origin CORS (no wildcards, no cookies).

Note: the rate limiter is per Cloud Run instance (in memory). That's adequate for a pilot with `--max-instances` kept low; a shared limiter would only be needed at scale.

## 6. Bootstrapping the first admin (no public endpoint)

There is **no** endpoint that creates the company or the first admin. Instead, `server/scripts/bootstrap.ts` is run by you, by hand, with your own Google credentials:

1. Sign in to AxiomFlo once with Google. You'll land on Access pending, which shows your user ID.
2. Confirm it in the Firebase console: **Authentication → Users**, the **User UID** column.
3. Run the script with the company name, department, two team names and codes, and your UID. It checks the UID exists and the email is verified, prints the email and the full planned configuration, and waits for you to type `yes`.
4. It writes everything in one transaction plus an audit event. Running it again with the same values changes nothing; different values for existing records are refused, never overwritten.
5. Refresh AxiomFlo and you're in as Company Admin.

**Where to run it without installing anything:** Google **Cloud Shell** (the **>_** button at the top of the Cloud Console). It already has Node and is signed in as you, so no key file is ever downloaded. Running it on your own computer instead needs the gcloud CLI for `gcloud auth application-default login`; that's the one place a terminal is unavoidable, and Cloud Shell is a terminal in your browser.

## 7. Frontend changes (Milestone 3)

- `membershipService` calls `GET /api/me` instead of Firestore. `active` member of an `active` company → workspace; `pending` → Access pending; `suspended` (member or company) → Access denied; network/5xx → the existing retryable error page.
- When `pending`, the app tries `POST /api/invitations/accept` **once**, then reloads `/api/me`. "No matching invitation" is a normal outcome, not a retry loop.
- The API client retries a 401 **once** after forcing a token refresh through the SDK (`getIdToken(true)`). 403s are never retried. Tokens are never stored by the app (Firebase keeps its own session).
- The workspace shows the signed-in identity, company, role and assigned teams.
- Sign-out clears membership, company, team, report and assistant state (the existing `key`-based reset already discards page state; Milestone 3 adds any cached API data).
- Demo mode stays as it is: separate, labelled sample data, and its role switcher has no effect on API calls (the API never reads it). Approved members keep seeing the honest "reporting not connected yet" state, not sample spend.

## 8. Cloud Run, IAM and the two kinds of "access"

**Two different gates:**

- **Cloud Run invocation access** decides who may send an HTTP request to the service at all (IAM role `Cloud Run Invoker`). Browsers can't attach Google IAM credentials, so a browser-called API has to allow public invocation (`allUsers`).
- **AxiomFlo application access** is what the API itself enforces: a valid Firebase token **and** an active membership on every protected route. This is the real security boundary for the web app.

**Recommended layout (same origin):** keep the existing `axiomflo-pilot` web service, and have its nginx forward `/api/*` to `axiomflo-api`. The browser then talks to one address, so there's no CORS at all and no second hostname to authorize. `ALLOWED_ORIGINS` stays empty. The alternative is calling the API's own `*.run.app` address with `ALLOWED_ORIGINS` set to the web app's exact address; the server supports both.

Either way `axiomflo-api` must be publicly invokable. **I won't change that setting; you'll do it, or approve it, at deploy time (Milestone 5).**

**Runtime service account** (a new one, `axiomflo-api@axiomflo-pilot.iam.gserviceaccount.com`, used only by this service), with only:

- `Cloud Datastore User` (`roles/datastore.user`): read/write Firestore documents.
- `Firebase Authentication Viewer` (`roles/firebaseauth.viewer`): look up users (needed for revocation/disabled checks and showing member emails).

Not Owner, not Editor, and no key file: Cloud Run supplies credentials automatically (Application Default Credentials). Because the Admin SDK **bypasses Firestore rules**, these IAM roles and the API's own checks are what protect the data, which is why the account is dedicated and narrow.

**APIs to have enabled** (most already are for this project): Cloud Run, Cloud Build, Artifact Registry, Cloud Firestore, Identity Toolkit (Firebase Auth).

## 9. Sharing auth with the Python agent (`backend/`)

Both services trust the same Firebase project, but **only `axiomflo-api` decides membership**. Proposed contract for the agent's reporting milestone:

- The agent service is **private** (no public invocation). Only `axiomflo-api`'s service account gets `Cloud Run Invoker` on it, and it calls the agent with a Google-signed service identity token.
- `axiomflo-api` verifies the user, loads the membership, and passes the trusted context (`companyId`, `uid`, `role`, `teamIds`, `requestId`) in the request. The agent's existing `TrustedContext` maps directly to it (`tenant_id` = companyId).
- The agent never accepts a browser's Firebase token or a browser-supplied company or role. If it ever must be called from a browser directly, it would verify the Firebase token and read the same `companies/{companyId}/memberships/{uid}` document, never its own copy.

The full contract is in [auth-contract.md](auth-contract.md).

## 10. Milestones

| # | What's built | What you configure |
| --- | --- | --- |
| **1 (this PR)** | This plan. `server/` skeleton: config validation (refuses wildcard CORS, bad IDs), `/health`, request IDs, sanitized JSON logs, security headers, exact-origin CORS, body limit, safe JSON errors, Admin SDK init with ADC, Dockerfile, `.env.example`, tests. | Nothing yet. |
| 2 | Token-verification middleware, `/api/me`, `/api/company`, `/api/teams`, membership gating, auth contract doc. | Nothing yet (tested with mocks/emulator). |
| 3 | Bootstrap script (emulator-tested); frontend switched to `/api/me` with 401 refresh-once; workspace shows identity, company, role and teams; closed Firestore rules; `/api` forwarding in the web server and the dev server; [go-live steps](go-live.md). The invitation-accept-once step moves to Milestone 4 together with the invitation endpoint. | Follow [go-live.md](go-live.md) when you're ready: bootstrap in Cloud Shell, then (with your approval) the service account, API deploy and web app update, then the rules. |
| 4 | `/api/members`, invitations (list, create, revoke, accept), `PATCH /api/members/:uid`, no self-changes, last-admin protection, one pending invitation per email, audit events, per-user rate limits. The web app tries a matching invitation once when someone has no membership, and Company Admins get a members and invitations screen. Emulator-tested, including concurrent requests. | Nothing new. Invitations go live with the API in [go-live.md](go-live.md). |
| 5 | Full test pass (emulator + mocks) for the security list in the brief; local and deployment docs; nginx `/api/` forwarding. | Create the service account and roles, deploy `axiomflo-api`, allow public invocation, redeploy the web app. Each step listed for the Console, and only with your go-ahead. |

## Defaults I've picked (say if you want otherwise)

- **Same-origin through nginx** for production (section 8), CORS only for unusual setups.
- **Invitation expiry:** 14 days by default, 30 at most.
- **Team codes** are set by the bootstrap script and read-only afterwards, matching the current UI.
- **Firestore:** the existing `(default)` database in `axiomflo-pilot`; no new database.
- **Email/password users** are supported the same way as Google users, as long as their email is verified.
