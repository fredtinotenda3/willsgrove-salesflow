import "server-only";
import { Prisma } from "@prisma/client";
import { matchInvoiceLineToOrder, type MatchCandidateOrder } from "@/lib/invoice-reconciliation/matching";
import {
  computeOrderLineReconciliation,
  deriveInvoiceReconciliationStatus,
  type InvoiceLineStateForStatus,
} from "@/lib/invoice-reconciliation/reconcile";
import { parseScaledDecimal } from "@/lib/picking/validation";

/**
 * Milestone 5 (SAP Invoice Reconciliation). The database-touching half of
 * matching -- gathers real candidate order lines for one customer and
 * drives lib/invoice-reconciliation/matching.ts's pure decision function
 * over one invoice's lines, writing the result. Used both at
 * import-confirm time (lib/invoice-reconciliation/execute-import.ts) and
 * by the "re-run automatic matching" manual action
 * (lib/invoice-reconciliation/manual-actions.ts) -- same function either
 * way, so the two can never behave differently.
 */

const ELIGIBLE_ORDER_STATUSES = ["READY_TO_INVOICE"] as const;

async function gatherCandidateOrders(
  tx: Prisma.TransactionClient,
  customerId: string,
  orderReference: string | null
): Promise<MatchCandidateOrder[]> {
  const orders = await tx.customerOrder.findMany({
    // Prisma's generated filter expects a mutable OrderStatus[]; spread
    // into a fresh array rather than loosening ELIGIBLE_ORDER_STATUSES's
    // own `as const` (kept for its literal-narrowing elsewhere). This
    // mismatch was also the root cause of the `pickingSessions`/implicit-
    // `any` errors below: the `where` clause failing to typecheck made
    // the whole findMany call fall back to a less-specific overload, so
    // `orders`'s inferred element type lost its `select`-narrowed shape.
    where: { customerId, status: { in: [...ELIGIBLE_ORDER_STATUSES] } },
    select: {
      id: true,
      reference: true,
      customerPoReference: true,
      pickingSessions: {
        where: { status: "AUTHORIZED" },
        orderBy: { authorizedAt: "desc" },
        take: 1,
        select: {
          lines: {
            select: {
              foundQuantity: true,
              orderLine: {
                select: { id: true, sapItemCodeSnapshot: true, product: { select: { sapItemCode: true } } },
              },
            },
          },
        },
      },
    },
  });

  const allOrderLineIds = orders.flatMap((order) =>
    (order.pickingSessions[0]?.lines ?? []).map((line) => line.orderLine.id)
  );

  // One aggregate query for every candidate order line's already-matched,
  // non-cancelled invoiced quantity -- never per-line, to keep this from
  // becoming N+1 as a customer's order history grows.
  const invoicedSoFar =
    allOrderLineIds.length === 0
      ? []
      : await tx.sapInvoiceLine.groupBy({
          by: ["matchedOrderLineId"],
          where: {
            matchedOrderLineId: { in: allOrderLineIds },
            matchStatus: { in: ["AUTO_MATCHED", "MANUALLY_MATCHED"] },
            sapInvoice: { isCancelledOrReversed: false },
          },
          _sum: { quantityInvoiced: true },
        });
  const invoicedByOrderLineId = new Map(
    invoicedSoFar.map((row) => [row.matchedOrderLineId as string, (row._sum.quantityInvoiced ?? new Prisma.Decimal(0)).toString()])
  );

  return orders.map((order) => {
    const referenceMatches =
      orderReference !== null && (order.reference === orderReference || order.customerPoReference === orderReference);

    const lines = (order.pickingSessions[0]?.lines ?? [])
      .filter((line) => line.foundQuantity !== null && !line.foundQuantity.isZero())
      .map((line) => ({
        orderLineId: line.orderLine.id,
        orderId: order.id,
        sapItemCode: line.orderLine.product?.sapItemCode ?? line.orderLine.sapItemCodeSnapshot ?? null,
        authorizedQuantity: line.foundQuantity!.toString(),
        alreadyInvoicedQuantity: invoicedByOrderLineId.get(line.orderLine.id) ?? "0.0000",
      }));

    return { orderId: order.id, referenceMatches, lines };
  });
}

export interface AutoMatchInvoiceSummary {
  matchedCount: number;
  overInvoicingFlagged: number;
}

/**
 * Runs automatic matching over every currently-UNMATCHED line of one
 * invoice, writing a result for each line the pure matcher resolves
 * confidently. Lines it can't resolve are left UNMATCHED -- exactly the
 * manual-reconciliation-queue behavior spec section 4 requires -- not
 * retried with a looser rule.
 *
 * `actorId` is recorded as the matcher even for an automatic match (no
 * action in this codebase goes unattributed -- spec section 11), with
 * matchMethod: "AUTOMATIC" distinguishing it from a human's own choice.
 */
export async function runAutoMatchForInvoice(
  tx: Prisma.TransactionClient,
  sapInvoiceId: string,
  actorId: string
): Promise<AutoMatchInvoiceSummary> {
  const invoice = await tx.sapInvoice.findUniqueOrThrow({
    where: { id: sapInvoiceId },
    select: {
      matchedCustomerId: true,
      sapOrderReference: true,
      lines: { where: { matchStatus: "UNMATCHED" }, select: { id: true, sapItemCode: true, quantityInvoiced: true } },
    },
  });

  if (!invoice.matchedCustomerId || invoice.lines.length === 0) {
    return { matchedCount: 0, overInvoicingFlagged: 0 };
  }

  const candidateOrders = await gatherCandidateOrders(tx, invoice.matchedCustomerId, invoice.sapOrderReference);

  // Running tally of quantity this invoice itself has already committed
  // to each order line, so a second line in the SAME invoice sharing a
  // SAP item code with the first sees the first's consumption rather
  // than stale pre-invoice data.
  const runningDelta = new Map<string, bigint>();

  let matchedCount = 0;
  let overInvoicingFlagged = 0;
  const now = new Date();

  for (const line of invoice.lines) {
    const adjustedCandidates = candidateOrders.map((order) => ({
      ...order,
      lines: order.lines.map((candidateLine) => {
        const delta = runningDelta.get(candidateLine.orderLineId) ?? BigInt(0);
        if (delta === BigInt(0)) return candidateLine;
        const baseline = parseScaledDecimal(candidateLine.alreadyInvoicedQuantity) ?? BigInt(0);
        return { ...candidateLine, alreadyInvoicedQuantity: formatNonNegativeScaled(baseline + delta) };
      }),
    }));

    const result = matchInvoiceLineToOrder(line.sapItemCode, line.quantityInvoiced.toString(), adjustedCandidates);
    if (!result) continue;

    await tx.sapInvoiceLine.update({
      where: { id: line.id },
      data: {
        matchStatus: "AUTO_MATCHED",
        matchMethod: "AUTOMATIC",
        matchedOrderId: result.orderId,
        matchedOrderLineId: result.orderLineId,
        matchNote: result.note,
        matchedById: actorId,
        matchedAt: now,
      },
    });

    const lineQty = parseScaledDecimal(line.quantityInvoiced.toString()) ?? BigInt(0);
    runningDelta.set(result.orderLineId, (runningDelta.get(result.orderLineId) ?? BigInt(0)) + lineQty);

    matchedCount += 1;
    if (result.causesOverInvoicing) overInvoicingFlagged += 1;
  }

  return { matchedCount, overInvoicingFlagged };
}

function formatNonNegativeScaled(scaled: bigint): string {
  const digits = scaled.toString().padStart(5, "0");
  return `${digits.slice(0, -4)}.${digits.slice(-4)}`;
}

/** The order line's authorized quantity, read live from its order's most
 * recently AUTHORIZED PickingSession -- never a stored/cached number. */
async function getAuthorizedQuantity(tx: Prisma.TransactionClient, orderLineId: string): Promise<string | null> {
  const line = await tx.pickingLine.findFirst({
    where: { orderLineId, pickingSession: { status: "AUTHORIZED" } },
    orderBy: { pickingSession: { authorizedAt: "desc" } },
    select: { foundQuantity: true },
  });
  return line?.foundQuantity ? line.foundQuantity.toString() : null;
}

/** The order line's current invoiced quantity, read live as a SUM across
 * every matched, non-cancelled SapInvoiceLine -- never a stored/cached
 * number (same "derive, don't store a second truth" choice throughout
 * this milestone). */
async function getInvoicedQuantity(tx: Prisma.TransactionClient, orderLineId: string): Promise<string> {
  const sum = await tx.sapInvoiceLine.aggregate({
    where: {
      matchedOrderLineId: orderLineId,
      matchStatus: { in: ["AUTO_MATCHED", "MANUALLY_MATCHED"] },
      sapInvoice: { isCancelledOrReversed: false },
    },
    _sum: { quantityInvoiced: true },
  });
  return (sum._sum.quantityInvoiced ?? new Prisma.Decimal(0)).toString();
}

/**
 * Recomputes and persists one invoice's header-level reconciliationStatus
 * and matchedOrderId convenience field from the current state of its own
 * lines plus each matched order line's live authorized-vs-invoiced
 * position. Must be called after ANY action that changes a line's match
 * state -- automatic matching at import time (runAutoMatchForInvoice,
 * above), a manual match, a manual "cannot link," or a cancellation flag
 * change (lib/invoice-reconciliation/manual-actions.ts) -- so the stored
 * status never goes stale relative to the lines it summarizes.
 */
export async function recomputeInvoiceHeaderStatus(tx: Prisma.TransactionClient, sapInvoiceId: string): Promise<void> {
  const invoice = await tx.sapInvoice.findUniqueOrThrow({
    where: { id: sapInvoiceId },
    select: {
      isCancelledOrReversed: true,
      lines: { select: { matchStatus: true, matchedOrderId: true, matchedOrderLineId: true } },
    },
  });

  const distinctOrderLineIds = Array.from(
    new Set(invoice.lines.map((line) => line.matchedOrderLineId).filter((id): id is string => id !== null))
  );

  const overInvoicedOrderLineIds = new Set<string>();
  for (const orderLineId of distinctOrderLineIds) {
    const authorized = await getAuthorizedQuantity(tx, orderLineId);
    if (authorized === null) continue; // no AUTHORIZED session found -- leave unflagged rather than guess
    const invoiced = await getInvoicedQuantity(tx, orderLineId);
    const result = computeOrderLineReconciliation(authorized, invoiced);
    if (result?.status === "OVER_INVOICED") overInvoicedOrderLineIds.add(orderLineId);
  }

  const lineStates: InvoiceLineStateForStatus[] = invoice.lines.map((line) => ({
    matchStatus: line.matchStatus,
    causesOverInvoicing: line.matchedOrderLineId ? overInvoicedOrderLineIds.has(line.matchedOrderLineId) : false,
  }));

  const reconciliationStatus = deriveInvoiceReconciliationStatus(lineStates, invoice.isCancelledOrReversed);

  // Header-level matchedOrderId convenience: only set when EVERY line
  // (including any CANNOT_LINK line, which has no matchedOrderId) agreed
  // on the exact same single order -- a partial or mixed result always
  // leaves this null, so a list view never implies more agreement than
  // actually exists. The line-level matches remain authoritative either way.
  const distinctOrderIds = Array.from(new Set(invoice.lines.map((line) => line.matchedOrderId).filter((id): id is string => id !== null)));
  const everyLineMatchedToAnOrder = invoice.lines.every((line) => line.matchedOrderId !== null);
  const matchedOrderId = everyLineMatchedToAnOrder && distinctOrderIds.length === 1 ? distinctOrderIds[0] : null;

  await tx.sapInvoice.update({ where: { id: sapInvoiceId }, data: { reconciliationStatus, matchedOrderId } });
}
