import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToTimestampFilter, defaultDateRange } from "@/lib/reporting/filters";

/**
 * Milestone 11 (Operational BI), spec section 5: picking and fulfilment
 * intelligence over the real M3 (PickingSession/PickingLine) and M10
 * (DispatchRecord/DispatchLine/DeliveryRecord/DeliveryLine) records.
 *
 * Quantity vocabulary used throughout this file -- deliberately never
 * blended, per the spec's explicit "do not treat dispatched quantities
 * as delivered quantities" / "do not treat picking completion as
 * delivery completion":
 *
 *   ordered    -- PickingLine.requestedQuantity (== the OrderLine it was
 *                 generated from; picking is always started against the
 *                 order's own requested quantities, never a guess).
 *   available  -- PickingLine.foundQuantity. This schema has no separate
 *                 "available" column distinct from "found" -- the act of
 *                 picking IS the act of discovering what's actually
 *                 available, so "available" and "picked" are the SAME
 *                 number here (foundQuantity), not two different ones.
 *                 Documented explicitly rather than silently inventing a
 *                 second figure spec section 5 asks for that this schema
 *                 doesn't separately track.
 *   shortage   -- PickingLine.unavailableQuantity (requested but not
 *                 found at pick time).
 *   dispatched -- DispatchLine.dispatchedQuantity (what physically left
 *                 on a vehicle/courier -- can be less than foundQuantity
 *                 if a dispatch covers only part of what was picked).
 *   accepted / rejected -- DeliveryLine.acceptedQuantity /
 *                 .rejectedQuantity (the customer's own recorded
 *                 response to what arrived -- only exists once a
 *                 DeliveryRecord has been recorded for that dispatch).
 *
 * Each rate below divides two sums over the EXACT SAME set of rows (no
 * cross-cohort mixing is even possible), and is reported alongside its
 * own denominator so a rate computed from a handful of rows is never
 * mistaken for one computed from hundreds.
 *
 * fulfilmentStatus is deliberately NOT applied anywhere in this function:
 * this report's whole output already IS a breakdown by status across
 * three different lifecycle stages, each with its own enum
 * (PickingPerformance by PickingSessionStatus, DispatchDeliverySummary by
 * DispatchStatus/DeliveryOutcome) -- an equality filter would silently
 * collapse one of those breakdowns down to a single number that's
 * already visible, rather than add information, and there is no single
 * enum fulfilmentStatus could even unambiguously mean at this report's
 * aggregate level. The filter dimension has real effect on the two
 * list-shaped drill-downs instead, where it unambiguously means one
 * specific entity's own status (lib/reporting/management-reports.ts's
 * "picking-shortages" list applies it as a PickingSessionStatus value;
 * "delivery-exceptions" applies it as a DeliveryOutcome value).
 */

export type FulfilmentQuantitySummary = {
  orderedQuantity: string;
  availableQuantity: string;
  shortageQuantity: string;
  dispatchedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  outstandingDeliveryQuantity: string; // dispatched, no delivery outcome recorded yet -- i.e. still in transit
};

export type FulfilmentRates = {
  /** sum(foundQuantity) / sum(requestedQuantity) over the same PickingLine rows -- "of what was ordered, how much could actually be picked." */
  pickingAvailabilityRatePercent: number | null;
  pickingLineSampleSize: number;
  /** sum(dispatchedQuantity) / sum(acceptedQuantity+rejectedQuantity) over DispatchLines that HAVE a recorded delivery outcome -- "of what was dispatched and has a known outcome, how much the customer actually accepted." Deliberately excludes dispatch lines with no DeliveryLine yet (those are outstanding, not a 0% acceptance). */
  deliveryAcceptanceRatePercent: number | null;
  deliveryLineSampleSize: number;
};

export type PickingPerformance = {
  sessionsStarted: number;
  sessionsCompleted: number;
  sessionsAuthorized: number;
  sessionsWithNoShortage: number;
  sessionsWithShortage: number;
  averagePickingDurationHours: number | null; // completedAt - startedAt, COMPLETED sessions only
  averageAuthorizationLagHours: number | null; // authorizedAt - completedAt, AUTHORIZED sessions only
};

export type DispatchDeliverySummary = {
  dispatchesPlanned: number;
  dispatchesDeparted: number;
  dispatchesDelivered: number;
  dispatchesCancelled: number;
  /** Planned departure date has passed and the dispatch has neither departed nor been cancelled -- a concrete, data-supported delay signal (spec section 5's "fulfilment delays"), never an estimate. */
  dispatchesOverdueToDepart: number;
  deliveriesAcceptedInFull: number;
  deliveriesPartiallyRejected: number;
  deliveriesFullyRejected: number;
};

export type OrderFulfilmentBreakdown = {
  ordersFullyFulfilled: number; // every picking line's foundQuantity === requestedQuantity, no shortage anywhere
  ordersPartiallyFulfilled: number; // at least one line short, but not every unit of every line
  ordersAwaitingPicking: number; // APPROVED/PICKING status orders with no PickingSession yet
};

export type FulfilmentIntelligenceReport = {
  dateFrom: string;
  dateTo: string;
  quantities: FulfilmentQuantitySummary;
  rates: FulfilmentRates;
  picking: PickingPerformance;
  dispatchDelivery: DispatchDeliverySummary;
  orders: OrderFulfilmentBreakdown;
};

function ratePercent(numerator: bigint, denominator: bigint): number | null {
  if (denominator === BigInt(0)) return null;
  // Scaled-integer division to one decimal place without floating point:
  // (numerator * 1000 / denominator), then shown as numerator/10.
  const scaled = (numerator * BigInt(1000)) / denominator;
  return Number(scaled) / 10;
}

function averageHoursBetween(rows: readonly { from: Date; to: Date }[]): number | null {
  if (rows.length === 0) return null;
  const totalMs = rows.reduce((sum, row) => sum + (row.to.getTime() - row.from.getTime()), 0);
  return Math.round((totalMs / rows.length / (1000 * 60 * 60)) * 10) / 10;
}

export async function getFulfilmentIntelligenceReport(filters: ReportFilters): Promise<FulfilmentIntelligenceReport> {
  const { dateFrom, dateTo } = defaultDateRange();
  const effectiveFrom = filters.dateFrom ?? dateFrom;
  const effectiveTo = filters.dateTo ?? dateTo;
  const range = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const demo = demoWhere(filters);

  const orderScope: Prisma.CustomerOrderWhereInput = {
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.salespersonId ? { salespersonId: filters.salespersonId } : {}),
    ...(filters.productId ? { lines: { some: { productId: filters.productId } } } : {}),
  };

  // --- Picking lines in scope: sessions started within the window ---
  // Demo-exclusion applies through the parent PickingSession's own isDemo
  // column -- PickingLine itself has no isDemo field (only the session it
  // belongs to does), same as every *Line child-of-a-demo-flagged-parent
  // model in this schema (DispatchLine/DeliveryLine below included).
  const pickingLines = await prisma.pickingLine.findMany({
    where: { pickingSession: { ...demo, startedAt: range, order: orderScope } },
    select: { requestedQuantity: true, foundQuantity: true, unavailableQuantity: true },
  });
  const orderedQuantity = sumDecimalStrings(pickingLines.map((l) => l.requestedQuantity.toString()));
  const availableQuantity = sumDecimalStrings(pickingLines.filter((l) => l.foundQuantity !== null).map((l) => l.foundQuantity!.toString()));
  const shortageQuantity = sumDecimalStrings(pickingLines.filter((l) => l.unavailableQuantity !== null).map((l) => l.unavailableQuantity!.toString()));

  // --- Dispatch lines in scope: dispatch created within the window ---
  // Same reasoning as pickingLines above: DispatchLine has no isDemo of
  // its own -- the demo filter applies through its parent DispatchRecord.
  const dispatchLines = await prisma.dispatchLine.findMany({
    where: { dispatchRecord: { ...demo, createdAt: range, order: orderScope } },
    select: {
      dispatchedQuantity: true,
      deliveryLine: { select: { acceptedQuantity: true, rejectedQuantity: true } },
    },
  });
  const dispatchedQuantity = sumDecimalStrings(dispatchLines.map((l) => l.dispatchedQuantity.toString()));
  const deliveredLines = dispatchLines.filter((l) => l.deliveryLine !== null);
  const outstandingLines = dispatchLines.filter((l) => l.deliveryLine === null);
  const acceptedQuantity = sumDecimalStrings(deliveredLines.map((l) => l.deliveryLine!.acceptedQuantity.toString()));
  const rejectedQuantity = sumDecimalStrings(deliveredLines.map((l) => l.deliveryLine!.rejectedQuantity.toString()));
  const outstandingDeliveryQuantity = sumDecimalStrings(outstandingLines.map((l) => l.dispatchedQuantity.toString()));

  const quantities: FulfilmentQuantitySummary = {
    orderedQuantity: formatScaledDecimal(orderedQuantity),
    availableQuantity: formatScaledDecimal(availableQuantity),
    shortageQuantity: formatScaledDecimal(shortageQuantity),
    dispatchedQuantity: formatScaledDecimal(dispatchedQuantity),
    acceptedQuantity: formatScaledDecimal(acceptedQuantity),
    rejectedQuantity: formatScaledDecimal(rejectedQuantity),
    outstandingDeliveryQuantity: formatScaledDecimal(outstandingDeliveryQuantity),
  };

  const rates: FulfilmentRates = {
    pickingAvailabilityRatePercent: ratePercent(availableQuantity, orderedQuantity),
    pickingLineSampleSize: pickingLines.length,
    deliveryAcceptanceRatePercent: ratePercent(acceptedQuantity, sumDecimalStrings(deliveredLines.map((l) => l.dispatchedQuantity.toString()))),
    deliveryLineSampleSize: deliveredLines.length,
  };

  // --- Picking performance ---
  const pickingSessions = await prisma.pickingSession.findMany({
    where: { ...demo, startedAt: range, order: orderScope },
    select: { status: true, startedAt: true, completedAt: true, authorizedAt: true, lines: { select: { unavailableQuantity: true } } },
  });
  const sessionsCompletedRows = pickingSessions.filter((s) => s.completedAt !== null).map((s) => ({ from: s.startedAt, to: s.completedAt as Date }));
  const sessionsAuthorizedRows = pickingSessions.filter((s) => s.completedAt !== null && s.authorizedAt !== null).map((s) => ({ from: s.completedAt as Date, to: s.authorizedAt as Date }));
  const picking: PickingPerformance = {
    sessionsStarted: pickingSessions.length,
    sessionsCompleted: pickingSessions.filter((s) => s.status === "COMPLETED" || s.status === "AUTHORIZED").length,
    sessionsAuthorized: pickingSessions.filter((s) => s.status === "AUTHORIZED").length,
    sessionsWithNoShortage: pickingSessions.filter((s) => s.lines.every((l) => l.unavailableQuantity === null || Number(l.unavailableQuantity) === 0)).length,
    sessionsWithShortage: pickingSessions.filter((s) => s.lines.some((l) => l.unavailableQuantity !== null && Number(l.unavailableQuantity) > 0)).length,
    averagePickingDurationHours: averageHoursBetween(sessionsCompletedRows),
    averageAuthorizationLagHours: averageHoursBetween(sessionsAuthorizedRows),
  };

  // --- Dispatch/delivery record-level summary ---
  const dispatchRecords = await prisma.dispatchRecord.findMany({
    where: { ...demo, createdAt: range, order: orderScope },
    select: { status: true, plannedDepartureAt: true, departedAt: true, deliveryRecord: { select: { outcome: true } } },
  });
  const now = new Date();
  const dispatchDelivery: DispatchDeliverySummary = {
    dispatchesPlanned: dispatchRecords.filter((d) => d.status === "PLANNED").length,
    dispatchesDeparted: dispatchRecords.filter((d) => d.status === "DEPARTED" || d.status === "DELIVERED").length,
    dispatchesDelivered: dispatchRecords.filter((d) => d.status === "DELIVERED").length,
    dispatchesCancelled: dispatchRecords.filter((d) => d.status === "CANCELLED").length,
    dispatchesOverdueToDepart: dispatchRecords.filter(
      (d) => d.status === "PLANNED" && d.plannedDepartureAt !== null && d.plannedDepartureAt < now && d.departedAt === null
    ).length,
    deliveriesAcceptedInFull: dispatchRecords.filter((d) => d.deliveryRecord?.outcome === "ACCEPTED_IN_FULL").length,
    deliveriesPartiallyRejected: dispatchRecords.filter((d) => d.deliveryRecord?.outcome === "PARTIALLY_REJECTED").length,
    deliveriesFullyRejected: dispatchRecords.filter((d) => d.deliveryRecord?.outcome === "FULLY_REJECTED").length,
  };

  // --- Order-level fulfilment breakdown ---
  const ordersWithPickingLines = await prisma.customerOrder.findMany({
    where: { ...demo, ...orderScope, receivedAt: range, status: { in: ["APPROVED", "PICKING", "READY_TO_INVOICE"] } },
    select: {
      id: true,
      pickingSessions: { select: { lines: { select: { requestedQuantity: true, foundQuantity: true } } }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  let ordersFullyFulfilled = 0;
  let ordersPartiallyFulfilled = 0;
  let ordersAwaitingPicking = 0;
  for (const order of ordersWithPickingLines) {
    const latestSession = order.pickingSessions[0];
    if (!latestSession || latestSession.lines.length === 0) {
      ordersAwaitingPicking += 1;
      continue;
    }
    const requested = sumDecimalStrings(latestSession.lines.map((l) => l.requestedQuantity.toString()));
    const found = sumDecimalStrings(latestSession.lines.filter((l) => l.foundQuantity !== null).map((l) => l.foundQuantity!.toString()));
    if (found >= requested) {
      ordersFullyFulfilled += 1;
    } else {
      ordersPartiallyFulfilled += 1;
    }
  }

  return {
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
    quantities,
    rates,
    picking,
    dispatchDelivery,
    orders: { ordersFullyFulfilled, ordersPartiallyFulfilled, ordersAwaitingPicking },
  };
}
