import "server-only";
import { Prisma, QuotationStatus, CreditNoteMatchStatus, UnfulfilledDemandStatus, RecordStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import type { ReportFilters, PaginatedResult, PaginationParams } from "@/lib/reporting/types";
import { demoWhere, dateRangeToDateOnlyFilter, dateRangeToTimestampFilter, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import { qualifyingInvoiceWhere } from "@/lib/reporting/customer-activity-queries";
import { groupRevenueByCurrencyAndCustomer, type CustomerRevenueLineRecord } from "@/lib/reporting/customer-revenue";
import { resolveAsOfDate, computeDaysSinceLastQualifyingInvoice } from "@/lib/reporting/customer-recency";
import { computePreviousPeriod } from "@/lib/reporting/product-segmentation";
import { getProductDecliningActivityOverview, getProductMasterDataQualityOverview } from "@/lib/reporting/product-revenue-queries";
import { getProductClaimAndReturnOverview } from "@/lib/reporting/product-commercial-health-queries";
import { getProductLostSalesRanking } from "@/lib/reporting/product-demand-queries";
import { getProductDeliveryRejectionOverview } from "@/lib/reporting/product-fulfilment-queries";
import { computeExposureByCurrency } from "@/lib/invoice-claims/financial";
import { classifyOrdersMatching } from "@/lib/reporting/attribution-queries";
import { getApprovalDashboard } from "@/lib/approvals/queries";
import { listOrdersAwaitingFulfilment } from "@/lib/reporting/management-reports";
import { formatScaledDecimal } from "@/lib/fulfilment/decimal";
import { parseScaledDecimal } from "@/lib/picking/validation";
import { evaluateAllDecisionRules, buildDecisionIntelligenceSummary, type DecisionRuleRawInputs } from "@/lib/reporting/decision-recommendations";
import {
  isValidDecisionStatusTransition,
  DECISION_CATEGORIES,
  type DecisionCategory,
  type DecisionConfidence,
  type DecisionPriority,
  type DecisionRecommendationStatus,
  type DecisionIntelligenceSummary,
  type RecommendationCandidate,
} from "@/lib/reporting/decision-types";

/**
 * Milestone 15 (Decision Intelligence). The Prisma-backed half of the
 * decision-intelligence engine -- same pure/Prisma-backed split M12-M14
 * already established (lib/reporting/decision-rules.ts and
 * lib/reporting/decision-recommendations.ts are pure; this file is the
 * only new module in this milestone that imports `@prisma/client` or
 * does I/O, so only this file is exercised via
 * RUN_DB_INTEGRATION_TESTS=1, same convention every other *-queries.ts
 * file in this project already follows).
 *
 * Three responsibilities:
 *   1. Fetch each rule's raw input by composing ALREADY-EXISTING M12-
 *      M14 query functions wherever one exists (getProductDecliningActivityOverview,
 *      getProductClaimAndReturnOverview, getProductLostSalesRanking,
 *      getProductDeliveryRejectionOverview, getProductMasterDataQualityOverview,
 *      computeExposureByCurrency, classifyOrdersMatching,
 *      getApprovalDashboard, listOrdersAwaitingFulfilment -- never
 *      re-deriving any of their calculations), and writing new,
 *      narrowly-scoped queries only for the handful of CUSTOMER/SALES
 *      groupings M12/M13 never needed for their own reports (a
 *      customer-level revenue decline, customer/salesperson claim and
 *      quotation-backlog counts, and the credit-note-backlog
 *      aggregate).
 *   2. Evaluate the full rule catalogue and SYNC the result into the
 *      DecisionRecommendation table by `dedupeKey` -- an upsert that
 *      updates evidence/priority/confidence/lastEvaluatedAt but NEVER
 *      touches `status`/`statusNote`/`statusById`/`statusAt`/
 *      `resolvedAt` on an existing row (spec section 5: regeneration
 *      must preserve lifecycle state and history).
 *   3. Serve the overview/list/detail/status-update/export surface the
 *      API routes call into.
 *
 * DEMO-DATA RULE (documented deviation worth calling out explicitly):
 * generation ALWAYS excludes demo data, regardless of the caller's own
 * `filters.includeDemo` -- every sub-fetch below uses
 * `generationFilters` (a copy of the caller's filters with
 * `includeDemo` forced false), never the caller's raw filters. This is
 * stricter than the M11-M14 "excluded by default, opt-in via
 * includeDemo=true" convention on purpose: DecisionRecommendation rows
 * are PERSISTED and SHARED across every future read (spec section 5's
 * anti-duplicate/dedupe design), so if demo data were ever allowed to
 * seed a recommendation, that recommendation would keep showing up in
 * every later non-demo read forever, with no natural point at which it
 * stops being "current." Excluding demo data unconditionally at
 * generation time is what keeps `isDemo` on every DecisionRecommendation
 * row honestly derivable as "true only if a linked entity is demo" (see
 * `deriveIsDemo` below) -- under this rule it is currently always
 * false, which is correct, not a bug: no demo-sourced recommendation is
 * ever created. The column and the remove-demo-data.ts cleanup block
 * are kept for schema completeness and for any future rule version that
 * may need demo-inclusive generation for test fixtures.
 */

const ATTRIBUTION_MIN_SAMPLE_SIZE = 5; // kept in sync with decision-rules.ts's own gate -- pre-filtering here is a pure perf optimization, never a second source of truth for the threshold itself (the rule function re-checks it).
const CUSTOMER_RECENCY_THRESHOLD_DAYS = 180;

function moneyToNumber(decimalString: string | null | undefined): number {
  if (!decimalString) return 0;
  const n = Number(decimalString);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// CUSTOMER-grain fetchers (new -- no existing M13 bulk function covers
// these groupings, since M13's own overview is single-period and
// customer-claims/returns/quotation-backlog counts were never needed
// by any M13 report).
// ---------------------------------------------------------------------------

async function fetchCustomerRevenueDeclines(filters: ReportFilters, demo: { isDemo?: false }, periodDateRange: { gte?: Date; lte?: Date }) {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const previousPeriod = computePreviousPeriod(effectiveFrom, effectiveTo);
  if (!previousPeriod) return [];

  const currencyFilter: Prisma.SapInvoiceWhereInput = filters.currency ? { currencyCode: filters.currency } : {};
  const customerFilter = filters.customerId ? { matchedCustomerId: filters.customerId } : {};

  async function fetchRecords(range: { gte?: Date; lte?: Date }): Promise<CustomerRevenueLineRecord[]> {
    const invoices = await prisma.sapInvoice.findMany({
      where: { ...qualifyingInvoiceWhere(demo, customerFilter), ...currencyFilter, invoiceDate: { not: null, ...range } },
      select: { matchedCustomerId: true, currencyCode: true, lines: { select: { lineTotal: true } } },
    });
    return invoices.flatMap((invoice) => invoice.lines.map((line) => ({ customerId: invoice.matchedCustomerId!, currency: invoice.currencyCode, lineTotal: line.lineTotal?.toString() ?? null })));
  }

  const [currentRecords, previousRecords] = await Promise.all([
    fetchRecords(periodDateRange),
    fetchRecords(dateRangeToDateOnlyFilter({ dateFrom: previousPeriod.previousFrom, dateTo: previousPeriod.previousTo })),
  ]);

  const currentBreakdown = groupRevenueByCurrencyAndCustomer(currentRecords);
  const previousBreakdown = groupRevenueByCurrencyAndCustomer(previousRecords);

  const currentByCustomerAndCurrency = new Map<string, Map<string, string>>();
  for (const currencyRow of currentBreakdown) {
    for (const c of currencyRow.byCustomer) {
      const byCurrency = currentByCustomerAndCurrency.get(c.customerId) ?? new Map<string, string>();
      byCurrency.set(currencyRow.currency, c.lineValueTotal);
      currentByCustomerAndCurrency.set(c.customerId, byCurrency);
    }
  }

  const candidates: { customerId: string; currencyCode: string; currentRevenue: string; previousRevenue: string }[] = [];
  for (const currencyRow of previousBreakdown) {
    for (const c of currencyRow.byCustomer) {
      const currentValue = currentByCustomerAndCurrency.get(c.customerId)?.get(currencyRow.currency) ?? "0";
      candidates.push({ customerId: c.customerId, currencyCode: currencyRow.currency, currentRevenue: currentValue, previousRevenue: c.lineValueTotal });
    }
  }
  if (candidates.length === 0) return [];

  const customerIds = [...new Set(candidates.map((c) => c.customerId))];
  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } });
  const nameById = new Map<string, string>(customers.map((c) => [c.id, c.name]));

  return candidates.map((c) => ({
    customerId: c.customerId,
    customerName: nameById.get(c.customerId) ?? c.customerId,
    currencyCode: c.currencyCode,
    currentRevenue: moneyToNumber(c.currentRevenue),
    currentRevenueDisplay: c.currentRevenue,
    previousRevenue: moneyToNumber(c.previousRevenue),
    previousRevenueDisplay: c.previousRevenue,
  }));
}

async function fetchCustomerClaimsReturns(filters: ReportFilters, demo: { isDemo?: false }, periodDateRange: { gte?: Date; lte?: Date }) {
  const customerFilter = filters.customerId ? { customerId: filters.customerId } : {};

  const [claimGroups, returnRows] = await Promise.all([
    prisma.invoiceClaim.groupBy({ by: ["customerId"], where: { ...demo, ...customerFilter, claimDate: periodDateRange }, _count: { _all: true } }),
    prisma.claimReturn.findMany({
      where: { ...demo, receivedDate: periodDateRange, claim: { ...customerFilter } },
      select: { claim: { select: { customerId: true } } },
    }),
  ]);

  const claimCountByCustomer = new Map<string, number>(claimGroups.map((g) => [g.customerId, g._count._all]));
  const returnCountByCustomer = new Map<string, number>();
  for (const row of returnRows) {
    returnCountByCustomer.set(row.claim.customerId, (returnCountByCustomer.get(row.claim.customerId) ?? 0) + 1);
  }

  const customerIds = [...new Set([...claimCountByCustomer.keys(), ...returnCountByCustomer.keys()])];
  if (customerIds.length === 0) return [];
  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } });
  const nameById = new Map<string, string>(customers.map((c) => [c.id, c.name]));

  return customerIds.map((customerId) => ({
    customerId,
    customerName: nameById.get(customerId) ?? customerId,
    claimCount: claimCountByCustomer.get(customerId) ?? 0,
    returnCount: returnCountByCustomer.get(customerId) ?? 0,
  }));
}

async function fetchCustomerUnresolvedQuotations(filters: ReportFilters, demo: { isDemo?: false }, asOfDateUtc: Date) {
  const customerFilter = filters.customerId ? { customerId: filters.customerId } : {};
  const groups = await prisma.quotation.groupBy({
    by: ["customerId"],
    where: { ...demo, ...customerFilter, status: QuotationStatus.ISSUED, validUntil: { lt: asOfDateUtc } },
    _count: { _all: true },
  });
  if (groups.length === 0) return [];
  const customers = await prisma.customer.findMany({ where: { id: { in: groups.map((g) => g.customerId) } }, select: { id: true, name: true } });
  const nameById = new Map<string, string>(customers.map((c) => [c.id, c.name]));
  return groups.map((g) => ({ customerId: g.customerId, customerName: nameById.get(g.customerId) ?? g.customerId, unresolvedCount: g._count._all }));
}

async function fetchSalespersonUnresolvedQuotationsBacklog(filters: ReportFilters, demo: { isDemo?: false }, asOfDateUtc: Date) {
  const salespersonFilter = filters.salespersonId ? { salespersonId: filters.salespersonId } : {};
  const groups = await prisma.quotation.groupBy({
    by: ["salespersonId"],
    where: { ...demo, ...salespersonFilter, status: QuotationStatus.ISSUED, validUntil: { lt: asOfDateUtc } },
    _count: { _all: true },
  });
  if (groups.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: groups.map((g) => g.salespersonId) } }, select: { id: true, name: true } });
  const nameById = new Map<string, string>(users.map((u) => [u.id, u.name]));
  return groups.map((g) => ({ salespersonId: g.salespersonId, salespersonName: nameById.get(g.salespersonId) ?? g.salespersonId, unresolvedCount: g._count._all }));
}

async function fetchCustomerInsufficientRecentActivity(filters: ReportFilters, demo: { isDemo?: false }, asOfDateUtc: Date, asOfDate: string) {
  // Scoped to ACTIVE customers only: a customer already marked INACTIVE
  // has an explicit, documented status of its own already -- flagging it
  // again here would be noise, not a new fact (spec section 3.4: never
  // label a customer lost/inactive without an explicit, documented rule
  // -- INACTIVE already IS that explicit rule, applied elsewhere, so this
  // rule has nothing further to add for a customer that status already
  // covers).
  const customerFilter: Prisma.CustomerWhereInput = filters.customerId ? { id: filters.customerId } : {};
  const customers = await prisma.customer.findMany({ where: { ...demo, ...customerFilter, status: RecordStatus.ACTIVE }, select: { id: true, name: true } });
  if (customers.length === 0) return [];

  const currencyFilter: Prisma.SapInvoiceWhereInput = filters.currency ? { currencyCode: filters.currency } : {};
  const recencyRows = await prisma.sapInvoice.groupBy({
    by: ["matchedCustomerId"],
    where: { ...qualifyingInvoiceWhere(demo, {}), ...currencyFilter, invoiceDate: { not: null, lte: asOfDateUtc } },
    _max: { invoiceDate: true },
  });
  const lastInvoiceByCustomer = new Map<string, Date>();
  for (const row of recencyRows) {
    if (row.matchedCustomerId && row._max.invoiceDate) lastInvoiceByCustomer.set(row.matchedCustomerId, row._max.invoiceDate);
  }

  const results: { customerId: string; customerName: string; daysSinceLastOrder: number | null; hasAnyOrderHistory: boolean; recencyThresholdDays: number }[] = [];
  for (const customer of customers) {
    const lastInvoice = lastInvoiceByCustomer.get(customer.id);
    const hasAnyOrderHistory = lastInvoice !== undefined;
    const daysSinceLastOrder = hasAnyOrderHistory ? computeDaysSinceLastQualifyingInvoice(asOfDate, lastInvoice!.toISOString().slice(0, 10)) : null;
    if (!hasAnyOrderHistory || (daysSinceLastOrder !== null && daysSinceLastOrder >= CUSTOMER_RECENCY_THRESHOLD_DAYS)) {
      results.push({ customerId: customer.id, customerName: customer.name, daysSinceLastOrder, hasAnyOrderHistory, recencyThresholdDays: CUSTOMER_RECENCY_THRESHOLD_DAYS });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// COMMERCIAL_EXPOSURE-grain fetchers.
// ---------------------------------------------------------------------------

async function fetchCommercialClaimExposure(filters: ReportFilters, demo: { isDemo?: false }) {
  const customerFilter = filters.customerId ? { customerId: filters.customerId } : {};
  const claims = await prisma.invoiceClaim.findMany({ where: { ...demo, ...customerFilter }, select: { id: true } });
  const buckets = await computeExposureByCurrency(claims.map((c) => c.id));
  return buckets
    .filter((b) => !filters.currency || b.currencyCode === filters.currency)
    .map((b) => {
      const potential = parseScaledDecimal(b.potentialCreditExposure) ?? BigInt(0);
      const actual = parseScaledDecimal(b.actualSapCreditedAmount) ?? BigInt(0);
      const unresolvedScaled = potential - actual;
      const unresolved = unresolvedScaled > BigInt(0) ? unresolvedScaled : BigInt(0);
      const unresolvedExposureDisplay = formatScaledDecimal(unresolved);
      return {
        currencyCode: b.currencyCode,
        claimCount: b.claimCount,
        potentialCreditExposureDisplay: b.potentialCreditExposure,
        approvedCreditExposureDisplay: b.approvedCreditExposure,
        actualSapCreditedAmountDisplay: b.actualSapCreditedAmount,
        unresolvedExposure: moneyToNumber(unresolvedExposureDisplay),
        unresolvedExposureDisplay,
      };
    });
}

async function fetchCommercialCreditNoteBacklog(filters: ReportFilters, demo: { isDemo?: false }) {
  const currencyFilter: Prisma.CreditNoteWhereInput = filters.currency ? { currencyCode: filters.currency } : {};
  const groups = await prisma.creditNote.groupBy({
    by: ["currencyCode"],
    where: { ...demo, ...currencyFilter, matchStatus: CreditNoteMatchStatus.UNMATCHED },
    _count: { _all: true },
    _sum: { amount: true },
  });
  return groups.map((g) => {
    const amountDisplay = g._sum.amount?.toString() ?? "0";
    return {
      currencyCode: g.currencyCode ?? "UNKNOWN",
      unmatchedCount: g._count._all,
      unmatchedAmount: moneyToNumber(amountDisplay),
      unmatchedAmountDisplay: amountDisplay,
    };
  });
}

// ---------------------------------------------------------------------------
// SALES-grain fetchers.
// ---------------------------------------------------------------------------

async function fetchSalesUnverifiedAttribution(filters: ReportFilters, demo: { isDemo?: false }, periodTimestampRange: { gte?: Date; lt?: Date }) {
  const salespersonFilter = filters.salespersonId ? { salespersonId: filters.salespersonId } : {};
  const { orders, attributionByOrderId } = await classifyOrdersMatching({ ...demo, ...salespersonFilter, salespersonId: { not: null }, createdAt: periodTimestampRange });

  const totalBySalesperson = new Map<string, number>();
  const unverifiedBySalesperson = new Map<string, number>();
  for (const order of orders) {
    if (!order.salespersonId) continue;
    totalBySalesperson.set(order.salespersonId, (totalBySalesperson.get(order.salespersonId) ?? 0) + 1);
    const bucket = attributionByOrderId.get(order.id);
    if (bucket && bucket.startsWith("UNVERIFIED")) {
      unverifiedBySalesperson.set(order.salespersonId, (unverifiedBySalesperson.get(order.salespersonId) ?? 0) + 1);
    }
  }

  const salespersonIds = [...totalBySalesperson.keys()].filter((id) => (totalBySalesperson.get(id) ?? 0) >= ATTRIBUTION_MIN_SAMPLE_SIZE);
  if (salespersonIds.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: salespersonIds } }, select: { id: true, name: true } });
  const nameById = new Map<string, string>(users.map((u) => [u.id, u.name]));

  return salespersonIds.map((salespersonId) => ({
    salespersonId,
    salespersonName: nameById.get(salespersonId) ?? salespersonId,
    totalOrders: totalBySalesperson.get(salespersonId) ?? 0,
    unverifiedOrders: unverifiedBySalesperson.get(salespersonId) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// PRODUCT-grain name resolution (shared across every product rule's
// fetcher below -- one query, never per-row).
// ---------------------------------------------------------------------------

async function resolveProductNames(productIds: readonly (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(productIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const products = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, itemName: true } });
  return new Map(products.map((p) => [p.id, p.itemName]));
}

/** sapItemCode is this milestone's own identity rule (Milestone 14): display name falls back to the bare SAP item code -- never a fabricated description -- when no Product master row matches. */
function displayName(productId: string | null, sapItemCode: string, namesByProductId: Map<string, string>): string {
  if (productId) return namesByProductId.get(productId) ?? sapItemCode;
  return sapItemCode;
}

// ---------------------------------------------------------------------------
// OPERATIONAL-grain fetchers.
// ---------------------------------------------------------------------------

async function fetchOperationalApprovalBottleneck(actingUser: { id: string; role: string }) {
  const dashboard = await getApprovalDashboard(actingUser.id, actingUser.role, { includeDemo: false });
  return { overdueCount: dashboard.overdueCount };
}

async function fetchOperationalUnfulfilledDemandBacklog() {
  const openCount = await prisma.unfulfilledDemand.count({
    where: { isDemo: false, status: { in: [UnfulfilledDemandStatus.PENDING_DECISION, UnfulfilledDemandStatus.AWAITING_SUPPLY, UnfulfilledDemandStatus.PARTIALLY_CANCELLED] } },
  });
  return { openCount };
}

async function fetchOperationalOrdersAwaitingFulfilment(filters: ReportFilters) {
  const result = await listOrdersAwaitingFulfilment({ ...filters, includeDemo: false }, { page: 1, pageSize: 1 });
  return { awaitingCount: result.pagination.totalItems };
}

// ---------------------------------------------------------------------------
// Orchestration: fetch every rule's raw input, then evaluate.
// ---------------------------------------------------------------------------

async function fetchDecisionRuleRawInputs(filters: ReportFilters, actingUser: { id: string; role: string }): Promise<DecisionRuleRawInputs> {
  const generationFilters: ReportFilters = { ...filters, includeDemo: false };
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(generationFilters);
  const period = { from: effectiveFrom, to: effectiveTo };
  const demo = demoWhere(generationFilters);
  const periodDateRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const periodTimestampRange = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const { asOfDate } = resolveAsOfDate({ dateTo: generationFilters.dateTo });
  const asOfDateUtc = dateOnlyStringToUtcDate(asOfDate)!;

  const [
    customerRevenueDeclinesRaw,
    customerClaimsReturns,
    customerUnresolvedQuotations,
    customerInsufficientRecentActivity,
    productDeclineReport,
    productClaimReturnReport,
    productLostSalesReport,
    productDeliveryRejectionReport,
    productMasterDataReport,
    commercialClaimExposure,
    commercialCreditNoteBacklog,
    salesUnverifiedAttribution,
    salesUnresolvedQuotationsBacklog,
    operationalApprovalBottleneck,
    operationalUnfulfilledDemandBacklog,
    operationalOrdersAwaitingFulfilment,
  ] = await Promise.all([
    fetchCustomerRevenueDeclines(generationFilters, demo, periodDateRange),
    fetchCustomerClaimsReturns(generationFilters, demo, periodDateRange),
    fetchCustomerUnresolvedQuotations(generationFilters, demo, asOfDateUtc),
    fetchCustomerInsufficientRecentActivity(generationFilters, demo, asOfDateUtc, asOfDate),
    getProductDecliningActivityOverview(generationFilters),
    getProductClaimAndReturnOverview(generationFilters),
    getProductLostSalesRanking(generationFilters),
    getProductDeliveryRejectionOverview(generationFilters),
    getProductMasterDataQualityOverview(generationFilters),
    fetchCommercialClaimExposure(generationFilters, demo),
    fetchCommercialCreditNoteBacklog(generationFilters, demo),
    fetchSalesUnverifiedAttribution(generationFilters, demo, periodTimestampRange),
    fetchSalespersonUnresolvedQuotationsBacklog(generationFilters, demo, asOfDateUtc),
    fetchOperationalApprovalBottleneck(actingUser),
    fetchOperationalUnfulfilledDemandBacklog(),
    fetchOperationalOrdersAwaitingFulfilment(generationFilters),
  ]);

  const productNamesById = await resolveProductNames([
    ...productDeclineReport.rows.map((r) => r.productId),
    ...productClaimReturnReport.rows.map((r) => r.productId),
    ...productLostSalesReport.rows.map((r) => r.productId),
    ...productDeliveryRejectionReport.rows.map((r) => r.productId),
    ...productMasterDataReport.rows.map((r) => r.productId),
  ]);

  return {
    period,
    customerRevenueDeclines: customerRevenueDeclinesRaw,
    customerRepeatedClaimsReturns: customerClaimsReturns,
    customerUnresolvedQuotations,
    customerInsufficientRecentActivity,
    productActivityDeclines: productDeclineReport.rows.map((r) => ({
      sapItemCode: r.sapItemCode,
      productId: r.productId,
      itemName: displayName(r.productId, r.sapItemCode, productNamesById),
      currencyCode: r.currency,
      currentRevenue: moneyToNumber(r.currentPeriodValue),
      currentRevenueDisplay: r.currentPeriodValue,
      previousRevenue: moneyToNumber(r.previousPeriodValue),
      previousRevenueDisplay: r.previousPeriodValue,
    })),
    productRepeatedClaimsReturns: productClaimReturnReport.rows.map((r) => ({
      sapItemCode: r.sapItemCode,
      productId: r.productId,
      itemName: displayName(r.productId, r.sapItemCode, productNamesById),
      claimCount: r.claimCount,
      returnCount: r.returnCount,
    })),
    productLostDemand: productLostSalesReport.rows.map((r) => ({
      sapItemCode: r.sapItemCode,
      productId: r.productId,
      itemName: displayName(r.productId, r.sapItemCode, productNamesById),
      confirmedLostSaleCount: r.confirmedLostSaleCount,
      confirmedLostQuantity: moneyToNumber(r.confirmedLostSaleQuantityTotal),
      confirmedLostQuantityDisplay: r.confirmedLostSaleQuantityTotal,
    })),
    productDeliveryRejections: productDeliveryRejectionReport.rows.map((r) => ({
      sapItemCode: r.sapItemCode,
      productId: r.productId,
      itemName: displayName(r.productId, r.sapItemCode, productNamesById),
      rejectionEventCount: r.deliveryLinesWithRejectionCount,
    })),
    productInsufficientMasterData: productMasterDataReport.rows.map((r) => ({
      sapItemCode: r.sapItemCode,
      productId: r.productId,
      itemNameOrFallback: displayName(r.productId, r.sapItemCode, productNamesById),
      missingFieldLabels: [r.issue === "unmatched" ? "no Product master record" : "Product.category"],
    })),
    commercialClaimExposure,
    commercialCreditNoteBacklog,
    salesUnverifiedAttribution,
    salesUnresolvedQuotationsBacklog,
    operationalApprovalBottleneck,
    operationalUnfulfilledDemandBacklog,
    operationalOrdersAwaitingFulfilment,
  };
}

// ---------------------------------------------------------------------------
// Persistence: sync evaluated candidates into DecisionRecommendation by
// dedupeKey, preserving lifecycle status/history on every existing row.
// ---------------------------------------------------------------------------

/** True only if a linked business entity is itself demo data -- see this file's own DEMO-DATA RULE comment above for why this is always false under the current generation rule. Kept honestly derivable rather than hardcoded, so a future rule version that DOES generate from demo-inclusive data gets a correct flag with no further change here. */
async function deriveIsDemo(candidate: RecommendationCandidate): Promise<boolean> {
  const checks: Promise<boolean>[] = [];
  if (candidate.customerId) checks.push(prisma.customer.findUnique({ where: { id: candidate.customerId }, select: { isDemo: true } }).then((r) => r?.isDemo ?? false));
  if (candidate.productId) checks.push(prisma.product.findUnique({ where: { id: candidate.productId }, select: { isDemo: true } }).then((r) => r?.isDemo ?? false));
  if (candidate.salespersonId) checks.push(prisma.user.findUnique({ where: { id: candidate.salespersonId }, select: { isDemo: true } }).then((r) => r?.isDemo ?? false));
  if (candidate.quotationId) checks.push(prisma.quotation.findUnique({ where: { id: candidate.quotationId }, select: { isDemo: true } }).then((r) => r?.isDemo ?? false));
  if (candidate.customerOrderId) checks.push(prisma.customerOrder.findUnique({ where: { id: candidate.customerOrderId }, select: { isDemo: true } }).then((r) => r?.isDemo ?? false));
  if (checks.length === 0) return false;
  const results = await Promise.all(checks);
  return results.some(Boolean);
}

/**
 * Syncs every evaluated candidate into the DecisionRecommendation
 * table. For each candidate: if a row with the same `dedupeKey`
 * already exists, UPDATE only its evaluation-derived fields (never
 * `status`/`statusNote`/`statusById`/`statusAt`/`resolvedAt`); if none
 * exists, CREATE it as OPEN and record a CREATED event. Runs each
 * candidate's upsert independently (not inside one giant transaction)
 * -- candidates are independent rows with no cross-row invariant to
 * protect, so a single candidate's failure (e.g. a stale FK target)
 * never blocks every other candidate's sync; it is attempted with
 * `Promise.allSettled` and failures are returned for the caller to log.
 */
async function syncDecisionRecommendations(candidates: readonly RecommendationCandidate[]): Promise<{ synced: number; failed: { dedupeKey: string; error: string }[] }> {
  const results = await Promise.allSettled(
    candidates.map(async (candidate) => {
      const existing = await prisma.decisionRecommendation.findUnique({ where: { dedupeKey: candidate.dedupeKey }, select: { id: true } });
      const periodFrom = dateOnlyStringToUtcDate(candidate.reportingPeriodFrom)!;
      const periodTo = dateOnlyStringToUtcDate(candidate.reportingPeriodTo)!;

      if (existing) {
        await prisma.decisionRecommendation.update({
          where: { id: existing.id },
          data: {
            ruleVersion: candidate.ruleVersion,
            decisionCategory: candidate.decisionCategory,
            priority: candidate.priority,
            confidence: candidate.confidence,
            title: candidate.title,
            explanation: candidate.explanation,
            evidence: candidate.evidence,
            recommendedNextAction: candidate.recommendedNextAction,
            reportingPeriodFrom: periodFrom,
            reportingPeriodTo: periodTo,
            currencyCode: candidate.currencyCode ?? null,
            lastEvaluatedAt: new Date(),
          },
        });
        return;
      }

      const isDemo = await deriveIsDemo(candidate);
      const created = await prisma.decisionRecommendation.create({
        data: {
          dedupeKey: candidate.dedupeKey,
          ruleId: candidate.ruleId,
          ruleVersion: candidate.ruleVersion,
          decisionCategory: candidate.decisionCategory,
          priority: candidate.priority,
          confidence: candidate.confidence,
          title: candidate.title,
          explanation: candidate.explanation,
          evidence: candidate.evidence,
          customerId: candidate.customerId ?? null,
          productId: candidate.productId ?? null,
          sapItemCode: candidate.sapItemCode ?? null,
          salespersonId: candidate.salespersonId ?? null,
          quotationId: candidate.quotationId ?? null,
          customerOrderId: candidate.customerOrderId ?? null,
          reportingPeriodFrom: periodFrom,
          reportingPeriodTo: periodTo,
          currencyCode: candidate.currencyCode ?? null,
          recommendedNextAction: candidate.recommendedNextAction,
          isDemo,
        },
        select: { id: true },
      });
      await prisma.decisionRecommendationEvent.create({
        data: { decisionRecommendationId: created.id, eventType: "CREATED", toStatus: "OPEN" },
      });
    })
  );

  const failed: { dedupeKey: string; error: string }[] = [];
  let synced = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") synced += 1;
    else failed.push({ dedupeKey: candidates[index].dedupeKey, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });
  return { synced, failed };
}

/** Evaluates the full rule catalogue and syncs it into the database. Called once per report request by every read endpoint below -- cheap relative to the queries it composes, and the only way regeneration (spec section 5) actually happens, since this milestone adds no background job. */
export async function evaluateAndSyncDecisionRecommendations(filters: ReportFilters, actingUser: { id: string; role: string }): Promise<{ candidates: RecommendationCandidate[]; synced: number; failed: { dedupeKey: string; error: string }[] }> {
  const raw = await fetchDecisionRuleRawInputs(filters, actingUser);
  const candidates = evaluateAllDecisionRules(raw);
  const { synced, failed } = await syncDecisionRecommendations(candidates);
  if (failed.length > 0) {
    console.error("Decision intelligence: failed to sync recommendation(s):", failed);
  }
  return { candidates, synced, failed };
}

// ---------------------------------------------------------------------------
// Read surface: overview, list, detail, status update, history, export.
// ---------------------------------------------------------------------------

export type DecisionRecommendationRow = {
  id: string;
  dedupeKey: string;
  ruleId: string;
  ruleVersion: number;
  decisionCategory: DecisionCategory;
  priority: DecisionPriority;
  confidence: DecisionConfidence;
  title: string;
  explanation: string;
  evidence: unknown;
  recommendedNextAction: string;
  customerId: string | null;
  customerName: string | null;
  productId: string | null;
  sapItemCode: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  quotationId: string | null;
  customerOrderId: string | null;
  customerOrderReference: string | null;
  reportingPeriodFrom: string;
  reportingPeriodTo: string;
  currencyCode: string | null;
  status: DecisionRecommendationStatus;
  statusNote: string | null;
  statusAt: string | null;
  firstDetectedAt: string;
  lastEvaluatedAt: string;
  resolvedAt: string | null;
  isDemo: boolean;
};

const recommendationSelect = {
  id: true,
  dedupeKey: true,
  ruleId: true,
  ruleVersion: true,
  decisionCategory: true,
  priority: true,
  confidence: true,
  title: true,
  explanation: true,
  evidence: true,
  recommendedNextAction: true,
  customerId: true,
  customer: { select: { name: true } },
  productId: true,
  sapItemCode: true,
  salespersonId: true,
  salesperson: { select: { name: true } },
  quotationId: true,
  customerOrderId: true,
  customerOrder: { select: { reference: true } },
  reportingPeriodFrom: true,
  reportingPeriodTo: true,
  currencyCode: true,
  status: true,
  statusNote: true,
  statusAt: true,
  firstDetectedAt: true,
  lastEvaluatedAt: true,
  resolvedAt: true,
  isDemo: true,
} satisfies Prisma.DecisionRecommendationSelect;

type RawRecommendationRow = Prisma.DecisionRecommendationGetPayload<{ select: typeof recommendationSelect }>;

function toRecommendationRow(row: RawRecommendationRow): DecisionRecommendationRow {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    ruleId: row.ruleId,
    ruleVersion: row.ruleVersion,
    decisionCategory: row.decisionCategory as DecisionCategory,
    priority: row.priority as DecisionPriority,
    confidence: row.confidence as DecisionConfidence,
    title: row.title,
    explanation: row.explanation,
    evidence: row.evidence,
    recommendedNextAction: row.recommendedNextAction,
    customerId: row.customerId,
    customerName: row.customer?.name ?? null,
    productId: row.productId,
    sapItemCode: row.sapItemCode,
    salespersonId: row.salespersonId,
    salespersonName: row.salesperson?.name ?? null,
    quotationId: row.quotationId,
    customerOrderId: row.customerOrderId,
    customerOrderReference: row.customerOrder?.reference ?? null,
    reportingPeriodFrom: row.reportingPeriodFrom.toISOString().slice(0, 10),
    reportingPeriodTo: row.reportingPeriodTo.toISOString().slice(0, 10),
    currencyCode: row.currencyCode,
    status: row.status as DecisionRecommendationStatus,
    statusNote: row.statusNote,
    statusAt: row.statusAt ? row.statusAt.toISOString() : null,
    firstDetectedAt: row.firstDetectedAt.toISOString(),
    lastEvaluatedAt: row.lastEvaluatedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    isDemo: row.isDemo,
  };
}

function buildRecommendationWhere(filters: ReportFilters): Prisma.DecisionRecommendationWhereInput {
  return {
    ...demoWhere(filters),
    ...(filters.decisionCategory ? { decisionCategory: filters.decisionCategory as Prisma.DecisionRecommendationWhereInput["decisionCategory"] } : {}),
    ...(filters.priority ? { priority: filters.priority as Prisma.DecisionRecommendationWhereInput["priority"] } : {}),
    ...(filters.recommendationStatus ? { status: filters.recommendationStatus as Prisma.DecisionRecommendationWhereInput["status"] } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.salespersonId ? { salespersonId: filters.salespersonId } : {}),
    ...(filters.currency ? { currencyCode: filters.currency } : {}),
  };
}

const PRIORITY_SORT_ORDER: DecisionPriority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"];

export type DecisionIntelligenceOverview = {
  summary: DecisionIntelligenceSummary;
  priorityQueue: DecisionRecommendationRow[];
  period: { from: string; to: string };
  generatedAt: string;
  dataFreshnessNote: string;
};

/** Builds the overview (summary + priority queue rows) from an already-evaluated candidate list -- shared by getDecisionIntelligenceOverview and getDecisionIntelligencePageData so neither re-evaluates the rule catalogue a second time in the same request. */
function buildOverviewFromCandidates(candidates: RecommendationCandidate[], filters: ReportFilters): Promise<DecisionIntelligenceOverview> {
  return (async () => {
    const now = new Date();
    const summary = buildDecisionIntelligenceSummary(candidates, () => now.toISOString());

    const urgentDedupeKeys = summary.priorityQueue.map((c) => c.dedupeKey);
    const rows =
      urgentDedupeKeys.length > 0
        ? await prisma.decisionRecommendation.findMany({ where: { dedupeKey: { in: urgentDedupeKeys } }, select: recommendationSelect })
        : [];
    const rowByDedupeKey = new Map(rows.map((r) => [r.dedupeKey, toRecommendationRow(r)]));
    const priorityQueue = urgentDedupeKeys.map((key) => rowByDedupeKey.get(key)).filter((r): r is DecisionRecommendationRow => r !== undefined);

    const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
    return {
      summary,
      priorityQueue,
      period: { from: effectiveFrom, to: effectiveTo },
      generatedAt: now.toISOString(),
      dataFreshnessNote: `Recommendations are evaluated live from current source data each time this report is viewed (generated ${now.toISOString()}).`,
    };
  })();
}

/** Builds the paginated, filtered recommendation list from the persisted table -- shared by listDecisionRecommendations and getDecisionIntelligencePageData, both of which call this only AFTER the catalogue has already been synced for this request. */
async function buildListFromWhere(filters: ReportFilters, pagination: PaginationParams): Promise<PaginatedResult<DecisionRecommendationRow>> {
  const where = buildRecommendationWhere(filters);
  const [totalItems, rows] = await Promise.all([
    prisma.decisionRecommendation.count({ where }),
    prisma.decisionRecommendation.findMany({
      where,
      select: recommendationSelect,
      orderBy: [{ lastEvaluatedAt: "desc" }],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
  ]);

  const mapped = rows.map(toRecommendationRow).sort((a, b) => PRIORITY_SORT_ORDER.indexOf(a.priority) - PRIORITY_SORT_ORDER.indexOf(b.priority));
  return { rows: mapped, pagination: { ...pagination, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pagination.pageSize)) } };
}

/** Spec sections 3.1/3.2: the executive decision summary and priority attention queue, evaluated and synced fresh on every call. */
export async function getDecisionIntelligenceOverview(filters: ReportFilters, actingUser: { id: string; role: string }): Promise<DecisionIntelligenceOverview> {
  const { candidates } = await evaluateAndSyncDecisionRecommendations(filters, actingUser);
  return buildOverviewFromCandidates(candidates, filters);
}

/** Spec section 9: the full recommendation list, filterable/paginated, evaluated and synced fresh on every call. */
export async function listDecisionRecommendations(filters: ReportFilters, pagination: PaginationParams, actingUser: { id: string; role: string }): Promise<PaginatedResult<DecisionRecommendationRow>> {
  await evaluateAndSyncDecisionRecommendations(filters, actingUser);
  return buildListFromWhere(filters, pagination);
}

/**
 * Combines the overview and the paginated list for the one page
 * (app/reports/decision-intelligence/page.tsx) that needs both at
 * once -- evaluates and syncs the rule catalogue exactly ONCE rather
 * than the two separate evaluations that calling
 * getDecisionIntelligenceOverview and listDecisionRecommendations back
 * to back would otherwise trigger (spec section 12: "never duplicate
 * calculations," "DB-side aggregation, no N+1" -- re-running the full
 * ~15-fetcher rule catalogue twice in one page load is exactly the
 * kind of avoidable duplicate work that principle rules out). The two
 * separate API routes (GET .../decision-intelligence and GET
 * .../recommendations) each still evaluate and sync independently when
 * called on their own, which is correct: a client calling just one of
 * them should not have to also fetch the other first.
 */
export async function getDecisionIntelligencePageData(
  filters: ReportFilters,
  pagination: PaginationParams,
  actingUser: { id: string; role: string },
): Promise<{ overview: DecisionIntelligenceOverview; list: PaginatedResult<DecisionRecommendationRow> }> {
  const { candidates } = await evaluateAndSyncDecisionRecommendations(filters, actingUser);
  const [overview, list] = await Promise.all([buildOverviewFromCandidates(candidates, filters), buildListFromWhere(filters, pagination)]);
  return { overview, list };
}

export type DecisionRecommendationEventRow = {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string | null;
  actorName: string | null;
  notes: string | null;
  createdAt: string;
};

export type DecisionRecommendationDetail = DecisionRecommendationRow & { history: DecisionRecommendationEventRow[] };

/** Spec section 6: the full, append-only status-change history for one recommendation -- reuses the existing AuditEvent-style event-log pattern (DecisionRecommendationEvent), never a second audit system. Exposed both as its own endpoint (GET .../[id]/history) and folded into getDecisionRecommendationDetail below. */
export async function getDecisionRecommendationHistory(id: string): Promise<DecisionRecommendationEventRow[]> {
  const events = await prisma.decisionRecommendationEvent.findMany({
    where: { decisionRecommendationId: id },
    select: { id: true, eventType: true, fromStatus: true, toStatus: true, actorId: true, actor: { select: { name: true } }, notes: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return events.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    actorId: e.actorId,
    actorName: e.actor?.name ?? null,
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
  }));
}

/** Spec section 9: single recommendation detail, including its full status-change history (spec section 6). Does not re-evaluate/sync (list/overview already do that); a detail view shows the persisted row as it stands. */
export async function getDecisionRecommendationDetail(id: string): Promise<DecisionRecommendationDetail | null> {
  const row = await prisma.decisionRecommendation.findUnique({ where: { id }, select: recommendationSelect });
  if (!row) return null;

  const history = await getDecisionRecommendationHistory(id);
  return { ...toRecommendationRow(row), history };
}

export type StatusUpdateFailure = { ok: false; status: number; message: string };
export type StatusUpdateSuccess = { ok: true };

const EVENT_TYPE_BY_TARGET_STATUS: Record<DecisionRecommendationStatus, "ACKNOWLEDGED" | "STARTED" | "RESOLVED" | "DISMISSED" | "REOPENED"> = {
  OPEN: "REOPENED",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  IN_PROGRESS: "STARTED",
  RESOLVED: "RESOLVED",
  DISMISSED: "DISMISSED",
};

/**
 * Spec section 5: the one mutation path for the recommendation
 * lifecycle -- validates the transition against
 * DECISION_RECOMMENDATION_STATUS_TRANSITIONS, updates the row, and
 * records a DecisionRecommendationEvent, all inside one transaction so
 * the row and its own history entry can never disagree. Also writes an
 * AuditEvent (spec section 6: "reuse the EXISTING audit infrastructure
 * -- never build a second audit system").
 */
export async function updateDecisionRecommendationStatus(
  id: string,
  toStatus: DecisionRecommendationStatus,
  actorId: string,
  note: string | null
): Promise<StatusUpdateSuccess | StatusUpdateFailure> {
  const existing = await prisma.decisionRecommendation.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!existing) return { ok: false, status: 404, message: "Recommendation not found." };

  const fromStatus = existing.status as DecisionRecommendationStatus;
  if (!isValidDecisionStatusTransition(fromStatus, toStatus)) {
    return { ok: false, status: 400, message: `Cannot move a recommendation from ${fromStatus} to ${toStatus}.` };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.decisionRecommendation.update({
      where: { id },
      data: {
        status: toStatus,
        statusNote: note,
        statusById: actorId,
        statusAt: now,
        resolvedAt: toStatus === "RESOLVED" ? now : toStatus === "OPEN" ? null : undefined,
      },
    });
    await tx.decisionRecommendationEvent.create({
      data: { decisionRecommendationId: id, eventType: EVENT_TYPE_BY_TARGET_STATUS[toStatus], fromStatus, toStatus, actorId, notes: note },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "DECISION_RECOMMENDATION_STATUS_CHANGED",
        entityType: "DecisionRecommendation",
        entityId: id,
        beforeData: { status: fromStatus },
        afterData: { status: toStatus, note },
      },
    });
  });

  return { ok: true };
}

/** Spec section 9's export route: builds the full filtered row set (no pagination cap beyond REPORT_MAX_PAGE_SIZE's own ceiling, same convention every other M11-M14 export already uses) for CSV. Does not re-evaluate/sync -- an export reflects the most recently generated state, same as a list page the user is already looking at. */
export async function listAllDecisionRecommendationsForExport(filters: ReportFilters): Promise<DecisionRecommendationRow[]> {
  const where = buildRecommendationWhere(filters);
  const rows = await prisma.decisionRecommendation.findMany({ where, select: recommendationSelect, orderBy: [{ lastEvaluatedAt: "desc" }] });
  return rows.map(toRecommendationRow).sort((a, b) => PRIORITY_SORT_ORDER.indexOf(a.priority) - PRIORITY_SORT_ORDER.indexOf(b.priority));
}

export { DECISION_CATEGORIES };
