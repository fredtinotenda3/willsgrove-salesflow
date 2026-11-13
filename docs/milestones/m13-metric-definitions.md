# Milestone 13 — Customer Intelligence: metric definitions

The authoritative catalogue of every figure the Customer 360 profile
(`/customers/[id]`) and the management customer-intelligence overview
(`/reports/customer-intelligence`) show, referenced by short comments
throughout `lib/reporting/customer-revenue.ts`/`customer-purchasing.ts`/
`customer-recency.ts`/`customer-segmentation.ts` and their `-queries.ts`
halves rather than re-explained inline at each call site. Read alongside
`docs/milestones/m11-metric-definitions.md` and `m12-metric-definitions.md`,
which this file does not repeat.

## 1. Why this milestone exists

Milestones 11/12 built salesperson- and whole-business-shaped reporting.
Nothing in this codebase let a user ask "tell me everything about THIS
customer" or "rank my customers against each other." Milestone 13 is
that customer-keyed reporting layer, built entirely over data M1/M5/M6A/
M6B/M11/M12 already write — **zero schema changes**. Two surfaces:

- **Customer 360 profile** (`/customers/[id]`, open to all three roles —
  the first Customer Intelligence page with no management restriction).
  One customer's own figures, in full, with no ranking context.
- **Management customer-intelligence overview**
  (`/reports/customer-intelligence`, `SALES_MANAGER`/`ADMINISTRATOR`
  only). Ranks every eligible customer against each other, per
  dimension, per currency where money is involved — **no composite
  score, no tier, no churn label**, by explicit instruction.

## 2. The as-of-date rule (`lib/reporting/customer-recency.ts`)

Every recency figure (days-since-last-qualifying-invoice, average
inter-purchase interval) is computed **as of a specific date**, resolved
once per request by `resolveAsOfDate`:

- A **historical** report (an explicit `dateTo` was selected):
  `asOfDate = dateTo`. Re-running the same report later with the same
  `dateTo` returns the same figures, provided the underlying `SapInvoice`
  rows haven't themselves changed — a historical report must be
  reproducible, never silently drifting as "today" moves forward.
- A **live** Customer 360 profile with no historical `dateTo` selected:
  `asOfDate` = the current business date in **Africa/Harare**
  (`currentBusinessDateInHarare`, resolved via the real IANA tz
  database, never a hardcoded UTC+2 offset), never the server's own UTC
  calendar date — a server in another timezone must not silently shift
  which calendar day "today" means for this business.

`computeDaysSinceLastQualifyingInvoice` returns `null` — rendered as "No
qualifying invoice on record," never `0` — when the customer has no
qualifying invoice at or before `asOfDate` at all. `0` is reserved for a
genuine same-day case. `computeAverageInterPurchaseInterval` similarly
returns an explicit `{ status: "insufficient_data" }` rather than `0`
when fewer than two usable dates exist within the period — `0` is a real
answer reserved for two invoices that genuinely share the same date.

## 3. SAP invoice line value, customer-keyed (`lib/reporting/customer-revenue.ts`)

The customer-keyed twin of Milestone 12's `sales-revenue.ts`. Same
"SAP invoice line value" label and never-call-it-revenue rule (see
`m12-metric-definitions.md` §4) — `SapInvoiceLine.lineTotal`'s VAT
treatment still cannot be established anywhere in this codebase.
`groupRevenueByCurrencyAndCustomer` groups by currency **first** (never
summed across currency, reusing `sales-revenue.ts`'s own
`UNKNOWN_CURRENCY` bucket rather than redefining it), then by customer
within each currency — deliberately the same shared primitive
(`currencyKey`/`sumMoneyRows`), never a second currency-normalization
implementation.

A line belongs to the customer recorded on its **own invoice header**
(`SapInvoice.matchedCustomerId`) — never resolved through order/
salesperson matching, which is Milestone 12's separate, unrelated join.
A `SapInvoiceLine`'s customer is a direct, unambiguous fact of its own
invoice header, carrying none of M12's order-attribution-confidence
ambiguity.

## 4. Product purchasing patterns (`lib/reporting/customer-purchasing.ts`)

Four **deliberately separate** metrics per `(customer, sapItemCode)` —
never combined into one number (this replaced an earlier, rejected
`SUM(quantityInvoiced / lineTotal)` "average price" expression):

1. **Quantity purchased**: `SUM(quantityInvoiced)`, grouped by
   `(sapItemCode, the LINE's own recorded unitOfMeasure)` — never
   `Product.unitOfMeasure` (separate master data, a different import,
   can be null or lag the transactional record). A sapItemCode invoiced
   under two different recorded units gets two separate rows, never
   summed together ("5 EA + 3 CTN" is not a meaningful number).
2. **SAP invoice line value per product**: `SUM(lineTotal)`, grouped by
   `(sapItemCode, SapInvoice.currencyCode)` — never summed across
   currency, same rule as every other money figure in this project.
3. **Purchase frequency**: `COUNT` of **distinct qualifying invoices**
   (never invoice lines) containing ≥1 line with this `sapItemCode` —
   two lines for the same item on one invoice is one purchase, not two.
4. **Last purchased**: `MAX(invoiceDate)` among qualifying invoices
   containing this item, bounded by whatever period/as-of filter the
   caller already applied — bounded exactly once, at the query layer.

`sapItemCode`/`unitOfMeasure`/`currency` each get their own explicit
`UNKNOWN_*` bucket when missing — never silently merged into a real
value. Product-master match status/category is joined separately by
the queries layer (`customer-purchasing-queries.ts`); when no `Product`
row exists for a `sapItemCode`, the UI falls back to the invoice line's
own recorded description (`latestLineDescription`, taken from whichever
contributing line has the **latest** `invoiceDate` — an explicit,
reasonable tie-break, never the first row in arbitrary fetch order).

## 5. Customer-intelligence ranking (`lib/reporting/customer-segmentation.ts`)

Per the explicit business decision for this milestone: **no fixed
financial thresholds, no percentile segmentation, no stored customer-
segment field, and no single composite score/tier.** The management
overview ranks customers independently along three dimensions — SAP
invoice line value (within one currency), purchase frequency, and days
since last qualifying invoice — and never merges them into one number.

`rankByValue` assigns sequential 1-based ranks (never a shared
"competition" rank for ties), ties broken deterministically by
`customerId` so the same input always produces the same output
regardless of fetch order. Every customer's rank is traceable to one
real, displayed value — never a derived or weighted score.

**Currency separation is the caller's job, not this module's**: ranking
"SAP invoice line value" across customers transacting in different
currencies would be meaningless (a USD customer must never be ranked
against a ZWG customer). `lib/reporting/customer-revenue-queries.ts`'s
`getCustomerIntelligenceOverview` groups customers by currency first and
calls `rankByValue` once per currency group; purchase-frequency and
recency ranking (no currency dimension at all) call it once,
whole-population.

**Population default**: every eligible customer is ranked, **including
those with zero qualifying invoices in the selected period**, unless the
caller explicitly sets `minimumActivityOnly: true` (the management
overview's UI toggle, default OFF) — an intelligence report should not
silently hide a customer with real invoice history just because they
went quiet or inactive in the selected window.

## 6. Commercial health (`lib/reporting/customer-commercial-health-queries.ts`)

- **Claims raised in period**: count of `InvoiceClaim.claimDate` falling
  inside the selected period.
- **Open as of the reporting date** — explicitly **calculated**, not a
  true historical replay of `InvoiceClaim.status`: this schema has no
  event-sourced claim-status history (`AuditEvent` records every change
  but, per this codebase's own established convention — see
  `Quotation`'s own schema comment — is never replayed into a point-in-
  time reconstruction anywhere). The approximation used is
  `claimDate <= asOfDate AND (closedAt IS NULL OR closedAt is on/after the day after asOfDate)`.
  Bulk-computed for every customer on the management overview in one
  query (`getOpenClaimsCountByCustomer`, batched at 500 ids for driver
  safety, never one query per customer).
- **Exposure by currency**: reuses `lib/invoice-claims/financial.ts`'s
  `computeExposureByCurrency` verbatim — zero new financial logic for
  claims. All-time, current-state (a running state, not a flow), same
  treatment the whole-business M6A dashboard already gives it — never
  period-scoped.
- **Returns by condition**: physical `ClaimReturn` rows received inside
  the selected period, grouped by `ReturnCondition`
  (`GOOD_RESALABLE`/`DAMAGED`/`EXPIRED`/`OTHER`, M6B's own enum).
- **Actual credit notes — the union path**: `CreditNote` rows reachable
  by **either** of two mutually exclusive branches — claim-linked
  (`claim.customerId === customerId`) **or** directly invoice-linked
  (`claimId: null`, `sapInvoice.matchedCustomerId === customerId`, the
  shape a CSV credit-note import produces when it matches straight to
  an invoice with no claim at all, per `lib/returns-credits/plan-import.ts`).
  The two branches cannot overlap by construction — one requires a
  linked claim, the other requires `claimId: null` — so a single query
  can never double-count one credit note under both paths. This closes
  a real gap M6A/M6B's own whole-business, claim-centric
  `computeExposureByCurrency` cannot see on its own (see §7). Reported
  as **in-period-by-currency** (notes dated inside the selected period)
  and a separately-labelled **all-time-cumulative-by-currency** (never
  implied to be the period's own figure), with notes carrying no
  `creditNoteDate` at all excluded from the in-period figure (can't be
  period-scoped) but still counted in the all-time cumulative total —
  never silently dropped.
- **Delivery outcomes** — explicitly labelled *"operational signal, not
  a commercial dispute"* and shown in its own section, never combined
  with the claims/returns/credit-note figures above: `PARTIALLY_REJECTED`/
  `FULLY_REJECTED` `DeliveryRecord` rows for the customer's orders,
  inside the selected period. A delivery rejection is a fulfilment fact;
  only a human filing an `InvoiceClaim` turns it into a commercial one
  (M10's own established rule).

## 7. Never conflate: Milestone 6B's claim-centric credit-note figure vs. this milestone's customer-centric one

`lib/invoice-claims/financial.ts`'s `CurrencyExposureBucket.actualSapCreditedAmount`
(M6B) and this milestone's `CustomerCommercialHealth.actualCreditNotes`
are both real, live sums of `CreditNote` rows — but over **different
populations**. M6B's figure runs **per-claim**, across every claim
against a given SAP invoice (or, on the M6A dashboard, every claim
whole-business). This milestone's figure runs **per-customer**, across
the claim-linked **and** direct-invoice-linked union described in §6.
They are shown side by side on the Customer 360 profile with
distinguishing labels and must never be added together or treated as
reconciling exactly against one another — they answer different
questions ("how much has SAP actually credited against this specific
claim/invoice" vs. "how much has SAP actually credited this customer,
by any path").

## 8. Access tier

The Customer 360 profile (`/customers/[id]` and its API route +
export sibling) is open to **all three roles**
(`requireUserOrResponse()`, no role list) — the first Customer
Intelligence surface with no management restriction, modeled on
`app/orders/[id]/page.tsx`'s own no-role-redirect precedent: a
salesperson can see a customer's full purchasing/commercial history,
same as any manager, because that is operational information needed
day to day. The management overview (`/reports/customer-intelligence`
and its API route + export sibling) is **management-only**
(`requireManagementReportAccess`) — comparing customers against each
other is management information, the same precedent M12 set for
salesperson comparison. Enforced server-side in every route; the
page-level redirect for a `SALESPERSON` on the overview is a UX
convenience only, never the security boundary.

## 9. Known, documented limitations

- "Open as of the reporting date" (§6) is an approximation derived from
  `claimDate`/`closedAt` only, not a true point-in-time replay of
  `InvoiceClaim.status` — this schema has no event-sourced status
  history anywhere, and this milestone does not add one.
- The management overview's ranking has **no composite score and no
  percentile/tier segmentation**, by explicit decision — never silently
  added in a future round without a fresh decision to do so.
- `getCustomerProductPurchasing`/`getCustomerCommercialHealth`/
  `getCustomerRevenueProfile` do not apply `ReportFilters.productId`,
  `orderStatus`, `quotationStatus`, `fulfilmentStatus`, `claimStatus`,
  or `communicationStatus` — the Customer 360 profile and the
  management overview use only `dateFrom`/`dateTo`/`includeDemo` (and,
  for the overview, `currency`), the same "a filter field is accepted
  everywhere but only actually does something where it's wired in"
  convention `m11-metric-definitions.md` §6 already documents.
- Quotations shown on the Customer 360 profile carry no classification
  or health signal of their own this milestone — they are listed for
  reference only (status, dates, total), exactly as `Quotation`'s own
  M7 fields record them.
