import "server-only";
import { ClaimResolutionDecision } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getInvoiceClaimsDashboard, type InvoiceClaimsDashboard } from "@/lib/invoice-claims/dashboard";
import { getInvoiceReconciliationReports, type InvoiceReconciliationReports } from "@/lib/invoice-reconciliation/queries";
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

export type FinancialExposureReport = {
  dateFrom: string;
  dateTo: string;
  claims: InvoiceClaimsDashboard;
  reconciliation: InvoiceReconciliationReports;
  returnsAndCreditNotes: ReturnsAndCreditNotesSummary;
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

  const [claims, reconciliation, returnsAndCreditNotes] = await Promise.all([
    getInvoiceClaimsDashboard({ includeDemo: filters.includeDemo }),
    getInvoiceReconciliationReports({ includeDemo: filters.includeDemo }),
    getReturnsAndCreditNotesSummary(filters, range),
  ]);

  return { dateFrom: effectiveFrom, dateTo: effectiveTo, claims, reconciliation, returnsAndCreditNotes };
}
