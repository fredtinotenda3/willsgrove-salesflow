import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Milestone 3A/3B (SAP Invoice Handover Specification -- warehouse
 * picking). Read-only helpers shared by the picking API routes (GET
 * endpoints) and the /fulfilment UI.
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

export type PickingQueueOrderSummary = {
  id: string;
  reference: string;
  customerPoReference: string | null;
  status: string;
  customer: { id: string; name: string } | null;
  requestedDeliveryDate: string | null;
  lineCount: number;
  isDemo: boolean;
  createdAt: string;
};

export type PickingQueueResult = {
  orders: PickingQueueOrderSummary[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

/**
 * Milestone 3B. The /fulfilment list page's query -- every "live" order
 * that could still need picking attention: not DRAFT (never confirmed),
 * not CANCELLED/REJECTED (dead), and not yet handed to SAP
 * (`handedToSapAt` is still null -- once a handover exists for an order,
 * picking is done and it drops off this queue, whatever OrderStatus it
 * happens to be sitting at). Deliberately NOT filtered to only
 * OrderStatus.PICKING -- an order that hasn't had picking started yet
 * (RECEIVED/PENDING_VERIFICATION/READY_FOR_APPROVAL/APPROVED) still
 * belongs on this queue so staff can see what's coming, and one that's
 * READY_TO_INVOICE still belongs here too (briefly) so staff can see a
 * pick just finished, right up until a handover is actually generated
 * for it in a future round (Milestone 3C).
 *
 * Ordered oldest-first (`createdAt asc`) rather than by delivery date --
 * simpler, and avoids Prisma's NULLS ordering edge cases for the many
 * orders with no `requestedDeliveryDate` set at all.
 */
export async function listPickingQueue(options: {
  page: number;
  pageSize: number;
  includeDemo?: boolean;
}): Promise<PickingQueueResult> {
  const where: Prisma.CustomerOrderWhereInput = {
    status: { notIn: ["DRAFT", "CANCELLED", "REJECTED"] },
    handedToSapAt: null,
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
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return {
    orders: rows.map((order) => ({
      id: order.id,
      reference: order.reference,
      customerPoReference: order.customerPoReference,
      status: order.status,
      customer: order.customer,
      requestedDeliveryDate: order.requestedDeliveryDate ? order.requestedDeliveryDate.toISOString() : null,
      lineCount: order._count.lines,
      isDemo: order.isDemo,
      createdAt: order.createdAt.toISOString(),
    })),
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / options.pageSize)),
    },
  };
}
