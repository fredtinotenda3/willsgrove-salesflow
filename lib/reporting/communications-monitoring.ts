import "server-only";
import { prisma } from "@/lib/prisma";
import { getEmailDeploymentMode, getWhatsAppDeploymentMode, type ChannelDeploymentMode } from "@/lib/channels/config";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToTimestampFilter, defaultDateRange } from "@/lib/reporting/filters";

/**
 * Milestone 11 (Operational BI), spec section 7: communication and
 * operational exception monitoring over the real M10 channel/
 * communications records.
 *
 * communicationStatus is deliberately NOT applied in this function: this
 * report's whole output already IS a breakdown by status (totalReceived/
 * awaitingReview/successfullyProcessed/duplicateOrRejected on the intake
 * side; queued/sent/failed on the outbound side) -- an equality filter
 * here would silently collapse that breakdown down to one number that's
 * already visible in the unfiltered response, rather than add any new
 * information. The filter dimension is real and does have effect
 * elsewhere on the reporting surface: lib/reporting/management-reports.ts's
 * "communication-failures" list report is the drill-down into the
 * `outbound.failed` figure this function already returns. fulfilmentStatus
 * similarly does not apply to this communications-focused report at all
 * (see lib/reporting/fulfilment-intelligence.ts's own comment for where
 * it does and doesn't apply).
 *
 * "Delivery failures where supported by the provider" (spec's own
 * phrasing, "where supported") is reported as `missing` rather than a
 * fabricated number: neither the mock adapters nor the real
 * email/WhatsApp adapters this milestone built (lib/channels/) model a
 * provider-side delivery receipt distinct from "the send attempt
 * itself succeeded or failed" -- OutboundMessage has no such column.
 * sentVsFailedCounts below is the real, available signal (did SENDING
 * succeed), named precisely as that, not as "delivered."
 */

export type ChannelModeSummary = {
  email: ChannelDeploymentMode;
  whatsapp: ChannelDeploymentMode;
};

export type IntakeSummary = {
  totalReceived: number;
  byChannel: { channel: string; count: number }[];
  awaitingReview: number;
  successfullyProcessed: number; // CONVERTED or LINKED
  duplicateOrRejected: number; // DUPLICATE or IGNORED
};

export type OutboundSummary = {
  queued: number;
  sent: number;
  failed: number;
  /** attemptCount > 1 -- a message that needed at least one retry before reaching its current state. */
  retried: number;
  deliveryReceiptsSupported: false; // see this file's own top comment
};

export type OrdersWithCommunicationProblems = {
  ordersWithFailedOutboundMessage: number;
  /** A delivery recorded PARTIALLY_REJECTED/FULLY_REJECTED whose DELIVERY_EXCEPTION notification either was never queued or itself failed -- the customer never actually found out. */
  deliveryExceptionsWithNoSuccessfulNotification: number;
};

export type CommunicationsMonitoringReport = {
  dateFrom: string;
  dateTo: string;
  channelMode: ChannelModeSummary;
  intake: IntakeSummary;
  outbound: OutboundSummary;
  exceptions: OrdersWithCommunicationProblems;
};

export async function getCommunicationsMonitoringReport(filters: ReportFilters): Promise<CommunicationsMonitoringReport> {
  const { dateFrom, dateTo } = defaultDateRange();
  const effectiveFrom = filters.dateFrom ?? dateFrom;
  const effectiveTo = filters.dateTo ?? dateTo;
  const range = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const demo = demoWhere(filters);
  const customerFilter = filters.customerId ? { customerId: filters.customerId } : {};

  const channelMode: ChannelModeSummary = {
    email: getEmailDeploymentMode(),
    whatsapp: getWhatsAppDeploymentMode(),
  };

  const intakeWhere = { ...demo, receivedAt: range, ...customerFilter };
  const [totalReceived, channelGroups, awaitingReview, successfullyProcessed, duplicateOrRejected] = await Promise.all([
    prisma.messageIntake.count({ where: intakeWhere }),
    prisma.messageIntake.groupBy({ by: ["channel"], where: intakeWhere, _count: { _all: true } }),
    prisma.messageIntake.count({ where: { ...intakeWhere, status: "RECEIVED" } }),
    prisma.messageIntake.count({ where: { ...intakeWhere, status: { in: ["CONVERTED", "LINKED"] } } }),
    prisma.messageIntake.count({ where: { ...intakeWhere, status: { in: ["DUPLICATE", "IGNORED"] } } }),
  ]);

  const outboundWhere = { ...demo, createdAt: range, ...customerFilter };
  const [queued, sent, failed, retried] = await Promise.all([
    prisma.outboundMessage.count({ where: { ...outboundWhere, status: "QUEUED" } }),
    prisma.outboundMessage.count({ where: { ...outboundWhere, status: "SENT" } }),
    prisma.outboundMessage.count({ where: { ...outboundWhere, status: "FAILED" } }),
    prisma.outboundMessage.count({ where: { ...outboundWhere, attemptCount: { gt: 1 } } }),
  ]);

  const [ordersWithFailedOutboundMessage, deliveryExceptionRecords] = await Promise.all([
    prisma.customerOrder.count({
      where: { ...demo, ...customerFilter, outboundMessages: { some: { status: "FAILED", createdAt: range } } },
    }),
    prisma.deliveryRecord.findMany({
      where: { ...demo, outcome: { in: ["PARTIALLY_REJECTED", "FULLY_REJECTED"] }, recordedAt: range },
      select: { outboundMessages: { where: { type: "DELIVERY_EXCEPTION" }, select: { status: true } } },
    }),
  ]);
  const deliveryExceptionsWithNoSuccessfulNotification = deliveryExceptionRecords.filter(
    (record) => !record.outboundMessages.some((m) => m.status === "SENT")
  ).length;

  return {
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
    channelMode,
    intake: {
      totalReceived,
      byChannel: channelGroups.map((g) => ({ channel: g.channel, count: g._count._all })),
      awaitingReview,
      successfullyProcessed,
      duplicateOrRejected,
    },
    outbound: { queued, sent, failed, retried, deliveryReceiptsSupported: false },
    exceptions: { ordersWithFailedOutboundMessage, deliveryExceptionsWithNoSuccessfulNotification },
  };
}
