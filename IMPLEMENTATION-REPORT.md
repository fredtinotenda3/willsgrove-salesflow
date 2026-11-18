# Implementation Report: Management Analytics, Claims Standardisation, Delivery Control and Complete Delivered History

Scope: enhancement to the existing Willsgrove SalesFlow architecture — a Prisma runtime bug fix, real analytical rendering for the Management Reports module, standardisation of invoice-claim rejection reasons, connecting those reasons to Lost Sales analytics, and a dedicated Delivered Orders history page. No order-lifecycle, picking/dispatch, or invoice-reconciliation business rule was changed. **Zero Prisma schema/migration changes were required or made this round.** No dependency was added, removed, or upgraded.

This report **replaces** the repository's previous `IMPLEMENTATION-REPORT.md` (which covered an earlier, unrelated round — "Deep Chart Intelligence, Product-Level Breakdown and Rich Tooltips"). It does not append to it.

---

## 1. Prisma error root cause (Part 1)

**Reported error:** a `PrismaClientValidationError: Unknown argument isDemo` thrown from `lib/reporting/product-demand-queries.ts`, surfacing on the Product Intelligence pages whenever their lost-sales figures were computed with the demo-exclusion filter (the default).

**Root cause:** `getProductLostSalesSummary` and `getProductLostSalesRanking` both called `prisma.lostSaleRecord.findMany({ where: { ...demoWhere(filters), ... } })`, spreading `demoWhere()`'s `{ isDemo: false }` (or `{}`) at the **top level** of the `where` clause. `LostSaleRecord` itself has **no `isDemo` column** — only its `unfulfilledDemand` relation does (`UnfulfilledDemand.isDemo`, see `prisma/schema.prisma` line ~1774 vs. the `UnfulfilledDemand` model). Every other query in the codebase that filters `LostSaleRecord` by demo status does so correctly, nested inside the relation filter (e.g. `lib/reporting/customer-insights-queries.ts`: `unfulfilledDemand: { ...demo, customerId }`) — these two functions were the only call sites that got it wrong.

**Fix:** moved the demo filter into the nested `unfulfilledDemand: { isDemo: ... }` relation filter at both call sites, matching the pattern already used everywhere else. No schema change — this was a pure application-layer bug in the `where` clause shape.

**Files changed:** `lib/reporting/product-demand-queries.ts`.

**Regression test:** `tests/product-intelligence-db.integration.test.ts` — `"regression: getProductLostSalesRanking/getProductLostSalesSummary do not throw PrismaClientValidationError with the DEFAULT (demo-excluded) filter set, and correctly exclude a demo-only confirmed lost sale"`. This both reproduces the exact reported failure mode and asserts the demo-exclusion/-inclusion behavior is still correct after the fix.

---

## 2. Management Reports audited (Part 2)

Every page under `app/reports/` was read and classified:

| Report | Kind | Verdict |
|---|---|---|
| `operational-summary`, `quotations-performance`, `lost-sales`, `invoice-claims-exposure` (all under `app/reports/management/[reportId]/page.tsx`) | SUMMARY | **Defective** — rendered via a generic `flattenToKeyValueRows` flat key→value table. This was the actual, isolated source of the "JSON-like information" defect. |
| `outstanding-orders`, `awaiting-fulfilment`, `picking-shortages`, `delivery-exceptions`, `communication-failures` (same page, LIST kind) | LIST | Paginated and correctly scoped, but offered **no distribution over the full matching set** — only the current page of raw rows. |
| `customer-intelligence`, `decision-intelligence`, `financial-exposure`, `fulfilment`, `pipeline`, `sales-performance`, `communications` | — | Already real analytical pages (ranked tables, rate stats, `BarRow` breakdowns) from earlier M11–M15 builds. No changes needed. |
| `product-intelligence` | — | Deliberately built (M14) as 10 independent, clearly-labeled ranked tables rather than the shared `BarRow`/`MetricCard` components. This already satisfies the spec's intent (no composite/invented score, every number traceable to its contributing rows) via a different, equally valid presentation. **Left unchanged** — a considered decision, not an oversight. |

Net: the defect was real but narrow — one rendering path on one page, reused across 4 report IDs — plus a genuine gap (no full-dataset breakdown) on the 5 LIST reports.

---

## 3. Analytics implemented (Part 2)

### SUMMARY reports — real presentation, zero new business logic
Built `app/reports/management/_components/summary-sections.tsx`: pure-presentational React Server Components (`PipelineFunnelSections`, `FulfilmentSections`, `CommunicationsSections`, `OperationalSummarySections`, `FinancialExposureSections`, `QuotationsPerformanceSections`, `LostSalesSections`) that render the **same already-computed, already-correct** aggregate payload each report was already producing — via `MetricCard`/`RateStat`/`BarRow`/ranked lists instead of a flat table. No new query, no new metric, no invented statistic. `FinancialExposureSections` is shared: used standalone for `invoice-claims-exposure` and embedded inside `OperationalSummarySections` (since `operational-summary.financial` and `invoice-claims-exposure`'s whole payload are the identical `FinancialExposureReport` type). `app/reports/management/[reportId]/page.tsx` now dispatches to the matching component per `reportId` instead of flattening.

### LIST reports — genuine full-dataset breakdowns
For each of the 5 LIST reports, the inline Prisma `where` was refactored into a named `buildXxxWhere(filters)` helper, reused by **both** the existing paginated list query and a new sibling `getXxxBreakdown(filters)` — so the breakdown and the list can never disagree about which rows are in scope (same `where`, same filters, computed in the same `Promise.all`):

- `getOutstandingOrdersBreakdown` / `getAwaitingFulfilmentBreakdown` → `getOrderStatusBreakdown` (shared): counts by order status via `prisma.customerOrder.groupBy`, plus `avgDaysOutstanding` computed in JS from each matching order's own `receivedAt` (mirroring `lib/reporting/sales-pipeline.ts`'s `averageDaysBetween` — no SQL `NOW()-receivedAt` aggregate exists through Prisma) and an explicit `sampleSize`.
- `getPickingShortagesBreakdown`: top-product ranking by total unavailable quantity, aggregated in JS (via `sumDecimalStrings`/`formatScaledDecimal` from `lib/fulfilment/decimal.ts` — the same decimal-summing convention used elsewhere) because the product dimension lives on `OrderLine`, not `PickingLine`.
- `getDeliveryExceptionsBreakdown`: counts by `DeliveryOutcome` via `groupBy`.
- `getCommunicationFailuresBreakdown`: counts by channel and by message type via `groupBy`.

`ManagementReportResult`'s list variant was extended additively (`{ kind: "list"; data: PaginatedResult<unknown>; breakdown: unknown }`); `PaginatedResult<T>` itself was left untouched. `runManagementReport` now runs each list query and its breakdown together via `Promise.all`. The page renders each breakdown via new components (`OrderStatusBreakdownSection`, `ProductShortageBreakdownSection`, `DeliveryOutcomeBreakdownSection`, `CommunicationFailureBreakdownSection`, all in `summary-sections.tsx`).

**No incompatible currency/UOM combining**: `QuotationsPerformanceSections` keeps per-currency value tables separate; `FinancialExposureSections` keeps Source A/Source B lost-sales figures side by side, never summed (matching the pre-existing codebase convention this spec requires). **No misleading small-sample statistics**: every rate/average is computed only from its own real `sampleSize`/count, never defaulted or interpolated. **Demo data excluded by default** throughout — every breakdown function receives the same `ReportFilters` (and therefore the same demo-exclusion) as its paired list query.

**Files changed:** `app/reports/management/_components/summary-sections.tsx` (new), `app/reports/management/[reportId]/page.tsx`, `lib/reporting/management-reports.ts`.

---

## 4. Delivery duplicate-prevention mechanism (Part 3)

Investigated and **verified already correctly implemented** by an earlier round (predates this engagement's work); no code changes were needed or made here.

- `InvoiceDeliveryRecord.sapInvoiceId` is `@unique` in `prisma/schema.prisma` — a **database-level** constraint, not just an application check, so a concurrent double-submit (two requests racing past an application-level check) is still rejected by Postgres itself.
- `lib/invoice-delivery/record-outcome.ts`'s `recordInvoiceDeliveryOutcome`: does a pre-check (`findUnique` on `sapInvoiceId`) for a clean `409` in the common non-racing case, then performs the actual insert plus (for `WITH_CLAIM`) every `InvoiceClaim` row inside a single `prisma.$transaction`, and separately catches the Postgres unique-violation code (`P2002`) in case the pre-check and the write race. Either path, exactly one outcome per invoice, and a `WITH_CLAIM` outcome's claim rows can never be created without their parent delivery record (or vice versa) because both are written in the same transaction.
- `lib/invoice-delivery/queries.ts` derives the `/invoice-reconciliation` page's "Delivered" status from the same `InvoiceDeliveryRecord` existence this constraint protects — UI and server enforcement agree by construction, not by convention.

No files changed for this part.

---

## 5. Standardised claim reasons (Part 4)

`lib/invoice-claims/validation.ts`'s `CLAIM_LINE_REASON_CATEGORIES` now exposes **exactly** the 8 spec-mandated options, in this exact order and wording, for the per-line claim-reason dropdown:

1. Price Claim
2. Poor Quality Product
3. Short Delivered
4. OverSupply
5. Expire
6. No Barcode
7. Barcode Scanning Problems
8. Duplicates

All 8 map to pre-existing `InvoiceClaimCategory` enum members (added additively by an earlier round's own migration) — **no schema/migration change was needed**, only the selectable set and display wording. This supersedes an earlier, different 10-option version (which included a typo, "BarCode Scabbing Problem"); the 2 now-unlisted legacy values (`PRODUCT_NOT_ORDERED`, `PRODUCT_NOT_DELIVERED`) and the typo-era values are deliberately **retained** in `CLAIM_LINE_REASON_CATEGORIES_ALL`/`CLAIM_LINE_REASON_CATEGORY_LABELS` so that any historical claim line written under the old wording still displays correctly — no silent data loss, no stored value rewritten.

This is a per-**line** field (`InvoiceClaimLine.reasonCategory`), independent of the claim-level `category` enum, so one claim/invoice can legitimately mix reasons across its lines.

**Scope decision carried forward and documented here:** `reasonCategory` remains optional at the server/schema level (not made mandatory), consistent with this engagement's "enhancement only, no new validation that could reject previously-valid historical data" posture — flagged again in §11 (Remaining limitations).

**Files changed:** `lib/invoice-claims/validation.ts`, `tests/invoice-claims.test.ts`.

---

## 6. Lost-sales integration (Part 5)

Built `lib/invoice-claims/reason-analytics.ts`, answering the spec's named questions for `InvoiceClaimLine.reasonCategory` (the field Part 4 standardised): claim counts and claimed quantity per reason, repeat-affected products/customers, and informational financial exposure per reason — **kept per-currency, never summed across currencies**, matching `lib/reporting/financial-exposure.ts`'s own `computeExposureByCurrency` convention.

Critically, this module is **deliberately never folded into** `lib/lost-sales/queries.ts`'s confirmed-lost-value figures: a claim is a customer-reported dispute, not an automatic confirmed loss (the spec is explicit: a rejection reason must not be auto-classified as confirmed lost revenue — a Price Claim may resolve via price correction, Short Delivered may be fulfilled later, etc.). The module's own exports are named to keep this distinction unmistakable at the type level: `claimLineCount`/`claimedQuantity` (what was disputed) and `informationalExposureByCurrency` (the customer's claimed value, informational only) vs. `resolvedCount`/`outstandingCount` (the claim's own investigation status — not a financial-loss determination; `ClaimResolution`/`CreditNote`/`ClaimReturn` remain the actual record of what financially happened).

Legacy claim lines written under the superseded 10-reason wording are included in their own explicit "Other (legacy reason)" row rather than being dropped — a historical claim's own data is never discarded from analytics. Surfaced on `app/lost-sales/analytics/page.tsx` alongside the existing Source A/Source B confirmed-loss figures, visually and typographically distinct from them.

**Files changed:** `lib/invoice-claims/reason-analytics.ts` (new), `app/lost-sales/analytics/page.tsx`, `tests/claim-reason-analytics-db.integration.test.ts`.

---

## 7. Delivered Orders history (Part 6)

New dedicated page at `/delivered-orders` plus a detail page at `/delivered-orders/[id]`, both linked from the sidebar.

- **`lib/delivered-orders/queries.ts`**: `listDeliveredOrders(filters, pagination)` and `getDeliveredOrderDetail(sapInvoiceId)`. "Delivered" is defined **identically** to `lib/invoice-delivery/queries.ts`'s existing derived status (a `SapInvoice` with a linked `InvoiceDeliveryRecord`) — the new page and the existing `/invoice-reconciliation` "Delivered" filter read the same underlying fact and can never disagree.
- **Filters**: customer, invoice number, PO reference, product, salesperson, driver, vehicle, delivery date range, outcome (No Claim / With Claim), and rejection-reason category (reusing Part 4's standardised 8).
- **Full lifecycle detail (A–H)**: purchase order → quotation → order → picking session(s) → dispatch(es) → physical delivery → invoice outcome/claims → durations between each stage. Durations (`DurationResult.milliseconds: number | null`) are explicitly `null` → rendered "Not Available" whenever either endpoint timestamp is missing — **never a fabricated zero**. Where an order went through multiple dispatches (e.g. a split delivery), the same driver/assistant appearing on more than one dispatch is de-duplicated in the people list rather than listed twice.
- Two distinct, pre-existing "delivery" concepts are kept correctly separated and both surfaced: `DeliveryRecord`/`DeliveryLine` (the older, per-dispatch physical truck/gate outcome) as the detail page's `physicalDelivery` sub-section, vs. `InvoiceDeliveryRecord`/`InvoiceClaim` (the newer, per-invoice reconciliation outcome from Part 3) as the top-level delivery outcome.

**Files changed:** `lib/delivered-orders/queries.ts` (new), `app/delivered-orders/page.tsx` (new), `app/delivered-orders/[id]/page.tsx` (new), `app/components/sidebar.tsx`, `tests/delivered-orders-db.integration.test.ts` (new).

**Post-delivery fix (`next build` failure on `/delivered-orders/[id]`):** the user's own production build (Windows, real Neon Postgres database, `npm run build`) reported `tsc`/`eslint`/`vitest` all clean against this delivery, but failed during static-page generation with: `Route "/delivered-orders/[id]": Next.js encountered uncached or runtime data during prerendering.` Root cause: this codebase runs with `cacheComponents: true` (`next.config.ts`), and **every** other authenticated page that reads the session and live DB data directly in the Server Component body (not through an API route) carries `export const instant = false;` as the documented escape hatch — confirmed present on `app/delivered-orders/page.tsx` (this feature's own list page, right next to the detail page) and on every other `[id]` detail page in the repo (`app/products/[id]/page.tsx`, `app/customers/[id]/page.tsx`, `app/orders/[id]/page.tsx`, `app/invoice-reconciliation/[id]/page.tsx`, etc.). The new `app/delivered-orders/[id]/page.tsx` was the one file in this delivery missing it. Added `export const instant = false;` to that file, matching the exact repo-wide convention and comment style (`app/page.tsx`'s own comment). Re-verified: `eslint` clean on the file, `tsc --noEmit` baseline unchanged (478/131/104/42/9/9/6, zero new errors). This sandbox still cannot run `next build` itself (no network access to Google Fonts — see §10/§11), so this fix is verified by direct comparison against the repo's own established, already-working pattern rather than by rerunning the build here; the user's own build log is the authority that this was in fact the failure's exact cause.

---

## 8. Database / schema changes

**None.** No `schema.prisma` edit and no new migration were made or are needed for any part of this round's scope — confirmed per-part above (Part 1 is a pure query-shape bug fix; Part 2 and Part 6 compose entirely from pre-existing models; Part 4 reuses an already-existing, already-migrated enum; Part 3 and Part 5 required no code changes to their respective models at all). The repository's standing additive-only migration policy was never invoked because nothing here required it.

---

## 9. Files changed

New files:
- `lib/delivered-orders/queries.ts`
- `app/delivered-orders/page.tsx`
- `app/delivered-orders/[id]/page.tsx`
- `tests/delivered-orders-db.integration.test.ts`
- `app/reports/management/_components/summary-sections.tsx`
- `lib/invoice-claims/reason-analytics.ts`
- `tests/claim-reason-analytics-db.integration.test.ts`

Modified files:
- `lib/reporting/product-demand-queries.ts` (Part 1)
- `tests/product-intelligence-db.integration.test.ts` (Part 1 regression test)
- `lib/invoice-claims/validation.ts` (Part 4)
- `tests/invoice-claims.test.ts` (Part 4)
- `app/lost-sales/analytics/page.tsx` (Part 5)
- `app/components/sidebar.tsx` (Part 6 nav entry)
- `app/reports/management/[reportId]/page.tsx` (Part 2)
- `lib/reporting/management-reports.ts` (Part 2)
- `tests/reporting-db.integration.test.ts` (Part 2 breakdown-function tests)
- `IMPLEMENTATION-REPORT.md` (this file — overwrites the previous round's report)

No file outside this list was touched. No migration file was added.

---

## 10. Tests executed and results

Run from the repository root, `/home/claude/work/round2/extract/willsgrove-salesflow-main`:

| Command | Result |
|---|---|
| `npx eslint .` | **Clean** — zero errors, zero warnings, full repository. |
| `npx tsc --noEmit` | **779 pre-existing errors** (478 × TS7006, 131 × TS2694, 104 × TS2339, 42 × TS2305, 9 × TS2345, 9 × TS2322, 6 × TS18046) — **zero new error categories**. This sandbox's `@prisma/client` install is a non-functional stub (confirmed and documented across this entire engagement), producing implicit-`any` and missing-namespace-member errors for any code touching real Prisma types/delegates. This round's edits legitimately added exactly **one** new instance of the already-existing `Prisma.CustomerOrderWhereInput` (TS2694) category — from splitting one inline `where` clause into two named helper functions plus one shared downstream type reference — confirmed by line-by-line review to be the same error shape occurring one additional time, not a new category. Every new TS7006 introduced by this round's own new `.map()`/`.sort()`/`.filter()`/`.reduce()` callbacks was fixed with explicit parameter type annotations, bringing TS7006 back down to its exact pre-existing baseline (478). |
| `npx vitest run` | **952 passed, 223 skipped** (87 test files: 60 passed, 27 skipped), 0 failed. |

**Honest sandbox-limitation note on the skipped tests:** every DB-integration test in this repository (including the new ones added this round — 5 in `tests/reporting-db.integration.test.ts`'s Section 3 for the new breakdown functions, plus the 4 in `tests/delivered-orders-db.integration.test.ts`, plus the regression test in `tests/product-intelligence-db.integration.test.ts` and the tests in `tests/claim-reason-analytics-db.integration.test.ts`) is written behind `describe.skipIf(!RUN_DB_INTEGRATION_TESTS)` and **skips cleanly** in this sandbox because no `DATABASE_URL` is configured here. They have **not been executed against a live database in this environment** — that is reported honestly, not claimed as "passing." They were written, reviewed line-by-line against the real exported function signatures and return-type shapes (confirmed via direct `grep`/`Read` of `lib/reporting/management-reports.ts` and `lib/delivered-orders/queries.ts`), and are ready to run the moment `DATABASE_URL` points at a real Postgres instance with the existing schema applied (see §12).

**New tests added this round, by area:**
- Part 1: 1 regression test (`tests/product-intelligence-db.integration.test.ts`).
- Part 2: 5 new tests in `tests/reporting-db.integration.test.ts` — one each for `getAwaitingFulfilmentBreakdown`, `getOutstandingOrdersBreakdown`, `getPickingShortagesBreakdown`, `getDeliveryExceptionsBreakdown`, `getCommunicationFailuresBreakdown`, each asserting the breakdown's counts sum to exactly the paired paginated list's own total (never disagree) rather than merely asserting the function runs without throwing.
- Part 4: new tests in `tests/invoice-claims.test.ts` for the 8-reason standardisation.
- Part 5: `tests/claim-reason-analytics-db.integration.test.ts` (new file).
- Part 6: `tests/delivered-orders-db.integration.test.ts` (new file, 4 tests) — list-filter correctness cross-checked against `getDeliveredSapInvoiceIds()`, full A–H detail assembly with people-de-duplication verification, "Not Available" (null) handling for every duration when a timestamp is missing, and the `null`-detail case for an invoice never given a delivery outcome.

**Not executed in this sandbox (environment limitation, not a code defect):**
- `npx prisma validate` / `npx prisma format`: fail immediately with `Missing required environment variable: DATABASE_URL` (this repo's `prisma.config.ts` requires it to even load); forcing a dummy `DATABASE_URL` instead hits the sandbox's network allowlist blocking the Prisma engine-binary CDN (`binaries.prisma.sh`, 403). Moot in any case: §8 confirms zero schema changes this round.
- `npx next build`: fails on this sandbox's network allowlist blocking `fonts.googleapis.com` (the project's `next/font/google` Geist fonts) — a pre-existing environment constraint unrelated to any change in this round. It also surfaced an unrelated, pre-existing Next.js CLI security-upgrade nudge; per this engagement's standing "no unnecessary upgrades" restriction, that was not acted on and is flagged for the user to decide on separately, outside this round's scope.

---

## 11. Remaining limitations

1. **`InvoiceClaimLine.reasonCategory` is not server-side-mandatory.** Carried forward from Part 4's original scope decision (documented there and here again): the field stays optional at the schema/validation level so that existing claim-creation flows and historical data are never retroactively invalidated. The UI dropdown only ever offers the 8 standardised values, but nothing currently prevents a claim line from being created with `reasonCategory: null` via a direct API call. If the business wants this made mandatory, that is a deliberate follow-up decision (likely with a data backfill plan for existing `null` rows) rather than something to slip in silently under this round's "enhancement only" instruction.
2. **Legacy claim-reason values remain live, not migrated.** `PRODUCT_NOT_ORDERED`/`PRODUCT_NOT_DELIVERED` and the typo-era wording are preserved for historical display (§5) rather than backfilled onto the new 8-value set. Any claim line still carrying one of these will keep showing under "Other (legacy reason)" in Part 5's analytics indefinitely, unless a one-time, approved data-migration/backfill is run.
3. **Sandbox `@prisma/client` stub noise.** As documented in §10, this environment's Prisma client install cannot produce real generated types, which is the source of all 779 `tsc` errors above (all seven categories pre-date this round). This is an environment artifact, not a defect in the delivered code — every file touched this round was manually checked line-by-line to confirm no *new* error category was introduced, only new instances within already-known categories (and in one case, TS7006, brought back down to the original baseline by adding explicit type annotations).
4. **No DB-integration test has been executed against a live database in this sandbox**, for the reason given in §10. They are believed correct from direct inspection of the real function signatures/return shapes they call, but "believed correct from inspection" is reported as exactly that, not as "passing."
5. **`next build` could not be run end-to-end here** (§10) due to this sandbox's network allowlist. `tsc --noEmit`, `eslint`, and `vitest` were used as the available proxy for build-time correctness; a real build (and the DB-integration suite) should both be run in CI or staging before this reaches production, per this engagement's standing verification bar.
6. **`product-intelligence`'s divergent presentation style was a deliberate choice, not a gap** (§2) — flagged here only so it is not mistaken for an oversight in a future review pass.

---

## 12. Windows PowerShell verification commands

Run from the project root in PowerShell:

```powershell
# Install (if not already) — unchanged, no new/updated dependency this round
npm install

# Type check
npx tsc --noEmit

# Lint
npx eslint .

# Full test suite (DB-integration tests will skip without DATABASE_URL)
npx vitest run

# To also execute the DB-integration tests, set DATABASE_URL first, e.g.:
$env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public"
$env:RUN_DB_INTEGRATION_TESTS = "1"
npx vitest run

# Schema sanity check (no changes expected — this should report the schema unchanged)
npx prisma validate

# Production build
npx next build
```

Expected results matching this report: `tsc` — the 779 pre-existing errors listed in §10 (none introduced by this round beyond the one documented new TS2694 instance); `eslint` — clean; `vitest` — 952 passed / 223 skipped without `DATABASE_URL`, or the same 952 plus however many of the DB-integration tests execute (and should pass) with it set.

---

## 13. Migration commands needing manual review or run

**None.** This round made no `schema.prisma` changes, so there is no new migration file and nothing to run or review here. The repository's existing migration history is untouched.
