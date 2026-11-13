# Milestone 13 Delivery Report — Customer Intelligence

Built from your attached full specification, under your explicit
implementation authorization — the document titled "Willsgrove
SalesFlow — Milestone 13: Customer Intelligence (FULL IMPLEMENTATION
AUTHORISED)," containing the literal instruction: "I explicitly
authorise you to implement Milestone 13 (M13: Customer Intelligence) in
full. This is implementation approval, not another specification
exercise." This report is the spec-structured record of what was built
and the honest state of verification — see `docs/milestones/PROGRESS.md`'s
Milestone 13 section for the full design-decision rationale this report
summarizes, and `docs/milestones/m13-metric-definitions.md` for the
authoritative definition of every figure this surface shows.

## 1. Scope recap

Two new, read-only reporting surfaces over existing M1/M5/M6A/M6B/M11/
M12 data — **zero schema changes**:

1. A **Customer 360 profile** (`/customers/[id]`), open to **all three
   roles** — the first Customer Intelligence surface with no management
   restriction, modeled on `app/orders/[id]/page.tsx`'s own
   no-role-redirect precedent.
2. A **management-only customer-intelligence overview**
   (`/reports/customer-intelligence`), ranking every eligible customer
   independently by SAP invoice line value (per currency), purchase
   frequency, and recency, plus a calculated open-claims count — **no
   composite score, no tier, no churn label**, per explicit instruction.

The authorization document was exhaustive and prescriptive (testing
requirements, documentation requirements, final-validation requirements,
and delivery requirements all specified in detail), so this round
proceeded directly to full implementation rather than a further
clarification pass, with judgment calls on the genuinely small remaining
gaps documented below and in PROGRESS.md.

## 2. What was actually built

### Customer 360 profile

Composes, for one customer: account identity; SAP invoice line value by
currency (never summed across currency); invoice history (first/last
qualifying invoice, days since last, average inter-purchase interval);
product purchasing (SAP item code, product-master match status/
category, quantity by unit of measure, value by currency, purchase
frequency as distinct-invoice count, last-purchased date); lost sales;
commercial health (claims raised/open-as-of-reporting-date/exposure-by-
currency, returns by `ReturnCondition`, actual credit notes in-period
vs. all-time-cumulative); delivery outcomes in their **own** section,
explicitly labelled "operational signal, not a commercial dispute" so
it is never read as a commercial figure; orders with salesperson-
attribution breakdown; quotations (no classification, by explicit
scope); and a data-quality summary with a legend.

### Management customer-intelligence overview

Ranks every eligible customer by three independent dimensions — SAP
invoice line value (within each currency, never across), purchase
frequency, and days since last qualifying invoice — plus a calculated
open-claims count as of the reporting date. A minimum-activity toggle
(default **OFF** — every eligible customer shown, including those with
zero qualifying invoices in the selected period) reuses the exact
existing period-toggle `Link`-pair pattern already established on
`app/reports/management/[reportId]/page.tsx`'s `operational-summary`
report, rather than extending `ReportFilterBar` with a bespoke boolean
control that component's own doc comment explicitly discourages ("a
dropdown that would silently do nothing is worse than no dropdown at
all"). Pagination for the screen is applied in memory over the already-
ranked full result set (never re-queried per page); the CSV export
deliberately skips pagination and exports every filtered customer, per
the spec's own instruction.

### New `lib/reporting/` modules

Same pure/Prisma-backed split every prior reporting milestone (M11,
M12) established:

- **`customer-revenue.ts`** (pure) / **`customer-revenue-queries.ts`**
  (Prisma-backed) — the customer-keyed twin of M12's `sales-revenue.ts`,
  reusing its `currencyKey`/`sumMoneyRows`/`UNKNOWN_CURRENCY` rather
  than reimplementing currency normalization. `customer-revenue-queries.ts`
  also owns the management overview's single full-population query
  (`getCustomerIntelligenceOverview`) and the profile's own revenue/
  history section (`getCustomerRevenueProfile`).
- **`customer-purchasing.ts`** (pure) / **`customer-purchasing-queries.ts`**
  (Prisma-backed) — four deliberately separate purchasing metrics,
  replacing an earlier, rejected `SUM(quantityInvoiced / lineTotal)`
  "average price" design.
- **`customer-recency.ts`** (pure, no Prisma-backed counterpart needed)
  — the as-of-date resolution rule and recency arithmetic.
- **`customer-segmentation.ts`** (pure) — `rankByValue`, the ranking
  primitive used for all three overview dimensions.
- **`customer-commercial-health-queries.ts`** (Prisma-backed) — claims/
  returns/credit-notes/delivery-outcomes for one customer, reusing
  `lib/invoice-claims/financial.ts`'s `computeExposureByCurrency`
  verbatim.
- **`customer-insights-queries.ts`** (Prisma-backed, composite) — the
  single `getCustomerProfile` function both the profile page and its
  export route call.
- **`customer-activity-queries.ts`** (M12 file) and **`filters.ts`** —
  small, backward-compatible additive extensions shared by the modules
  above.

## 3. The credit-note union path: closing a real gap in M6A/M6B's own figure

`lib/invoice-claims/financial.ts`'s `computeExposureByCurrency` (M6A/
M6B) is claim-centric — it walks `CreditNote` rows reachable through a
claim. A credit note can also be recorded with **no claim at all**,
directly against an invoice (`claimId: null`, via `lib/returns-credits/plan-import.ts`'s
own CSV match path), and that path is invisible to a claim-centric
walk. `getCustomerCommercialHealth` closes this gap for the customer-
scoped figure with a single query spanning both branches —
`OR: [{ claim: { customerId } }, { claimId: null, sapInvoice: { matchedCustomerId: customerId } }]`
— mutually exclusive by construction (one branch requires a linked
claim, the other requires `claimId: null`), so neither branch can
double-count a note the other already counted. This figure is reported
separately from, and must never be added to, M6A/M6B's own claim-
centric `actualSapCreditedAmount` — see `docs/milestones/m13-metric-definitions.md`
§7 for the explicit warning.

## 4. A genuine coverage gap self-caught mid-round

While finishing `tests/customer-intelligence-db.integration.test.ts`,
re-reading the file's own top-of-file doc comment against its actual
`describe` sections found that it claimed "Returns grouped by actual
return condition" coverage that did not yet exist — only the credit-
note union-path test had been written. This was a real gap between
documentation and implementation, not a pre-existing sandbox
limitation, caught before any user or test run surfaced it (there was
nothing to fail — the section simply didn't exist yet). Fixed before
delivery: extracted the shared claim-driving logic into a
`driveClaimToApproved()` helper (shared with the existing credit-note
test section, avoiding duplicated claim-lifecycle boilerplate), then
added the actually-missing test section, calling the real
`recordClaimReturn()` twice (`GOOD_RESALABLE` and `DAMAGED`) and
asserting `getCustomerCommercialHealth(...).returns.inPeriodByCondition`
reflects both.

## 5. Access-control tests: a deliberate departure from Milestone 11's own precedent

`tests/reporting-db.integration.test.ts` (M11) explicitly defers role-
gating 403 tests as "already covered elsewhere." This milestone's own
authorization explicitly and specifically requires these exact
assertions, so `tests/customer-intelligence-access.test.ts` was written
as a new, unconditional (no database needed) test file — mocking only
the external session-resolution boundary (`next/headers`'s `cookies()`,
`lib/auth/session.ts`'s `resolveSession`) via `vi.mock`, while
exercising the REAL, unmodified `requireUserOrResponse()`/
`requireManagementReportAccess()` functions every M13 route actually
calls. 5 tests, all passing: unauthenticated → 401 on both surfaces;
`SALESPERSON` → allowed on the profile, 403 on the overview;
`SALES_MANAGER`/`ADMINISTRATOR` → allowed on both; `isValidId` rejects
malformed customer ids.

## 6. Role / permission matrix

| Surface | Route(s) | Access |
|---|---|---|
| Customer 360 profile | `app/customers/[id]/page.tsx`, `app/api/customers/[id]/profile/route.ts`, `.../export/route.ts` | All three roles (`requireUserOrResponse()`, no role list) |
| Management overview | `app/reports/customer-intelligence/page.tsx`, `app/api/reports/customer-intelligence/route.ts`, `.../export/route.ts` | `SALES_MANAGER`/`ADMINISTRATOR` only (`requireManagementReportAccess`) |

Enforced server-side in every route; the page-level redirect for a
`SALESPERSON` on the overview is a UX convenience only, never the
security boundary — the same standing rule every M11/M12 management
report already follows.

## 7. Documented scope decisions

- No schema migration — every M13 figure is derived live from existing
  tables/columns.
- No composite score, no tier, no churn label, no percentile
  segmentation on the management overview — an explicit instruction;
  `customer-segmentation.ts`'s own top comment states this so a future
  round doesn't quietly add one without a fresh decision.
- The management overview's minimum-activity toggle defaults to OFF.
- `getCustomerProductPurchasing`/`getCustomerCommercialHealth`/
  `getCustomerRevenueProfile` apply only `dateFrom`/`dateTo`/
  `includeDemo` (and, for the overview, `currency`) — none of
  `productId`/`orderStatus`/`quotationStatus`/`fulfilmentStatus`/
  `claimStatus`/`communicationStatus` is wired into any M13 query,
  documented in `m13-metric-definitions.md` §9 rather than silently
  guessed at.
- Quotations on the Customer 360 profile carry no classification or
  health signal of their own this milestone — listed for reference
  only.

## 8. Tests executed and results

- **39 new unconditional tests**, all passing:
  - `tests/customer-revenue.test.ts`, `tests/customer-purchasing.test.ts`,
    `tests/customer-recency.test.ts`, `tests/customer-segmentation.test.ts`
    — full coverage of the four new pure modules.
  - `tests/customer-intelligence-access.test.ts` — 5 access-control
    tests exercising the real auth-boundary functions directly (see §5).
- **A new gated DB-integration test file**
  (`tests/customer-intelligence-db.integration.test.ts`,
  `RUN_DB_INTEGRATION_TESTS=1`, 13 tests) covering: qualifying-invoice
  rules at customer-level grouping; the credit-note union path's
  non-double-counting (verified via a cumulative lower-bound assertion
  against seeded demo data); the open-claims-count as-of approximation;
  historical as-of-date reproducibility; product-purchasing query-layer
  wiring; returns grouped by condition (§4); and the management
  overview's minimum-activity toggle. Confirmed to self-skip cleanly
  with `RUN_DB_INTEGRATION_TESTS=1` set and no `DATABASE_URL` present —
  not actually run against a real database from inside this sandbox.
- **Full-project regression**: `npx vitest run` — 696 passed, 131
  skipped, 0 failed (up from 657 passed / 118 skipped after Milestone
  12 — net +39 passed / +13 skipped, all new M13 tests). **Zero
  regressions in any pre-existing test.**

## 9. Honest `tsc` / lint / build results

- **`npx eslint .`** — clean across the whole project, including every
  file this milestone added or edited.
- **`npx tsc --noEmit`** — 569 errors (up from 532 after Milestone 12).
  The +37 break down exactly as `customer-revenue-queries.ts` (12) +
  `customer-purchasing-queries.ts` (7) + `customer-commercial-health-queries.ts`
  (3) + `customer-insights-queries.ts` (14) + one new `TS7006` in
  `tests/customer-intelligence-db.integration.test.ts` (1) = 37, every
  one falling into the same three already-documented sandbox
  `@prisma/client`-stub categories (`TS2694`/`TS7006`/`TS2305`, plus the
  `TS2345`/`TS2322` cascade from the stub's `{}`-typed JSON/aggregate
  fields — the same cascade already present in M12's own
  `lib/quotations/create.ts`/`lib/reporting/sales-performance.ts`).
  Confirmed by grep that this milestone's own new page and API-route
  files, and all four new pure modules, carry **zero** type errors —
  the noise isolates entirely to the four new Prisma-backed query/
  composite modules and the one DB-integration test file.
- **`npx prisma validate` / `npx prisma generate`** — could not run.
  Confirmed by direct reproduction this round (including past the
  `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` checksum-bypass env var) to
  be the identical `binaries.prisma.sh` 403-Forbidden network-egress
  block documented since Milestone 4 — the actual engine binary itself
  cannot be downloaded in this sandbox, not merely its checksum.
- **`npm run build`** — fails at the identical, pre-existing
  `next/font/google` Google Fonts network block, confirmed unrelated to
  any file this milestone touched (`app/layout.tsx` itself is untouched
  by M13).
- **Not run in this sandbox**: `npx prisma generate`/`validate`, and
  this milestone's gated DB-integration tests against a real database.

## 10. Non-goals honored

No schema migration was introduced. No parallel copy of business data
was created — every new query reads the same tables M1–M12 already
write to. No composite score, tier, or churn label was added to the
management overview. "SAP invoice line value" is never called
"revenue," matching M12's own established labelling rule. Delivery
outcomes are never combined with the commercial (claims/returns/
credit-note) figures on the Customer 360 profile.

## Files changed

See `CHANGES.md`'s Milestone 13 section for the complete file-by-file
list: 9 new `lib/reporting/` files plus 2 small additive edits to
existing M12 files, 4 new API routes, 2 new UI pages plus 2 additive
edits to existing pages, 6 new test files, and this documentation set.

## Exact Windows PowerShell commands

See `SETUP-WINDOWS.md` §30 for the full, copy-pasteable sequence: no
migration to apply, regenerating the Prisma client, running the 5 new
unconditional test files, the gated DB-integration test file and its
preconditions, and a 9-step manual test script covering both new
surfaces, the minimum-activity toggle, the credit-note union figures,
and CSV export.
