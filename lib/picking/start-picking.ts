import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
 *
 * Starts a new PickingSession for an order: one PickingLine per OrderLine,
 * each with requestedQuantity snapshotted from the order line at this
 * instant (see PickingLine's schema comment for why it's a snapshot, not
 * a live read). Moves the order to OrderStatus.PICKING.
 *
 * Any authenticated user can start a session -- per the user's confirmed
 * design, picking itself has no dedicated role; only authorization
 * (lib/picking/authorize-picking.ts) is role-restricted, and that's
 * enforced at the API route, not here.
 */
export type StartPickingResult =
  | {
      ok: true;
      session: {
        id: string;
        status: "IN_PROGRESS";
        startedAt: string;
        lines: { id: string; orderLineId: string; requestedQuantity: string }[];
      };
    }
  | { ok: false; status: number; message: string };

const ORDER_STATUSES_THAT_CANNOT_BE_PICKED = new Set(["CANCELLED", "REJECTED"]);

export async function startPickingSession(orderId: string, actorId: string): Promise<StartPickingResult> {
  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      lines: { select: { id: true, requestedQuantity: true }, orderBy: { lineNumber: "asc" } },
    },
  });
  if (!order) {
    return { ok: false, status: 404, message: "Order not found." };
  }
  if (ORDER_STATUSES_THAT_CANNOT_BE_PICKED.has(order.status)) {
    return { ok: false, status: 409, message: "Cannot start picking for a cancelled or rejected order." };
  }
  if (order.lines.length === 0) {
    return { ok: false, status: 400, message: "This order has no lines to pick." };
  }

  // At most one session per order may be IN_PROGRESS or COMPLETED (but
  // not yet AUTHORIZED) at a time -- a brand-new session is only allowed
  // when there is no prior session, or the most recent one has already
  // been authorized (a deliberate re-pick/correction, which keeps the
  // earlier session's full history untouched -- see PickingSession's
  // schema comment).
  const latest = await prisma.pickingSession.findFirst({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  if (latest && latest.status !== "AUTHORIZED") {
    return {
      ok: false,
      status: 409,
      message:
        "A picking session is already in progress for this order. Complete and authorize it before starting a new one.",
    };
  }

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.pickingSession.create({
      data: {
        orderId,
        startedById: actorId,
        lines: {
          create: order.lines.map((line) => ({
            orderLineId: line.id,
            requestedQuantity: line.requestedQuantity,
          })),
        },
      },
      select: {
        id: true,
        startedAt: true,
        lines: { select: { id: true, orderLineId: true, requestedQuantity: true } },
      },
    });

    await tx.customerOrder.update({
      where: { id: orderId },
      data: { status: "PICKING" },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId,
        changedById: actorId,
        fromStatus: order.status,
        toStatus: "PICKING",
        notes: "Picking started.",
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "PICKING_SESSION_STARTED",
        entityType: "PickingSession",
        entityId: created.id,
        afterData: { orderId, lineCount: order.lines.length },
      },
    });

    return created;
  }, TRANSACTION_OPTIONS);

  return {
    ok: true,
    session: {
      id: session.id,
      status: "IN_PROGRESS",
      startedAt: session.startedAt.toISOString(),
      lines: session.lines.map((line) => ({
        id: line.id,
        orderLineId: line.orderLineId,
        requestedQuantity: line.requestedQuantity.toString(),
      })),
    },
  };
}
