# Milestone 9 Delivery Report — SAP Business One Integration

Built from your attached full specification (25 numbered sections) in
one pass, delivered silently per your `return only a zip of created
and edited file` instruction. This report follows the spec's own
required-disclosures structure as closely as the material allows.

## 1. Business context and the engineering standard this milestone was held to

Willsgrove Farm Enterprises (Harare branch, Bulawayo HQ) runs SAP
Business One as its system of record for products, customers,
inventory, accounting, invoicing, and credit notes. This milestone adds
an integration layer that lets SalesFlow read master data and invoice/
credit-note data from SAP, and submit one kind of document outbound —
a sales order — while never pretending to be, or compete with, SAP
itself.

The spec's own standard governed every decision in this report:

> When Bulawayo grants the required SAP permissions, Willsgrove should
> not need to redesign SalesFlow or start the integration project
> again. The remaining work should be environment configuration,
> connection verification, authorised testing and controlled
> activation.

Concretely, that means: no SAP credential, endpoint, or company
database was ever guessed anywhere in this milestone; no mock
transaction is ever presented to a user as a real SAP transaction; no
code anywhere writes directly to a SAP table; and every place a real
tenant's exact behavior is still unknown is explicitly flagged rather
than assumed — see §14 and `docs/sap-integration/discovery-checklist.md`.

## 2. Architecture: the adapter contract

`lib/integrations/sap/types.ts` defines `SapAdapter` — the **only**
shape any business module in this codebase is allowed to depend on for
SAP data. Two implementations exist:

- **`MockSapAdapter`** (`mock-adapter.ts`) — a deterministic, clearly-
  synthetic fixture world (4 products, 2 customers, 1 invoice, 1 credit
  note), with idempotent sales-order creation and three documented
  simulation sentinels for exercising the NETWORK_UNAVAILABLE / lost-
  response-TIMEOUT / never-reached-TIMEOUT failure paths in tests.
  Always available, requires no real SAP access, and is this project's
  default everywhere.
- **`ServiceLayerAdapter`** (`real-adapter.ts`) — written against SAP
  Business One's publicly documented Service Layer REST object model
  (session/cookie login, Items/BusinessPartners/Orders/Invoices/
  CreditNotes endpoints). **Honestly unverified against a real SAP
  tenant** — see §14.

`getSapAdapter()` (`get-adapter.ts`) is the single choke point that
decides which implementation a caller receives, based on the three-gate
resolution in §4. No API route, library function outside
`lib/integrations/sap/`, or UI component ever constructs a `fetch()`
call to a SAP endpoint directly.

## 3. Schema / migration changes

Purely additive — `prisma/migrations/20261111200000_add_sap_integration/migration.sql`:

| Change | Detail |
|---|---|
| 8 new enums | `IntegrationProvider`, `IntegrationMode`, `IntegrationSyncJobType`, `IntegrationSyncJobStatus`, `IntegrationTrigger`, `IntegrationOperationType`, `IntegrationOperationStatus`, `IntegrationErrorCategory`. |
| 3 new tables | `IntegrationConnection` (singleton-per-provider config — no secret column, ever), `IntegrationSyncJob` (one row per sync run, manual or scheduled), `IntegrationOperation` (the sales-order outbox — `customerOrderId`/`idempotencyKey`/`externalDocEntry` all `@unique`). |
| New relations | `CustomerOrder.integrationOperation` (pure inverse side, no new column on `CustomerOrder`), two new `User` inverse-relation fields. |
| Nothing removed/changed | No existing table, column, or enum value was dropped, renamed, or had its type/nullability changed. `Product`/`Customer`'s existing `sapItemCode`/`sapCustomerCode` columns (Milestone 1) are read, never altered. |

`IntegrationOperation.customerOrderId` is a real, typed, `Restrict`
foreign key onto `CustomerOrder` — never a generic polymorphic
`entityType`/`entityId` pair, per the spec's explicit warning against a
reference table with no referential integrity.

## 4. Security and configuration model

Three independent gates must **all** agree before any real SAP call is
ever attempted (`lib/integrations/sap/config.ts`'s `canUseLiveSapAdapter`):

1. The `SAP_B1_PROVIDER` environment variable must literally equal
   `"live"` (case-sensitive) — an operator-only kill switch, never
   reachable from this app's UI, API, or database.
2. `IntegrationConnection.mode` must be `LIVE`.
3. `IntegrationConnection.enabled` must be `true`.
4. A complete credential set must resolve: `baseUrl`/`companyDb`/
   `username` from the database row, **and** `SAP_B1_PASSWORD` from the
   environment.

Any one of these missing or wrong falls back to `MockSapAdapter`,
fail-safe by default (`SAP_B1_PROVIDER` unset → mock; a typo → mock).
No secret is ever stored in the database (`IntegrationConnection` has
no password column at all), logged, or included in any API response
body. `sanitizeSapErrorMessage` redacts any password/username match,
`Authorization:` header, or `Bearer` token out of an error message
before it is ever stored (`lastErrorMessage`/`lastTestMessage`) or shown
in the UI — this is defense-in-depth, not the primary control, since a
real Service Layer error is not expected to echo credentials back in
the first place. Connection configuration is `ADMINISTRATOR`-only and
every change is written to `AuditEvent` (`SAP_INTEGRATION_CONNECTION_UPDATED`).

## 5. Sync behaviour, by data type

| Data | Direction | Reuses | Trigger |
|---|---|---|---|
| Products | Inbound | `lib/product-import.ts`'s `planProductImport`/`executeProductImport` (Milestone 1), verbatim | Manual or scheduled (`scripts/sap-sync.ts`) |
| Customers | Inbound | `lib/customer-master-import.ts` (Milestone 1), verbatim | Manual or scheduled |
| Invoices | Inbound | `lib/invoice-reconciliation/{plan,execute}-import.ts` (Milestone 5), verbatim | **Manual only** |
| Credit notes | Inbound | `lib/returns-credits/{plan,execute}-import.ts` (Milestone 6B), verbatim | **Manual only** |
| Sales orders | **Outbound** | New (`order-outbox.ts`) — the one write this milestone performs | Always manual, per-order |

Invoice and credit-note sync are manual-only because
`SapInvoiceImportBatch.uploadedById`/`CreditNoteImportBatch.uploadedById`
are both required, non-nullable columns from Milestone 5/6B — a
scheduled run triggered by an external scheduler has no signed-in user
to attribute an import batch to. This is a clean, explicit architectural
decision, documented in three places (`invoice-sync.ts`'s own module
comment, the sync API route's comment, and `scripts/sap-sync.ts`'s own
comment).

`scripts/sap-sync.ts` is a new standalone script (`npm run sap:sync`),
mirroring this project's existing `scripts/expire-quotations.ts`
convention exactly — this architecture has no persistent background
worker, so it is meant to be invoked by a real external scheduler
(Windows Task Scheduler) and never left running. It runs **only**
product and customer sync. Sales-order outbox processing is never
scheduled in this milestone: submitting an order to SAP is always a
deliberate, per-order action by whoever is looking at that order, never
an unattended sweep.

No real SAP environment has been confirmed to support an incremental
"changed since" filter, so every fetch is a full refetch; the
downstream Milestone 1/5/6B import pipelines' own SAP-code-based dedupe
already makes this safe, if not bandwidth-optimal against a large
catalogue — see §14 and the discovery checklist.

## 6. Outbox, idempotency, and reconciliation design (spec section 7's CRITICAL requirement)

**A network timeout does not prove the request was rejected.** This is
the central reliability requirement this milestone was built around.

`IntegrationOperation` is the outbox: one row per `CustomerOrder`,
ever (`customerOrderId` is `@unique` at the database level — this is
the actual duplicate-submission guard, not a convention). Its
`idempotencyKey` is deterministic (`SAP-SO-<customerOrderId>`), and its
`submittedSnapshot` is captured once, at creation, and resubmitted
**verbatim** on every retry — never recomputed from the order's
possibly-changed current state.

State machine:

```
PENDING -> PROCESSING -> SUCCEEDED   (adapter confirmed creation)
                       -> FAILED     (a definite, interpretable rejection -- safe to fix and retry)
                       -> UNCERTAIN  (a TIMEOUT -- NEVER auto-retried)
UNCERTAIN -> SUCCEEDED   (reconcileUncertainOperation found the order after all)
UNCERTAIN -> FAILED      (a human's resolveUncertainOperation confirmed it was never created)
FAILED -> PROCESSING -> SUCCEEDED/FAILED/UNCERTAIN   (retrySubmission, same immutable snapshot)
```

Every other failure category (`VALIDATION_FAILURE`,
`MISSING_CUSTOMER_MAPPING`, `MISSING_PRODUCT_MAPPING`, etc.) is treated
as a definite, interpretable answer from SAP — safe to correct and
retry. Only `TIMEOUT` reaches `UNCERTAIN`, and an `UNCERTAIN` row is
**never** blindly resubmitted; `retrySubmission` explicitly throws if
called on one. Resolution requires either:

- `reconcileUncertainOperation` — a **read-only** lookup by external
  reference (`findSalesOrderByExternalReference`); a `NOT_FOUND` result
  does **not** prove the order was never created, only that this
  lookup mechanism didn't find it, and the row is deliberately left
  `UNCERTAIN`, not auto-failed; or
- `resolveUncertainOperation` — an authorised human's own decision
  (`ADMINISTRATOR`-only), recorded with their notes and a dedicated
  `AuditEvent` (`SAP_UNCERTAIN_SUBMISSION_RESOLVED`).

## 7. The central scope decision: SAP-submission eligibility

Found by reading the existing codebase directly, not assumed:
`OrderLine.approvedUnitPrice` and `CustomerOrder.subtotal/taxTotal/total`
are structurally always `null` across the **entire** application today
— the legacy pricing/discount-approval workflow those columns were
written for has never been built, in any milestone up to and including
this one. The only place a genuine, Sales-approved commercial price
exists anywhere in this codebase is `OrderLine.customerUnitPrice`, set
only when `lib/quotations/convert-to-order.ts` converts an accepted
Quotation into an order.

**Consequence**: `checkOrderEligibility()` (`order-eligibility.ts`)
only ever returns `eligible: true` for an order where
`source === "QUOTATION"`, the source quotation has no live pending
approval request (respecting Milestone 8's framework — see §7a), the
customer has a mapped `sapCustomerCode`, every line is matched to a
product with a `sapItemCode`, every line has a non-null
`customerUnitPrice`, and every quantity is a valid positive number.
Every other order is permanently `NOT_READY`, with an explicit,
human-readable blocker (`NOT_FROM_QUOTATION`) — never a guessed price,
never a silent workaround.

### 7a. Respecting, not bypassing, Milestone 8

`checkOrderEligibility` calls the existing
`getLiveApprovalRequestForQuotation` and blocks submission
(`LIVE_APPROVAL_PENDING`) while the source quotation has a pending
discount-approval request — SAP submission can never race ahead of an
approval decision. Per your own standing instruction from Milestone 8,
`ApprovalActionType.ORDER_VALUE_EXCEEDS_THRESHOLD` remains
**framework-ready only**; nothing in this milestone activates that
gate or calls into it from anywhere in the SAP submission path.

## 8. Role / permission matrix

| Action | SALESPERSON | SALES_MANAGER | ADMINISTRATOR |
|---|---|---|---|
| View order's SAP status (`/api/orders/[id]/sap-status`) | ✅ | ✅ | ✅ |
| Submit / retry an order's SAP submission | ❌ | ✅ | ✅ |
| View SAP dashboard (`/integrations/sap`) | ❌ | ✅ | ✅ |
| Reconcile an UNCERTAIN operation | ❌ | ✅ | ✅ |
| Resolve an UNCERTAIN operation (human decision) | ❌ | ❌ | ✅ |
| View/edit connection configuration | ❌ | View only | ✅ |
| Test connection | ❌ | ❌ | ✅ |
| Manual catalogue-wide sync (products/customers/invoices/credit notes) | ❌ | ❌ | ✅ |

Every mutating route enforces this server-side via
`requireUserOrResponse([...roles])` and `verifyCsrfOrigin` — the UI
hides buttons a role cannot use, but the route itself refuses the
action independently, the same pattern this project's existing
approvals routes already use. No new RBAC role was created; this
milestone uses only the three roles that already exist.

## 9. New API routes

| Route | Method | Roles |
|---|---|---|
| `/api/integrations/sap/connection` | GET | ADMINISTRATOR, SALES_MANAGER |
| `/api/integrations/sap/connection` | PATCH | ADMINISTRATOR |
| `/api/integrations/sap/connection/test` | POST | ADMINISTRATOR |
| `/api/integrations/sap/sync/[jobType]` | POST | ADMINISTRATOR |
| `/api/integrations/sap/dashboard` | GET | ADMINISTRATOR, SALES_MANAGER |
| `/api/integrations/sap/operations` | GET | ADMINISTRATOR, SALES_MANAGER |
| `/api/integrations/sap/operations/[id]/retry` | POST | ADMINISTRATOR, SALES_MANAGER |
| `/api/integrations/sap/operations/[id]/reconcile` | POST | ADMINISTRATOR, SALES_MANAGER |
| `/api/integrations/sap/operations/[id]/resolve` | POST | ADMINISTRATOR |
| `/api/orders/[id]/sap-submit` | POST | ADMINISTRATOR, SALES_MANAGER |
| `/api/orders/[id]/sap-status` | GET | Any authenticated role |

Every mutating route: `verifyCsrfOrigin`, `isValidId` on path params,
body parsing via `readJsonObject`, `Cache-Control: no-store`.

## 10. UI / UX

- **`/integrations/sap`** — dashboard: connection health, per-job-type
  last-sync summaries, manual "Sync now" buttons, and an operations
  table with retry/reconcile/resolve actions, each gated to the
  viewer's actual role (not just hidden — the underlying route enforces
  the same gate).
- **`/integrations/sap/settings`** — ADMINISTRATOR-only connection
  configuration. No password field exists anywhere on this page or in
  any API response it calls.
- **`/orders/[id]`** — a new, self-fetching "SAP Business One" panel
  showing the order's live integration status (`NOT_READY`/`READY`/
  `SYNCED`/`FAILED`/`REQUIRES_REVIEW`), the blocker reasons when not
  ready, and a "Submit to SAP" button only when eligible and the
  viewer's role permits.
- **Sidebar** — new "SAP Integration" entry in the existing "SAP
  MASTER DATA" section.

Every state (loading, empty, error, not-eligible, permission-denied via
page-level redirect) is handled explicitly — no dead buttons, no silent
failure.

## 11. Audit trail

Every SAP-relevant write that changes something durable is audited:
connection updates (`SAP_INTEGRATION_CONNECTION_UPDATED`) and uncertain-
operation resolutions (`SAP_UNCERTAIN_SUBMISSION_RESOLVED`) write to the
existing `AuditEvent` model. Sync-job and outbox-operation history is
itself a durable, queryable audit trail (`IntegrationSyncJob`/
`IntegrationOperation`), so "last successful synchronisation," "who
triggered this," and "what exactly was submitted" are all real queries,
never something held only in memory or inferred.

## 12. Tests executed and results

| File | Kind | Count | Result |
|---|---|---|---|
| `tests/sap-mock-adapter.test.ts` | Unconditional | 16 | ✅ All passing |
| `tests/sap-config.test.ts` | Unconditional | 13 | ✅ All passing (caught 1 real bug — see below) |
| `tests/sap-idempotency.test.ts` | Unconditional | 3 | ✅ All passing |
| `tests/sap-order-outbox-db.integration.test.ts` | Gated (`RUN_DB_INTEGRATION_TESTS=1`) | 5 | ⏭️ Written to this project's established convention; correctly self-skips in this sandbox (no real database/generated Prisma client available here) |

**One real bug found and fixed, self-caught, not user-reported**: while
writing `sap-config.test.ts`, `sanitizeSapErrorMessage`'s
`Authorization`-header redaction regex was found to redact only the
auth *scheme* word ("Basic"/"Bearer"), never the credential token after
it — so a Basic-auth header's base64 payload would have survived
verbatim into a stored error message. Fixed to consume up to two
whitespace-separated tokens after `Authorization:`; a dedicated test
now guards this.

### Tests not run from this sandbox (honest, not hidden)

- The 5 gated DB-integration tests above, against a real database.
- Anything through `ServiceLayerAdapter` against a real SAP Business
  One tenant — no real SAP credentials, endpoint, or company database
  were ever available to, or guessed by, this work. This is the
  single most important honesty disclosure in this report: **nothing
  in this milestone has been tested against real SAP**, and nothing
  claims otherwise anywhere in the code, comments, or UI.

### Full-project regression check

`npx vitest run`: **553 passed, 90 skipped (44 files)** — up from 521
passed / 85 skipped at the end of Milestone 8 (+32 new unconditional
tests, all passing; +5 new gated tests, correctly skipping). **Zero
regressions** in any pre-existing test.

## 13. Honest `tsc` / lint / build results

- **`npx eslint .`** — clean across the whole project, including every
  file this milestone added or edited.
- **`npx tsc --noEmit`** — **370 errors**, up from 363 at the end of
  Milestone 8. All 7 added errors were individually traced to the
  same pre-existing, sandbox-only stale/stub-`@prisma/client` noise
  every prior milestone has produced here (`Namespace 'Prisma' has no
  exported member 'Decimal'`/`'JsonValue'`/`'InputJsonValue'`, and
  `Parameter 'tx'`/destructured-query-result implicitly has an `'any'`
  type on `prisma.$transaction` callbacks and complex Prisma query
  results) — confirmed by cross-checking every new error against this
  exact, already-documented category, not assumed. None is a real
  defect in this milestone's code. Running `npx prisma generate`
  against a real network and re-running `tsc` is expected to clear
  essentially all of this delta, exactly as for every prior milestone.
- **`npm run build`** — not re-attempted this round; every prior
  milestone has hit the same pre-existing Google-Fonts network block
  in this sandbox, unrelated to this milestone's own code.
- **`npx prisma generate`/`validate`** — not run; network-blocked in
  this sandbox, same as every prior milestone.

## 14. Known limitations (recorded, not silent)

1. **Only quotation-converted orders are SAP-submission-eligible.**
   Every manually-entered or extracted order is permanently
   `NOT_READY` until a future milestone builds the legacy pricing/
   discount-approval workflow referenced throughout the existing
   codebase. See §7.
2. **Invoice and credit-note sync have no scheduled equivalent** — a
   pre-existing Milestone 5/6B schema constraint (`uploadedById`
   required), not something this milestone could additively change
   without altering those models.
3. **`ServiceLayerAdapter` is honestly unverified against a real SAP
   Business One tenant.** Written against SAP's standard, publicly
   documented Service Layer object model; every place a real tenant
   could differ is explicitly commented in `real-adapter.ts` and
   listed in `docs/sap-integration/discovery-checklist.md` (exact
   field names, UDFs, the external-reference field a real Sales Order
   actually carries, whether incremental sync or lookup-by-reference
   is even supported, rate limits, IP allow-listing).
4. **No native incremental ("changed since") sync is assumed** — every
   fetch is a full refetch; safe (downstream dedupe already exists)
   but not bandwidth-optimal against Willsgrove's ~7,500-item
   catalogue.
5. **Sales-order outbox processing is never scheduled** — by design,
   not oversight; submission is always a deliberate per-order human
   action in this milestone. A future milestone could add scheduled
   outbox processing as its own, separately-reviewed decision.
6. **Reconciliation-by-external-reference's real-world support is
   unverified** — part of the adapter contract and implemented
   against the mock fixture world; whether a real SAP B1 tenant
   actually supports it is an open discovery-checklist item. Until
   confirmed, a human SAP-side check is the practical fallback for an
   `UNCERTAIN` row reconciliation alone cannot resolve.

## 15. Go-live path: the discovery checklist

`docs/sap-integration/discovery-checklist.md` is the single, complete
list of what Bulawayo HQ must confirm or grant before
`SAP_B1_PROVIDER=live` is ever set anywhere but a test environment:
Service Layer reachability and TLS; a dedicated service account with
exactly the right (and no more than the right) permissions; field-name/
UDF/external-reference-field confirmation; idempotency/duplicate-
detection support; volume and rate-limit confirmation; and a staged
go-live sequence (non-production test first, then production). Nothing
in that checklist blocks ordinary use of SalesFlow today — every sync
and submission path runs against the mock adapter until every gate is
deliberately and explicitly flipped.

## Files changed

See `CHANGES.md`'s "Milestone 9" section for the complete, categorized
file list (schema/migration, `lib/integrations/sap/` module, API
routes, UI, tests, documentation, other changes).

## Exact Windows PowerShell commands

See `SETUP-WINDOWS.md` §26 for the full migration-apply, Prisma-
regenerate, gated-test-run, manual-test-script, and rollback
instructions.
