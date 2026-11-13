# Milestone 14 Delivery Report — Product Intelligence

Built from your attached full specification, under your explicit
implementation authorization — the M14: Product Intelligence / Full
Implementation Authorisation document, containing the literal
instructions: "This is an implementation instruction, not a request
for another proposal or specification... Do not stop after producing a
design document," "Never stop after inspection. Never ask to approve
another specification," and "M14 is complete only when the
implementation, tests, documentation and ZIP delivery are finished."
This report is the spec-structured record of what was built and the
honest state of verification — see `docs/milestones/PROGRESS.md`'s
Milestone 14 section for the full design-decision rationale this
report summarizes, and `docs/milestones/m14-metric-definitions.md` for
the authoritative definition of every figure this surface shows. Per
the spec's own explicit path instruction, this report lives under
`docs/milestones/`, unlike Milestone 13's own delivery report at the
repo root.

## 1. Scope recap

Two new, read-only reporting surfaces over existing M1/M5/M6A/M6B/M10/
M13 data — **zero schema changes**:

1. A **Product 360 profile** (`/products/[id]`), open to **all three
   roles** — modeled on `app/customers/[id]/page.tsx`'s own
   no-role-redirect precedent.
2. A **management-only product-intelligence overview**
   (`/reports/product-intelligence`), independently ranking every
   product across **exactly 10 named dimensions** — SAP invoice line
   value by currency; invoiced quantity by UoM; invoice frequency;
   distinct purchasing customers; lost-sales activity; claim/return
   activity; actual credit-note values by currency; delivery
   rejection quantities; declining invoice activity vs. the
   immediately preceding period of equal duration; incomplete/
   unmatched master data — **no composite score, no invented tier**,
   per explicit instruction.

The authorization document was exhaustive and prescriptive (exact
metric definitions, testing requirements, documentation requirements,
final-validation requirements, and delivery requirements all specified
in detail), so this round proceeded directly to full implementation
rather than a further clarification pass, with judgment calls on the
genuinely small remaining gaps documented below and in PROGRESS.md.

## 2. What was actually built

### Product 360 profile

Composes, for one product: identity (SAP item code, product-master
match status, category where present); SAP invoice line value by
currency (never summed across currency); invoiced quantity by unit of
measure (transaction-level only, never `Product.unitOfMeasure`);
invoice frequency and distinct purchasing customers; lost sales;
commercial health (claims/returns raised, actual credit notes by
currency — the inclusive count and the attribution-gated value kept
structurally separate, see §3); delivery/rejection outcomes; and
deterministic, structurally-cutoff-based insights (or none, when the
product has fewer than 2 qualifying invoices all-time).

### Management product-intelligence overview

Ranks every product across the 10 dimensions listed in §1, each
ranked **independently** and, where currency-denominated,
**independently per currency** — never combined into one score, never
bucketed into an invented tier. Only the largest dimension's rows
(`revenueQuantityFrequencyCustomers.rows`) are paginated in memory for
the screen; the other 9 dimensions are returned/exported whole, per
the spec's own instruction that CSV export include **all** filtered
records. Every row with a resolved `productId` links through to that
product's own Product 360 profile; the 10th dimension's unmatched
rows have no profile to link to and carry no `rank` field, since that
dimension is a binary flag, not a ranked magnitude.

### New `lib/reporting/` modules

Same pure/Prisma-backed split every prior reporting milestone (M11–
M13) established:

- **`product-segmentation.ts`** (pure) / no Prisma-backed counterpart
  needed — `rankByValue` (the ranking primitive, reused verbatim from
  the same shape as M13's `customer-segmentation.ts`) and
  `computePreviousPeriod` (the shared primitive behind dimension 9).
- **`product-revenue.ts`** (pure) / **`product-revenue-queries.ts`**
  (Prisma-backed) — dimensions 1–4, 9, and 10, grouped by `sapItemCode`
  only, never `Product.id` or description.
- **`product-purchasing.ts`** (pure) / **`product-demand-queries.ts`**
  (Prisma-backed) — dimension 5 (lost-sales ranking).
- **`product-commercial-health.ts`** (pure) /
  **`product-commercial-health-queries.ts`** (Prisma-backed) —
  dimensions 6–7, built on the single-product attribution rule (§3).
- **`product-fulfilment-queries.ts`** (Prisma-backed) — dimension 8,
  built on the `DispatchRecord` date-field fix (§4).
- **`product-insights.ts`** (pure) / **`product-insights-queries.ts`**
  (Prisma-backed, composite) — the deterministic insights engine and
  the single `getProductProfile`/`getProductIntelligenceOverview`
  assembly functions the pages and their export routes call.
- **`filters.ts`** (extended) — `productCategory`/`productSearch`/
  `sapItemCode`, all optional free text per the spec's own instruction
  and M12's documented "optional filter" lesson.

## 3. The single-product attribution rule: never guessing, never splitting pro-rata

A claim, credit note, or return can span multiple products on one
multi-line invoice. `resolveSingleProductSapItemCode` resolves this
deliberately conservatively: a record is attributed to exactly one
product only when **every** line on it resolves to the same single,
non-blank SAP item code (whitespace trimmed before comparison);
otherwise it resolves to `"multiple"` or `"none"`. A multi-product
record is excluded from every product's own financial total and
counted instead in an explicit `multiProductClaimCount` (dimension 6)
or `unattributableCreditNoteCount` (dimension 7) bucket — never
guessed at, never split pro-rata. This is why `getProductClaimAndReturnOverview`'s
inclusive `claimCount`/`returnCount` and `getProductCreditNoteValueOverview`'s
attribution-gated per-currency totals are two structurally different
populations that must never be read as reconciling against one
another — see the new "never conflate" bullet in
`docs/milestones/ROADMAP.md`.

## 4. The `DispatchRecord` date-field fix: this milestone's one genuinely new query-layer risk

Direct schema inspection confirmed `DispatchRecord` has **no
`dispatchedAt` field** — only `DispatchLine` carries its own
non-nullable `createdAt`. Both `getProductFulfilmentSummary` and
`getProductDeliveryRejectionOverview` (dimension 8) filter on
`DispatchLine.createdAt` instead, documented explicitly as producing a
"cohort view" (dispatches that **occurred** in the period, not
deliveries **recorded** in the period). This is a scope decision, not
a bug, and is the one area of this milestone's own new query-layer
logic given the heaviest DB-integration test coverage, since it is a
genuinely new shape rather than a direct extension of M13's own
already-proven patterns.

## 5. A real regression caught and fixed by actually running the full suite

This milestone's own extension of `ReportFilters` broke Milestone 11's
own pre-existing `tests/reporting-filters.test.ts` "parses a full,
valid filter set" test — its exact-equality assertion didn't
anticipate the three new always-present (default-`null`) keys this
milestone added. Caught only by actually running the full test suite,
not by inspection of the new code alone. Fixed properly, per the
spec's own "never weaken/skip/delete existing tests" instruction: the
three new keys were added to the expected object, and two new
dedicated test cases were added exercising the new fields' free-text
parsing and shared length-cap rejection.

## 6. Role / permission matrix

| Surface | Route(s) | Access |
|---|---|---|
| Product 360 profile | `app/products/[id]/page.tsx`, `app/api/products/[id]/profile/route.ts`, `.../export/route.ts` | All three roles (`requireUserOrResponse()`, no role list) |
| Management overview | `app/reports/product-intelligence/page.tsx`, `app/api/reports/product-intelligence/route.ts`, `.../export/route.ts` | `SALES_MANAGER`/`ADMINISTRATOR` only (`requireManagementReportAccess`) |

Enforced server-side in every route; the page-level redirect for a
`SALESPERSON` on the overview is a UX convenience only, never the
security boundary — the same standing rule every M11–M13 management
report already follows.

## 7. Documented scope decisions

- No schema migration — every M14 figure is derived live from existing
  M1/M5/M6A/M6B/M10/M13 tables/columns.
- No composite score, no invented product tier, on the management
  overview — an explicit instruction; the overview page's own
  structure (10 separate `SectionCard`s, one per dimension) makes this
  visually as well as structurally true.
- `Product.id` is used only as the Product 360 route key for a real
  master record; an unmatched SAP item code has no profile page of its
  own and surfaces only through the overview's 10th dimension.
- Quantity/category reporting uses only transaction-level UoM and
  `Product.category`; `Product.unitOfMeasure` is never read for
  quantity aggregation, by deliberate design.
- Delivery-rejection figures are a "cohort view" over
  `DispatchLine.createdAt` — see §4.
- The 10th dimension (master-data quality) carries no `rank` field,
  since it is a binary flag, not a ranked magnitude.

## 8. Tests executed and results

- **69 new unconditional tests, plus 2 extending a pre-existing file**,
  all passing:
  - `tests/product-segmentation.test.ts`, `tests/product-revenue.test.ts`,
    `tests/product-insights.test.ts`,
    `tests/product-commercial-health.test.ts`, `tests/product-purchasing.test.ts`
    — full coverage of the five new pure modules.
  - `tests/product-intelligence-access.test.ts` — 4 access-control
    tests exercising the real auth-boundary functions directly.
  - `tests/reporting-filters.test.ts` — 2 new dedicated test cases for
    the three new `ReportFilters` fields, plus the regression fix (§5).
- **A new gated DB-integration test file**
  (`tests/product-intelligence-db.integration.test.ts`,
  `RUN_DB_INTEGRATION_TESTS=1`, 14 tests) covering all 10 overview
  dimensions plus both composite-assembly functions, with dedicated
  sections for the single- vs. multi-product attribution rule (§3) and
  the `DispatchRecord.createdAt`-based fix (§4). Confirmed to self-skip
  cleanly with `RUN_DB_INTEGRATION_TESTS=1` set and no `DATABASE_URL`
  present — not actually run against a real database from inside this
  sandbox.
- **Full-project regression**: `npx vitest run` — 765 passed, 145
  skipped, 0 failed (up from 696 passed / 131 skipped after Milestone
  13 — net +69 passed / +14 skipped, all new M14 tests). **Zero
  regressions in any pre-existing test** — the one pre-existing test
  that would have regressed (`tests/reporting-filters.test.ts`) was
  caught and properly fixed, as detailed in §5.

## 9. Honest `tsc` / lint / build results

- **`npx eslint .`** — clean across the whole project, including every
  file this milestone added or edited.
- **`npx tsc --noEmit`** — 630 errors (up from 569 after Milestone 13).
  The +61 isolate entirely to this milestone's five new Prisma-backed
  query/composite modules plus the one new DB-integration test file,
  every one falling into the same pre-existing, sandbox-
  `@prisma/client`-stub categories (`TS2694`/`TS7006`/`TS2305`, plus
  the `TS2322`/`TS2345`/`TS2339` cascade from the stub's `{}`-typed
  JSON/aggregate fields) already documented in every prior milestone's
  own round. Confirmed by grep that this milestone's own new page and
  API-route files, and all five new pure modules, carry **zero** type
  errors — the noise isolates entirely to the five new Prisma-backed
  modules and the one DB-integration test file. The one new error
  shape in that test file (`TS7006` implicit-any on a callback
  parameter) was confirmed identical to an already-shipped error at
  the same code pattern in `tests/customer-intelligence-db.integration.test.ts`.
- **`npx prisma validate` / `npx prisma generate`** — could not run.
  Confirmed by direct reproduction this round (including past the
  `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` checksum-bypass env var) to
  be the identical `binaries.prisma.sh` 403-Forbidden network-egress
  block documented since Milestone 4 — the actual engine binary itself
  cannot be downloaded in this sandbox, not merely its checksum.
- **`npm run build`** — fails at the identical, pre-existing
  `next/font/google` Google Fonts network block, confirmed unrelated to
  any file this milestone touched (`app/layout.tsx` itself is untouched
  by M14; the failure occurs during root-layout module evaluation,
  before any `/products` or `/reports` route is ever reached).
- **Not run in this sandbox**: `npx prisma generate`/`validate`, and
  this milestone's gated DB-integration tests against a real database.

## 10. Non-goals honored

No schema migration was introduced. No parallel copy of business data
was created — every new query reads the same tables M1–M13 already
write to. No composite score, tier, or product classification was
added to the management overview. Product matching is never done by
description similarity, only exact SAP item code. No claim/credit-note
figure was ever split pro-rata across products on a multi-product
record.

## Files changed

See `CHANGES.md`'s Milestone 14 section for the complete file-by-file
list: 11 new `lib/reporting/` files plus 1 additive edit to an existing
M11 file, 4 new API routes, 2 new UI pages plus 2 additive edits to
existing pages, 7 new test files plus 1 additive edit to an existing
test file, and this documentation set.

## Exact Windows PowerShell commands

See `SETUP-WINDOWS.md` §31 for the full, copy-pasteable sequence: no
migration to apply, regenerating the Prisma client, running the 7 new
unconditional test files, the gated DB-integration test file and its
preconditions, and a 9-step manual test script covering both new
surfaces and CSV export.
