# Willsgrove SalesFlow — Implementation Report (this delivery round)

**Scope of this round:** the bug-report/feature-request covering seven distinct issues: Lost Sales missing amounts everywhere (list, analytics, dashboard, graphs); an order's per-line "Line Total" stuck on "Pending"; the lifecycle stepper's Dispatched/Delivered stages never showing a tick even when the order is actually Delivered; the Related Records panel's Lost Sale cards showing "no price available"; Fulfilment History needing accepted/rejected product quantities; the Invoice Claims page showing "0 claims total" despite real rejected product sitting unaddressed; and amount data on the "Requested vs. unavailable quantity" graph. Tracked as tasks #273–#279.

---

## 1. Delivery contents (zip of changed/new files only)

| File | Change |
|---|---|
| `lib/order-display.ts` | Fixed `getOrderLifecycleSteps`'s terminal-stage bug (§2.3). Added `formatLineAmountWithEstimate()` (§2.2). |
| `lib/order-queries.ts` | Added `estimateLineTotal()` helper + `estimatedLineTotal` field on each returned order line (§2.2). Extended `getOrderById`'s `dispatchRecords` select with the physical `deliveryRecord` outcome (per-product accepted/rejected quantity + rejection reason) and mapped it onto each returned dispatch as `delivery` (§2.5). |
| `app/orders/[id]/page.tsx` | Line Total cell now renders a real (or clearly-marked estimated) amount instead of "Pending" (§2.2). Fulfilment History section extended to show each dispatch's physical delivery outcome — accepted/rejected quantity per product, with rejection reason — when one has been recorded (§2.5). |
| `lib/lost-sales/estimate-value.ts` | Fixed `resolveEstimatedLostSaleValue()` to fall back to `OrderLine.customerUnitPrice` when no separately-approved price exists — the same `approvedUnitPrice ?? customerUnitPrice` convention already used everywhere else in this codebase (§2.1). |
| `app/lost-sales/page.tsx` | Updated a tooltip's wording to stay accurate after the §2.1 fix (price may now come from either field, not only an approved price). |
| `lib/invoice-claims/queries.ts` | **New** `listRejectedDeliveriesAwaitingClaim()` — finds every physically-rejected delivery line with no claim filed against it yet, native or SAP-anchored (§2.4). |
| `app/invoice-claims/page.tsx` | **New** "Awaiting a claim" section: every row from the query above, with the standardised rejection reason already recorded at delivery, and a "File a claim" link that carries the order/line/quantity/reason straight into the claim form (§2.4). |
| `app/invoice-claims/new/page.tsx` | Reads and validates the new `orderId`/`orderLineId`/`rejectedQuantity`/`reasonLabel` query parameters; a malformed or tampered link is dropped entirely rather than partially applied (§2.4). |
| `app/invoice-claims/new/new-claim-form.tsx` | Accepts an optional `prefill` prop: loads the linked order and pre-marks the specific rejected line as disputed, with its rejected quantity and (when it matches one of the 8 standardised reasons) its reason category already filled in (§2.4). |
| `tests/order-display.test.ts` | Updated 2 existing `getOrderLifecycleSteps` assertions for the terminal-stage fix; added 1 new test covering the non-terminal case. |
| `tests/lost-sales-db.integration.test.ts` | **New** test: a lost sale with only `OrderLine.customerUnitPrice` set (no `approvedUnitPrice`) still resolves a real, non-null estimated value. |

**Not included:** task #276 (Related Records lost-sale price) and task #279 (amount on the quantity-trend graph) needed no code — see §2.1 and §2.6 for why.

---

## 2. What was actually done, by issue

### 2.1 Lost Sales missing amount everywhere (#273, #276)
Root cause: `resolveEstimatedLostSaleValue()` (`lib/lost-sales/estimate-value.ts`) only ever checked `OrderLine.approvedUnitPrice` — a field **no real application code path writes**, confirmed by an exhaustive grep (only test fixtures set it). The only price realistically ever set at order creation is `OrderLine.customerUnitPrice`, and this one function was missing the `approvedUnitPrice ?? customerUnitPrice` fallback already used identically at 6 other call sites across this codebase. The result: almost every lost sale resolved to a null price, shown as "no price available" / blank on `/lost-sales`, `/lost-sales/analytics`, the dashboard KPI tiles and trend charts, and the order detail page's Related Records "Lost Sale record" cards.

The fix is one function, not six, because `lib/lost-sales/create-unfulfilled-demand.ts` creates both `UnfulfilledDemand` and `LostSaleRecord` in the same transaction from the **same** `estimate` object this function returns. Confirmed by reading every downstream consumer (not assumed) that no separate display-layer changes were needed — this closes #276 (Related Records) with zero additional code.

`LostSaleValueSource` stays `"ORDER_LINE_APPROVED_PRICE"` even when the value actually came from `customerUnitPrice` — that enum has exactly 2 members in the schema (`ORDER_LINE_APPROVED_PRICE`, `PRICE_LIST_ENTRY`), and adding a third requires a migration this sandbox cannot run (see §3). Every other call site in this codebase already blends the two prices under this same label; this fix is consistent with that, not a new inconsistency.

**Important limitation to flag:** this fix only changes what happens going forward. Lost-sale records already created with a null price will **not** retroactively gain one — there is no new migration or backfill in this delivery. If you want existing null-priced records corrected, say so and I'll write a one-off backfill script against the same resolution logic.

### 2.2 "Line Total" stuck on "Pending" (#274)
`OrderLine.lineTotal` is only ever written by SAP invoice reconciliation — never by order creation or approval (confirmed by an exhaustive grep of every writer). This exact staleness pattern was already fixed at the **order** level in an earlier round (`estimateOrderTotal()` / `formatOrderAmountWithEstimate()`, applied to the orders list, dashboard, and the order detail page's "Order Total" card) but was never extended to the **per-line** "Line Total" column, which showed "Pending" for an order's entire active lifecycle even though the unit price and quantity needed to compute it were sitting right there on the line.

Fixed by mirroring the exact same pattern one level down: `estimateLineTotal()` (`lib/order-queries.ts`) computes `requestedQuantity × customerUnitPrice` using this codebase's scaled-bigint decimal-string convention (never floats), and `formatLineAmountWithEstimate()` (`lib/order-display.ts`) displays it prefixed with `~` — the same convention the order-level total already uses to mark an estimate as not-yet-SAP-confirmed, with a tooltip explaining why. A real `lineTotal` (once SAP reconciliation sets one) always takes priority over the estimate.

Verification note: `lib/order-queries.ts` imports `@/lib/prisma`, which this sandbox's stub `@prisma/client` cannot construct — confirmed (a second time, same error as a prior round) that this makes the file un-importable by any vitest test here, under any env-var configuration. `estimateLineTotal`'s arithmetic was instead verified by a standalone throwaway Node.js script (4 cases, all correct) outside the delivered test suite — not a substitute for a real unit test, so if you'd like one added once `prisma generate` works in your environment, say so.

### 2.3 Lifecycle stepper: Dispatched/Delivered never ticking (#275)
`getOrderLifecycleSteps` computed how far an order had progressed (`stageIndex`), then marked every stage before it `"done"` (ticked) and the reached stage itself `"current"` (a plain highlighted number, no tick) — correct for every stage **except the last one**. "Current" means "in progress, something still ahead" — true for Dispatched while a truck is still mid-transit, but once `delivered` is true there is nothing further to progress to: Delivered is a completed, terminal fact, not a step still underway. It needs to render `"done"` exactly like every earlier stage, which it never did.

Fixed with a single additional condition: the reached stage also counts as `"done"` when it is the last stage. Two existing tests that had encoded the old (buggy) `"current"` expectation for the terminal stage were corrected, and one new test confirms a still-in-transit order (Dispatched, not yet Delivered) correctly keeps `"current"` on its own last-reached, non-terminal stage.

### 2.4 Invoice Claims showing "0 claims total" despite real rejected product (#278)
This page's own module comment in `lib/fulfilment/delivery.ts` already documented the intended design: recording a physical delivery rejection "never creates an `InvoiceClaim` itself... surfaced to the UI as a link into the existing `/invoice-claims/new` flow" — but that link was never actually built anywhere. The Claims Queue only ever lists claims that already exist, so a real rejection with no claim filed for it was simply invisible, and the page kept reporting "0 claims total" even with rejected product sitting unaddressed.

Two separate delivery-outcome models exist in this codebase and must not be confused: `DeliveryRecord`/`DeliveryLine` records the **physical** outcome of one truck's delivery (accepted/rejected quantity per product, with a rejection reason) — this is the one relevant here. `InvoiceDeliveryRecord` is a separate, SAP-invoice-level "No Claim"/"With Claim" workflow status gate, untouched by this change.

Built `listRejectedDeliveriesAwaitingClaim()`: every `DeliveryLine` with a rejected quantity whose order line has no `InvoiceClaimLine` filed against it yet — checked via the real back-relation field (`claimLines`, confirmed against the schema; an earlier draft of this query had the relation name wrong and was corrected before shipping) on both the native (`orderLineId`) and SAP-anchored (`sapInvoiceLineId` → that line's own matched order line) paths, so a claim filed either way correctly removes the row. `/invoice-claims` now shows this as an "Awaiting a claim" section above the existing Claims Queue, using the rejection reason already recorded at delivery (dispatch-panel.tsx already uses the same standardised 8-reason dropdown this feature needs — no new reason vocabulary was introduced).

Each row's "File a claim" link carries the order, line, rejected quantity, and reason straight into `/invoice-claims/new`, which now pre-loads that order and pre-marks the specific line as disputed with its quantity and (when the recorded reason text matches one of the 8 standardised categories exactly) its reason category already selected — filing the claim the spec calls for is now a few seconds of review, not re-entering what delivery already recorded. A malformed or tampered link (bad IDs, non-numeric quantity) is dropped entirely server-side rather than partially trusted, landing the user on a normal empty form instead.

### 2.5 Fulfilment History missing accepted/rejected quantities (#277)
Extended the existing `getOrderById` query and Fulfilment History section (both built in an earlier round) to also surface each dispatch's physical delivery outcome — reusing the exact select shape already proven correct in `lib/delivered-orders/queries.ts`, so the two pages can never disagree about what a delivery outcome looked like. Shown per product: accepted quantity, rejected quantity, and the rejection reason, when a delivery outcome has been recorded for that dispatch.

### 2.6 Amount on the "Requested vs. unavailable quantity" graph (#279)
Confirmed via inspection, not assumption: this is already present. A dedicated `EstimatedLostValueTrendChart` already renders below the quantity chart, and the quantity chart's own tooltip (`TrendTooltipContent`) already shows four value summary rows (Requested / Found / Estimated lost / Confirmed lost value). No code change was needed. One smaller enhancement is **not** implemented — the per-product breakdown rows inside that tooltip don't yet show a value even though the underlying type already carries one (`requestedValue`/`foundValue`/`estimatedValue` on `LostSalesProductBreakdown`) — flagged here since you phrased this item as "if possible," and lower priority than the other six.

### Note on "USD"
Lost-sales analytics figures deliberately carry no currency code — a documented, pre-existing schema/design decision (`lib/lost-sales/analytics-queries.ts`'s own module comment), not a display bug. This round's fix (§2.1) makes the **amount** itself real; it does not add currency labeling to analytics aggregates, since "USD" in the request read as shorthand for "the dollar amount" (your own parenthetical — "in other words AMOUNT") rather than a request to label every aggregate with a currency code. If you did mean the latter, say so and I'll scope what that requires (this business trades in more than one currency per the schema, so a global "USD" label would be actively wrong wherever a lost sale isn't in USD).

---

## 3. Final verification (exact results, this session)

| Check | Result |
|---|---|
| `npx eslint` on all 11 changed files | **Clean** — 0 errors, 0 warnings. |
| `npx tsc --noEmit` (full repo) | **847 errors** (was 846 immediately before this round's final file). Isolated the delta: **+1**, `TS7006: implicit any` on the new `.map()` callback in `listRejectedDeliveriesAwaitingClaim()` — the same pre-existing sandbox-stub pattern already present on every other Prisma-derived array in this codebase, caused by this sandbox's non-functional generated Prisma client (see below), not a defect in the new code. |
| `npx vitest run` (full suite) | **1001 passed / 257 skipped / 2 failed**, unchanged from immediately before this round except the 2 new tests added in §1. The 2 failures are the same pre-existing, unrelated `tests/acceptance-item-0228.test.ts` `ENOENT` (missing `test-data/sample-customer-master.csv` fixture), confirmed untouched by this round. |
| `npx prisma generate` | **Blocked**, as in every prior round — this sandbox's outbound network allowlist does not reach `binaries.prisma.sh`. This is the direct cause of every `tsc` error above: the generated client stub is missing real `Prisma.Decimal`, several `Prisma.<Model>WhereInput`/`Select` types, and the `OrderStatus` export, so **any** file importing `@/lib/prisma` shows these same error shapes and cannot be imported by vitest at all, regardless of env vars (confirmed again this round). Resolves automatically once `prisma generate` runs in a real environment. |

A relation-name correctness check worth recording explicitly, since it's exactly the kind of mistake that would otherwise ship silently: the first draft of `listRejectedDeliveriesAwaitingClaim()` assumed the Prisma-generated back-relation field connecting `OrderLine`/`SapInvoiceLine` to their claim lines was named `invoiceClaimLines`. It isn't — the schema names it `claimLines` on both models (confirmed by reading `prisma/schema.prisma` directly, not inferred). Caught and corrected before this file was synced for verification; the delivered query uses the real field name.

---

## 4. Residual items for your own environment

1. **Existing null-priced lost-sale records** (§2.1) will not retroactively gain a price from this fix — only future ones will. Say the word if you want a backfill script.
2. **`estimateLineTotal`** (§2.2) is verified by arithmetic, not by a vitest unit test, because the containing file cannot be imported in this sandbox at all (see §3). Once `prisma generate` succeeds in your environment, a real unit test can be added in minutes if you want one.
3. **`npx prisma generate` / `migrate`**, in a real environment with network access — resolves the `tsc` noise in §3 and is a prerequisite for running this round's new DB-integration test (`tests/lost-sales-db.integration.test.ts`, `RUN_DB_INTEGRATION_TESTS=1 npx vitest run`).
4. **The optional per-product value row in the lost-sales trend tooltip** (§2.6) — not implemented, flagged as a "nice to have" you can ask for directly if it's worth doing.
