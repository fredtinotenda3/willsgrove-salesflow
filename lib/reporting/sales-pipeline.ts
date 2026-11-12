import "server-only";
import { Prisma, OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToTimestampFilter, defaultDateRange } from "@/lib/reporting/filters";

/**
 * Milestone 11 (Operational BI), spec section 4: "movement of customer
 * demand through the sales process," with conversion rates and
 * stage-to-stage bottlenecks, and the explicit warning "avoid misleading
 * conversion percentages caused by mixing different date cohorts."
 *
 * Methodology (the one genuinely nontrivial design decision in this
 * file): a conversion rate here is NEVER (count of stage B in range) /
 * (count of stage A in range) -- that ratios two independently-dated
 * populations and is exactly the "mixing different date cohorts" the
 * spec warns against (a quotation issued this week can easily have come
 * from a request received last week, so dividing this week's issued
 * count by this week's received count answers a different, meaningless
 * question). Instead, every rate here fixes ONE cohort by a single
 * anchor date field, then asks what fraction of THAT SAME cohort has
 * reached the next state AS OF NOW:
 *
 *   - requestsProcessedRate: of MessageIntake rows with receivedAt in
 *     range, what fraction are now CONVERTED or LINKED.
 *   - quotationAcceptanceRate: of Quotation rows with issuedAt in range,
 *     what fraction are now ACCEPTED.
 *   - quotationToOrderConversionRate: of Quotation rows that were
 *     ACCEPTED (respondedAt in range), what fraction now have
 *     convertedAt set.
 *   - orderApprovalRate: of CustomerOrder rows with receivedAt in range,
 *     what fraction are now APPROVED or further along (PICKING,
 *     READY_TO_INVOICE) rather than REJECTED/CANCELLED/still pending.
 *
 * Each rate's own cohort can still include records whose outcome hasn't
 * happened yet (a request received yesterday may not have been actioned
 * yet) -- that's correct, not a bug: it is reported as "not yet
 * processed," never silently dropped from the denominator.
 *
 * orderStatus/quotationStatus are deliberately NOT applied anywhere in
 * this function, for the same reason as lib/reporting/
 * fulfilment-intelligence.ts's own fulfilmentStatus: this report's whole
 * output already IS a breakdown by status (ordersAwaitingApproval/
 * ordersConfirmed/ordersRejected/ordersCancelled; quotationsAccepted/
 * quotationsRejected/quotationsExpired/quotationsCancelled) -- an
 * equality filter would just collapse the funnel down to a number
 * that's already visible in the unfiltered response. Both filters DO
 * have real effect on the list-shaped drill-downs this funnel's own
 * numbers link out to (the /orders and /quotations list pages, and
 * lib/reporting/management-reports.ts's "outstanding-orders"/
 * "awaiting-fulfilment" list reports, which apply orderStatus for real).
 */

const ORDER_PROGRESSED_STATUSES: OrderStatus[] = [OrderStatus.APPROVED, OrderStatus.PICKING, OrderStatus.READY_TO_INVOICE];
const ORDER_AWAITING_FULFILMENT_STATUSES: OrderStatus[] = [OrderStatus.APPROVED, OrderStatus.PICKING];

export type SalesPipelineFunnel = {
  requestsReceived: number;
  requestsProcessed: number;
  requestsIgnoredOrDuplicate: number;
  requestsProcessedRatePercent: number | null;

  quotationsCreated: number;
  quotationsIssued: number;
  quotationsIssuedValue: string;
  quotationsAccepted: number;
  quotationsRejected: number;
  quotationsExpired: number;
  quotationsCancelled: number;
  quotationAcceptanceRatePercent: number | null;

  acceptedQuotationsInCohort: number;
  acceptedQuotationsConvertedToOrder: number;
  quotationToOrderConversionRatePercent: number | null;

  ordersReceived: number;
  ordersAwaitingApproval: number;
  ordersConfirmed: number;
  ordersAwaitingFulfilment: number;
  ordersRejected: number;
  ordersCancelled: number;
  orderApprovalRatePercent: number | null;

  lostSalesConfirmedCount: number;
  lostSalesConfirmedQuantity: string;
};

export type SalesPipelineBottleneck = {
  /** e.g. "Quotation drafted to issued" */
  transition: string;
  averageDays: number | null;
  /** How many records had both timestamps and so contributed to the average -- shown so a 1-record average is never mistaken for a stable trend. */
  sampleSize: number;
};

export type SalesPipelineReport = {
  dateFrom: string;
  dateTo: string;
  funnel: SalesPipelineFunnel;
  bottlenecks: SalesPipelineBottleneck[];
};

function ratePercent(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10; // one decimal place
}

function averageDaysBetween(rows: readonly { from: Date; to: Date }[]): number | null {
  if (rows.length === 0) return null;
  const totalMs = rows.reduce((sum, row) => sum + (row.to.getTime() - row.from.getTime()), 0);
  return Math.round((totalMs / rows.length / (1000 * 60 * 60 * 24)) * 10) / 10;
}

export async function getSalesPipelineReport(filters: ReportFilters): Promise<SalesPipelineReport> {
  const { dateFrom, dateTo } = defaultDateRange();
  const effectiveFrom = filters.dateFrom ?? dateFrom;
  const effectiveTo = filters.dateTo ?? dateTo;
  const range = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const demo = demoWhere(filters);

  const customerFilter = filters.customerId ? { customerId: filters.customerId } : {};
  const salespersonFilter = filters.salespersonId ? { salespersonId: filters.salespersonId } : {};
  const orderLineProductFilter = filters.productId ? { lines: { some: { productId: filters.productId } } } : {};
  const quotationLineProductFilter = filters.productId ? { lines: { some: { productId: filters.productId } } } : {};

  // --- Requests (MessageIntake) cohort: receivedAt in range ---
  const intakeWhere: Prisma.MessageIntakeWhereInput = { ...demo, receivedAt: range, ...customerFilter };
  const [requestsReceived, requestsProcessed, requestsIgnoredOrDuplicate] = await Promise.all([
    prisma.messageIntake.count({ where: intakeWhere }),
    prisma.messageIntake.count({ where: { ...intakeWhere, status: { in: ["CONVERTED", "LINKED"] } } }),
    prisma.messageIntake.count({ where: { ...intakeWhere, status: { in: ["IGNORED", "DUPLICATE"] } } }),
  ]);

  // --- Quotations cohort A: quotationDate in range (created) ---
  const quotationCreatedWhere: Prisma.QuotationWhereInput = {
    ...demo,
    supersededAt: null,
    quotationDate: { gte: range.gte, lt: range.lt },
    ...customerFilter,
    ...salespersonFilter,
    ...quotationLineProductFilter,
  };
  const quotationsCreated = await prisma.quotation.count({ where: quotationCreatedWhere });

  // --- Quotations cohort B: issuedAt in range (the rate's real anchor) ---
  const quotationIssuedWhere: Prisma.QuotationWhereInput = {
    ...demo,
    supersededAt: null,
    issuedAt: { not: null, ...range },
    ...customerFilter,
    ...salespersonFilter,
    ...quotationLineProductFilter,
  };
  const [quotationsIssued, quotationsIssuedValueRows, quotationsAcceptedFromIssuedCohort] = await Promise.all([
    prisma.quotation.count({ where: quotationIssuedWhere }),
    prisma.quotation.findMany({ where: quotationIssuedWhere, select: { total: true } }),
    prisma.quotation.count({ where: { ...quotationIssuedWhere, status: "ACCEPTED" } }),
  ]);
  const quotationsIssuedValue = formatScaledDecimal(sumDecimalStrings(quotationsIssuedValueRows.map((q) => q.total.toString())));

  // --- Quotations cohort C: respondedAt in range AND status=ACCEPTED (anchor for the accept->order rate) ---
  const quotationAcceptedWhere: Prisma.QuotationWhereInput = {
    ...demo,
    status: "ACCEPTED",
    respondedAt: { not: null, ...range },
    ...customerFilter,
    ...salespersonFilter,
    ...quotationLineProductFilter,
  };
  const [acceptedQuotationsInCohort, acceptedQuotationsConvertedToOrder] = await Promise.all([
    prisma.quotation.count({ where: quotationAcceptedWhere }),
    prisma.quotation.count({ where: { ...quotationAcceptedWhere, convertedAt: { not: null } } }),
  ]);

  // Rejected/expired/cancelled, counted against their own natural anchor date (respondedAt for rejected, expiredAt for expired, cancelledAt for cancelled) rather than forcing all three onto issuedAt.
  const [quotationsRejected, quotationsExpired, quotationsCancelled] = await Promise.all([
    prisma.quotation.count({ where: { ...demo, status: "REJECTED", respondedAt: { not: null, ...range }, ...customerFilter, ...salespersonFilter } }),
    prisma.quotation.count({ where: { ...demo, status: "EXPIRED", expiredAt: { not: null, ...range }, ...customerFilter, ...salespersonFilter } }),
    prisma.quotation.count({ where: { ...demo, status: "CANCELLED", cancelledAt: { not: null, ...range }, ...customerFilter, ...salespersonFilter } }),
  ]);

  // --- Orders cohort: receivedAt in range (the rate's anchor) ---
  const orderReceivedWhere: Prisma.CustomerOrderWhereInput = {
    ...demo,
    receivedAt: { not: null, ...range },
    ...customerFilter,
    ...salespersonFilter,
    ...orderLineProductFilter,
  };
  const [ordersReceived, ordersAwaitingApproval, ordersConfirmed, ordersAwaitingFulfilment, ordersRejected, ordersCancelled] = await Promise.all([
    prisma.customerOrder.count({ where: orderReceivedWhere }),
    prisma.customerOrder.count({ where: { ...orderReceivedWhere, status: OrderStatus.READY_FOR_APPROVAL } }),
    prisma.customerOrder.count({ where: { ...orderReceivedWhere, status: { in: ORDER_PROGRESSED_STATUSES } } }),
    prisma.customerOrder.count({ where: { ...orderReceivedWhere, status: { in: ORDER_AWAITING_FULFILMENT_STATUSES } } }),
    prisma.customerOrder.count({ where: { ...orderReceivedWhere, status: OrderStatus.REJECTED } }),
    prisma.customerOrder.count({ where: { ...orderReceivedWhere, status: OrderStatus.CANCELLED } }),
  ]);

  // --- Lost sales confirmed in this same window (cohorted by createdAt -- see this module's own top comment and docs/milestones/m11-metric-definitions.md for why createdAt, not a dedicated "confirmed lost" timestamp, which UnfulfilledDemand does not have) ---
  const lostSaleWhere: Prisma.UnfulfilledDemandWhereInput = { ...demo, status: "CONFIRMED_LOST", createdAt: range, ...customerFilter };
  const [lostSalesConfirmedCount, lostSalesRows] = await Promise.all([
    prisma.unfulfilledDemand.count({ where: lostSaleWhere }),
    prisma.unfulfilledDemand.findMany({ where: lostSaleWhere, select: { confirmedLostQuantity: true } }),
  ]);
  const lostSalesConfirmedQuantity = formatScaledDecimal(sumDecimalStrings(lostSalesRows.map((r) => r.confirmedLostQuantity.toString())));

  // --- Bottlenecks: average lag between consecutive lifecycle timestamps on the SAME record, over records in this window whose relevant stage actually happened (never padded with nulls as zero) ---
  const [quotationTimings, orderTimings] = await Promise.all([
    prisma.quotation.findMany({
      where: quotationCreatedWhere,
      select: { quotationDate: true, issuedAt: true, respondedAt: true, convertedAt: true },
    }),
    prisma.customerOrder.findMany({
      where: orderReceivedWhere,
      select: { receivedAt: true, approvedAt: true, handedToSapAt: true },
    }),
  ]);

  const bottlenecks: SalesPipelineBottleneck[] = [
    (() => {
      const rows = quotationTimings.filter((q) => q.issuedAt !== null).map((q) => ({ from: q.quotationDate, to: q.issuedAt as Date }));
      return { transition: "Quotation drafted to issued", averageDays: averageDaysBetween(rows), sampleSize: rows.length };
    })(),
    (() => {
      const rows = quotationTimings.filter((q) => q.issuedAt !== null && q.respondedAt !== null).map((q) => ({ from: q.issuedAt as Date, to: q.respondedAt as Date }));
      return { transition: "Quotation issued to customer response", averageDays: averageDaysBetween(rows), sampleSize: rows.length };
    })(),
    (() => {
      const rows = quotationTimings.filter((q) => q.respondedAt !== null && q.convertedAt !== null).map((q) => ({ from: q.respondedAt as Date, to: q.convertedAt as Date }));
      return { transition: "Quotation accepted to order conversion", averageDays: averageDaysBetween(rows), sampleSize: rows.length };
    })(),
    (() => {
      const rows = orderTimings.filter((o) => o.receivedAt !== null && o.approvedAt !== null).map((o) => ({ from: o.receivedAt as Date, to: o.approvedAt as Date }));
      return { transition: "Order received to approved", averageDays: averageDaysBetween(rows), sampleSize: rows.length };
    })(),
    (() => {
      const rows = orderTimings.filter((o) => o.approvedAt !== null && o.handedToSapAt !== null).map((o) => ({ from: o.approvedAt as Date, to: o.handedToSapAt as Date }));
      return { transition: "Order approved to handed to SAP", averageDays: averageDaysBetween(rows), sampleSize: rows.length };
    })(),
  ];

  return {
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
    funnel: {
      requestsReceived,
      requestsProcessed,
      requestsIgnoredOrDuplicate,
      requestsProcessedRatePercent: ratePercent(requestsProcessed, requestsReceived),
      quotationsCreated,
      quotationsIssued,
      quotationsIssuedValue,
      quotationsAccepted: quotationsAcceptedFromIssuedCohort,
      quotationsRejected,
      quotationsExpired,
      quotationsCancelled,
      quotationAcceptanceRatePercent: ratePercent(quotationsAcceptedFromIssuedCohort, quotationsIssued),
      acceptedQuotationsInCohort,
      acceptedQuotationsConvertedToOrder,
      quotationToOrderConversionRatePercent: ratePercent(acceptedQuotationsConvertedToOrder, acceptedQuotationsInCohort),
      ordersReceived,
      ordersAwaitingApproval,
      ordersConfirmed,
      ordersAwaitingFulfilment,
      ordersRejected,
      ordersCancelled,
      orderApprovalRatePercent: ratePercent(ordersConfirmed, ordersReceived),
      lostSalesConfirmedCount,
      lostSalesConfirmedQuantity,
    },
    bottlenecks,
  };
}
