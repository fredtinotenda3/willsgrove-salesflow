import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { parseScaledDecimal } from "@/lib/picking/validation";
import { getOrderFulfilmentStatus } from "@/lib/fulfilment/queries";
import type { CreateDispatchInput } from "@/lib/fulfilment/validation";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Dispatch (spec
 * point 4: "dispatch and delivery," "support partial fulfilment").
 *
 * Any authenticated user may create/depart/cancel a dispatch -- no
 * dedicated warehouse role exists in this system, the same "picking
 * itself has no dedicated role" precedent lib/picking/start-picking.ts's
 * own comment establishes (only its own *authorization* step is role-
 * restricted). Role enforcement, where it applies, lives at the API
 * route layer, same split as every other lib/-vs-route boundary here.
 */

export type CreateDispatchResult = { ok: true; dispatchRecordId: string } | { ok: false; status: number; message: string };

const ORDER_STATUS_ELIGIBLE_FOR_DISPATCH = "READY_TO_INVOICE";

export async function createDispatchRecord(orderId: string, actorId: string, input: CreateDispatchInput): Promise<CreateDispatchResult> {
  const order = await prisma.customerOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
  if (!order) {
    return { ok: false, status: 404, message: "Order not found." };
  }
  if (order.status !== ORDER_STATUS_ELIGIBLE_FOR_DISPATCH) {
    return { ok: false, status: 409, message: "An order must be ready to invoice (picking completed and authorized) before it can be dispatched." };
  }

  if (input.pickingSessionId) {
    const session = await prisma.pickingSession.findUnique({
      where: { id: input.pickingSessionId },
      select: { id: true, orderId: true, status: true },
    });
    if (!session || session.orderId !== orderId) {
      return { ok: false, status: 404, message: "Picking session not found for this order." };
    }
    if (session.status !== "AUTHORIZED") {
      return { ok: false, status: 409, message: "The referenced picking session has not been authorized." };
    }
  }

  const fulfilment = await getOrderFulfilmentStatus(orderId);
  if (!fulfilment) {
    return { ok: false, status: 404, message: "Order not found." };
  }
  const statusByLine = new Map(fulfilment.lines.map((line) => [line.orderLineId, line]));

  const seenLineIds = new Set<string>();
  for (const requestedLine of input.lines) {
    if (seenLineIds.has(requestedLine.orderLineId)) {
      return { ok: false, status: 400, message: "Each order line can appear only once in a single dispatch." };
    }
    seenLineIds.add(requestedLine.orderLineId);

    const status = statusByLine.get(requestedLine.orderLineId);
    if (!status) {
      return { ok: false, status: 400, message: `Order line ${requestedLine.orderLineId} does not belong to this order.` };
    }

    const requestedScaled = parseScaledDecimal(requestedLine.quantity);
    const outstandingScaled = parseScaledDecimal(status.outstandingQuantity);
    if (requestedScaled === null || requestedScaled <= BigInt(0)) {
      return { ok: false, status: 400, message: `Line ${status.lineNumber}: dispatch quantity must be a positive number.` };
    }
    if (outstandingScaled === null || requestedScaled > outstandingScaled) {
      return {
        ok: false,
        status: 400,
        message: `Line ${status.lineNumber}: cannot dispatch ${requestedLine.quantity} -- only ${status.outstandingQuantity} is outstanding (authorized as found and not yet dispatched).`,
      };
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.dispatchRecord.create({
      data: {
        orderId,
        createdById: actorId,
        pickingSessionId: input.pickingSessionId ?? null,
        vehicleOrCourierReference: input.vehicleOrCourierReference ?? null,
        plannedDepartureAt: input.plannedDepartureAt ? new Date(input.plannedDepartureAt) : null,
        notes: input.notes ?? null,
        lines: {
          create: input.lines.map((line) => ({ orderLineId: line.orderLineId, dispatchedQuantity: line.quantity })),
        },
      },
      select: { id: true },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "DISPATCH_RECORD_CREATED",
        entityType: "DispatchRecord",
        entityId: record.id,
        afterData: { orderId, lines: input.lines },
      },
    });

    return record;
  }, TRANSACTION_OPTIONS);

  return { ok: true, dispatchRecordId: created.id };
}

export type DepartDispatchResult = { ok: true } | { ok: false; status: number; message: string };

export async function departDispatchRecord(dispatchRecordId: string, actorId: string, vehicleOrCourierReference?: string): Promise<DepartDispatchResult> {
  const record = await prisma.dispatchRecord.findUnique({ where: { id: dispatchRecordId }, select: { id: true, status: true } });
  if (!record) {
    return { ok: false, status: 404, message: "Dispatch record not found." };
  }
  if (record.status !== "PLANNED") {
    return { ok: false, status: 409, message: `Only a PLANNED dispatch can depart (current status: ${record.status}).` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.dispatchRecord.update({
      where: { id: dispatchRecordId },
      data: {
        status: "DEPARTED",
        departedById: actorId,
        departedAt: new Date(),
        ...(vehicleOrCourierReference ? { vehicleOrCourierReference } : {}),
      },
    });
    await tx.auditEvent.create({
      data: { actorId, action: "DISPATCH_RECORD_DEPARTED", entityType: "DispatchRecord", entityId: dispatchRecordId },
    });
  }, TRANSACTION_OPTIONS);

  return { ok: true };
}

export type CancelDispatchResult = { ok: true } | { ok: false; status: number; message: string };

export async function cancelDispatchRecord(dispatchRecordId: string, actorId: string, reason: string): Promise<CancelDispatchResult> {
  const record = await prisma.dispatchRecord.findUnique({ where: { id: dispatchRecordId }, select: { id: true, status: true } });
  if (!record) {
    return { ok: false, status: 404, message: "Dispatch record not found." };
  }
  if (record.status !== "PLANNED") {
    return {
      ok: false,
      status: 409,
      message: "Only a PLANNED dispatch (not yet departed) can be cancelled -- a dispatch that has already departed must be resolved by recording its delivery outcome instead.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.dispatchRecord.update({
      where: { id: dispatchRecordId },
      data: { status: "CANCELLED", cancelledById: actorId, cancelledAt: new Date(), cancellationReason: reason },
    });
    await tx.auditEvent.create({
      data: { actorId, action: "DISPATCH_RECORD_CANCELLED", entityType: "DispatchRecord", entityId: dispatchRecordId, afterData: { reason } },
    });
  }, TRANSACTION_OPTIONS);

  return { ok: true };
}
