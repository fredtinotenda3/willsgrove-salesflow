import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
 *
 * Marks a COMPLETED PickingSession AUTHORIZED -- the second of the two
 * gates the spec's section 3 describes ("quantities have not been
 * authorized"), and the one that actually moves the order to
 * OrderStatus.READY_TO_INVOICE, which lib/handover/generate-handover.ts
 * (Milestone 3C) will require before it produces an SAP Invoice Handover.
 *
 * Role-restricted to SALES_MANAGER/ADMINISTRATOR per the user's confirmed
 * design -- enforced at the API route (app/api/orders/[id]/picking/
 * [sessionId]/authorize/route.ts) via requireUserOrResponse, not here;
 * this function itself is role-agnostic, the same split every other
 * lib/-vs-route boundary in this project already follows.
 */
export type AuthorizePickingResult =
  | { ok: true; session: { id: string; status: "AUTHORIZED"; authorizedAt: string } }
  | { ok: false; status: number; message: string };

export async function authorizePickingSession(sessionId: string, actorId: string): Promise<AuthorizePickingResult> {
  const session = await prisma.pickingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, orderId: true, order: { select: { status: true } } },
  });
  if (!session) {
    return { ok: false, status: 404, message: "Picking session not found." };
  }
  if (session.status !== "COMPLETED") {
    return { ok: false, status: 409, message: "Picking must be completed before it can be authorized." };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.pickingSession.update({
      where: { id: sessionId },
      data: { status: "AUTHORIZED", authorizedById: actorId, authorizedAt: new Date() },
      select: { id: true, authorizedAt: true },
    });

    await tx.customerOrder.update({
      where: { id: session.orderId },
      data: { status: "READY_TO_INVOICE" },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: session.orderId,
        changedById: actorId,
        fromStatus: session.order.status,
        toStatus: "READY_TO_INVOICE",
        notes: "Picking authorized; ready for invoice handover.",
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "PICKING_SESSION_AUTHORIZED",
        entityType: "PickingSession",
        entityId: sessionId,
        afterData: { orderId: session.orderId },
      },
    });

    return result;
  }, TRANSACTION_OPTIONS);

  return {
    ok: true,
    session: { id: updated.id, status: "AUTHORIZED", authorizedAt: updated.authorizedAt!.toISOString() },
  };
}
