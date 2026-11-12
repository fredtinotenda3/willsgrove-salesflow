# Milestone 11 Delivery Report — Operational Business Intelligence (BI)

Built from your attached 17-section full specification, delivered
silently per your "return only changed files" instruction, after four
approved `AskUserQuestion` decisions resolved the spec's own approval
gate (§0/§17). This report is the spec-structured record of what was
built and the honest state of verification — see
`docs/milestones/PROGRESS.md`'s Milestone 11 section for the full
design-decision rationale this report summarizes, and
`docs/milestones/m11-metric-definitions.md` for the authoritative
definition of every figure this surface shows.

## 1. Scope recap and the four approved architecture decisions

The spec's 17 numbered sections cover: repository verification (§1); the
core architectural objective of one reliable reporting layer that never
fabricates data and distinguishes actual/calculated/provisional/missing
values (§2); an operational dashboard (§3); sales pipeline/order
intelligence that avoids misleading cohort-mixed conversion rates (§4);
picking/fulfilment intelligence that never conflates dispatched with
delivered (§5); invoice claims/financial exposure that avoids
double-counting (§6); communications/exception monitoring (§7); reusable
filtering by date/customer/product/salesperson/status plus CSV export
(§8); named management reports (§9); server-side-only role permissions
(§10); data quality/performance (§11); professional UI/UX with
drill-down (§12); extensive testing requirements (§13); documentation
(§14); explicit non-goals — no M12+, no SAP replacement, no speculative
figures (§15); staged implementation A–I (§16); delivery as a zip (§17).

Four decisions were resolved via `AskUserQuestion` before implementation
began:

1. Both `app/page.tsx` and `app/reports/page.tsx`'s existing mock data
   are replaced with real M11-backed data.
2. The four operational views stay open to all three roles; the 9 named
   management reports are `SALES_MANAGER`/`ADMINISTRATOR`-only.
3. A real `salespersonId` column is added to `CustomerOrder` (additive
   migration), rather than approximating "salesperson" from
   `createdById`.
4. Exports are CSV plus browser-print, with no new PDF-generation
   dependency.

## 2. Architecture: one reporting layer, never a parallel source of truth

Every `lib/reporting/*.ts` function reads the same tables and calls the
same already-shipped lib functions as the rest of this project — M4's
lost-sales summary, M5's reconciliation reports, M6A's claims dashboard,
and M7's quotation dashboard counts are *reused as-is*, not
re-implemented. Nothing in this milestone invents a parallel copy of
business data. The one new piece of state is `CustomerOrder.salespersonId`
(§3 below) — everything else is a read-only view.

Every figure carries one of four data-quality labels (spec §2), defined
once in `lib/reporting/types.ts`'s `DataQuality`/`QualifiedMetric<T>` and
catalogued per-figure in `docs/milestones/m11-metric-definitions.md`:

- **Actual** — a plain count/sum/stored value with no derivation.
- **Calculated** — derived from two or more actual values.
- **Provisional** — real but expected to still change.
- **Missing** — reported honestly as absent, never defaulted to zero.

### The one genuinely nontrivial decision this round made

A status-equality filter (`orderStatus`/`fulfilmentStatus`/
`quotationStatus`/`claimStatus`/`communicationStatus`) is wired into a
report only when that report's own output does not already break every
row down by that exact status. Applying one to an aggregate that already
reports "N received, M approved, K rejected" would silently collapse
that breakdown to a single number already visible in the unfiltered
response. Concretely:

- **Applied for real**: `orderStatus` on `outstanding-orders`/
  `awaiting-fulfilment` (narrows *within* each report's own status
  definition via an `AND: [...]` array, never replaces it);
  `fulfilmentStatus` as `PickingSessionStatus` on `picking-shortages`;
  `fulfilmentStatus` as `DeliveryOutcome` on `delivery-exceptions`.
- **Deliberately not applied**: inside every aggregate function
  (`sales-pipeline`, `fulfilment-intelligence`, `communications-
  monitoring`, `financial-exposure`) and on the other 5 management
  reports, each already status-broken-down or a thin reuse of an
  already-independent dashboard.
- `fulfilmentStatus`/`communicationStatus` are **not centrally
  validated** in `lib/reporting/filters.ts`, because each maps onto more
  than one schema enum depending on which report consumes it. A value
  from the wrong enum for a given report is treated as "not applicable"
  — silently not applied, never a thrown error and never a filter that
  forces zero rows by accident (`applicableEnumFilter` in
  `lib/reporting/management-reports.ts`).

See `docs/milestones/m11-metric-definitions.md` §6 for the full,
one-time-documented rationale and per-report matrix.

## 3. Schema / migration change

Purely additive — one nullable column, two indexes, one FK, and a
one-time backfill of existing rows: `CustomerOrder.salespersonId String?`,
its `onDelete: Restrict` FK onto `User` (relation name
`OrderSalesperson`, distinct from `Quotation`'s own
`QuotationSalesperson` relation), `@@index([salespersonId])`, and
`CustomerOrder_isDemo_status_idx` on `(isDemo, status)` (the operational-
dashboard/pipeline reports' most common query shape). The migration
(`prisma/migrations/20261112080000_add_order_salesperson/migration.sql`)
backfills every pre-existing row with `UPDATE "CustomerOrder" SET
"salespersonId" = "createdById" WHERE "salespersonId" IS NULL` — there is
no reliable record of who the *actual* assigned salesperson was for
orders created before this migration, so `createdById` is used as the
best available, non-invented approximation, documented as such in the
migration's own comment. Every order created *after* this migration gets
a real, non-approximated value: `lib/orders.ts`'s `createOrderCore`
applies the identical `input.salespersonId ?? createdById` fallback for
a direct order creation, and `lib/quotations/convert-to-order.ts` now
threads the source quotation's own `salespersonId` through on
conversion, so pipeline attribution survives the whole funnel rather
than resetting to whoever clicked "Convert." No existing column,
constraint, or table is altered or dropped. `prisma migrate dev` cannot
run in this sandbox — see §9.

## 4. Sales pipeline / order intelligence (spec §4)

`lib/reporting/sales-pipeline.ts`'s `getSalesPipelineReport` covers the
full request→quotation→order funnel. Every rate divides two counts from
the *same, single cohort*, anchored to one date field — never two
independently-dated populations (the spec's own worked counter-example:
`(quotations issued this week) / (requests received this week)` is
meaningless, since a quotation issued this week was very possibly a
request received last week). Lifecycle-transition bottleneck averages
are computed only over records that actually have both of the relevant
timestamps, never padded with a null treated as zero.

## 5. Picking / fulfilment intelligence (spec §5)

`lib/reporting/fulfilment-intelligence.ts` reports six distinct
quantities, never blended into each other: ordered, available (what
picking actually found), shortage, dispatched, accepted/rejected (the
customer's own recorded response), and outstanding-in-transit (dispatched
with no delivery record yet — the figure that proves dispatched ≠
delivered). Rates (`pickingAvailabilityRatePercent`,
`deliveryAcceptanceRatePercent`) always divide two sums over the exact
same row set, with their own sample sizes reported alongside so a rate
from a handful of rows is never mistaken for a stable trend.

## 6. Invoice claims / financial exposure (spec §6)

`lib/reporting/financial-exposure.ts` wraps the existing M6A invoice-
claims dashboard and M5 invoice-reconciliation reports (both whole-
business, right-now totals by their own original design — only
`includeDemo` affects them) and adds a genuinely date/customer-filterable
returns-and-credit-notes summary. `exposureByCurrency[]` is kept strictly
per-currency, never summed across currencies (this project's real-world
currencies are USD and ZWG). The only money figure ever reported as
"actually credited" is a live sum of real `CreditNote` rows;
`creditNotesIssuedCount` (a document count) is never added to a money
amount.

## 7. Communications / exception monitoring (spec §7)

`lib/reporting/communications-monitoring.ts`'s `intake.totalReceived`
and `intake.byChannel[]` always share the identical `where` clause —
structurally guaranteed never to drift apart. `outbound
.deliveryReceiptsSupported` is always `false`: neither this project's
mock adapters nor its real email/WhatsApp adapters (M10) model a
provider-side delivery receipt distinct from "the send attempt itself
succeeded or failed," so `sent`/`failed` are reported honestly under
their own name rather than mislabelled "delivered."

## 8. Reusable filtering and CSV export (spec §8)

`lib/reporting/filters.ts`'s `parseReportFilters`/`parsePagination` is
the one central, synchronous validation point every report route calls
before touching Prisma — a malformed query string becomes a clean 400
here, never an unhandled 500 downstream. `orderStatus`/
`quotationStatus`/`claimStatus` are validated against their real schema
enums; `fulfilmentStatus`/`communicationStatus` pass through unvalidated
(§2 above). `app/reports/_components/filter-bar.tsx`'s `ReportFilterBar`
is a plain `<form method="GET">` with zero client JS, reused by every
report page, each opting in only to the filters its own report actually
honors. `lib/reporting/export-csv.ts`'s `flattenToKeyValueRows` is reused
directly by the management-report detail UI, so the on-screen table and
the CSV export are guaranteed to show literally the same numbers through
the same function. Customer/salesperson dropdowns are capped at 500 rows
(`FILTER_OPTION_CAP`); Product gets a plain exact-ID text input instead
of a dropdown (7,500+ catalogue rows), per the spec's explicit "never
load an entire table into the browser."

## 9. The 9 named management reports (spec §9)

| Report id | Shape | What it is |
|---|---|---|
| `operational-summary` | summary | Daily/weekly/monthly rollup — one function parameterized by period, never three near-duplicate functions |
| `outstanding-orders` | list | Orders not `CANCELLED`/`REJECTED` and not yet confirmed fully delivered |
| `awaiting-fulfilment` | list | Orders `APPROVED`/`PICKING` with no dispatch that has `DEPARTED`/`DELIVERED` yet |
| `picking-shortages` | list | `PickingLine` rows where `unavailableQuantity > 0` |
| `delivery-exceptions` | list | `DeliveryRecord` rows `PARTIALLY_REJECTED`/`FULLY_REJECTED` |
| `quotations-performance` | summary | M7's all-time quotation dashboard counts + the period-scoped funnel |
| `lost-sales` | summary | M4's own summary, reused as-is |
| `invoice-claims-exposure` | summary | §6's `getFinancialExposureReport` |
| `communication-failures` | list | `OutboundMessage` rows `FAILED` |

`lib/reporting/management-reports.ts`'s `runManagementReport` dispatches
by id; `isManagementReportId` narrows an untrusted route param before it
reaches that dispatcher.

## 10. Role / permission matrix (spec §10, server-side only)

| Surface | SALESPERSON | SALES_MANAGER | ADMINISTRATOR |
|---|---|---|---|
| `/reports` hub, all 4 operational views, their API routes + CSV export | ✅ | ✅ | ✅ |
| Home dashboard (`/`) | ✅ | ✅ | ✅ |
| `/reports/management` catalogue + all 9 reports + their API routes | ❌ | ✅ | ✅ |

Enforced via `lib/reporting/access.ts`'s `requireManagementReportAccess`
(= `requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"])`), called
by every `/api/reports/management/*` route **and** independently by
`app/reports/management/page.tsx`/`[reportId]/page.tsx` themselves
(redirecting to `/reports`) — matching the existing
`app/approvals/policies/page.tsx` precedent exactly, so the restriction
holds even if someone navigates straight to a management-report URL.
The 4 operational views and their routes call only
`requireUserOrResponse()` with no role argument — open to any
authenticated role, per decision 2 (§1).

## 11. Data quality / performance (spec §11)

Every report defaults to `includeDemo: false`
(`lib/reporting/filters.ts`'s `demoWhere`), matching every dashboard
already built in prior milestones. Pagination is capped at
`REPORT_MAX_PAGE_SIZE` (200 rows) server-side, rejecting an out-of-range
`pageSize` rather than silently clamping it. The new
`CustomerOrder_isDemo_status_idx` index supports the operational-
dashboard/pipeline reports' most common query shape.

## 12. UI / UX (spec §12)

- `app/reports/page.tsx` — reports hub: 4 operational-view cards for
  every role, plus a management-catalogue card for
  `SALES_MANAGER`/`ADMINISTRATOR` only.
- `app/reports/pipeline/page.tsx`, `.../fulfilment/page.tsx`,
  `.../financial-exposure/page.tsx`, `.../communications/page.tsx` — the
  4 operational views.
- `app/reports/management/page.tsx` — the 9-report catalogue, role-gated.
- `app/reports/management/[reportId]/page.tsx` — one generic viewer for
  all 9 reports: a per-report filter config stating exactly which
  filters apply and why, a period selector for `operational-summary`,
  and either a metric/value table (summary-kind) or a paginated table
  with order drill-down links (list-kind).
- `app/page.tsx` — home dashboard, real data replacing the previous
  mock.
- Shared building blocks: `app/reports/_components/{ui,filter-bar,
  search-params}.tsx` — reused by every page rather than each page
  inventing its own chrome.

Every list-kind report's first column links to `/orders/[id]` for a real
order wherever the row has one.

## 13. Tests executed and results (spec §13)

- **21 unconditional unit tests**, all passing
  (`tests/reporting-filters.test.ts`) — covering full/partial/malformed
  filter parsing, the centrally-validated `orderStatus`/
  `quotationStatus`/`claimStatus` enums, the deliberately-unvalidated
  `fulfilmentStatus`/`communicationStatus` pass-through, pagination
  bounds, and the date-range helpers' inclusive/exclusive-bound
  behaviour. This is the one `lib/reporting/*.ts` file with no
  `@prisma/client` dependency anywhere in its import graph, so it alone
  can run here without this sandbox's Prisma blocker.
- **14 gated DB-integration tests**
  (`tests/reporting-db.integration.test.ts`, `RUN_DB_INTEGRATION_TESTS`)
  — `export-csv` helpers; the sales-pipeline/fulfilment-intelligence
  quantity vocabulary (including the dispatched-≠-delivered invariant);
  the 4 list-reports' status-filter applicability (including the
  "value from the wrong enum is a silent no-op" case), demo-data
  exclusion, and pagination; communications-monitoring consistency; and
  financial-exposure's never-summed per-currency exposure. Correctly
  self-skipping in this sandbox (no `DATABASE_URL`) — not yet run
  against a real database. One fixture-design bug was caught and fixed
  before any test ran: 4 tests originally used a full
  pick→complete→authorize fixture for assertions that actually needed
  an order parked at `APPROVED`/`PICKING`, which `authorizePickingSession`
  always moves past regardless of shortage — replaced with a direct
  `createOrderWithStatus` fixture that bypasses the picking lifecycle
  entirely.
- **Full-project regression**: `npx vitest run` — 613 passed, 112
  skipped (35 files passed, 16 skipped, 51 total). Zero regressions in
  any pre-existing test.

## 14. Honest `tsc` / lint / build results

- **`npx eslint .`** (`npm run lint`) — clean across the whole project,
  including every file this milestone added or edited.
- **`npx tsc --noEmit`** — 488 errors, up from 412 at the end of
  Milestone 10 (+76, all 76 inside this milestone's own genuinely new
  files: `lib/reporting/*.ts`, `app/reports/*`, `app/api/reports/*`,
  `tests/reporting-*.test.ts`). Every one of the 76 individually
  checked by error code: 57 `TS7006` (implicit `any` from an untyped
  Prisma delegate result), 14 `TS2694` (a `Prisma.*WhereInput`/
  `*Select`/`*GetPayload` member the stale generated client doesn't know
  exists), 5 `TS2305` (an enum type not exported from `@prisma/client`)
  — the identical three categories, in the identical proportions,
  already present in every pre-existing file that touches Prisma types
  across Milestones 0–10. `lib/orders.ts`/`lib/quotations/
  convert-to-order.ts` (modified, not new, this milestone) contribute 12
  errors to the unchanged *baseline* 412, not to the +76 delta — their
  errors predate this milestone. This is a sandbox-only `@prisma/client`-
  generation limitation; `npx prisma generate` against a real network is
  expected to clear essentially all of it.
- **`npx prisma generate`** — not possible in this sandbox, same
  `binaries.prisma.sh` proxy block documented in every prior milestone.
- **`npm run build`** — re-attempted this round: fails at the identical
  pre-existing `next/font/google` block (`app/layout.tsx`'s Geist/Geist
  Mono fonts cannot reach `fonts.googleapis.com`), confirmed unrelated
  to any file this milestone touched — the failure occurs during the
  root layout's module evaluation, before any `/reports/*` route is ever
  reached.
- **Not run in this sandbox**: `npx prisma generate`/`validate`, and
  this milestone's 14 gated DB-integration tests against a real
  database.

## 15. Non-goals honored (spec §15)

Nothing in this milestone builds a Milestone 12+ feature, replaces or
bypasses SAP Business One (every SAP-sourced figure is read through
M9's own existing integration, never re-fetched independently), or
reports a speculative/estimated figure dressed up as real — every number
is labelled Actual/Calculated/Provisional, or reported as Missing rather
than defaulted to zero.

## 16. Staged implementation (spec §16)

Delivered as one pass covering stages A–I: schema (A), the
`lib/reporting/` module (B–E, one file per report domain), API routes
(F), UI (G), role enforcement (H, built into the module from the start
rather than bolted on), and tests/docs (I) — see §13/§14 above and
`docs/milestones/PROGRESS.md`'s "What was actually built" for the full
breakdown.

## Files changed

See `CHANGES.md`'s Milestone 11 section for the complete file-by-file
list (schema/migration, 11 new `lib/reporting/` files, 12 new API
routes, 10 new/modified UI files, `lib/orders.ts`/`lib/quotations/
convert-to-order.ts`, 2 new test files, a 2-file comment-only
correction, and this documentation set).

## Exact Windows PowerShell commands

See `SETUP-WINDOWS.md` §28 for the full, copy-pasteable sequence:
applying the migration, regenerating the Prisma client, running the two
new gated test files, and an 11-step manual test script covering every
operational view, CSV export, the management catalogue, a drill-down,
and the role restriction itself.
