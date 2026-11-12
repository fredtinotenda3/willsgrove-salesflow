# Milestone 11 — Operational BI: metric definitions

The authoritative catalogue of every figure the `/reports/*` surface shows, referenced by short comments throughout `lib/reporting/*.ts` rather than re-explained inline at each call site. If a figure's meaning is ever in doubt, this file is the tie-breaker — not the UI label, not a guess from the field name.

Every figure below carries one of four data-quality labels (spec section 2), shown in the UI via `DataQualityBadge` and in the API via `QualifiedMetric<T>` where used:

- **Actual** — a plain count, sum, or stored value with no derivation beyond grouping/filtering.
- **Calculated** — derived from two or more actual values (a rate, an average, a difference).
- **Provisional** — a real figure that is expected to still change (e.g. a quotation's funnel position before its outcome is known).
- **Missing** — the underlying data doesn't exist yet for this scope; reported honestly as absent, never estimated or defaulted to zero.

## 1. Core principle: never mix date cohorts

Every rate in this milestone divides two counts drawn from the **same, single cohort**, anchored to one date field, never two independently-dated populations. See `lib/reporting/sales-pipeline.ts`'s own top comment for the worked explanation of why `(quotations issued this week) / (requests received this week)` is a meaningless ratio, and what this module does instead.

## 2. Sales pipeline (`lib/reporting/sales-pipeline.ts`)

| Figure | Definition | Anchor date |
|---|---|---|
| `requestsReceived` | `MessageIntake` rows (M10) in range | `receivedAt` |
| `requestsProcessed` | Of those, status `CONVERTED` or `LINKED` *as of now* | — |
| `requestsProcessedRatePercent` | `requestsProcessed / requestsReceived` | — |
| `quotationsIssued` | `Quotation` rows with `issuedAt` in range, `supersededAt` null | `issuedAt` |
| `quotationAcceptanceRatePercent` | Of the `quotationsIssued` cohort, fraction now `ACCEPTED` | — |
| `acceptedQuotationsInCohort` | `Quotation` rows `ACCEPTED` with `respondedAt` in range | `respondedAt` |
| `quotationToOrderConversionRatePercent` | Of that cohort, fraction with `convertedAt` set | — |
| `ordersReceived` | `CustomerOrder` rows with `receivedAt` in range | `receivedAt` |
| `ordersAwaitingFulfilment` | Of that cohort, status `APPROVED` or `PICKING` right now | — |
| `orderApprovalRatePercent` | `ordersConfirmed / ordersReceived` (confirmed = `APPROVED`/`PICKING`/`READY_TO_INVOICE`) | — |
| `lostSalesConfirmedCount`/`Quantity` | `UnfulfilledDemand` rows `CONFIRMED_LOST`, cohorted by `createdAt` (M4 has no dedicated "confirmed lost" timestamp) | `createdAt` |
| `bottlenecks[]` | Average days between two consecutive lifecycle timestamps on the SAME record, over only the records that have both timestamps (never padded with a null-as-zero) | varies per transition |

`orderStatus`/`quotationStatus` are **not** applied in this file — the funnel's own breakdown (`ordersAwaitingApproval`/`ordersConfirmed`/`ordersRejected`/… and `quotationsAccepted`/`quotationsRejected`/`quotationsExpired`/…) already answers "how many of each status," so an equality filter here would collapse that breakdown to a single already-visible number. Both filters apply for real on the two list-shaped management reports this funnel's own figures link out to (`outstanding-orders`/`awaiting-fulfilment`).

## 3. Picking & fulfilment (`lib/reporting/fulfilment-intelligence.ts`)

Six quantities, never blended into each other, per the spec's explicit "do not treat dispatched as delivered" / "do not treat picking completion as delivery completion":

| Quantity | Source | Meaning |
|---|---|---|
| `orderedQuantity` | `PickingLine.requestedQuantity` | What was asked for |
| `availableQuantity` | `PickingLine.foundQuantity` | What picking actually found (this schema has no separate "available" column — the act of picking *is* the act of discovering availability) |
| `shortageQuantity` | `PickingLine.unavailableQuantity` | Requested but not found at pick time |
| `dispatchedQuantity` | `DispatchLine.dispatchedQuantity` | What physically left — may be less than `availableQuantity` for a partial dispatch |
| `acceptedQuantity`/`rejectedQuantity` | `DeliveryLine` | The customer's own recorded response — only exists once a `DeliveryRecord` has been recorded |
| `outstandingDeliveryQuantity` | Dispatched, no `DeliveryRecord` yet | Still in transit — the figure that proves dispatched ≠ delivered |

Rates (`pickingAvailabilityRatePercent`, `deliveryAcceptanceRatePercent`) always divide two sums over the exact same row set, so no cross-cohort mixing is even structurally possible, and each is shown with its own sample size (`pickingLineSampleSize`/`deliveryLineSampleSize`) so a rate from a handful of rows is never mistaken for a stable trend.

`fulfilmentStatus` is **not** applied in this file for the same reason as above — the output already breaks down by `PickingSessionStatus` (picking) and by `DispatchStatus`/`DeliveryOutcome` (dispatch/delivery) as three separate enums at once, so there is no single unambiguous meaning an equality filter could even have at this aggregate level. It applies for real, as exactly one specific entity's status, on the two list-shaped drill-downs (`picking-shortages` → `PickingSessionStatus`; `delivery-exceptions` → `DeliveryOutcome`).

## 4. Financial exposure (`lib/reporting/financial-exposure.ts`)

Three sections with **deliberately uneven filter coverage** — stated here once rather than re-derived from reading three separate functions:

- **`claims`** (`getInvoiceClaimsDashboard`, M6A) and **`reconciliation`** (`getInvoiceReconciliationReports`, M5) are each a whole-business, right-now total by their own original design — only `includeDemo` has any effect on them. `dateFrom`/`dateTo`/`customerId`/`claimStatus` are accepted by the shared filter bar but do nothing to these two sections.
- **`returnsAndCreditNotes`** (new this milestone) is this file's own query and genuinely honors `dateFrom`/`dateTo`/`customerId`.

`exposureByCurrency[]` is kept **per currency, never summed across currencies** — a USD figure and a ZWG figure are two separate rows, never combined into one meaningless cross-currency total. The only money figure ever reported as "actually credited" is `exposureByCurrency[].actualSapCreditedAmount` (a live sum of real `CreditNote` rows); `creditNotesIssuedCount` is a **document count**, a different unit that can never be added to a money amount; `creditNotesPendingCount` is a count of approved resolutions with no matching credit note yet — the structural definition of "approved but not yet actually issued."

## 5. Communications & exceptions (`lib/reporting/communications-monitoring.ts`)

`intake.totalReceived` and `intake.byChannel[]` always use the identical `where` clause, so `totalReceived` is structurally guaranteed to equal the sum of `byChannel[].count` — never two independently-filtered numbers that could silently drift apart.

`outbound.deliveryReceiptsSupported` is always `false`: neither the mock adapters nor the real email/WhatsApp adapters this project built model a provider-side delivery receipt distinct from "the send attempt itself succeeded or failed." `outbound.sent`/`outbound.failed` report exactly that — whether `SENDING` succeeded — honestly, under their own name, rather than being mislabelled "delivered."

`communicationStatus` is **not** applied anywhere — this report's whole output already is a breakdown by status on both sides (intake: received/awaiting-review/processed/duplicate; outbound: queued/sent/failed). It applies for real, fixed to `FAILED`, as the `communication-failures` list report's own identity.

## 6. The 9 management reports (`lib/reporting/management-reports.ts`)

Restricted to `SALES_MANAGER`/`ADMINISTRATOR` (spec section 10), enforced server-side in every `/api/reports/management/*` route via `lib/reporting/access.ts`, never UI-only.

| Report id | Shape | What it is |
|---|---|---|
| `operational-summary` | summary | One function, parameterized by `period` (`daily`/`weekly`/`monthly`) — today ± N days fed into the same pipeline/fulfilment/financial/communications functions every other report uses, never three near-duplicate functions |
| `outstanding-orders` | list | Orders not `CANCELLED`/`REJECTED` and not yet confirmed fully delivered (documented approximation: several partial dispatches that together cover the full quantity, none individually `ACCEPTED_IN_FULL`, still shows here — see the function's own comment) |
| `awaiting-fulfilment` | list | Orders `APPROVED`/`PICKING` with no dispatch that has actually `DEPARTED`/`DELIVERED` yet |
| `picking-shortages` | list | `PickingLine` rows where `unavailableQuantity > 0` |
| `delivery-exceptions` | list | `DeliveryRecord` rows `PARTIALLY_REJECTED`/`FULLY_REJECTED` |
| `quotations-performance` | summary | All-time quotation dashboard counts (M7, unfiltered) + the period-scoped funnel from section 2 above |
| `lost-sales` | summary | M4's own summary, reused as-is — only `includeDemo` has effect |
| `invoice-claims-exposure` | summary | This file's own `getFinancialExposureReport` — see section 4's uneven-filter-coverage note |
| `communication-failures` | list | `OutboundMessage` rows `FAILED` — the drill-down into section 5's `outbound.failed` figure |

### Status-filter applicability — the one genuinely nontrivial decision this round made

A status-equality filter (`orderStatus`/`fulfilmentStatus`/`quotationStatus`/`claimStatus`/`communicationStatus`) is only ever wired into a report whose OWN output does not already break every row down by that exact status. Applying one to an aggregate that already reports "N received, M approved, K rejected" would silently collapse that breakdown to a single number already visible in the unfiltered response — never useful, and in the worst case misleading (it would look like the filter "did nothing" when it actually just restated existing data). Concretely:

- **Applied for real**: `orderStatus` on `outstanding-orders`/`awaiting-fulfilment` (each narrows *within* its own status definition, via an `AND: [...]` array — never replaces it); `fulfilmentStatus` as `PickingSessionStatus` on `picking-shortages`; `fulfilmentStatus` as `DeliveryOutcome` on `delivery-exceptions`.
- **Deliberately not applied**: everywhere else, including inside `sales-pipeline`/`fulfilment-intelligence`/`communications-monitoring`/`financial-exposure`'s own aggregate functions, and on the `communication-failures`/`lost-sales`/`quotations-performance`/`invoice-claims-exposure`/`operational-summary` management reports (each is already either status-broken-down or a thin reuse of an already-independent dashboard).
- **`fulfilmentStatus`/`communicationStatus` are not centrally validated** in `lib/reporting/filters.ts`, because each maps onto more than one schema enum depending on which report consumes it (`PickingSessionStatus`/`DispatchStatus`/`DeliveryOutcome`; `MessageIntakeStatus`/`OutboundMessageStatus`). A value from the *wrong* enum for a given report is treated as "not applicable" (silently not applied, never a thrown error and never forced into an always-zero-rows filter) — see `applicableEnumFilter` in `lib/reporting/management-reports.ts`.

## 7. Demo-data and pagination conventions

Every report defaults to `includeDemo: false` (`lib/reporting/filters.ts`'s `demoWhere`), matching every dashboard already built in prior milestones. Pagination is capped at `REPORT_MAX_PAGE_SIZE` (200 rows) server-side — the filter/customer/salesperson dropdowns are themselves capped at 500 rows (`FILTER_OPTION_CAP`, `lib/reporting/filter-options.ts`) with Product given no dropdown at all (7,500+ catalogue rows) and a plain exact-ID text input instead, per the spec's "never load an entire table into the browser."
