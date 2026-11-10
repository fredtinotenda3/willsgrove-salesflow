import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exceedsRequested } from "@/lib/picking/validation";

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
 *
 * Records (or re-records -- a line can be edited any number of times
 * while its session is IN_PROGRESS) one PickingLine's found/unavailable
 * split. Deliberately does NOT require found + unavailable to exactly
 * equal requestedQuantity here -- that full-accounting check is
 * complete-picking.ts's job, run once over every line, so a line can be
 * saved mid-entry (e.g. found recorded, unavailable not yet) without
 * blocking progress on the rest of the order. It DOES reject
 * found + unavailable exceeding requestedQuantity immediately, in either
 * direction, since overcounting is never legitimate -- picking more of a
 * product than was requested isn't "found," it's a different order.
 */
export type RecordPickedLineResult =
  | {
      ok: true;
      line: {
        id: string;
        orderLineId: string;
        requestedQuantity: string;
        foundQuantity: string;
        unavailableQuantity: string;
        notes: string | null;
      };
    }
  | { ok: false; status: number; message: string };

export async function recordPickedLine(
  sessionId: string,
  orderLineId: string,
  foundQuantity: string,
  unavailableQuantity: string,
  notes: string | undefined,
  actorId: string
): Promise<RecordPickedLineResult> {
  const session = await prisma.pickingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true },
  });
  if (!session) {
    return { ok: false, status: 404, message: "Picking session not found." };
  }
  if (session.status !== "IN_PROGRESS") {
    return {
      ok: false,
      status: 409,
      message: "This picking session is no longer in progress, so its lines can't be edited.",
    };
  }

  const line = await prisma.pickingLine.findUnique({
    where: { pickingSessionId_orderLineId: { pickingSessionId: sessionId, orderLineId } },
    select: { id: true, requestedQuantity: true },
  });
  if (!line) {
    return { ok: false, status: 404, message: "This order line is not part of this picking session." };
  }

  const requestedQuantityText = line.requestedQuantity.toString();
  if (exceedsRequested(foundQuantity, unavailableQuantity, requestedQuantityText)) {
    return {
      ok: false,
      status: 400,
      message: `Found (${foundQuantity}) plus unavailable (${unavailableQuantity}) cannot exceed the requested quantity (${requestedQuantityText}).`,
    };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.pickingLine.update({
      where: { id: line.id },
      data: {
        foundQuantity: new Prisma.Decimal(foundQuantity),
        unavailableQuantity: new Prisma.Decimal(unavailableQuantity),
        notes: notes ?? null,
        pickedById: actorId,
        pickedAt: new Date(),
      },
      select: {
        id: true,
        orderLineId: true,
        requestedQuantity: true,
        foundQuantity: true,
        unavailableQuantity: true,
        notes: true,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "PICKING_LINE_RECORDED",
        entityType: "PickingLine",
        entityId: result.id,
        afterData: { pickingSessionId: sessionId, orderLineId, foundQuantity, unavailableQuantity },
      },
    });

    return result;
  });

  return {
    ok: true,
    line: {
      id: updated.id,
      orderLineId: updated.orderLineId,
      requestedQuantity: updated.requestedQuantity.toString(),
      foundQuantity: updated.foundQuantity!.toString(),
      unavailableQuantity: updated.unavailableQuantity!.toString(),
      notes: updated.notes,
    },
  };
}
