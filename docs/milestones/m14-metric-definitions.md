# Milestone 14 — Product Intelligence: metric definitions

This document records, in one place, exactly what every Milestone 14
figure means, how it is computed, and which documented limitation applies
to it. It exists for the same reason `m11/m12/m13-metric-definitions.md`
do: so a manager reading a Product 360 profile or the Product
Intelligence overview can trust what a number means without reading the
query code, and so a future engineer changing this code knows which rule
is deliberate and which is an honestly-documented workaround.

## 1. Why this milestone exists

Milestones 1-13 gave Willsgrove SalesFlow customer-, order-, fulfilment-
and claim-level operational reporting (M9-M13), but no PRODUCT-level
view. A manager could ask "how is this customer doing?" (M13) but not
"how is this PRODUCT doing — what sells, what doesn't, what's going
wrong with it?" Milestone 14 closes that gap with two surfaces:

- **Product 360** (`/products/[id]`) — one product's own complete
  picture: revenue, quantity, customers, demand, lost sales, claims,
  credit notes, delivery performance and deterministic insights. Open to
  all three roles (SALESPERSON, SALES_MANAGER, ADMINISTRATOR), same as
  Customer 360.
- **Product Intelligence overview** (`/reports/product-intelligence`) —
  management-only, ten INDEPENDENT rankings (spec section 4.B), never
  combined into one composite score or product tier.

Every identity, aggregation and access rule below follows the exact same
engineering discipline M9-M13 already established: no fabricated data,
no invented thresholds, no silent merging, no hidden exclusions.

## 2. Product identity: SAP item code is canonical, Product.id is the Product 360 key

Per spec sections 1-3, the SAP item code (`SapInvoiceLine.sapItemCode`,
`Product.sapItemCode`) is the one canonical product identity used for
EVERY aggregation, grouping and ranking in this milestone — never a
description-based match, and never a silent merge of two different SAP
item codes into one row.

`Product.id` (a cuid) is used for exactly one thing: the Product 360
route parameter (`/products/[id]`). This is a deliberate design choice,
not an accident: the page shows a profile of one Product MASTER RECORD.
An unmatched SAP item code (real invoice activity, no Product row at all)
has no master record to show a profile of — it surfaces only through the
management overview's item 10 ("incomplete or unmatched master data"),
never hidden (spec section 10), and never given a fabricated profile
page.

## 3. The ten management-overview ranking dimensions (spec section 4.B)

Every dimension below is computed, ranked and displayed INDEPENDENTLY.
**They are never combined into one composite score, and no product tier
or classification is invented anywhere in this milestone.** Each has its
own named key on `ProductIntelligenceOverviewReport`
(`lib/reporting/product-insights-queries.ts`) and its own `SectionCard`
on the overview page — never a single merged table.

1. **SAP invoice line value, by currency** — `SUM(SapInvoiceLine.lineTotal)`
   over qualifying invoices (the same qualifying-invoice rule M9-M13
   already established: not cancelled/reversed, has a usable
   `invoiceDate`), grouped by `(sapItemCode, SapInvoice.currencyCode)`.
   Ranked separately PER CURRENCY — a USD total and a ZWG total are never
   summed or compared against each other.
2. **Invoiced quantity, by unit of measure** — `SUM(SapInvoiceLine.quantityInvoiced)`,
   grouped by `(sapItemCode, SapInvoiceLine.unitOfMeasure)` — the LINE's
   own recorded unit, never `Product.unitOfMeasure` (separate master
   data, populated by a different import, can lag or be null — see
   section 6 below). Ranked separately per unit; "5 EA" and "3 CTN" are
   never added together.
3. **Invoice frequency** — COUNT of DISTINCT qualifying invoices
   containing this item code in the period, never a count of lines (two
   lines for the same item on one invoice is one purchase).
4. **Distinct purchasing customers** — COUNT of DISTINCT
   `SapInvoice.matchedCustomerId` values among this item's qualifying
   invoices in the period.
5. **Highest recorded lost-sales activity** — COUNT and summed quantity
   of CONFIRMED `LostSaleRecord` rows only (never an assumption that
   every unfulfilled/cancelled order line became a lost sale — spec
   section 5.6), grouped by `UnfulfilledDemand.sapItemCodeSnapshot`.
6. **Highest claim and return activity** — see section 4 below for the
   single-vs-multi-product attribution rule this depends on. Reports TWO
   numbers per product: `claimCount` (inclusive — any claim touching this
   product at all) and `returnCount` (conservative — only returns on
   claims this milestone can attribute to exactly one product).
7. **Highest actual credit-note values, by currency** — same
   single-product attribution rule as item 6, applied to `CreditNote`
   (both claim-linked and direct-invoice-linked notes — the same union
   M13's own customer-centric credit-note figure already established).
   Ranked separately per currency.
8. **Highest recorded delivery rejection quantities** — see section 5
   below. LINE-level `DeliveryLine.rejectedQuantity`, never
   `DeliveryRecord`'s header-level `outcome` (which can span several
   products in one shipment).
9. **Declining invoice activity vs. the previous comparable period** —
   see section 7 below.
10. **Incomplete or unmatched master data** — see section 8 below. A
    FLAGGED LIST, deliberately with NO `rank` field (unlike every other
    dimension above) — "incomplete/unmatched" is a binary data-quality
    fact, not a magnitude to rank highest-to-lowest.

Every row in every dimension links to the corresponding Product 360
profile when `productId` is resolved (spec section 4.B: "provide links
from overview results to the corresponding Product 360 profile"); a row
with `productId: null` (an unmatched SAP item code) simply has no link,
consistent with Product 360 only existing for a real master record.

## 4. Claim/return/credit-note product attribution — the single-product rule

Two structural schema gaps, confirmed directly against `prisma/schema.prisma`
during inspection:

- `CreditNote` has NO product or line-level field at all — only
  `claimId`/`sapInvoiceId` (both nullable).
- `ClaimReturn.claimLineId` is OPTIONAL — a return can be recorded
  against the whole claim with no specific line, so it may span
  whichever products the claim's lines cover.

Per spec sections 5.7/7 ("never infer product-level credit allocations
from invoice-level totals unless the database explicitly supports that
allocation"), the rule (`lib/reporting/product-commercial-health.ts`'s
`resolveSingleProductSapItemCode`) is:

> A claim (and, by extension, any credit note or claim-level return tied
> to it) is attributable to ONE product only when every one of its lines
> resolves to the SAME single SAP item code. A claim whose lines span two
> or more distinct item codes — or whose lines carry no resolvable item
> code at all — is NOT attributed to any product; it is counted in an
> explicit `multiProductClaimCount` / `unattributableCreditNoteCount`
> bucket instead of being guessed or split pro-rata.

This produces two deliberately separate figures per product, never
merged: `claimCount` is INCLUSIVE (any claim touching this product at
all — a reliable, un-guessed fact); `exposureByCurrency` /
`actualCreditNotes` / `returnCount` are CONSERVATIVE (computed only from
claims/invoices that resolve to this product and no other). The
multi-product exclusion count is always shown, never silently absorbed
into any one product's total.

## 5. Delivery/fulfilment reach: line level, and the DispatchRecord date-field fix

Reached via `OrderLine.productId`/`sapItemCodeSnapshot` →
`DispatchLine.orderLineId` → `DeliveryLine.dispatchLineId` — LINE level
throughout, never `DeliveryRecord`'s own header-level `outcome` (spec
section 4.5: "never classify every delivery rejection as a product
quality defect" for a shipment that may contain other products).

**Documented limitation (spec section 15's fallback clause):**
`DispatchRecord` has no `dispatchedAt` column — confirmed directly
against `prisma/schema.prisma`. Its date-bearing fields are
`plannedDepartureAt`/`departedAt`/`cancelledAt`, all nullable (a dispatch
may be planned but not yet physically departed). Using any of those for
the period filter would silently exclude legitimate
dispatched-but-not-yet-departed activity. `DispatchLine`'s own
`createdAt` (non-nullable, set when this dispatch line — i.e. this
quantity's dispatch — was recorded) is used instead. **This makes the
accepted/rejected figures the eventual outcome of dispatches that
occurred in the period (a cohort view), not of deliveries recorded in
the period** — the closest defensible reading of "fulfilment activity in
the period" this schema supports, honestly documented here rather than
silently assumed.

## 6. Quantity and category: transaction-level only, deliberately never Product-master fields

Every quantity figure in this milestone (items 2, 5's quantity total, 8's
rejected quantity) uses the TRANSACTION's own recorded unit of measure —
`SapInvoiceLine.unitOfMeasure`, `OrderLine.requestedUnitCode` — never
`Product.unitOfMeasure`. That master-data field is populated by a
separate import and can lag or be null; mixing it in would silently
misreport a transaction that used a different unit at the time.

Item 10's "incomplete" check is correspondingly scoped NARROWLY to
`Product.category` — the one nullable Product-master field this
milestone's own filters and display actually depend on (the
`productCategory` filter, spec section 6). A null `Product.unitOfMeasure`
is deliberately NOT flagged as an "incompleteness" this milestone has any
stake in, for the same reason it is never used for a quantity figure.

## 7. Declining invoice activity (item 9): per-currency, previous period of equal duration

"Declining" is the SAME per-currency rule
`lib/reporting/product-insights.ts`'s `hasDeclineSimple` already
establishes for the Product 360 single-product insight: the current
period's value, for a given currency, strictly lower than that SAME
currency's previous-period value — applied here across every currency a
product transacted in, since this overview ranks "highest decline"
independently PER CURRENCY (same convention as items 1-4), never a
single cross-currency figure.

The previous period (`lib/reporting/product-segmentation.ts`'s
`computePreviousPeriod`) is the immediately preceding period of EQUAL
DURATION, with no gap and no overlap:

```
current:  [dateFrom .......... dateTo]        (N days inclusive)
previous: [previousFrom .. previousTo]         (same N days)
                              previousTo = dateFrom - 1 day
```

A product with zero previous-period activity in a currency is simply
ABSENT from that currency's comparison set — spec section 6's "handle a
zero previous period without division," never treated as a fabricated
100% decline.

## 8. Incomplete or unmatched master data (item 10)

Two DISTINCT issues, both surfaced, never hidden (spec section 10):

- **`unmatched`** — a SAP item code with real qualifying-invoice activity
  in the selected period that has no corresponding `Product` master row
  at all.
- **`incomplete_category`** — a matched `Product` whose `category` is
  null (see section 6 above for why only `category`, never
  `unitOfMeasure`).

This dimension carries no `rank` field — see section 3, item 10.

## 9. Deterministic insights (spec section 7)

`lib/reporting/product-insights.ts` generates every Product 360 insight
from a product's own already-computed metrics, pure and reproducible —
no LLM call, no randomness, no fabricated explanation. The spec's own
illustrative language ("repeated," "high," "significant") inherently
implies some cutoff; rather than invent a business-judgment number (e.g.
"more than 3 claims is a concern"), every rule uses a STRUCTURAL cutoff
that needs no judgment call:

- **"repeated"** == occurred more than once (count >= 2) — the plain
  dictionary meaning of the word.
- **"declining"** == the current period's own figure is strictly lower
  than the immediately preceding period's, for the SAME currency — a
  direction, never a percentage magnitude.
- **"credit notes significant relative to invoice activity"** == actual
  credit-note value in a currency is greater than or equal to the SAP
  invoice line value invoiced in that SAME currency in the same period —
  a self-justifying 100% bar, not a chosen percentage tier.

A product with fewer than two qualifying invoices all-time gets exactly
one insight — `insufficient-data` — and every other rule is skipped,
since no trend, decline, or recurring-issue pattern can be reliably
assessed from a single data point.

## 10. Access tier

- **Product 360** (`/products/[id]`, `app/api/products/[id]/profile/route.ts`
  and its export sibling) — `requireUserOrResponse()`, no role list: open
  to SALESPERSON, SALES_MANAGER and ADMINISTRATOR alike (spec section
  4.A).
- **Product Intelligence overview** (`/reports/product-intelligence`,
  `app/api/reports/product-intelligence/route.ts` and its export
  sibling) — `requireManagementReportAccess()`: SALES_MANAGER and
  ADMINISTRATOR only (spec section 4.B). Enforced server-side in both the
  view and export route; a hidden nav link for SALESPERSON is never the
  real control.

## 11. Known, documented limitations

Stated honestly, per spec section 15's own instruction, rather than
silently assumed:

- **Delivery rejections are a cohort view** (section 5 above) —
  dispatches that OCCURRED in the period, not deliveries RECORDED in the
  period, because `DispatchRecord` has no single field meaning "when
  this fulfilment cycle completed."
- **Claim/return/credit-note product attribution is conservative**
  (section 4 above) — a claim or credit note spanning more than one
  product is excluded from any one product's money/return figure and
  counted in an explicit multi-product bucket instead, never guessed or
  split pro-rata.
- **SAP invoice line value by currency is a minimal-column fetch, not a
  true database-side `groupBy`** — `SapInvoiceLine` has no `currencyCode`
  column of its own (it lives only on the parent `SapInvoice`), and
  Prisma's typed `groupBy` cannot group by a joined model's column
  without raw SQL. Every other metric in this milestone (invoiced
  quantity by unit, in particular) IS a true database-side `groupBy`.
- **Lost-sales activity counts only CONFIRMED `LostSaleRecord` rows** —
  never an assumption that every unfulfilled or cancelled order line
  became a lost sale.
- **This file is cross-referenced from the code it describes** — see the
  top-of-file comments in `lib/reporting/product-revenue-queries.ts`,
  `product-commercial-health-queries.ts`, `product-fulfilment-queries.ts`,
  `product-demand-queries.ts` and `product-insights.ts` for the exact
  same rules, stated again at the point of implementation.
