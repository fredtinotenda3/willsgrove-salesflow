import "server-only";
import { ClaimResolutionDecision } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getInvoiceClaimsDashboard, type InvoiceClaimsDashboard } from "@/lib/invoice-claims/dashboard";
import type { CurrencyExposureBucket } from "@/lib/invoice-claims/financial";
import { getInvoiceReconciliationReports, type InvoiceReconciliationReports } from "@/lib/invoice-reconciliation/queries";
import { getSupplyShortageLostSalesValue, type SupplyShortageLostSalesValue } from "@/lib/lost-sales/queries";
import { getReturnedGoodsLostSalesValue, type ReturnedGoodsLostSalesValue } from "@/lib/returns-credits/lost-sale-analytics";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToTimestampFilter, defaultDateRange } from "@/lib/reporting/filters";

/**
 * Milestone 11 (Operational BI), spec section 6: a consolidated view of
 * invoice reconciliation, claims and financial exposure. Deliberately a
 * THIN composition over the two already-existing, already-correct
 * aggregate functions below -- reusing their exact figures rather than
 * re-deriving claim/exposure math a second time (spec section 2's core
 * instruction) -- plus the one genuinely new piece this schema didn't
 * have a dashboard for yet: returns and credit notes.
 *
 * The spec's explicit warning -- "never count an approved claim as a
 * completed credit note" / "avoid double-counting amounts across
 * claims, returns and credit notes" -- is kept by construction, not by
 * a runtime check: the ONLY money figure for "actually credited" this
 * file ever surfaces is exposureByCurrency[].actualSapCreditedAmount
 * (from lib/invoice-claims/financial.ts, which itself sums real
 * CreditNote rows per claim). creditNotesIssuedCount below is a
 * DOCUMENT count (how many CreditNote rows exist), a different unit
 * from a money amount, so it can never be added to or confused with an
 * exposure total. creditNotesPendingCount is, separately, a count of
 * APPROVED ClaimResolutions that have NO matching CreditNote at all --
 * the structural definition of "approved but not yet actually issued,"
 * which is exactly the distinction the spec asks for.
 *
 * Filter coverage is NOT uniform across this report's three sections,
 * and that's a deliberate, documented choice rather than an oversight:
 *   - `claims` (getInvoiceClaimsDashboard) and `reconciliation`
 *     (getInvoiceReconciliationReports) are the pre-existing M6A/M5
 *     dashboard functions, reused exactly as spec section 2 asks, and
 *     each is a whole-business "right now" total by its own original
 *     design -- only `includeDemo` applies to them, the same "current
 *     state, not date-ranged" shape operational-dashboard.ts's own
 *     snapshot already has. dateFrom/dateTo/customerId/claimStatus are
 *     accepted by the shared filter bar but have no effect on these two
 *     sections; changing their signatures is out of scope here (spec
 *     section 15).
 *   - `returnsAndCreditNotes` (new in this milestone, below) DOES honor
 *     dateFrom/dateTo and customerId, since it's this file's own query,
 *     not a reused one.
 *   - claimStatus is not applied anywhere in this file for the same
 *     reason orderStatus/quotationStatus aren't applied in
 *     lib/reporting/sales-pipeline.ts: getInvoiceClaimsDashboard's own
 *     output already is a full claims-by-status breakdown.
 */

export type ReturnsAndCreditNotesSummary = {
  returnsAwaitingResolution: number; // claims with a recorded ClaimReturn whose own status is not yet RESOLVED/CLOSED/REJECTED
  returnsResolved: number;
  /** Approved (ClaimResolution.approvedAt set, decision recommends a credit) but with no CreditNote row recorded against that claim yet -- see this file's own comment on why this can never be summed with creditNotesIssuedCount. */
  creditNotesPendingCount: number;
  creditNotesIssuedCount: number;
  creditNotesIssuedCountInPeriod: number;
};

/**
 * Final Operational Enhancements (spec Part 7): the two lost-sales
 * sources this business must track SEPARATELY, never blended into one
 * number:
 *   - Source A ("invoice claims after delivery"): "Affected Value =
 *     Affected Quantity x Applicable Unit Price," as an estimate/
 *     exposure -- this is exactly `claims.exposureByCurrency` above
 *     (lib/invoice-claims/financial.ts's potentialCreditExposure,
 *     unchanged, reused by reference rather than recomputed).
 *   - Source B ("insufficient supply at fulfilment"): "Estimated Supply
 *     Lost Sales = Unavailable Quantity x Applicable Selling Price" --
 *     lib/lost-sales/queries.ts's getSupplyShortageLostSalesValue(),
 *     likewise unchanged/reused.
 *
 * These cannot double-count by construction, not merely by convention:
 * Source A requires an actual SapInvoiceLine to dispute (InvoiceClaim is
 * always linked to one), while Source B's quantity is, by
 * UnfulfilledDemand's own definition, exactly the portion that was NEVER
 * dispatched or invoiced in the first place. The same physical units can
 * therefore never appear in both sources at once. Source A is
 * per-currency (claims can span multiple SAP invoice currencies); Source
 * B is reported as a single total because lib/lost-sales/estimate-value.ts
 * itself never records a currency (same scope this project's Milestone 4
 * design already settled on) -- the two are presented side by side, with
 * a combined grand total deliberately NOT computed here, since summing
 * across an unlabeled Source B total and a per-currency Source A
 * breakdown would silently assume they share one currency.
 */
export type LostSalesBySourceReport = {
  sourceA: { label: string; description: string; exposureByCurrency: CurrencyExposureBucket[] };
  sourceB: { label: string; description: string } & SupplyShortageLostSalesValue;
  // Real Business Data Onboarding round, Phase 7 (Claims analytics):
  // confirmed loss from returned goods (lib/returns-credits/
  // lost-sale-analytics.ts, backed by Phase 6's ClaimReturnLostSale).
  // NOT a third independent pool to add to A and B -- it can describe the
  // SAME claims Source A already covers, just with a different, more
  // concrete signal (physical ReturnCondition, not a dispute amount). See
  // getReturnedGoodsLostSalesValue's own module comment and this file's
  // note string below.
  sourceC: { label: string; description: string } & ReturnedGoodsLostSalesValue;
  note: string;
};

export type FinancialExposureReport = {
  dateFrom: string;
  dateTo: string;
  claims: InvoiceClaimsDashboard;
  reconciliation: InvoiceReconciliationReports;
  returnsAndCreditNotes: ReturnsAndCreditNotesSummary;
  lostSalesBySource: LostSalesBySourceReport;
};

const CREDIT_RECOMMENDING_DECISIONS: ClaimResolutionDecision[] = [ClaimResolutionDecision.PARTIAL_CREDIT_RECOMMENDED, ClaimResolutionDecision.FULL_CREDIT_RECOMMENDED];
const CONCLUDED_CLAIM_STATUSES = ["RESOLVED", "REJECTED", "CLOSED"] as const;

async function getReturnsAndCreditNotesSummary(filters: ReportFilters, range: { gte?: Date; lt?: Date }): Promise<ReturnsAndCreditNotesSummary> {
  const demo = demoWhere(filters);
  const customerFilter = filters.customerId ? { claim: { customerId: filters.customerId } } : {};

  const [claimsWithReturns, creditNotesIssuedCount, creditNotesIssuedCountInPeriod, approvedResolutions] = await Promise.all([
    prisma.claimReturn.findMany({
      where: { ...demo, ...customerFilter },
      select: { claim: { select: { id: true, status: true } } },
      distinct: ["claimId"],
    }),
    prisma.creditNote.count({ where: demoWhere(filters) }),
    prisma.creditNote.count({ where: { ...demoWhere(filters), recordedAt: range } }),
    prisma.claimResolution.findMany({
      where: { ...demo, decision: { in: CREDIT_RECOMMENDING_DECISIONS }, approvedAt: { not: null } },
      select: { claimId: true },
      distinct: ["claimId"],
    }),
  ]);

  const returnsAwaitingResolution = claimsWithReturns.filter((r) => !CONCLUDED_CLAIM_STATUSES.includes(r.claim.status as (typeof CONCLUDED_CLAIM_STATUSES)[number])).length;
  const returnsResolved = claimsWithReturns.length - returnsAwaitingResolution;

  const approvedClaimIds = approvedResolutions.map((r) => r.claimId);
  const claimsWithIssuedCreditNote =
    approvedClaimIds.length > 0
      ? await prisma.creditNote.findMany({ where: { ...demoWhere(filters), claimId: { in: approvedClaimIds } }, select: { claimId: true }, distinct: ["claimId"] })
      : [];
  const claimIdsWithIssuedCreditNote = new Set(claimsWithIssuedCreditNote.map((c) => c.claimId));
  const creditNotesPendingCount = approvedClaimIds.filter((id) => !claimIdsWithIssuedCreditNote.has(id)).length;

  return {
    returnsAwaitingResolution,
    returnsResolved,
    creditNotesPendingCount,
    creditNotesIssuedCount,
    creditNotesIssuedCountInPeriod,
  };
}

export async function getFinancialExposureReport(filters: ReportFilters): Promise<FinancialExposureReport> {
  const { dateFrom, dateTo } = defaultDateRange();
  const effectiveFrom = filters.dateFrom ?? dateFrom;
  const effectiveTo = filters.dateTo ?? dateTo;
  const range = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

  const [claims, reconciliation, returnsAndCreditNotes, supplyShortage, returnedGoodsLoss] = await Promise.all([
    getInvoiceClaimsDashboard({ includeDemo: filters.includeDemo }),
    getInvoiceReconciliationReports({ includeDemo: filters.includeDemo }),
    getReturnsAndCreditNotesSummary(filters, range),
    getSupplyShortageLostSalesValue({ includeDemo: filters.includeDemo }),
    getReturnedGoodsLostSalesValue({ includeDemo: filters.includeDemo }),
  ]);

  const lostSalesBySource: LostSalesBySourceReport = {
    sourceA: {
      label: "Source A: Invoice claims (after delivery)",
      description: "Affected value = affected quantity x applicable unit price, per claim line -- an estimate/exposure figure, not confirmed lost revenue (not every claim is accepted or credited).",
      exposureByCurrency: claims.exposureByCurrency,
    },
    sourceB: {
      label: "Source B: Insufficient supply at fulfilment",
      description: "Estimated supply lost sales = unavailable quantity x applicable selling price, per lost-sale record -- only computed where a real price was available (never invented).",
      ...supplyShortage,
    },
    sourceC: {
      label: "Source C: Confirmed loss from returned goods",
      description: "Of goods physically received back against a claim, the value of whatever was found DAMAGED, EXPIRED or otherwise unsellable -- a confirmed outcome from the physical inspection, not a dispute estimate. Priced only where the returned line's real invoiced unit price was on record (never invented).",
      ...returnedGoodsLoss,
    },
    note:
      "Source A and Source B never overlap: Source A requires an actual invoiced line to dispute, while Source B's quantity was by definition never dispatched or invoiced. They are kept separate rather than summed into one figure -- Source A is broken down by currency (claims can span multiple SAP invoice currencies); Source B has none recorded, so adding the two would wrongly assume a shared currency. Source C is a different matter: it is NOT a third independent pool to add to A and B -- it can describe the very same claims Source A already covers, just measured from the physical return's own confirmed condition rather than the dispute's claimed value. Never add Source C to Source A for the same claim lines; that would double-count one loss as both a dispute estimate and a confirmed outcome.",
  };

  return { dateFrom: effectiveFrom, dateTo: effectiveTo, claims, reconciliation, returnsAndCreditNotes, lostSalesBySource };
}
