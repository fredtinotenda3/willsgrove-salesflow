import "server-only";
import { Prisma } from "@prisma/client";
import { resolveOriginalDemandFields } from "@/lib/lost-sales/resolve-fields";
import { deriveUnfulfilledDemandStatus } from "@/lib/lost-sales/validation";

/**
 * Milestone 4 (Lost-Sales Management).
 *
 * Called from INSIDE lib/picking/authorize-picking.ts's existing
 * transaction (never opens its own) the instant a COMPLETED PickingSession
 * is marked AUTHORIZED -- the single, additive integration point this
 * whole module hangs off of. Creates one UnfulfilledDemand per
 * PickingLine whose unavailableQuantity > 0; a fully-available line
 * creates none at all (spec test scenario 1).
 *
 * Deliberately takes only `pickingSessionId` + the caller's `tx` and
 * re-reads everything it needs itself, rather than having
 * authorizePickingSession() thread extra fields through its own select --
 * this keeps that already-shipped, already-tested function's own change
 * to a single one-line call, which matters more here than avoiding one
 * extra read inside an already-open transaction.
 */
export type CreateUnfulfilledDemandsResult = { createdCount: number };

export async function createUnfulfilledDemandsForSession(
  tx: Prisma.TransactionClient,
  pickingSessionId: string,
  actorId: string
): Promise<CreateUnfulfilledDemandsResult> {
  const session = await tx.pickingSession.findUnique({
    where: { id: pickingSessionId },
    select: {
      id: true,
      orderId: true,
      order: { select: { customerId: true } },
      lines: {
        select: {
          id: true,
          orderLineId: true,
          requestedQuantity: true,
          foundQuantity: true,
          unavailableQuantity: true,
          orderLine: {
            select: {
              originalProductDescription: true,
              sapItemCodeSnapshot: true,
              productId: true,
              product: { select: { sapItemCode: true, itemName: true } },
            },
          },
        },
      },
    },
  });

  // Defensive only: authorizePickingSession() just updated this exact
  // session's status inside the same transaction, so this row existing
  // is guaranteed by the time this function runs.
  if (!session) {
    throw new Error(`createUnfulfilledDemandsForSession: picking session ${pickingSessionId} not found.`);
  }

  const unavailableLines = session.lines.filter(
    (line) => line.unavailableQuantity !== null && !line.unavailableQuantity.isZero()
  );

  let createdCount = 0;

  for (const line of unavailableLines) {
    // @@unique([pickingLineId]) is the structural guarantee against
    // duplicates. A duplicate call for the same session should be
    // unreachable -- the COMPLETED -> AUTHORIZED transition this function
    // is invoked from is one-way, guarded by authorizePickingSession()'s
    // own status check before this transaction ever opens -- but this
    // stays defensive rather than trusting that invariant blindly from
    // inside a different module.
    const existing = await tx.unfulfilledDemand.findUnique({
      where: { pickingLineId: line.id },
      select: { id: true },
    });
    if (existing) continue;

    const resolved = resolveOriginalDemandFields({
      originalProductDescription: line.orderLine.originalProductDescription,
      sapItemCodeSnapshot: line.orderLine.sapItemCodeSnapshot,
      productSapItemCode: line.orderLine.product?.sapItemCode ?? null,
      officialProductDescription: line.orderLine.product?.itemName ?? null,
    });

    const unavailableQuantityText = line.unavailableQuantity!.toString();

    // Always PENDING_DECISION at creation (every bucket starts at zero) --
    // still computed via the shared deriveUnfulfilledDemandStatus rather
    // than hardcoded, so there is exactly one definition of this mapping
    // in the codebase.
    const status = deriveUnfulfilledDemandStatus({
      unavailableQuantity: unavailableQuantityText,
      outstandingQuantity: "0.0000",
      cancelledQuantity: "0.0000",
      substitutedQuantity: "0.0000",
      confirmedLostQuantity: "0.0000",
    });

    // foundQuantity is never actually null here: complete-picking.ts
    // already requires found + unavailable === requested for EVERY line
    // before a session can reach COMPLETED (a precondition of reaching
    // AUTHORIZED, which is what triggers this function). The fallback is
    // defensive only.
    const foundQuantity = line.foundQuantity ?? new Prisma.Decimal(0);

    const created = await tx.unfulfilledDemand.create({
      data: {
        orderId: session.orderId,
        orderLineId: line.orderLineId,
        customerId: session.order.customerId,
        pickingSessionId: session.id,
        pickingLineId: line.id,
        productId: line.orderLine.productId,
        sapItemCodeSnapshot: resolved.sapItemCodeSnapshot,
        productDescriptionSnapshot: resolved.productDescriptionSnapshot,
        requestedQuantity: line.requestedQuantity,
        foundQuantity,
        unavailableQuantity: line.unavailableQuantity!,
        status,
      },
      select: { id: true },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "UNFULFILLED_DEMAND_CREATED",
        entityType: "UnfulfilledDemand",
        entityId: created.id,
        afterData: {
          orderId: session.orderId,
          pickingLineId: line.id,
          unavailableQuantity: unavailableQuantityText,
        },
      },
    });

    createdCount += 1;
  }

  return { createdCount };
}
