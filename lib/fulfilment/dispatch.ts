import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { parseScaledDecimal } from "@/lib/picking/validation";
import { getOrderFulfilmentStatus } from "@/lib/fulfilment/queries";
import type { ChangeDispatchAssignmentInput, CreateDispatchInput } from "@/lib/fulfilment/validation";

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

  // Final Operational Enhancements (spec Part 3.3): "every confirmed
  // dispatch must record Driver, Driver's Assistant, and Truck
  // Registration, selected from registered Settings records (not
  // free-typed)." Re-validated here server-side (never trusting the
  // client's dropdown selection alone) -- each id must reference an
  // ACTIVE record of the correct kind/role. A record that was deactivated
  // after being selected in the UI is rejected here, same as any other
  // stale-selection race.
  const [driver, assistant, vehicle] = await Promise.all([
    prisma.personnel.findUnique({ where: { id: input.driverId }, select: { id: true, name: true, role: true, status: true } }),
    prisma.personnel.findUnique({ where: { id: input.assistantId }, select: { id: true, name: true, role: true, status: true } }),
    prisma.vehicle.findUnique({ where: { id: input.vehicleId }, select: { id: true, registrationNumber: true, status: true } }),
  ]);
  if (!driver || driver.status !== "ACTIVE" || driver.role !== "DRIVER") {
    return { ok: false, status: 400, message: "The selected driver is not a registered, active driver." };
  }
  if (!assistant || assistant.status !== "ACTIVE" || assistant.role !== "DRIVER_ASSISTANT") {
    return { ok: false, status: 400, message: "The selected driver's assistant is not a registered, active driver's assistant." };
  }
  if (!vehicle || vehicle.status !== "ACTIVE") {
    return { ok: false, status: 400, message: "The selected vehicle is not a registered, active vehicle." };
  }

  const driverName = driver.name;
  const assistantName = assistant.name;
  const vehicleRegistration = vehicle.registrationNumber;

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
        driverId: input.driverId,
        assistantId: input.assistantId,
        vehicleId: input.vehicleId,
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
        afterData: {
          orderId,
          lines: input.lines,
          driverId: input.driverId,
          assistantId: input.assistantId,
          vehicleId: input.vehicleId,
          // Names are snapshotted into the history event so the initial
          // assignment still reads correctly if a person/vehicle record is
          // later renamed or deactivated.
          driverName: driverName,
          assistantName: assistantName,
          vehicleRegistration: vehicleRegistration,
        },
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

export type ChangeDispatchAssignmentResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * Changes the driver, assistant and/or vehicle on a dispatch that has not
 * finished yet, and records the change -- who, when, why, and the before and
 * after values -- as an AuditEvent that the order's Fulfilment History
 * (lib/fulfilment/assignment-history.ts) reads back. Nothing is invented: the
 * history only ever contains events that were actually written here or at
 * dispatch creation.
 *
 * Allowed while the dispatch is PLANNED or DEPARTED (a truck can break down
 * mid-route); once DELIVERED or CANCELLED the assignment is a closed historical
 * fact and cannot be rewritten. The same registered-and-active rules as
 * createDispatchRecord apply, re-checked server-side. A request that would
 * leave every field unchanged is rejected rather than writing an empty event.
 * `orderId` is checked against the record so a dispatch cannot be changed
 * through another order's URL.
 */
export async function changeDispatchAssignment(
  orderId: string,
  dispatchRecordId: string,
  actorId: string,
  input: ChangeDispatchAssignmentInput
): Promise<ChangeDispatchAssignmentResult> {
  const record = await prisma.dispatchRecord.findUnique({
    where: { id: dispatchRecordId },
    select: {
      id: true,
      orderId: true,
      status: true,
      driverId: true,
      assistantId: true,
      vehicleId: true,
      driver: { select: { name: true } },
      assistant: { select: { name: true } },
      vehicle: { select: { registrationNumber: true } },
    },
  });
  if (!record || record.orderId !== orderId) {
    return { ok: false, status: 404, message: "Dispatch record not found." };
  }
  if (record.status !== "PLANNED" && record.status !== "DEPARTED") {
    return {
      ok: false,
      status: 409,
      message: `The assignment of a ${record.status === "DELIVERED" ? "delivered" : "cancelled"} dispatch is part of the historical record and cannot be changed.`,
    };
  }

  const nextDriverId = input.driverId ?? record.driverId;
  const nextAssistantId = input.assistantId ?? record.assistantId;
  const nextVehicleId = input.vehicleId ?? record.vehicleId;
  if (nextDriverId === record.driverId && nextAssistantId === record.assistantId && nextVehicleId === record.vehicleId) {
    return { ok: false, status: 400, message: "Nothing would change: the selected driver, assistant and vehicle are already assigned." };
  }

  const [driver, assistant, vehicle] = await Promise.all([
    nextDriverId ? prisma.personnel.findUnique({ where: { id: nextDriverId }, select: { id: true, name: true, role: true, status: true } }) : null,
    nextAssistantId ? prisma.personnel.findUnique({ where: { id: nextAssistantId }, select: { id: true, name: true, role: true, status: true } }) : null,
    nextVehicleId ? prisma.vehicle.findUnique({ where: { id: nextVehicleId }, select: { id: true, registrationNumber: true, status: true } }) : null,
  ]);
  // Only the fields actually being changed need to be registered AND active;
  // an unchanged field is left alone even if that person was deactivated since.
  if (input.driverId && input.driverId !== record.driverId && (!driver || driver.status !== "ACTIVE" || driver.role !== "DRIVER")) {
    return { ok: false, status: 400, message: "The selected driver is not a registered, active driver." };
  }
  if (input.assistantId && input.assistantId !== record.assistantId && (!assistant || assistant.status !== "ACTIVE" || assistant.role !== "DRIVER_ASSISTANT")) {
    return { ok: false, status: 400, message: "The selected driver's assistant is not a registered, active driver's assistant." };
  }
  if (input.vehicleId && input.vehicleId !== record.vehicleId && (!vehicle || vehicle.status !== "ACTIVE")) {
    return { ok: false, status: 400, message: "The selected vehicle is not a registered, active vehicle." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.dispatchRecord.update({
      where: { id: dispatchRecordId },
      data: { driverId: nextDriverId, assistantId: nextAssistantId, vehicleId: nextVehicleId },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "DISPATCH_ASSIGNMENT_CHANGED",
        entityType: "DispatchRecord",
        entityId: dispatchRecordId,
        beforeData: {
          driverId: record.driverId,
          assistantId: record.assistantId,
          vehicleId: record.vehicleId,
          driverName: record.driver?.name ?? null,
          assistantName: record.assistant?.name ?? null,
          vehicleRegistration: record.vehicle?.registrationNumber ?? null,
        },
        afterData: {
          driverId: nextDriverId,
          assistantId: nextAssistantId,
          vehicleId: nextVehicleId,
          driverName: driver?.name ?? null,
          assistantName: assistant?.name ?? null,
          vehicleRegistration: vehicle?.registrationNumber ?? null,
          reason: input.reason,
          dispatchStatusAtChange: record.status,
        },
      },
    });
  }, TRANSACTION_OPTIONS);

  return { ok: true };
}
