import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
 * Read-only helpers shared by the picking API routes (GET endpoints) and,
 * from Milestone 3B onward, the /fulfilment UI.
 */
export type PickingLineDetail = {
  id: string;
  orderLineId: string;
  lineNumber: number;
  originalProductDescription: string;
  requestedQuantity: string;
  foundQuantity: string | null;
  unavailableQuantity: string | null;
  notes: string | null;
  pickedById: string | null;
  pickedAt: string | null;
};

export type PickingSessionDetail = {
  id: string;
  orderId: string;
  status: "IN_PROGRESS" | "COMPLETED" | "AUTHORIZED";
  startedById: string;
  startedAt: string;
  completedById: string | null;
  completedAt: string | null;
  authorizedById: string | null;
  authorizedAt: string | null;
  notes: string | null;
  lines: PickingLineDetail[];
};

function toDetail(session: {
  id: string;
  orderId: string;
  status: string;
  startedById: string;
  startedAt: Date;
  completedById: string | null;
  completedAt: Date | null;
  authorizedById: string | null;
  authorizedAt: Date | null;
  notes: string | null;
  lines: {
    id: string;
    orderLineId: string;
    requestedQuantity: { toString(): string };
    foundQuantity: { toString(): string } | null;
    unavailableQuantity: { toString(): string } | null;
    notes: string | null;
    pickedById: string | null;
    pickedAt: Date | null;
    orderLine: { lineNumber: number; originalProductDescription: string };
  }[];
}): PickingSessionDetail {
  return {
    id: session.id,
    orderId: session.orderId,
    status: session.status as PickingSessionDetail["status"],
    startedById: session.startedById,
    startedAt: session.startedAt.toISOString(),
    completedById: session.completedById,
    completedAt: session.completedAt ? session.completedAt.toISOString() : null,
    authorizedById: session.authorizedById,
    authorizedAt: session.authorizedAt ? session.authorizedAt.toISOString() : null,
    notes: session.notes,
    lines: session.lines
      .slice()
      .sort((a, b) => a.orderLine.lineNumber - b.orderLine.lineNumber)
      .map((line) => ({
        id: line.id,
        orderLineId: line.orderLineId,
        lineNumber: line.orderLine.lineNumber,
        originalProductDescription: line.orderLine.originalProductDescription,
        requestedQuantity: line.requestedQuantity.toString(),
        foundQuantity: line.foundQuantity ? line.foundQuantity.toString() : null,
        unavailableQuantity: line.unavailableQuantity ? line.unavailableQuantity.toString() : null,
        notes: line.notes,
        pickedById: line.pickedById,
        pickedAt: line.pickedAt ? line.pickedAt.toISOString() : null,
      })),
  };
}

const SESSION_SELECT = {
  id: true,
  orderId: true,
  status: true,
  startedById: true,
  startedAt: true,
  completedById: true,
  completedAt: true,
  authorizedById: true,
  authorizedAt: true,
  notes: true,
  lines: {
    select: {
      id: true,
      orderLineId: true,
      requestedQuantity: true,
      foundQuantity: true,
      unavailableQuantity: true,
      notes: true,
      pickedById: true,
      pickedAt: true,
      orderLine: { select: { lineNumber: true, originalProductDescription: true } },
    },
  },
} as const;

/** Most recent picking session for an order (any status), or null if picking has never been started for it. */
export async function getLatestPickingSessionForOrder(orderId: string): Promise<PickingSessionDetail | null> {
  const session = await prisma.pickingSession.findFirst({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    select: SESSION_SELECT,
  });
  return session ? toDetail(session) : null;
}

export async function getPickingSessionDetail(sessionId: string): Promise<PickingSessionDetail | null> {
  const session = await prisma.pickingSession.findUnique({
    where: { id: sessionId },
    select: SESSION_SELECT,
  });
  return session ? toDetail(session) : null;
}
