/**
 * Milestone 12 (Sales Performance Intelligence). Pure new/repeat
 * customer classification -- split out from lib/reporting/
 * customer-activity-queries.ts for the same @prisma/client-stub reason
 * as lib/reporting/attribution.ts's own module comment explains.
 *
 * Definitions, exactly as approved:
 *   - Qualifying invoice: a SapInvoice row with isCancelledOrReversed
 *     false, a resolved matchedCustomerId, and a non-null invoiceDate.
 *     Counted as whole DISTINCT INVOICE RECORDS, never invoice lines --
 *     a multi-line invoice is one qualifying transaction, not N. A
 *     fully-credited invoice (a CreditNote reducing it to zero net
 *     value) still counts as qualifying: the only exclusion gate is
 *     isCancelledOrReversed, the SAP-native document-status flag, same
 *     as the existing M5 reconciliation precedent -- a later credit
 *     note is a separate, non-conflated fact, never treated as
 *     un-happening the original sale.
 *   - NEW (for a selected period): this customer's first-ever qualifying
 *     invoice date falls INSIDE the selected period. Naturally covers
 *     "first and second invoice both land in the same period" (the
 *     first-ever date is itself the one checked).
 *   - REPEAT (for a selected period): this customer has a qualifying
 *     invoice INSIDE the period, AND their first-ever qualifying invoice
 *     date is STRICTLY BEFORE the period.
 *   - A customer with no qualifying invoice inside the period is
 *     classified as NEITHER, regardless of history -- never counted as
 *     an "active" new or repeat customer for a period they didn't buy
 *     in.
 *
 * This two-fact algorithm (a global all-time MIN(invoiceDate) per
 * customer, plus an in-period existence check) computes the SAME way
 * regardless of which date range is selected, so "applied consistently
 * across date filters and historical comparisons" holds by
 * construction, not by convention.
 */

export type CustomerPeriodActivity = "NEW" | "REPEAT";

/**
 * `firstQualifyingDate` is this customer's earliest qualifying
 * SapInvoice.invoiceDate ACROSS ALL TIME (never scoped to the period).
 * `periodFrom`/`periodTo` are inclusive UTC calendar-day bounds.
 *
 * Callers MUST only invoke this for a customer already known to have at
 * least one qualifying invoice INSIDE the period (see this module's own
 * "NEITHER" rule above) -- such a customer is excluded from
 * classification entirely and never reaches this function. Under that
 * precondition, firstQualifyingDate can never fall strictly after
 * periodTo (it is a MIN over a set that includes at least one in-period
 * date), so this function always returns a real answer.
 */
export function classifyCustomerPeriodActivity(firstQualifyingDate: Date, periodFrom: Date, periodTo: Date): CustomerPeriodActivity {
  const isInsidePeriod = firstQualifyingDate.getTime() >= periodFrom.getTime() && firstQualifyingDate.getTime() <= periodTo.getTime();
  return isInsidePeriod ? "NEW" : "REPEAT";
}
