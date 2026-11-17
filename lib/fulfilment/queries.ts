import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimalStrings, formatScaledDecimal, clampedDifference } from "@/lib/fulfilment/decimal";

export type OrderLineFulfilmentStatus = {
  orderLineId: string;
  lineNumber: number;
  originalProductDescription: string;
  requestedQuantity: string;
  /**
   * Final Operational Enhancements (spec Part 3): surfaced so the dispatch
   * screen can auto-populate its lines with product code/UOM instead of
   * requiring manual re-entry, without changing what this function has
   * always computed (outstanding-to-dispatch quantities). Both fields are
   * nullable/optional on OrderLine itself (a line without a resolved SAP
   * item code, or predating requestedUnitCode being required, still has a
   * fulfilment status).
   */
  sapItemCodeSnapshot: string | null;
  requestedUnitCode: string;
  /** Total PickingLine.foundQuantity across every AUTHORIZED PickingSession for this line -- see this function's own comment. */
  authorizedFoundQuantity: string;
  /** Total DispatchLine.dispatchedQuantity across every non-CANCELLED DispatchRecord for this line. */
  dispatchedQuantity: string;
  /** authorizedFoundQuantity - dispatchedQuantity, clamped at zero. What can still be dispatched for this line. */
  outstandingQuantity: string;
};

export type OrderFulfilmentStatus = {
  orderId: string;
  lines: OrderLineFulfilmentStatus[];
};

/**
 * Milestone 10 (Communication Channels & Fulfilment). How much of each
 * OrderLine is still outstanding to dispatch -- the one function both
 * lib/fulfilment/dispatch.ts (validating a new DispatchRecord's requested
 * quantities) and the /fulfilment UI's dispatch screen read, so there is
 * exactly one definition of "outstanding," the same one-definition
 * discipline lib/picking/validation.ts's classifyAvailability already
 * follows for picking.
 *
 * authorizedFoundQuantity sums PickingLine.foundQuantity across EVERY
 * AUTHORIZED PickingSession for the order, not just the latest one --
 * lib/picking/start-picking.ts's own comment confirms an order can have
 * more than one AUTHORIZED session over its life (a deliberate re-pick
 * after an earlier one already authorized some quantity, which keeps the
 * earlier session's history untouched). Each authorization represents a
 * genuinely separate batch of stock that became available to dispatch, so
 * they are additive here, never a "latest session wins" replacement.
 */
export async function getOrderFulfilmentStatus(orderId: string): Promise<OrderFulfilmentStatus | null> {
  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      lines: {
        select: {
          id: true,
          lineNumber: true,
          originalProductDescription: true,
          requestedQuantity: true,
          sapItemCodeSnapshot: true,
          requestedUnitCode: true,
        },
        orderBy: { lineNumber: "asc" },
      },
    },
  });
  if (!order) return null;

  const [authorizedPickingLines, dispatchLines] = await Promise.all([
    prisma.pickingLine.findMany({
      where: { pickingSession: { orderId, status: "AUTHORIZED" }, foundQuantity: { not: null } },
      select: { orderLineId: true, foundQuantity: true },
    }),
    prisma.dispatchLine.findMany({
      where: { orderLine: { orderId }, dispatchRecord: { status: { not: "CANCELLED" } } },
      select: { orderLineId: true, dispatchedQuantity: true },
    }),
  ]);

  const foundByLine = new Map<string, string[]>();
  for (const line of authorizedPickingLines) {
    if (!line.foundQuantity) continue;
    const existing = foundByLine.get(line.orderLineId);
    if (existing) {
      existing.push(line.foundQuantity.toString());
    } else {
      foundByLine.set(line.orderLineId, [line.foundQuantity.toString()]);
    }
  }

  const dispatchedByLine = new Map<string, string[]>();
  for (const line of dispatchLines) {
    const existing = dispatchedByLine.get(line.orderLineId);
    if (existing) {
      existing.push(line.dispatchedQuantity.toString());
    } else {
      dispatchedByLine.set(line.orderLineId, [line.dispatchedQuantity.toString()]);
    }
  }

  const lines: OrderLineFulfilmentStatus[] = order.lines.map((line) => {
    const authorizedFoundScaled = sumDecimalStrings(foundByLine.get(line.id) ?? ["0"]);
    const dispatchedScaled = sumDecimalStrings(dispatchedByLine.get(line.id) ?? ["0"]);
    const outstandingScaled = clampedDifference(authorizedFoundScaled, dispatchedScaled);
    return {
      orderLineId: line.id,
      lineNumber: line.lineNumber,
      originalProductDescription: line.originalProductDescription,
      requestedQuantity: line.requestedQuantity.toString(),
      sapItemCodeSnapshot: line.sapItemCodeSnapshot,
      requestedUnitCode: line.requestedUnitCode,
      authorizedFoundQuantity: formatScaledDecimal(authorizedFoundScaled),
      dispatchedQuantity: formatScaledDecimal(dispatchedScaled),
      outstandingQuantity: formatScaledDecimal(outstandingScaled),
    };
  });

  return { orderId: order.id, lines };
}

export type DispatchRecordSummary = {
  id: string;
  status: string;
  vehicleOrCourierReference: string | null;
  plannedDepartureAt: string | null;
  departedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  lineCount: number;
  deliveryOutcome: string | null;
  /** Final Operational Enhancements (spec Part 3.3): the registered driver/assistant/vehicle recorded for this dispatch. Null only for a dispatch created before this feature existed. */
  driver: { id: string; name: string } | null;
  assistant: { id: string; name: string } | null;
  vehicle: { id: string; registrationNumber: string } | null;
};

/**
 * Every DispatchRecord for an order, newest first -- the /fulfilment
 * order detail page's own list of past and in-flight dispatches.
 */
export async function listDispatchRecordsForOrder(orderId: string): Promise<DispatchRecordSummary[]> {
  const records = await prisma.dispatchRecord.findMany({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      vehicleOrCourierReference: true,
      plannedDepartureAt: true,
      departedAt: true,
      cancelledAt: true,
      createdAt: true,
      _count: { select: { lines: true } },
      deliveryRecord: { select: { outcome: true } },
      driver: { select: { id: true, name: true } },
      assistant: { select: { id: true, name: true } },
      vehicle: { select: { id: true, registrationNumber: true } },
    },
  });

  return records.map((record) => ({
    id: record.id,
    status: record.status,
    vehicleOrCourierReference: record.vehicleOrCourierReference,
    plannedDepartureAt: record.plannedDepartureAt ? record.plannedDepartureAt.toISOString() : null,
    departedAt: record.departedAt ? record.departedAt.toISOString() : null,
    cancelledAt: record.cancelledAt ? record.cancelledAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    lineCount: record._count.lines,
    deliveryOutcome: record.deliveryRecord?.outcome ?? null,
    driver: record.driver,
    assistant: record.assistant,
    vehicle: record.vehicle,
  }));
}

export type DispatchRecordDetail = {
  id: string;
  orderId: string;
  status: string;
  vehicleOrCourierReference: string | null;
  plannedDepartureAt: string | null;
  notes: string | null;
  createdById: string;
  createdAt: string;
  departedById: string | null;
  departedAt: string | null;
  cancelledById: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  driver: { id: string; name: string } | null;
  assistant: { id: string; name: string } | null;
  vehicle: { id: string; registrationNumber: string } | null;
  lines: { id: string; orderLineId: string; lineNumber: number; originalProductDescription: string; dispatchedQuantity: string }[];
  delivery: {
    id: string;
    outcome: string;
    recordedById: string;
    recordedAt: string;
    recipientName: string | null;
    notes: string | null;
    proofPhotoStorageKey: string | null;
    proofSignatureStorageKey: string | null;
    lines: { dispatchLineId: string; acceptedQuantity: string; rejectedQuantity: string; rejectionReason: string | null }[];
  } | null;
};

export async function getDispatchRecordDetail(dispatchRecordId: string): Promise<DispatchRecordDetail | null> {
  const record = await prisma.dispatchRecord.findUnique({
    where: { id: dispatchRecordId },
    select: {
      id: true,
      orderId: true,
      status: true,
      vehicleOrCourierReference: true,
      plannedDepartureAt: true,
      notes: true,
      createdById: true,
      createdAt: true,
      departedById: true,
      departedAt: true,
      cancelledById: true,
      cancelledAt: true,
      cancellationReason: true,
      driver: { select: { id: true, name: true } },
      assistant: { select: { id: true, name: true } },
      vehicle: { select: { id: true, registrationNumber: true } },
      lines: {
        select: { id: true, orderLineId: true, dispatchedQuantity: true, orderLine: { select: { lineNumber: true, originalProductDescription: true } } },
      },
      deliveryRecord: {
        select: {
          id: true,
          outcome: true,
          recordedById: true,
          recordedAt: true,
          recipientName: true,
          notes: true,
          proofPhotoStorageKey: true,
          proofSignatureStorageKey: true,
          lines: { select: { dispatchLineId: true, acceptedQuantity: true, rejectedQuantity: true, rejectionReason: true } },
        },
      },
    },
  });
  if (!record) return null;

  return {
    id: record.id,
    orderId: record.orderId,
    status: record.status,
    vehicleOrCourierReference: record.vehicleOrCourierReference,
    plannedDepartureAt: record.plannedDepartureAt ? record.plannedDepartureAt.toISOString() : null,
    notes: record.notes,
    createdById: record.createdById,
    createdAt: record.createdAt.toISOString(),
    departedById: record.departedById,
    departedAt: record.departedAt ? record.departedAt.toISOString() : null,
    cancelledById: record.cancelledById,
    cancelledAt: record.cancelledAt ? record.cancelledAt.toISOString() : null,
    cancellationReason: record.cancellationReason,
    driver: record.driver,
    assistant: record.assistant,
    vehicle: record.vehicle,
    lines: record.lines
      .slice()
      .sort((a, b) => a.orderLine.lineNumber - b.orderLine.lineNumber)
      .map((line) => ({
        id: line.id,
        orderLineId: line.orderLineId,
        lineNumber: line.orderLine.lineNumber,
        originalProductDescription: line.orderLine.originalProductDescription,
        dispatchedQuantity: line.dispatchedQuantity.toString(),
      })),
    delivery: record.deliveryRecord
      ? {
          id: record.deliveryRecord.id,
          outcome: record.deliveryRecord.outcome,
          recordedById: record.deliveryRecord.recordedById,
          recordedAt: record.deliveryRecord.recordedAt.toISOString(),
          recipientName: record.deliveryRecord.recipientName,
          notes: record.deliveryRecord.notes,
          proofPhotoStorageKey: record.deliveryRecord.proofPhotoStorageKey,
          proofSignatureStorageKey: record.deliveryRecord.proofSignatureStorageKey,
          lines: record.deliveryRecord.lines.map((line) => ({
            dispatchLineId: line.dispatchLineId,
            acceptedQuantity: line.acceptedQuantity.toString(),
            rejectedQuantity: line.rejectedQuantity.toString(),
            rejectionReason: line.rejectionReason,
          })),
        }
      : null,
  };
}

export type DispatchQueueOrderSummary = {
  id: string;
  reference: string;
  customerPoReference: string | null;
  status: string;
  customer: { id: string; name: string } | null;
  requestedDeliveryDate: string | null;
  openDispatchCount: number;
  isDemo: boolean;
  createdAt: string;
  /** Final completion phase, section 7 -- non-CANCELLED DispatchRecord.status values, for getEffectiveOrderStatus. */
  dispatchStatuses: string[];
};

export type DispatchQueueResult = {
  orders: DispatchQueueOrderSummary[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

/**
 * The exact set of DispatchRecord conditions that mean "this order is
 * fully delivered and needs no further dispatch/delivery attention" --
 * shared between listDispatchQueue's exclusion below and
 * listDeliveredOrders' inclusion, so the two lists can never disagree
 * about where the line sits.
 */
const FULLY_DELIVERED_CONDITION: Prisma.CustomerOrderWhereInput = {
  status: "READY_TO_INVOICE",
  dispatchRecords: { some: { status: "DELIVERED" }, none: { status: { in: ["PLANNED", "DEPARTED"] } } },
};

/**
 * The /deliveries queue page's query -- builds out what was previously a
 * dead sidebar link ("Dispatch & Delivery"). Every order that is either
 * currently READY_TO_INVOICE (eligible to dispatch, whether or not
 * anything has been dispatched yet) or has a DispatchRecord still in
 * flight (PLANNED awaiting departure, or DEPARTED awaiting a delivery
 * outcome) -- i.e. every order that could still need dispatch/delivery
 * attention.
 *
 * Final completion phase, section 7 bug fix: this used to additionally
 * require `status !== "READY_TO_INVOICE"` to drop an order off the
 * queue once done, on the assumption that status eventually moves off
 * READY_TO_INVOICE once "handed to SAP" -- but CustomerOrder.status
 * never actually changes again after authorize-picking.ts sets it to
 * READY_TO_INVOICE (prisma/schema.prisma's own OrderStatus comment
 * documents why: it's the SAP-handover gate, not a tracked terminal
 * state), so that assumption was false and every ever-authorized order
 * stayed on this queue forever, even long after every one of its
 * dispatches was DELIVERED. The real "done" signal is DispatchRecord
 * state, not OrderStatus -- FULLY_DELIVERED_CONDITION above is
 * subtracted out here so a fully-delivered order finally leaves the
 * active queue (and appears in listDeliveredOrders/"/deliveries/history"
 * instead), the same "done, so it leaves the queue" convention
 * lib/picking/queries.ts's listPickingQueue already follows.
 *
 * openDispatchCount is read via a filtered relation `select` (not a
 * filtered `_count`), deliberately -- the plain filtered-select form has
 * been supported since Prisma's earliest relation queries, whereas a
 * `where` filter inside `_count.select` is a newer addition this
 * sandbox's network-blocked `prisma generate` cannot confirm is
 * available in whatever client version actually ends up installed.
 */
export async function listDispatchQueue(options: { page: number; pageSize: number; includeDemo?: boolean }): Promise<DispatchQueueResult> {
  const where: Prisma.CustomerOrderWhereInput = {
    AND: [
      { OR: [{ status: "READY_TO_INVOICE" }, { dispatchRecords: { some: { status: { in: ["PLANNED", "DEPARTED"] } } } }] },
      { NOT: FULLY_DELIVERED_CONDITION },
    ],
  };
  if (!options.includeDemo) {
    where.isDemo = false;
  }

  const [totalItems, rows] = await Promise.all([
    prisma.customerOrder.count({ where }),
    prisma.customerOrder.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      select: {
        id: true,
        reference: true,
        customerPoReference: true,
        status: true,
        requestedDeliveryDate: true,
        isDemo: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
        // Final completion phase, section 7: fetched WITHOUT a status
        // filter (unlike before this fix) so both openDispatchCount and
        // dispatchStatuses (for getEffectiveOrderStatus) can be derived
        // from the one relation load below -- Prisma does not support
        // selecting the same relation twice under two different filters
        // in a single query.
        dispatchRecords: { select: { status: true } },
      },
    }),
  ]);

  return {
    orders: rows.map((order) => {
      const nonCancelled = order.dispatchRecords.filter((d) => d.status !== "CANCELLED");
      return {
        id: order.id,
        reference: order.reference,
        customerPoReference: order.customerPoReference,
        status: order.status,
        customer: order.customer,
        requestedDeliveryDate: order.requestedDeliveryDate ? order.requestedDeliveryDate.toISOString() : null,
        openDispatchCount: order.dispatchRecords.filter((d) => d.status === "PLANNED" || d.status === "DEPARTED").length,
        isDemo: order.isDemo,
        createdAt: order.createdAt.toISOString(),
        dispatchStatuses: nonCancelled.map((d) => d.status),
      };
    }),
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / options.pageSize)),
    },
  };
}

export type DeliveredOrderSummary = {
  id: string;
  reference: string;
  customerPoReference: string | null;
  customer: { id: string; name: string } | null;
  requestedDeliveryDate: string | null;
  /** The most recent DeliveryRecord.recordedAt across this order's dispatches -- when it actually finished, not when the order was created. */
  lastDeliveredAt: string | null;
  isDemo: boolean;
};

export type DeliveredOrdersResult = {
  orders: DeliveredOrderSummary[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

/**
 * Final completion phase, section 7: the "Delivered History" surface the
 * directive names -- did not exist before this fix, because
 * listDispatchQueue's own (buggy) filter never excluded a fully-
 * delivered order in the first place, so there was never anywhere for
 * one to "graduate" to. FULLY_DELIVERED_CONDITION is the exact complement
 * of listDispatchQueue's own exclusion, so between the two lists every
 * order that has ever reached READY_TO_INVOICE appears in EXACTLY one of
 * them, never both and never neither.
 */
export async function listDeliveredOrders(options: { page: number; pageSize: number; includeDemo?: boolean }): Promise<DeliveredOrdersResult> {
  const where: Prisma.CustomerOrderWhereInput = { ...FULLY_DELIVERED_CONDITION };
  if (!options.includeDemo) {
    where.isDemo = false;
  }

  const [totalItems, rows] = await Promise.all([
    prisma.customerOrder.count({ where }),
    prisma.customerOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      select: {
        id: true,
        reference: true,
        customerPoReference: true,
        requestedDeliveryDate: true,
        isDemo: true,
        customer: { select: { id: true, name: true } },
        dispatchRecords: {
          where: { status: "DELIVERED" },
          select: { deliveryRecord: { select: { recordedAt: true } } },
        },
      },
    }),
  ]);

  return {
    orders: rows.map((order) => {
      const deliveredTimestamps = order.dispatchRecords
        .map((d) => d.deliveryRecord?.recordedAt)
        .filter((date): date is Date => date !== null && date !== undefined);
      const lastDeliveredAt = deliveredTimestamps.length > 0 ? new Date(Math.max(...deliveredTimestamps.map((d) => d.getTime()))) : null;

      return {
        id: order.id,
        reference: order.reference,
        customerPoReference: order.customerPoReference,
        customer: order.customer,
        requestedDeliveryDate: order.requestedDeliveryDate ? order.requestedDeliveryDate.toISOString() : null,
        lastDeliveredAt: lastDeliveredAt ? lastDeliveredAt.toISOString() : null,
        isDemo: order.isDemo,
      };
    }),
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / options.pageSize)),
    },
  };
}
