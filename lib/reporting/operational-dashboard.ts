import "server-only";
import { prisma } from "@/lib/prisma";
import { getQuotationDashboardCounts } from "@/lib/quotations/queries";
import { getApprovalDashboard } from "@/lib/approvals/queries";
import { getLostSalesReportSummary } from "@/lib/lost-sales/queries";
import type { ReportFilters, DrillDownLink } from "@/lib/reporting/types";

/**
 * Milestone 11 (Operational BI), spec section 3: "the current state of
 * the business" -- deliberately a RIGHT-NOW snapshot, not date-range
 * filtered (the date-range-filtered, over-time view is
 * lib/reporting/sales-pipeline.ts). Composes the already-existing
 * per-module dashboard functions directly (spec section 2: reuse, don't
 * re-derive) and adds exactly two new pieces this schema didn't have an
 * aggregate for yet: the corrected fulfilment-stage order counts (now
 * that real M10 DispatchRecord/DeliveryRecord data exists -- see this
 * file's own comment on `awaitingFulfilment`/`dispatched`/`delivered`
 * below, which replace app/page.tsx's old APPROVED-and-not-yet-handed-
 * to-SAP / invoicedAt-is-set proxies), and the curated action-queue list
 * itself.
 *
 * Spec section 3: "Do not display every metric merely because it is
 * available. Prioritise what management needs to act on." --
 * `actionQueues` is that curated, prioritized list (each a real count
 * with a drill-down link into an EXISTING filtered list page, never a
 * number invented for this dashboard); `snapshot` is the smaller set of
 * broader headline totals for context around it, not an attempt to
 * surface literally every number section 3 mentions.
 */

export type ActionQueueSeverity = "info" | "attention" | "urgent";

export type ActionQueueItem = {
  label: string;
  count: number;
  severity: ActionQueueSeverity;
  drillDown: DrillDownLink;
};

export type OperationalDashboard = {
  /** ISO timestamp this snapshot was computed at -- this is a live "right now" view, not a cached report. */
  asOf: string;
  actionQueues: ActionQueueItem[];
  snapshot: {
    quotationsAwaitingPreparation: number;
    quotationsIssuedAwaitingResponse: number;
    ordersReceived: number;
    ordersAwaitingApproval: number;
    ordersApproved: number;
    ordersAwaitingFulfilment: number;
    ordersDispatched: number;
    ordersDelivered: number;
    openInvoiceClaims: number;
    lostSalesPendingDecision: number;
    outboundMessagesFailedBacklog: number;
    intakeAwaitingReview: number;
  };
};

export async function getOperationalDashboard(viewerId: string, viewerRole: string, filters: ReportFilters): Promise<OperationalDashboard> {
  const demoWhere = filters.includeDemo ? {} : { isDemo: false };

  const [
    quotationCounts,
    approvalDashboard,
    lostSalesSummary,
    ordersReceived,
    ordersAwaitingApproval,
    ordersApproved,
    // "Awaiting fulfilment" corrected: APPROVED/PICKING orders with no
    // DispatchRecord that has actually DEPARTED or DELIVERED yet --
    // replaces app/page.tsx's old proxy (APPROVED && handedToSapAt is
    // null), which measured SAP handover timing, not fulfilment.
    ordersAwaitingFulfilment,
    ordersDispatched,
    ordersDelivered,
    openInvoiceClaims,
    outboundMessagesFailedBacklog,
    intakeAwaitingReview,
  ] = await Promise.all([
    getQuotationDashboardCounts(),
    getApprovalDashboard(viewerId, viewerRole, { includeDemo: filters.includeDemo }),
    getLostSalesReportSummary({ includeDemo: filters.includeDemo }),
    prisma.customerOrder.count({ where: { ...demoWhere, status: "RECEIVED" } }),
    prisma.customerOrder.count({ where: { ...demoWhere, status: "READY_FOR_APPROVAL" } }),
    prisma.customerOrder.count({ where: { ...demoWhere, status: "APPROVED" } }),
    prisma.customerOrder.count({
      where: { ...demoWhere, status: { in: ["APPROVED", "PICKING"] }, dispatchRecords: { none: { status: { in: ["DEPARTED", "DELIVERED"] } } } },
    }),
    prisma.customerOrder.count({ where: { ...demoWhere, dispatchRecords: { some: { status: { in: ["DEPARTED", "DELIVERED"] } } } } }),
    prisma.customerOrder.count({ where: { ...demoWhere, dispatchRecords: { some: { deliveryRecord: { isNot: null } } } } }),
    prisma.invoiceClaim.count({ where: { ...demoWhere, status: { in: ["OPEN", "UNDER_INVESTIGATION", "AWAITING_CUSTOMER", "AWAITING_INTERNAL_ACTION"] } } }),
    prisma.outboundMessage.count({ where: { ...demoWhere, status: "FAILED" } }),
    prisma.messageIntake.count({ where: { ...demoWhere, status: "RECEIVED" } }),
  ]);

  const quotationsAwaitingPreparation = quotationCounts.draft;
  const quotationsIssuedAwaitingResponse = quotationCounts.issuedAwaitingResponse;
  const lostSalesPendingDecision = lostSalesSummary.awaitingDecisionCount;

  const actionQueues: ActionQueueItem[] = [
    {
      label: "Quotations awaiting preparation",
      count: quotationsAwaitingPreparation,
      severity: quotationsAwaitingPreparation > 0 ? "attention" : "info",
      drillDown: { label: "View draft quotations", href: "/quotations?status=DRAFT" },
    },
    {
      label: "Orders awaiting approval",
      count: ordersAwaitingApproval,
      severity: ordersAwaitingApproval > 0 ? "attention" : "info",
      drillDown: { label: "View orders awaiting approval", href: "/orders?status=READY_FOR_APPROVAL" },
    },
    {
      label: "Message intake awaiting review",
      count: intakeAwaitingReview,
      severity: intakeAwaitingReview > 5 ? "urgent" : intakeAwaitingReview > 0 ? "attention" : "info",
      drillDown: { label: "Review inbox", href: "/communications/inbox" },
    },
    {
      label: "Orders awaiting fulfilment",
      count: ordersAwaitingFulfilment,
      severity: ordersAwaitingFulfilment > 0 ? "attention" : "info",
      drillDown: { label: "View orders awaiting fulfilment", href: "/fulfilment" },
    },
    {
      label: "Open invoice claims",
      count: openInvoiceClaims,
      severity: openInvoiceClaims > 0 ? "attention" : "info",
      drillDown: { label: "View open claims", href: "/invoice-claims?status=OPEN" },
    },
    {
      label: "Lost sales awaiting decision",
      count: lostSalesPendingDecision,
      severity: lostSalesPendingDecision > 0 ? "attention" : "info",
      drillDown: { label: "View lost-sales decisions", href: "/lost-sales" },
    },
    {
      label: "Failed outbound messages",
      count: outboundMessagesFailedBacklog,
      severity: outboundMessagesFailedBacklog > 0 ? "urgent" : "info",
      drillDown: { label: "View outbound message log", href: "/communications?status=FAILED" },
    },
    {
      label: "Approvals pending my decision",
      count: approvalDashboard.pendingMyDecisionCount,
      severity: approvalDashboard.pendingMyDecisionCount > 0 ? "attention" : "info",
      drillDown: { label: "View my pending approvals", href: "/approvals" },
    },
  ];

  return {
    asOf: new Date().toISOString(),
    actionQueues,
    snapshot: {
      quotationsAwaitingPreparation,
      quotationsIssuedAwaitingResponse,
      ordersReceived,
      ordersAwaitingApproval,
      ordersApproved,
      ordersAwaitingFulfilment,
      ordersDispatched,
      ordersDelivered,
      openInvoiceClaims,
      lostSalesPendingDecision,
      outboundMessagesFailedBacklog,
      intakeAwaitingReview,
    },
  };
}
