# User Acceptance Testing Plan — Milestone 16

This is a **plan to execute against a real staging environment with a real database** — it was not run in this sandbox (no live database exists here; see `DATABASE-BACKUP-AND-RECOVERY.md`). Use controlled test data (seeded demo data, or a dedicated UAT dataset flagged `isDemo: true` where practical) rather than real customer or financial data, per the spec's own instruction. Each scenario below has a blank **Actual Result** and **Pass/Fail** column for Willsgrove's own testers to fill in during a real UAT pass; "Evidence to collect" names what to screenshot/export/note.

Legend for Status column once run: **PASS** / **FAIL** / **BLOCKED** / **NOT TESTED**.

## 1. Administrator scenarios

| # | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status | Evidence |
|---|---|---|---|---|---|---|---|
| A1 | Login/logout | A valid ADMINISTRATOR account exists | Sign in with correct credentials; sign out | Redirected to dashboard on success; signed out and redirected to `/login`, and the session cookie no longer works for any page | | | Screenshot of dashboard; confirm a copied session cookie value no longer authenticates after logout |
| A2 | Failed login / rate limiting | — | Attempt login with a wrong password 9 times in 10 minutes for the same account | After 8 attempts, further attempts are rejected (rate limited) regardless of whether the 9th password is correct | | | Response/error shown on the 9th attempt |
| A3 | First-login forced password change | A newly admin-created user with `mustChangePassword=true` | Sign in as that user | Redirected/forced to `/change-password` before reaching anything else; cannot navigate away until changed | | | Screenshot |
| A4 | Create a user | Signed in as ADMINISTRATOR | Create a new SALESPERSON user | User created; a one-time temporary password is shown; new user can sign in and is forced to change it (A3) | | | The one-time password screen |
| A5 | Deactivate a user | A second browser/session signed in as that user, active | Deactivate that user from `/settings` | The other session is logged out on its very next action; that account can no longer sign in | | | Before/after on the second session |
| A6 | Non-admin cannot manage users | Signed in as SALESPERSON | Attempt `POST /api/users` directly (e.g. via browser dev tools or a REST client), and look for any admin-only control in the UI | Request rejected with 403; no user-management control visible in the UI for this role | | | 403 response body |
| A7 | Permissions boundary — management reports | Signed in as SALESPERSON | Navigate directly to `/reports/sales-performance` and `/reports/decision-intelligence` by URL | Redirected away / denied — these are management-only regardless of direct URL entry | | | Screenshot of the redirect |
| A8 | System settings / integration configuration | Signed in as ADMINISTRATOR | Open `/integrations/sap/settings`; review (do not necessarily enable) SAP connection fields | Settings page loads; mode defaults to mock/disabled; no real credential is visible anywhere in the UI | | | Screenshot |
| A9 | Audit history | Signed in as ADMINISTRATOR | Perform any mutation (e.g. create a user), then query the `AuditEvent` table for that action (via DB access, not UI — there is no dedicated audit-browsing page) | A matching `AuditEvent` row exists with the correct `actorId`, `action`, and `afterData` | | | The row (redact any sensitive value before sharing) |
| A10 | Operational health check | — | `curl /api/health/live` and `curl /api/health` against the real deployment | Both return `success: true`; `/api/health` reports `database: "connected"` and the correct version/build id | | | Raw responses |

## 2. Sales Manager scenarios

| # | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status | Evidence |
|---|---|---|---|---|---|---|---|
| M1 | Customer management | Signed in as SALES_MANAGER | Open `/customers`, open one customer's 360 profile | List and profile load with real figures (revenue, orders, claims) | | | Screenshot of profile |
| M2 | Product catalogue | — | Open `/products`, open one product's 360 profile | List and profile load | | | Screenshot |
| M3 | PO intake | A sample PO document (image/PDF/text) | Upload via PO intake, review extracted lines, confirm | Order created from the reviewed/confirmed extraction | | | The created order |
| M4 | Order lifecycle | An existing DRAFT/RECEIVED order | Move it through verification → approval | Status transitions correctly; each transition recorded as an `AuditEvent` | | | Order detail screenshots at each stage |
| M5 | Quotation → order conversion | An ISSUED quotation | Convert it to an order | Order created with the quotation's priced lines carried over | | | Before/after |
| M6 | Sales reports | — | Open `/reports/sales-performance`, apply a date-range and salesperson filter | Figures update correctly; CSV export produces a file matching the filtered view | | | The exported CSV |
| M7 | Customer/Product/Decision Intelligence | — | Open `/reports/customer-intelligence`, `/reports/product-intelligence`, `/reports/decision-intelligence` | Each loads a ranked overview with no composite/blended score anywhere | | | Screenshots |
| M8 | Approvals | A pending approval item | Approve or reject it | Status updates; `AuditEvent` recorded; the requester's view reflects the new status | | | Before/after |
| M9 | Claims / returns | An invoiced order with a disputed line | Raise an invoice claim, then a return against it | Claim and return recorded correctly, credit note value reflected in the customer's commercial-health figures | | | Claim and credit-note screenshots |
| M10 | Exports | Any list/report page with an export action | Export to CSV/Excel | File downloads and opens with the expected columns and row count matching the on-screen filtered view | | | The exported file |
| M11 | Decision recommendation lifecycle | An open decision recommendation exists (seed data, or triggered by real activity) | Acknowledge it, then resolve it with a note | Status transitions correctly; history panel shows every event in order | | | Screenshot of the history timeline |

## 3. Salesperson scenarios

| # | Scenario | Preconditions | Steps | Expected Result | Actual Result | Status | Evidence |
|---|---|---|---|---|---|---|---|
| S1 | Login | A valid SALESPERSON account | Sign in | Reaches the operational dashboard | | | Screenshot |
| S2 | Customer/product lookup | — | Search `/customers` and `/products` | Can find and view records; cannot see management-only overview pages (redirected per A7) | | | Screenshot |
| S3 | PO intake workflow | A sample PO document | Upload, review, confirm | Same as M3 — available to this role too | | | The created order |
| S4 | Order workflows | An order this salesperson created | View and progress it through the stages this role is permitted to perform | Allowed transitions succeed; any management-only transition (e.g. final approval, if restricted) is rejected server-side even if attempted directly | | | Screenshot / rejected-attempt response |
| S5 | Quotation creation | — | Create a quotation for a customer, issue it | Quotation created and issued with correct salesperson attribution (never silently defaulted to whoever is logged in without an explicit pick — see M12's attribution-confidence design) | | | Quotation detail |
| S6 | Lost-sale recording | A requested item that cannot be fulfilled | Record a lost sale with a reason | Lost sale recorded, visible in this salesperson's own lost-sales figures | | | Screenshot |
| S7 | Permitted operational views | — | Open `/reports` (the hub) | Only non-management tiles are reachable/visible; direct navigation to a management report redirects (same as A7/M-tier checks) | | | Screenshot |
| S8 | Restricted management pages | — | Attempt to navigate directly to `/settings`'s user-creation action, `/reports/sales-performance`, `/reports/decision-intelligence` | All denied server-side regardless of direct URL entry | | | Rejected responses |

## 4. End-to-end business scenarios

| # | Scenario | Steps | Expected Result | Status |
|---|---|---|---|---|
| E1 | PO to cash | Upload a PO → review/confirm → approve order → pick/dispatch → deliver → SAP invoice arrives (or is simulated via the mock adapter) → reconcile against the order → no discrepancy | Every stage's status is consistent; the final reconciled invoice matches the order lines | |
| E2 | Dispute to resolution | A delivered order with a damaged-line dispute → file an invoice claim → raise a return → credit note recorded → customer's commercial-health figures reflect the credit | Each step's figures tie together (claim count, return count, credit-note value) with no double-counting | |
| E3 | Decision recommendation to action | A rule fires a recommendation (e.g. a declining customer) → a manager acknowledges it → takes the suggested action in the relevant module (e.g. contacts the customer, recorded as a note) → resolves the recommendation | Recommendation lifecycle and the underlying business action are both reflected, with full history | |

## 5. How to use this plan

Willsgrove (or whoever runs UAT) fills in **Actual Result**, **Status**, and attaches the named evidence for every row, against a real staging deployment with a real database — not this sandbox. Any row that cannot be executed because of a missing precondition (e.g. no real SAP credentials to test a live sync) should be marked **BLOCKED**, with the blocking reason noted, rather than skipped silently or guessed at. A **FAIL** on any row should be filed as an issue before go-live is declared on the strength of this plan.
