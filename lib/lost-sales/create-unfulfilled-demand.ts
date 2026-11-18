import "server-only";
import { Prisma } from "@prisma/client";
import type { PrismaTransactionClient } from "@/lib/prisma";
import { resolveOriginalDemandFields } from "@/lib/lost-sales/resolve-fields";
import { deriveUnfulfilledDemandStatus } from "@/lib/lost-sales/validation";
import { resolveEstimatedLostSaleValue } from "@/lib/lost-sales/estimate-value";

/**
 * Milestone 4 (Lost-Sales Management), extended by the Additional
 * Implementation Requirements ("lost-sales automation," section 1).
 *
 * Called from INSIDE lib/picking/authorize-picking.ts's existing
 * transaction (never opens its own) the instant a COMPLETED PickingSession
 * is marked AUTHORIZED -- the single, additive integration point this
 * whole module hangs off of. Creates one UnfulfilledDemand per
 * PickingLine whose unavailableQuantity > 0; a fully-available line
 * creates none at all (spec test scenario 1).
 *
 * Two behaviours added on top of Milestone 4's original, unchanged
 * creation logic:
 *
 *   1. Automatic estimate (spec: "record the relevant date and applicable
 *      selling price... calculate the estimated lost-sales value"). Reuses
 *      the exact same resolveEstimatedLostSaleValue() the deliberate,
 *      manual lib/lost-sales/confirm-lost-sale.ts action already uses --
 *      so the two never drift into two different pricing rules -- but
 *      calls it unconditionally, right here, the moment the shortage
 *      itself is recorded, rather than waiting for that separate manual
 *      step (which the spec's section 2 removes from the user interface
 *      precisely because this estimate is no longer conditional on it).
 *
 *   2. Supersession (spec: "automatic lost sales must update, not
 *      duplicate... if picking records are corrected... update the
 *      corresponding lost-sales record consistently"). Picking a session
 *      a SECOND time for the same order (lib/picking/start-picking.ts
 *      explicitly allows this once the prior session is AUTHORIZED, as a
 *      deliberate re-pick/correction) produces a brand-new PickingLine
 *      per order line -- and therefore, under Milestone 4's original
 *      @@unique([pickingLineId]) design, would create a SECOND,
 *      independent UnfulfilledDemand for the same order line, which an
 *      aggregate that just sums every row would double-count. This
 *      function now looks up whatever UnfulfilledDemand is still "current"
 *      (status != SUPERSEDED) for the SAME orderLineId before creating a
 *      new one, and marks it SUPERSEDED -- linked to its replacement via
 *      supersededByDemandId, or linked to nothing if the correction found
 *      the line fully available (no replacement is created in that case:
 *      the spec's own "corrected to 100: reverse the estimate to zero"
 *      example). The superseded row's quantity buckets, decision history
 *      (CustomerDecisionEvent) and any lost-sale confirmations
 *      (LostSaleRecord) are never touched, deleted or recomputed -- only
 *      its `status` and `supersededByDemandId` change -- so nothing the
 *      spec calls out as needing preservation ("a customer decision must
 *      not silently erase the original unavailable quantity or its
 *      history") is lost. See this function's own in-line comment at the
 *      supersession check for the one deliberately-undecided edge case
 *      (a correction arriving after a decision/confirmation already
 *      exists on the superseded row) and this round's delivery report for
 *      the reasoning behind it.
 */
export type CreateUnfulfilledDemandsResult = { createdCount: number; supersededCount: number };

export async function createUnfulfilledDemandsForSession(
  tx: PrismaTransactionClient,
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

  let createdCount = 0;
  let supersededCount = 0;
  const confirmedAt = new Date();

  for (const line of session.lines) {
    const isUnavailable = line.unavailableQuantity !== null && !line.unavailableQuantity.isZero();

    // @@unique([pickingLineId]) is the structural guarantee against
    // duplicates FOR THIS EXACT PickingLine. A duplicate call for the
    // same session should be unreachable -- the COMPLETED -> AUTHORIZED
    // transition this function is invoked from is one-way, guarded by
    // authorizePickingSession()'s own status check before this
    // transaction ever opens -- but this stays defensive rather than
    // trusting that invariant blindly from inside a different module.
    const existingForThisLine = await tx.unfulfilledDemand.findUnique({
      where: { pickingLineId: line.id },
      select: { id: true },
    });
    if (existingForThisLine) continue;

    // Additional Implementation Requirements (lost-sales automation,
    // section 1): the "current" UnfulfilledDemand for this ORDER LINE
    // (not this picking line) from an EARLIER session, if this
    // authorization is a re-pick/correction -- see this file's own module
    // comment, point 2. `status != SUPERSEDED` is the live/active filter;
    // the @@unique([pickingLineId]) + one-authorization-per-session
    // invariant above means there is at most one such row.
    const priorActiveDemand = await tx.unfulfilledDemand.findFirst({
      where: { orderLineId: line.orderLineId, status: { not: "SUPERSEDED" } },
      select: { id: true },
    });

    if (!isUnavailable) {
      // The correction found this line fully available. Nothing to
      // create, but a PRIOR shortage on this same order line is now
      // resolved by the correction -- supersede it (spec's own worked
      // example: "corrected to 100: reverse the outstanding estimated
      // lost sales to zero"). supersededByDemandId stays null: there is
      // no replacement row for a line that is no longer short at all.
      if (priorActiveDemand) {
        await tx.unfulfilledDemand.update({
          where: { id: priorActiveDemand.id },
          data: { status: "SUPERSEDED" },
        });
        await tx.auditEvent.create({
          data: {
            actorId,
            action: "UNFULFILLED_DEMAND_SUPERSEDED",
            entityType: "UnfulfilledDemand",
            entityId: priorActiveDemand.id,
            afterData: {
              reason: "re-pick found the line fully available; shortage resolved to zero",
              newPickingSessionId: session.id,
              supersededByDemandId: null,
            },
          },
        });
        supersededCount += 1;
      }
      continue;
    }

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

    // Additional Implementation Requirements (lost-sales automation,
    // section 1): "Estimated Lost Sales = Unavailable Quantity x
    // Applicable Selling Price," resolved automatically, never invented
    // (resolveEstimatedLostSaleValue returns null, never a guessed/zero
    // price, when no historically valid price is available -- see that
    // function's own comment).
    const estimate = await resolveEstimatedLostSaleValue(tx, {
      orderLineId: line.orderLineId,
      customerId: session.order.customerId,
      productId: line.orderLine.productId,
      sapItemCodeSnapshot: resolved.sapItemCodeSnapshot,
      quantity: unavailableQuantityText,
      asOf: confirmedAt,
    });

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
        estimatedUnitPrice: estimate?.unitPrice ?? null,
        estimatedValue: estimate?.value ?? null,
        estimatedValueSource: estimate?.source ?? null,
      },
      select: { id: true },
    });

    // Link the correction to whatever it replaces, in the same
    // transaction the new row was just created in -- see point 2 of this
    // file's module comment.
    if (priorActiveDemand) {
      await tx.unfulfilledDemand.update({
        where: { id: priorActiveDemand.id },
        data: { status: "SUPERSEDED", supersededByDemandId: created.id },
      });
      await tx.auditEvent.create({
        data: {
          actorId,
          action: "UNFULFILLED_DEMAND_SUPERSEDED",
          entityType: "UnfulfilledDemand",
          entityId: priorActiveDemand.id,
          afterData: {
            reason: "re-pick corrected the unavailable quantity",
            newPickingSessionId: session.id,
            supersededByDemandId: created.id,
            newUnavailableQuantity: unavailableQuantityText,
          },
        },
      });
      supersededCount += 1;
    }

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
          estimatedUnitPrice: estimate?.unitPrice ?? null,
          estimatedValue: estimate?.value ?? null,
          estimatedValueSource: estimate?.source ?? null,
          ...(priorActiveDemand ? { supersedesDemandId: priorActiveDemand.id } : {}),
        },
      },
    });

    createdCount += 1;
  }

  return { createdCount, supersededCount };
}
