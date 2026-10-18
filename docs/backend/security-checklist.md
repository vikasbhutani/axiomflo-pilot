# Security checklist

Each rule from the pilot brief, where it's enforced, and the automated test that proves it. "Emulator" tests run the real API against local Firebase Authentication and Firestore (`cd server && npm run test:emulator`). "Unit" tests use stand-ins (`npm test` in `server/`, or at the top level for the web app).

None of these tests touch your real Firebase project. After going live, the [checks at the end of go-live.md](go-live.md#7-check-it-works) confirm the same behaviour on the real deployment.

## Who gets in

| Rule | Enforced in | Proven by |
| --- | --- | --- |
| A successful Google sign-in alone grants nothing | `server/src/membership/access.ts` | Emulator: `security.emulator.test.ts` › "the very first person to sign in…" |
| An email domain grants nothing | Access is looked up by the token's `uid` only | Emulator: "sharing the admin's email domain is not enough" |
| A company ID from the browser grants nothing | The company is `PILOT_COMPANY_ID` on the server | Emulator: "a company ID, role or demo role from the browser is ignored"; unit: `api.test.ts` › "ignores company, role, uid and demo-role hints…" |
| A localStorage role or the demo role selector grants nothing | The demo is a separate mode that never calls the API | Web: `auth.test.tsx` › "cannot give a signed-in person without membership access, whatever demo role is saved" and "never changes a real member's role" |
| The first person to sign up isn't made an admin | Only the bootstrap script, run by hand with your Google credentials, creates the first admin | Emulator: "the very first person to sign in…" and "every write a stranger could try on an empty database is refused, and nothing is stored" |
| No public endpoint can create the first admin | There's no such route; invitations need an existing active admin | Emulator: "every write a stranger could try…" (seven attempts, database stays empty) |
| Unverified emails get no membership lookup | `access.ts`, `acceptInvitation` | Emulator: `api.emulator.test.ts` › "does not look up a membership for an unverified email"; `admin.emulator.test.ts` › "requires the verified token email to match" |
| Disabled accounts and revoked sessions are refused | `verifyIdToken(token, true)` | Emulator: "rejects a token after the account is disabled" and "…after sessions are revoked" |
| Tokens for another Firebase project are refused | `tokenVerifier.ts` checks `aud` and `iss` | Unit: `tokenVerifier.test.ts` › "rejects a token issued for another Firebase project…" |
| A membership in another company grants nothing here | All reads go under `companies/{PILOT_COMPANY_ID}` | Emulator: "a membership written directly for another company grants nothing here" |
| An individual user sees only their teams | `permittedTeams` | Emulator: "gives an individual user only their assigned team"; unit: "an individual user cannot see other teams by asking for them" |

## Trusting the request

| Rule | Enforced in | Proven by |
| --- | --- | --- |
| A uid or email in the request body is never trusted | Routes take the caller from the verified token | Emulator: "accepting with someone else's email in the body does not take their invitation"; unit: `admin.test.ts` › "uses only the verified identity…" and "passes the acting admin from the token…" |
| Unknown fields (inviter, company…) are refused, not silently used | `server/src/admin/validation.ts` | Emulator: "an inviter or company in the invitation body is refused…" |
| Invitation acceptance never takes a role or team from the browser | `acceptInvitation` copies them from the invitation | Emulator: `api.emulator.test.ts` › "walks the invitation flow over HTTP…" (sends `role: company_admin`, gets `individual_user`) |

## Changing access

| Rule | Enforced in | Proven by |
| --- | --- | --- |
| Nobody edits their own role, teams or status | `updateMember` | Emulator: "an individual user cannot promote themselves or add teams" and "the only admin cannot suspend or demote themselves" |
| At least one active admin always remains, even with simultaneous changes | Transaction in `updateMember` | Emulator: `admin.emulator.test.ts` › "keeps at least one active admin, even when two admins demote each other at once" |
| Suspension applies immediately | Membership is read on every request | Emulator: `security.emulator.test.ts` › "applies on the very next request…" |
| A suspended person can't get back in through an invitation | `createInvitation` refuses existing members; `acceptInvitation` refuses suspended ones | Emulator: "…survives a fresh invitation attempt"; `admin.emulator.test.ts` › "does not let a suspended member back in…" |
| One pending invitation per email, even if sent twice at once | Lock document in a transaction | Emulator: "refuses a second pending invitation for the same email, even when sent at the same time" |
| Accepting twice, or five times at once, creates one membership | Transaction in `acceptInvitation` | Emulator: "is safe to retry…" and "concurrent accepts create exactly one membership" |
| Every change is audited, without email addresses | Audit event written in the same transaction | Emulator: `security.emulator.test.ts` › "invite, accept and member change each leave one audit event…" |
| Invitations say "Created — email not sent" | `InvitationView.delivery` | Emulator: "walks the invitation flow over HTTP…"; web: `AdminPanel.test.tsx` |
| Rate limits on invitations and member changes | `server/src/http/rateLimit.ts` | Unit: `admin.test.ts` › "rate-limits invitation and member changes per admin" |

## Errors

| Rule | Enforced in | Proven by |
| --- | --- | --- |
| `401` for missing or invalid sign-in | `authenticate.ts` | Unit: `api.test.ts` › "authentication on every /api route"; `admin.test.ts` › "admin-only routes" |
| `403` for insufficient authorization | `requireMember.ts` | Unit: `requireMember.test.ts`, `admin.test.ts` |
| `503` when membership can't be checked, never "no membership" or access | `access.ts`, `admin.ts` `run()` | Unit: "returns 503, not pending, when the database is down", "turns a database failure into 503, never success" |
| A malformed stored record is an error, never access | Strict parsers in `records.ts` | Unit: `requireMember.test.ts` › "malformed membership records are refused with a 500…" |
| The web app treats any failed lookup as "couldn't check", never as access | `membershipService.ts` | Web: `auth.unit.test.ts` › "treats any error status, including 403 and 503, as a failed lookup…" |
| The web app tries an invitation once, and "none" is a normal outcome | `membershipService.ts` | Web: `auth.unit.test.ts` › "tries to accept a matching invitation once…", "treats 'no matching invitation' as a normal pending result…" |

## Secrets and logs

| Rule | Enforced in | Proven by |
| --- | --- | --- |
| Tokens and Authorization headers are never logged | Redacting logger; access log has no headers | Unit: `app.test.ts` › "never writes the Authorization header into the access log", "redacts sensitive keys at any depth"; `api.test.ts` › "never logs the token…" |
| The web app never stores tokens itself | Firebase SDK keeps them; `api.ts` only adds the header | Web: `auth.test.tsx` › "are never written to localStorage or sessionStorage, even after API calls" |
| No service-account keys or private keys in the repository | Application Default Credentials only; `.gitignore` | Unit: `repo.test.ts` › "contains no private keys or service-account key files" |
| CORS allows exact origins only, never `*`, never credentials | `config.ts`, `cors.ts` | Unit: `config.test.ts` (refuses `*` and wildcards), `app.test.ts` › "CORS" |
| The Auth emulator can't be switched on in production | `config.ts` | Unit: `config.test.ts` › "refuses to run on Cloud Run with the Auth emulator switched on" |

## Not covered by automated tests

- **The real deployment.** IAM roles, `--allow-unauthenticated`, the web server's `/api` forwarding over HTTPS and Firestore rules are checked by hand in [go-live.md step 7](go-live.md#7-check-it-works).
- **Rate limits across instances.** They're in memory per instance, which is fine with `--max-instances 2`.
- **Invitation email delivery.** It isn't built.
