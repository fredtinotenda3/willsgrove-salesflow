# Milestone 12 — Sales Performance Intelligence: metric definitions

The authoritative catalogue of every figure the `/reports/sales-performance` surface shows, referenced by short comments throughout `lib/reporting/attribution.ts`/`customer-activity.ts`/`sales-revenue.ts`/`sales-performance.ts` rather than re-explained inline at each call site. Read alongside `docs/milestones/m11-metric-definitions.md`, which this file does not repeat.

## 1. Why this milestone exists: the attribution-provenance gap

Milestone 11 added `CustomerOrder.salespersonId`, but `lib/orders.ts`'s `createOrderCore` silently defaulted it to the order's **creator** (`input.salespersonId ?? createdById`) on every direct order-creation path, with no audit trail distinguishing "a human deliberately chose this" from "nobody supplied a value, so this is just whoever typed the order in." That default has been removed. Going forward, every order-creation path (`/orders/new`, PO-intake review confirmation) and every quotation-creation path (`/quotations/new`, which also used to pre-fill its picker to the preparer) presents a never-pre-filled picker, and a new `salespersonAssignment` sub-object is written onto the `ORDER_CREATE`/`QUOTATION_CREATED` `AuditEvent.afterData`:

```json
{ "salespersonId": "clxyz...", "source": "explicit" | "unassigned", "assignedById": "clabc..." }
```

The mere **absence** of this sub-object — true of every pre-fix row, by construction — is itself the signal `lib/reporting/attribution.ts` relies on. It is never backfilled onto historical rows and never re-derived from the resolved `salespersonId` field value: a `salespersonId` that happens to differ from `createdById` is never, by itself, read as proof of a deliberate, reliable choice (a manager or administrator could always have picked someone else through the picker — the only way to know that pick was real and recorded is to check for the audit record, not to infer it from the field's value).

## 2. Attribution confidence (`lib/reporting/attribution.ts`)

Six buckets, computed live by `classifyOrderAttribution` — never a stored column, so the classification always reflects the latest understanding of what counts as reliable, not a value frozen at some past import:

| Bucket | Meaning |
|---|---|
| `VERIFIED` | A human recorded, audit-confirmed deliberate choice — either directly on this order, or inherited from a quotation whose OWN creation was itself audit-confirmed. |
| `QUOTATION_SOURCED_LEGACY` | Converted from a quotation created before the quotation-side provenance fix shipped — traceable to a real, required field a human saw, but not audit-confirmed as a deliberate choice. |
| `UNVERIFIED_LIKELY` | Created before the order-side provenance fix shipped, with no explicit salesperson supplied — defaulted to the order's creator, who held the `SALESPERSON` role at creation time. |
| `UNVERIFIED_SUSPECT` | Same as above, but the creator held `SALES_MANAGER`/`ADMINISTRATOR` at creation time — most likely entering on a salesperson's behalf, so materially less likely to actually be that creator's own deal. |
| `UNVERIFIED_NO_PROVENANCE` | `salespersonId` differs from the order's creator (or was set some other way), with no audit record confirming a deliberate choice was ever made. A differing value is never read as proof of a reliable choice. |
| `UNASSIGNED` | `salespersonId IS NULL`. Ownership is genuinely unknown and has not been defaulted to anything — never folded into a confidence tier, reported as its own explicit category. |

**A quotation-sourced order is classified by its SOURCE QUOTATION's own `QUOTATION_CREATED` event, never by the converted order's own `ORDER_CREATE` event** — `lib/quotations/convert-to-order.ts` always supplies a real, inherited `salespersonId` to the new order, so that order's own `ORDER_CREATE` event always looks "explicit" regardless of whether the SOURCE quotation itself was ever a deliberate pick. Reading the order's own event here would make every quotation-converted order look `VERIFIED`, which is exactly the false signal this milestone exists to eliminate. `Quotation.salespersonId` is a required (`NOT NULL`) database field — unlike `CustomerOrder.salespersonId` — so a quotation-sourced order's attribution is never `UNASSIGNED`.

`lib/reporting/attribution-queries.ts` is the database-backed half: it bulk-fetches exactly the `AuditEvent`/`Quotation` rows a batch of orders needs (two extra round trips regardless of batch size — never one query per order) and delegates every classification decision to the pure functions above.

## 3. New/repeat customers (`lib/reporting/customer-activity.ts`)

- **Qualifying invoice**: a `SapInvoice` row with `isCancelledOrReversed: false`, a resolved `matchedCustomerId`, and a non-null `invoiceDate`. Counted as whole distinct invoice records, never invoice lines. **A fully-credited invoice (a `CreditNote` reducing it to zero net value) still counts** — by explicit decision, confirmed this round — because the only exclusion gate is `isCancelledOrReversed`, the SAP-native document-status flag (same precedent the existing M5 reconciliation logic already uses); a later credit note is a separate, non-conflated fact, never treated as un-happening the original sale.
- **NEW** (for a selected period): this customer's first-ever qualifying invoice date falls **inside** the selected period.
- **REPEAT** (for a selected period): this customer has a qualifying invoice inside the period, **and** their first-ever qualifying invoice date is strictly **before** the period.
- A customer with no qualifying invoice inside the period is classified as **neither** — never counted as an "active" new or repeat customer for a period they didn't buy in.

**Basis is `SapInvoice`, not `CustomerOrder`** — confirmed this round, since an order can be approved/cancelled without ever actually being invoiced by SAP, and `SapInvoice` is this codebase's one honestly-SAP-sourced fact about whether a sale actually happened. This two-fact algorithm (one all-time `MIN(invoiceDate)` per customer, plus an in-period existence check) computes the same way regardless of which date range is selected, so "applied consistently across date filters and historical comparisons" holds by construction. This metric is **whole-business, never split by salesperson** — a single `SapInvoice` can span multiple SalesFlow orders with different salespeople (see `SapInvoice.matchedOrderId`'s own schema comment), so there is no single owner to attribute a customer's new/repeat status to.

## 4. "SAP invoice line value" — deliberately never called "revenue" (`lib/reporting/sales-revenue.ts`)

`SapInvoiceLine.lineTotal`'s VAT treatment (tax-inclusive vs. tax-exclusive) cannot be established from this codebase or its documentation — confirmed by a repository-wide search (`lib/`, `docs/`, `CHANGES.md`, every `MILESTONE*.md`, `prisma/schema.prisma`) for inclusive/exclusive VAT terminology, which returns no matches. The one real, independently-confirmed invoice example this project has ever examined (`HRE580108`, item `0228`) is VAT-zero-rated, which cannot resolve the question either way. Calling this figure "revenue" or "gross revenue" would imply a tax treatment nobody has confirmed — so every money figure this module and its callers surface uses the exact label **"SAP invoice line value"** instead. This is a deliberate decision and must never be silently reverted.

Attributed at **LINE** level (`SapInvoiceLine.matchedOrderId`/`matchedOrderLineId`), never at invoice-**header** level (`SapInvoice.matchedOrderId`) — an invoice spanning several SalesFlow orders (explicitly supported by the schema) leaves the header-level `matchedOrderId` null, so a header-level join would silently lose that invoice's value attribution entirely. See `SapInvoice.matchedOrderId`'s own schema comment.

**Never summed across currency** — `groupRevenueByCurrencyAndSalesperson` groups by currency FIRST and never produces a single cross-currency total, the same precedent `lib/invoice-claims/financial.ts`'s `exposureByCurrency` already established (see `m11-metric-definitions.md` section 4). Header-level `SapInvoice.total`/`taxTotal`/`subtotal` are kept separately available (`headerTotalsByCurrency`) and are never implied to reconcile exactly against the line-level sum — rounding and header-only discounts can legitimately make the two differ.

A line's SALESPERSON is the matched order's own `salespersonId` (never a field the invoice line itself carries), and every revenue row also carries that order's `lib/reporting/attribution.ts` classification — so a salesperson's revenue figure is never read at face value without also seeing how reliably it is actually attributed to them.

## 5. Lost sales by salesperson (`lib/reporting/sales-performance.ts`)

New this milestone — joins `LostSaleRecord` → `UnfulfilledDemand` → `CustomerOrder` (for `salespersonId`/`currency`), since no existing M4 query is shaped this way. Anchored on `LostSaleRecord.confirmedAt` (when the lost sale itself was confirmed) — **not** `UnfulfilledDemand.createdAt`, which `lib/reporting/sales-pipeline.ts`'s own, differently-scoped "lost sales confirmed in window" figure uses. This report's own natural anchor is the confirmation event, since that is what `LostSaleReason`/`decisionSource`/`estimatedValue` all describe.

The headline figure is **quantity** (`LostSaleRecord.quantity`), not value — the same choice `lib/reporting/sales-pipeline.ts` already made for its own `lostSalesConfirmedQuantity`, since `estimatedValue` is nullable and, per its own schema comment, "never invented" when absent. `estimatedValueByCurrency[]` is reported separately, grouped by the matched order's own `currency` field (never summed across currency, same rule as section 4), with rows missing an estimate excluded from the sum rather than coerced to 0, and explicitly labelled as an estimate, never an authoritative SAP figure.

`ReportFilters.lostSalesReason` (`LostSaleRecord.reason`) is applied **only** here — every other M11/M12 report is deliberately silent on it, the same "a filter field is accepted everywhere but only actually does something in the one report that needs it" convention `m11-metric-definitions.md` section 6 already documents for `fulfilmentStatus`/`communicationStatus`.

## 6. Per-salesperson conversion funnel (`lib/reporting/sales-performance.ts`)

Reuses — never re-derives — `lib/reporting/sales-pipeline.ts`'s own, already-tested cohort/rate math (see `m11-metric-definitions.md` section 1 for why that matters): one funnel per active salesperson (or just the one named by `filters.salespersonId`, when set), computed by calling `getSalesPipelineReport` once per salesperson with that salesperson substituted into the filter set. Orders/quotations with **no** assigned salesperson are not represented in this breakdown at all (`sales-pipeline.ts` has no "salespersonId IS NULL" filter mode) — they remain visible in the unfiltered `/reports/pipeline` funnel and in this report's own attribution `UNASSIGNED` count (section 2).

## 7. The `ReportFilters.currency`/`lostSalesReason` fields

Both new this milestone. `currency` is a free-form 3-letter code (`CustomerOrder.currency`/`SapInvoice.currencyCode` are both free strings in this schema, never a validated enum), centrally uppercased/shape-checked (not value-checked against a fixed list — there is none) in `lib/reporting/filters.ts`'s `parseReportFilters`. `lostSalesReason` maps onto exactly one schema enum (`LostSaleReason`), so — unlike `fulfilmentStatus`/`communicationStatus` — it IS centrally validated there, the same precedent `orderStatus`/`quotationStatus`/`claimStatus` already set.

`currency` is applied in `lib/reporting/sales-revenue-queries.ts` (narrows to one `SapInvoice.currencyCode` — a genuine completeness fix made this round: the field had been added to `ReportFilters` but never actually wired into that query) and in this milestone's own lost-sales estimated-value breakdown (section 5). It is deliberately **not** applied to the attribution breakdown (section 2) or the new/repeat customer split (section 3), neither of which is money-denominated.

## 8. Access tier

`/reports/sales-performance` and its API/export routes are **management-only** (`SALES_MANAGER`/`ADMINISTRATOR`), via the EXISTING `lib/reporting/access.ts`'s `requireManagementReportAccess` — unlike every M11 **operational** view (`pipeline`/`fulfilment`/`financial-exposure`/`communications`), which stays open to all three roles. Confirmed this round as the correct tier: salesperson-level performance comparison is management information, not a thing a salesperson should see about their colleagues. Enforced server-side in every route; the page-level redirect for a `SALESPERSON` user is a UX convenience only, never the security boundary (spec section 10's standing rule, carried over from M11).

## 9. Known, documented limitations

- `lib/reporting/sales-revenue-queries.ts` and `lib/reporting/customer-activity-queries.ts` do not apply `ReportFilters.productId` — `SapInvoiceLine` carries no `productId` of its own (only `matchedOrderLineId` → `OrderLine.productId`, an extra join neither function makes today). Documented here rather than silently guessed at; a future round can add that join if product-level revenue/customer-activity filtering is actually needed.
- A role change after an order/quotation was created is not tracked — `createdByRole`/the audit-confirmed assignment both reflect the role **at creation time**, which `AuditEvent.afterData` already freezes; there is no live "what if this person's role is different today" question this classifier tries to answer. (Carried over from M11's own documented limitation; `User.role` has no update path anywhere in this codebase today, so this remains forward-looking only.)
- The per-salesperson conversion funnel (section 6) runs `getSalesPipelineReport` once per active salesperson — bounded by `lib/reporting/filter-options.ts`'s own "a few hundred customers, a handful of sales staff at most" scale assumption, not paginated or capped independently.
