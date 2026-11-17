# Implementation Report: SalesFlow Analytics — Deep Chart Intelligence, Product-Level Breakdown and Rich Tooltips

Scope: enhancement (not a rebuild) to the Lost Sales Analytics dashboard's charts, and an audit of every other reporting/dashboard chart surface. No order-lifecycle, picking/dispatch, invoice-claims/credit-note, or schema changes were made. No dependency was added, removed, or upgraded (Next.js/Prisma/Recharts versions unchanged; no new charting library introduced).

## 1. Charts inspected

- `/lost-sales/analytics` (`app/lost-sales/analytics/page.tsx` + `app/lost-sales/analytics/_components/charts.tsx`):
  - Requested-vs-unavailable quantity trend (line/area)
  - Estimated lost value trend (area)
  - Top unavailable products (horizontal bar)
  - Top unavailable customers (horizontal bar)
  - Requested/found/unavailable by product (grouped horizontal bar)
  - Shortage rate by product (horizontal bar)
  - Shortage rate by customer (horizontal bar)
  - Composition of unavailable quantity (segmented bar)
  - Distribution of unavailable quantity per demand (histogram + percentiles)
  - By loss reason (bar-row ranking)
  - By customer decision (bar-row ranking)
- Main dashboard (`app/page.tsx`): the same requested-vs-unavailable and estimated-lost-value trend charts, via the shared `components/charts/lost-sales-trend.tsx` component.
- Every other `/reports/*` page (sales-performance, product-intelligence, customer-intelligence, financial-exposure, pipeline, communications, fulfilment, decision-intelligence, management): inspected for aggregate-chart-style visualizations. None use Recharts or any bar/line/pie chart — every ranking and breakdown on those pages is rendered as a plain, itemized `<table>` of the underlying records themselves (already maximally traceable: the "chart" already is the list of contributing rows), so the "opaque aggregate number with no visible contributors" problem this task targets does not exist there. `decision-intelligence`'s own category/priority/confidence bar-rows (`BarRow`) are a distinct, already-tested M15 feature, outside both "Lost Sales Analytics" and this task's named examples, and were left untouched to avoid scope creep into another milestone's finished, acceptance-tested behavior.

## 2. Charts improved

- **Requested-vs-unavailable trend** and **estimated-lost-value trend**: rich hover tooltip (date/period summary, product-level breakdown table, drill-down links) replacing the generic series tooltip. Chart type unchanged (still line/area — correct for a time trend).
- **Top unavailable products / top unavailable customers**: rows are now the full per-entity breakdown (not a flattened label+quantity pair); each bar's tooltip shows the complete picture (requested/found/unavailable, estimated vs. confirmed value, affected orders/customers, drill-down link). Chart type unchanged (horizontal bar — correct for a top-N ranking).
- **Requested/found/unavailable by product**: each bar's tooltip now shows the full product breakdown instead of only the three plotted numbers. Chart type unchanged (grouped horizontal bar — correct for a 3-series comparison).
- **Shortage rate by product / by customer**: the underlying data was refactored (see §4) to carry the same rich per-entity shape as every other chart, so these rankings now get the identical rich tooltip and drill-down. Chart type unchanged (horizontal bar, gated by `MIN_DEMAND_COUNT_FOR_RATE_RANKING` — correct and already honest about small samples).
- **By loss reason / by customer decision**: each bar-row is now a drill-down link into the page's own filtered view (`lostSalesReason` / `customerDecisionType`), with a secondary line showing the total quantity/confirmed value behind that reason/decision — directly matching the spec's own example ("clicking a loss reason filters the relevant records"). Chart type unchanged (ranked bars over a small, finite category set — the right choice; no pie/donut was ever used here).
- **Composition stacked bar** and **distribution histogram**: inspected, left unchanged. Both already show every real number directly (segment values + percentages in a visible legend list; percentile tiles above the histogram) rather than hiding them behind hover-only interaction, and neither segment/bucket corresponds to an existing, filterable row dimension — a drill-down link here would have to invent a filter that doesn't exist (e.g., "cancelled-but-not-confirmed-lost" or "unavailable quantity between X and Y" are derived quantity splits, not `UnfulfilledDemandStatus` values), which would risk misleading rather than informing. Documented here as a deliberate decision, not an oversight.
- **Main-dashboard trend charts** (`app/page.tsx`): automatically inherit the same rich tooltips, since they are the identical shared component. The dashboard page itself applies no query-string filters, so these tooltips' drill-down correctly defaults to the unfiltered Lost Sales Analytics page (there is no "current filter" on that page to carry across).

## 3. New tooltip and drill-down functionality

New shared component: `components/charts/rich-tooltip.tsx` (built on the existing shadcn `components/ui/chart.tsx` `ChartTooltip`/custom-`content` mechanism — no new charting library). Exports:

- `TrendTooltipContent` — date/period summary (requested/found/unavailable/availability rate/shortage rate/estimated+confirmed value/affected orders+customers) plus a scrollable per-product breakdown table, each row a drill-down link.
- `ValueTrendTooltipContent` — financial summary (estimated exposure vs. confirmed loss, kept as two separate lines, never summed) plus a product-contribution table with each product's own implied average selling price (a real derived ratio, not an invented price).
- `ProductBarTooltipContent` — one product's full detail for every per-product bar chart.
- `CustomerBarTooltipContent` — the customer equivalent (deliberately no unit-of-measure suffix: a customer's total can span several products in several different units, and this schema has no single "this customer's unit" to attach).

Every tooltip is plain HTML (a `TooltipShell` div with real `<Link>` elements inside, so once visible — including via touch-hold — its links are keyboard-focusable and activatable like any other link on the page), scrollable for long product lists (`max-h-[360px] overflow-y-auto`), and formats quantities/currency/percentages consistently via shared `formatQty`/`formatPlainAmount`/`formatPercent` helpers.

Drill-down reuses the existing `/lost-sales/analytics` page's own filter bar and drilldown table — every link is a plain `<Link href="/lost-sales/analytics?...">` built from the caller's **current** filters (`filtersOnly(searchParams)`, which drops only the meaningless `page` param) merged with the specific product/customer/date/reason the user clicked. No new page, no duplicated filter or query logic.

## 4. Data aggregation changes

All changes are in `lib/lost-sales/analytics-queries.ts`'s single existing `getLostSalesAnalytics` query — no new query, no N+1. One additional join was added to the already-single `findMany` (`product: { select: { unitOfMeasure: true } }` and `lostSaleRecords: { select: { estimatedValue: true } }`), so every per-bucket/per-product figure below is computed from data already fetched in one round trip.

- **New `LostSalesProductBreakdown` fields**: `unitOfMeasure`, `shortageRatePercent` (this product's own rate, never gated by the ranking threshold), `estimatedValue`, `confirmedLostValue` (kept separate — see below), `affectedOrderCount`, `affectedCustomerCount`, `demandCount`.
- **New `LostSalesCustomerBreakdown` fields**: the customer equivalent (no `unitOfMeasure` — see §3).
- **`LostSalesTrendPoint`** now carries, per bucket: `dateFrom`/`dateTo` (the inverse of the existing bucket-key format, via a new `bucketDateRange` helper in `lib/lost-sales/analytics-validation.ts`), `foundQuantity`, `confirmedLostValue`, `affectedOrderCount`/`affectedCustomerCount`, `quantityUnitCode`/`mixedUnitsOfMeasure`, and `products` (the top `MAX_PRODUCTS_PER_BUCKET_TOOLTIP = 8` contributing products by unavailable quantity, plus `otherProductsCount`/`otherProductsUnavailableQuantity` for the remainder) — so a tooltip never has to show an unbounded product list.
- **`shortageRateByProduct`/`shortageRateByCustomer` refactored**: previously returned a narrow, rate-only `LostSalesShortageRateEntry` (now removed); they now return the same rich `LostSalesProductBreakdown[]`/`LostSalesCustomerBreakdown[]` every other chart uses, via a new shared `rankByShortageRate` helper (computes each aggregate's rate exactly once, applies the existing `MIN_DEMAND_COUNT_FOR_RATE_RANKING` gate, then hands the raw aggregates to the same `toProductBreakdown`/`toCustomerBreakdown` mapper every other breakdown already uses) — one aggregation rule, never two separately-maintained implementations of "what a product/customer's contribution means."
- **Estimated vs. confirmed value, kept separate everywhere**: `AnalyticsRow.confirmedLostValue` sums `LostSaleRecord.estimatedValue` (Source B's actually-confirmed figure) defensively over every linked record; `estimatedValue` remains `UnfulfilledDemand.estimatedValue` (the automatic Source-B estimate, set at demand-creation time). Neither this module nor any new UI ever adds the two together — every KPI tile, tooltip, and breakdown row shows both labeled lines.
- **Currency**: unchanged, pre-existing limitation — Source B amounts carry no currency code anywhere in this schema (Milestone 4). Not fixed here (would require a schema change, out of scope); the new tooltips now say so explicitly instead of silently implying one currency.
- **UOM**: `Product.unitOfMeasure` is now tracked per row, per bucket, and for the whole filtered scope (`allUnitsOfMeasure: Set<string>`); `mixedUnitsOfMeasure`/`quantityUnitCode` surface honestly whenever two or more distinct units are in scope, rather than silently combining e.g. kilograms and individual pieces into one number.
- **"Recovered value"**: deliberately not invented. This system tracks no dollar figure for "no longer a loss" — only the real, existing quantity-level signals (`substitutedQuantity`, `RESOLVED` status). The UI surfaces those honestly instead of fabricating a pro-rated recovered-value number.
- **New KPI fields** (`app/lost-sales/analytics/page.tsx`): `totalFoundQuantity`, `totalConfirmedLostValue`, `affectedOrderCount`, `affectedCustomerCount`, and a page-level mixed-UOM warning banner, now shown as their own tiles (previously computed but not displayed).

## 5. Files changed

- `lib/lost-sales/analytics-validation.ts` — added `bucketDateRange` (pure, unit-testable).
- `lib/lost-sales/analytics-queries.ts` — extended select/aggregation as described in §4; removed `LostSalesShortageRateEntry`.
- `components/charts/rich-tooltip.tsx` — **new file**: the four shared rich-tooltip components.
- `components/charts/lost-sales-trend.tsx` — wired the two trend charts to the new tooltips; added optional `basePath`/`baseQuery` props (default to `/lost-sales/analytics` with no extra filter, so the existing unfiltered call from `app/page.tsx` is unaffected).
- `app/lost-sales/analytics/_components/charts.tsx` — rewrote `TopUnavailableBarChart`, `RequestedFoundUnavailableChart`, `ShortageRateBarChart` to accept the rich breakdown rows and `basePath`/`baseQuery`/`kind`.
- `app/lost-sales/analytics/page.tsx` — passes `basePath`/current-filters `baseQuery` into every chart; new KPI tiles; loss-reason/customer-decision bars are now drill-down links.
- `tests/lost-sales-analytics-db.integration.test.ts` — see §6.

## 6. Tests actually executed and results

Added three new DB-integration tests (same file, same `describe.skipIf(!RUN_DB_INTEGRATION_TESTS)` gate as the three pre-existing ones in this file) plus strengthened the pre-existing `MIN_DEMAND_COUNT_FOR_RATE_RANKING` test's assertions to cover the new rich return shape:

1. A trend bucket's per-product breakdown attributes requested/found/unavailable to each of two distinct contributing products separately (never collapsed into one combined row), and the same two rows surface correctly in the whole-scope product breakdown.
2. The automatic estimated-lost-value and a later customer-confirmed lost-sale value are two separate figures — confirming a lost sale is asserted to leave the automatic estimate completely unchanged, and the confirmed-value delta is asserted to match exactly what `confirmLostSale` itself returned (deterministic regardless of whether this fixture's product happens to have a resolvable price).
3. Two products with different units of measure (two fresh, deterministic `Product` rows created with controlled `unitOfMeasure` values, to avoid depending on whatever UOM data happens to exist in a given seeded database) are flagged `mixedUnitsOfMeasure: true`/`quantityUnitCode: null` in a combined view, while a single-product filter sees exactly one unit.

**Executed in this sandbox** (this environment's `@prisma/client` is a non-functional stub — confirmed again this round: `npx prisma validate`/`generate` fail with `Missing required environment variable: DATABASE_URL`, before even reaching the network — so every DB-integration test, including the three new ones above, self-skips here and was never run against a real database in this sandbox):

- `npx tsc --noEmit`: unchanged against this sandbox's own stable, pre-existing 760-error/7-category baseline (464 TS7006, 126 TS2694, 104 TS2339, 42 TS2305, 9 TS2345, 9 TS2322, 6 TS18046 — all from the stub client, none from this round's changes) after every edit in this round, re-verified at the end. Zero new error categories.
- `npm run lint` (whole project, not just changed files): **clean**, 0 errors, 0 warnings.
- `npx vitest run` (whole suite): **950 passed, 0 failures, 211 skipped** (was 208 skipped before this round — the 3 new self-skipping DB-integration tests above account for the difference; no existing test's outcome changed).
- `npx prisma validate` / `npx prisma generate`: blocked — `Missing required environment variable: DATABASE_URL` in this sandbox (unrelated to any change in this round; no schema or migration was touched).
- `npx next build`: blocked — `next/font` cannot reach `fonts.googleapis.com` from this sandbox (unrelated to any change in this round; `app/layout.tsx` was not touched). The build CLI also printed an unrelated, informational "upgrade recommendation" nudge suggesting `next upgrade --agent=security`; this was **not** actioned, per this task's own explicit instruction not to upgrade Next.js.

**Not executed here, requires your own environment** (run the PowerShell commands in §8, after `npm run db:seed`):

- The three new DB-integration tests above, and the one strengthened existing test.
- `npx prisma validate` / `npx prisma generate` against a real generated client.
- `npx next build` (this round touched no font/layout code, so a successful build in your environment is the real confirmation that nothing here regressed it).
- A visual check of the new tooltips/drill-down in a browser (hover behavior, scroll behavior on a long product list, drill-down links landing on the right filtered page).

## 7. Remaining limitations

- **No currency code** on any lost-sales money figure (pre-existing Milestone-4 limitation, not fixed — would require a schema change, explicitly out of this task's scope). Every new tooltip states this plainly rather than implying one currency.
- **Composition/distribution charts have no drill-down** (§2) — a deliberate decision, not an oversight, since their segments/buckets don't correspond to an existing filterable dimension.
- **Keyboard/focus access to a chart's own hover tooltip** is inherently limited by Recharts itself (tooltips open on pointer hover/touch, not on keyboard focus of the SVG mark) — not something this enhancement can change without replacing the charting library (explicitly out of scope). The same information is always available without hovering, via the ordinary keyboard-navigable bar charts, the drilldown table, and the loss-reason/decision links.
- **Shared-database test flakiness risk**: the new per-product trend-bucket test and the pre-existing `shortageRateByProduct` threshold test both depend on this fixture's own rows ranking within a bounded top-N/top-8 cap among whatever else exists in the same shared test database at the same time — documented explicitly in both tests' own comments, with deliberately large quantities chosen to make a collision unlikely in practice, consistent with how the pre-existing test in this file already handled the same risk.
- **DB-integration test price-dependency**: the estimated-vs-confirmed test does not assume a resolvable price exists for its fixture product — it is written to pass either way (see §6) — but this means it is a weaker check than one guaranteed to exercise a non-zero confirmed value. If your database has a `PriceListEntry` or approved order-line price for the demo product used, it will.

## 8. Windows PowerShell commands to validate locally

Run from the project root in PowerShell, after setting a real `DATABASE_URL`:

```powershell
npx prisma validate
npx prisma generate
npx tsc --noEmit
npm run lint
npx vitest run
# Seed once if you haven't already, then opt in to the DB-integration tests:
npm run db:seed
$env:RUN_DB_INTEGRATION_TESTS = "1"
npx vitest run tests/lost-sales-analytics-db.integration.test.ts
Remove-Item Env:\RUN_DB_INTEGRATION_TESTS
npm run build
npm run dev
# Then in a browser: open /lost-sales/analytics and the main dashboard,
# hover the trend/bar charts for the new rich tooltips, and click a
# tooltip's product/customer/loss-reason link to confirm the drill-down
# lands on /lost-sales/analytics with the right filter applied.
```
