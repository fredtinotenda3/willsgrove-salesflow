# FOLLOW-UP FIXES REPORT — Price-List Editing, Priced Analytics, and Consolidated Lost-Sales Reporting

**Scope:** every change made to this codebase after `IMPLEMENTATION-REPORT.md` (Round 5, Phases 1–10) was packaged into `willsgrove-salesflow-real-business-data-onboarding-round5.zip`. This report and its accompanying ZIP cover everything changed since that delivery — tasks #219–#228 on the project's own task tracker.

**Disclosure on scope of detail below:** tasks #219–#222 and #224 were completed in earlier turns of this same working session, before the most recent context compaction; this report states their outcome (confirmed complete, reflected in the file list and verification results below) but does not re-describe their internal work in detail, since that detail is not available to re-derive honestly here. Tasks #223, #225, #226, and #228 were completed with full context and are reported in full below.

---

## 1. What changed, in one paragraph

Price-list entries can now be edited/updated individually from the UI (task #223), closing a gap left open by the Phase 4 pricing work. The Lost Sales Analytics page, its CSV export, and the two affected Management Reports pages now show a **value**, not just a bare quantity, alongside every "requested"/"found"/"unavailable" figure — reusing the price each demand row already had snapshotted, never a newly-invented or re-derived price (task #225). Most significantly, returned-claim lost sales (goods a customer returned and an inspector found damaged/expired/unsellable) are now shown in the **same** Lost Sales Analytics page, KPIs, and drilldown as shortage-based lost sales, with a source filter, a by-source breakdown, combined by-product/by-customer breakdowns, drill-down to the original order/invoice/claim/return, and a dedicated CSV export — all without mixing currencies, without mixing units of measure, and with no possibility of double-counting the same loss under two sources (task #228, following task #226's clarifying question/answer exchange). The existing, separate "Source C" whole-business returned-goods summary (`lib/returns-credits/lost-sale-analytics.ts`, consumed by the financial-exposure report) is untouched, per the explicit instruction to preserve it.

No schema or migration change was needed for any of this — every field the new work reads or writes already existed.

---

## 2. Task #223 — Price-list entry editing

**Problem:** `app/price-lists/[id]/page.tsx`'s data-loading `useEffect` called `setLoading(true)` synchronously at the top of the effect body, tripping the `react-hooks/set-state-in-effect` ESLint rule.

**Fix:** restructured to this project's own established idiom (already used by `app/price-lists/customers/page.tsx`): an `async function load()` defined and invoked inside the effect, with an `AbortController` for cleanup, so `setLoading(true)` runs inside the async function rather than synchronously in the effect body.

**Verification:** `eslint` clean; `tsc`/`vitest` baselines unchanged.

---

## 3. Task #225 — Price-derived value alongside every quantity figure

**Requirement:** "since now we have prices, the graphs should now have prices too — not just Requested quantity, Found quantity, Unavailable quantity — the quantity should be associated with its price."

**What changed:**
- `lib/lost-sales/analytics-queries.ts`: added `requestedValue`/`foundValue` throughout (`AnalyticsRow`, the trend/product/customer breakdown types, and the KPI totals) — each computed from a row's own already-resolved `estimatedUnitPrice` (the same snapshot that already priced `unavailableQuantity` into `estimatedValue`), `null` (never a fabricated `0`) when that price itself is `null`. `demandsWithoutEstimate` already discloses exactly how many rows that affects, and continues to.
- `app/lost-sales/analytics/page.tsx`: the Requested/Found/Unavailable `MetricCard`s now show `≈ $X in value`, with the existing no-estimate caveat; the order-level drilldown table gained an "Est. value" column.
- `components/charts/rich-tooltip.tsx`: the trend/product/customer tooltips show a "Requested value"/"Found value" row alongside the existing quantity rows.
- `app/api/lost-sales/analytics/export/route.ts`: the CSV export gained `requestedValue`/`foundValue` columns.
- `lib/reporting/management-reports.ts` + `app/reports/management/[reportId]/page.tsx` + `.../summary-sections.tsx`: the Lost Sales and Picking Shortages management reports gained the same value figures, priced from `OrderLine.approvedUnitPrice` only (never the less-trustworthy `customerUnitPrice`), with an explicit `linesWithoutPrice` count disclosed wherever a total excludes unpriced lines.
- `tests/lost-sales-analytics-db.integration.test.ts`: new DB-integration test proving `requestedValue`/`foundValue`/`estimatedValue` all derive from the same unit price and agree exactly.

---

## 4. Task #226/#228 — Consolidating returned-claim lost sales into Lost Sales Analytics

### 4.1 The requirement (verbatim, since it is detailed and specific)

> Show returned-claim losses in the same Lost Sales Analytics page, KPIs, charts and reports as shortage-based lost sales — not isolated in a separate report. Keep the existing return-condition rule (GOOD_RESALABLE = no loss; DAMAGED/EXPIRED/OTHER = the received quantity at the original invoice line's unit price). Distinguish shortage losses from returned-product losses; include both in overall KPIs; show separate by-source breakdowns; include product, customer, quantity, unit of measure, unit price, and total value; add source filters and drill-down to the original order/invoice/claim/return; prevent duplicate counting; never count a mere complaint as a confirmed loss; preserve the separate detailed returned-claims report; use real pricing data; never mix currencies or units of measure.

### 4.2 Investigation before building

The existing rule (`lib/returns-credits/return-lost-sale.ts`'s `recordClaimReturnLostSaleIfLoss`) was read in full first and found already correct and well-reasoned — it was left completely unchanged, per the instruction not to touch it absent a specific inconsistency (none was found). The problem was purely that its output (`ClaimReturnLostSale` rows) was only ever surfaced via a whole-business summary (`getReturnedGoodsLostSalesValue`, "Source C") consumed solely by the financial-exposure report — genuinely isolated from the main Lost Sales Analytics page, exactly as the user described.

### 4.3 Design

- **No change to any existing, already-tested function.** `getLostSalesAnalytics()` (shortage-only) is untouched; `getReturnedGoodsLostSalesValue()` (the whole-business Source C summary) is untouched. A new, additive layer was built alongside both:
  - `lib/returns-credits/lost-sale-rows.ts` — row-level lister for `ClaimReturnLostSale`, enriched with the real product (resolved via the disputed claim line's matched order line), real unit of measure (the invoice line's own), and every id needed to drill down to the order/invoice/claim/return.
  - `lib/lost-sales/queries.ts` (`listShortageLostSaleRows`, new export) — the row-level counterpart on the shortage side, reading `LostSaleRecord` directly (the same table `getSupplyShortageLostSalesValue` already reads) and resolving currency from `CustomerOrder.currency` (a real, always-set column — `UnfulfilledDemand`/`LostSaleRecord` themselves carry no currency, a pre-existing, documented limitation).
  - `lib/lost-sales/consolidated-analytics.ts` (`getConsolidatedLostSalesAnalytics`, new) — merges both row sets into combined KPIs (by currency, by unit of measure), a by-source breakdown, combined by-product/by-customer breakdowns (with the per-source split preserved inside each), and a combined, paginated drilldown — all using this project's exact scaled-bigint decimal arithmetic (`lib/fulfilment/decimal.ts`), not float summation, since these are headline money totals, not chart-only display.
- **No duplicate-counting risk, by construction, not by a runtime check:** a `LostSaleRecord` row only ever exists for quantity that was *never delivered* (unavailable at picking); a `ClaimReturnLostSale` row only ever exists for quantity that *was* delivered, invoiced, and later physically returned. These describe disjoint populations of physical goods, so merging the two row sets is a union of disjoint sets, never an addition that could count the same lost unit twice. This reasoning is documented at length in the new module's own header comment.
- **Source filter (`lostSaleSource`)** added centrally to `ReportFilters`/`parseReportFilters` (`lib/reporting/types.ts`, `lib/reporting/filters.ts`), following the exact precedent `unfulfilledDemandStatus`/`lostSalesReason` already set. When the caller filters to one source, the *other* source is never even queried — not just hidden afterward.
- **UI**: `/lost-sales/analytics` gained a new "Lost sales by source (combined)" section (KPIs, value-by-currency table, by-source cards, top-products/customers) and a "Combined lost-sales drilldown" table with per-row drill-down links to the order, invoice, claim (which already renders its returns inline — no separate return page exists), and demand — all above the pre-existing, **unchanged** shortage-only charts. A new "Loss source" filter dropdown was added to the shared filter bar (`app/reports/_components/filter-bar.tsx`). The shared `Pagination` component gained an optional `pageParam` (default `"page"`, fully backward-compatible) so this page's two independently-paginated tables never collide.
- **Export**: a new route, `app/api/lost-sales/analytics/consolidated-export/route.ts`, exports every row of the combined drilldown (both sources, not just the current page) as CSV.
- **Preserved as asked**: `lib/returns-credits/lost-sale-analytics.ts`'s `getReturnedGoodsLostSalesValue` and its one consumer (`lib/reporting/financial-exposure.ts`) are unchanged — only a cross-referencing comment was added pointing to the new consolidated view.

### 4.4 Tests

`tests/consolidated-lost-sales-db.integration.test.ts` (new): builds one real shortage-side confirmed loss (via the actual picking → authorize pipeline) and one real returned-product-side confirmed loss (via the actual claim → resolution → approval → return pipeline), both against a dedicated, self-contained customer/product fixture, and asserts: combined KPIs are correct; value-by-currency never blends currencies; the by-source and by-product/customer breakdowns correctly split and recombine; drilldown rows carry the correct order/invoice/claim/return/demand ids; and the `lostSaleSource` filter excludes the other source's row *entirely* (sample size drops to 1, not just a hidden row).

This follows the project's established `describe.skipIf(!RUN_DB_INTEGRATION_TESTS)` convention — it has been verified to typecheck and lint cleanly, and matches every function signature read directly from the source files it calls, but (like every other `*-db.integration.test.ts` file in this project) has not been executed against a real database in this sandbox, which has no `DATABASE_URL`.

---

## 5. Final verification (this session)

| Check | Result |
|---|---|
| `npx eslint .` (repo-wide) | **Clean** — 0 errors, 0 warnings. |
| `npx tsc --noEmit` | **795 errors** — same pre-existing, already-documented `@prisma/client`-stub baseline as every prior round (see `docs/milestones/PROGRESS.md`'s "Sandbox-only blocker"). The 3-error increase over the prior round's reported 792 is **not a regression**: it is 3 more instances of the exact same two already-present error categories (`Prisma.XWhereInput` has no exported member; an implicit `any` on a `.select()`-shaped callback parameter) in the two new query functions this round added, which follow the identical pattern every existing query function in the same files already uses. Zero new error categories. |
| `npx vitest run` (full suite) | **964 passed / 239 skipped / 2 failed** (1205 total). The 2 failures (`tests/acceptance-item-0228.test.ts`) are pre-existing, unrelated, missing-fixture (`ENOENT`) failures, confirmed untouched by this round's work. The skip count rose from 235 to 239 — the 4 new DB-integration tests this round added (`tests/consolidated-lost-sales-db.integration.test.ts`), correctly skipped with no `DATABASE_URL`. |
| `npx prisma validate` | Blocked by this sandbox's pre-existing network restriction (no `DATABASE_URL`/cannot reach `binaries.prisma.sh`) — unrelated to this round, since no schema change was made at all this round. |
| `npm run build` | Not attempted — this sandbox has never been able to reach the build's later phases (see `docs/milestones/PROGRESS.md`'s "Sandbox-only blocker" for the full, previously-documented explanation); nothing this round changes that. |

---

## 6. Delivery contents

This ZIP contains **only files created or modified since the prior delivery** (`willsgrove-salesflow-real-business-data-onboarding-round5.zip`), established mechanically via `find . -newer <that zip>` against this working copy — not from memory. No `node_modules`, `.next`, `.git`, `tsconfig.tsbuildinfo`, `.env*`, or credential is included.

New files this round:
- `lib/lost-sales/consolidated-analytics.ts`
- `lib/returns-credits/lost-sale-rows.ts`
- `app/api/lost-sales/analytics/consolidated-export/route.ts`
- `tests/consolidated-lost-sales-db.integration.test.ts`
- `business-data/IMPORT-GUIDE.md`, `business-data/items-import.csv`, `business-data/price-lists-import.csv` (task #224, business-data conversion — not re-described in detail here per this report's own disclosure above)
- `scripts/convert-item-master-xlsx-to-csv.ts`, `scripts/convert-price-list-xlsx-to-csv.ts` (task #224)

Everything else in the file list is a modification to an existing file (see §2–4 above for which task touched which file; tasks #219/#220/#221/#222/#224 also touch `lib/customer-master-import.ts`, `app/api/customers/master-import/route.ts`, `app/customers/master-import/page.tsx`, `app/quotations/new/new-quotation-form.tsx`, `lib/price-list-queries.ts`, `app/api/price-lists/[id]/entries/route.ts`, `app/api/price-lists/entries/[id]/route.ts`, `app/api/price-lists/lookup/route.ts`, and `tests/customer-master-import-db.integration.test.ts` — completed in earlier turns of this session, per this report's own disclosure in §0).

## 7. Known limitations / recommended next steps

1. Run `tests/consolidated-lost-sales-db.integration.test.ts` (and every other DB-integration test) against a real seeded database before go-live — never executed in this sandbox.
2. The combined drilldown paginates in memory over (at most) two capped row sets (10,000 rows each); `truncated` discloses if either cap is hit. Fine at this business's realistic volume; would need a real cross-table DB-side pagination strategy only if that volume grows by roughly two orders of magnitude.
3. As flagged in the prior round's report, a customer's assigned price list still does not drive new-order pricing — only lost-sale value estimation. Unchanged this round.
