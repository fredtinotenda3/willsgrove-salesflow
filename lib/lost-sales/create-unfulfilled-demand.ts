import "server-only";
import { Prisma } from "@prisma/client";
import type { PrismaTransactionClient } from "@/lib/prisma";
import { resolveOriginalDemandFields } from "@/lib/lost-sales/resolve-fields";
import { resolveEstimatedLostSaleValue } from "@/lib/lost-sales/estimate-value";

/**
 * Milestone 4 (Lost-Sales Management), rewritten for the Real Business
 * Data Onboarding round's removal of the Customer Decision workflow
 * (spec PART A, section 4): "Requested = Found + Unavailable. There is no
 * customer approval step. The system should automatically: Cancel the
 * unavailable quantity... Record it as a lost sale."
 *
 * Called from INSIDE lib/picking/authorize-picking.ts's existing
 * transaction (never opens its own) the instant a COMPLETED PickingSession
 * is marked AUTHORIZED -- the single, additive integration point this
 * whole module hangs off of. Creates one UnfulfilledDemand per
 * PickingLine whose unavailableQuantity > 0; a fully-available line
 * creates none at all (spec test scenario 1).
 *
 * Three behaviours, all in the SAME transaction as the shortage itself:
 *
 *   1. Automatic estimate (spec: "record the relevant date and applicable
 *      selling price... calculate the estimated lost-sales value"), via
 *      resolveEstimatedLostSaleValue() -- OrderLine.approvedUnitPrice
 *      first, then the customer's PriceList, never a guessed/zero price.
 *
 *   2. Automatic cancellation AND confirmation, in the SAME write, with
 *      NO intervening decision step: cancelledQuantity and
 *      confirmedLostQuantity are both set equal to the full
 *      unavailableQuantity, outstandingQuantity/substitutedQuantity stay
 *      0, status is CONFIRMED_LOST, and a LostSaleRecord is created
 *      alongside the UnfulfilledDemand itself, reusing the SAME `estimate`
 *      already resolved above for its own estimatedUnitPrice/
 *      estimatedValue/estimatedValueSource -- so the two figures can never
 *      diverge, because they are quite literally the same resolved value
 *      written twice in one transaction. reason is picked mechanically,
 *      never guessed at a business-judgement level: INSUFFICIENT_QUANTITY
 *      when something was found but not enough, PRODUCT_UNAVAILABLE when
 *      nothing was found at all. decisionSource is always
 *      AUTOMATIC_SYSTEM_RECORDED (lib/lost-sales/validation.ts) and
 *      confirmedById is the same actorId that authorized the picking
 *      session -- there is no separate human "confirm" action to attribute
 *      this to.
 *
 *   3. Supersession (spec: "automatic lost sales must update, not
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
 *      example). The superseded row's quantity buckets and its own
 *      LostSaleRecord are never touched, deleted or recomputed -- only its
 *      `status` and `supersededByDemandId` change -- and the replacement
 *      row gets its OWN fresh LostSaleRecord for its own (corrected)
 *      quantity, so "update, not duplicate" holds exactly as it did under
 *      the prior design, just with the confirmation happening
 *      automatically instead of waiting on a human.
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

    // PART A, section 4: "There is no customer approval step. The system
    // should automatically: Cancel the unavailable quantity... Record it
    // as a lost sale." CONFIRMED_LOST is therefore the only status a newly
    // created demand can ever have -- cancelledQuantity and
    // confirmedLostQuantity are both set equal to the full
    // unavailableQuantity below, with no intervening bucket state.
    const status = "CONFIRMED_LOST" as const;

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
        // No decision step ever reduces these buckets below the full
        // shortage -- see the status comment above.
        cancelledQuantity: line.unavailableQuantity!,
        confirmedLostQuantity: line.unavailableQuantity!,
        estimatedUnitPrice: estimate?.unitPrice ?? null,
        estimatedValue: estimate?.value ?? null,
        estimatedValueSource: estimate?.source ?? null,
      },
      select: { id: true },
    });

    // Additional Implementation Requirements (lost-sales automation,
    // section 1) / PART A, section 4: the confirmed LostSaleRecord is
    // created in the SAME transaction, at the SAME moment, as the
    // UnfulfilledDemand itself -- never a separate human "confirm" step.
    // `reason` is picked mechanically, never a business judgement call:
    // INSUFFICIENT_QUANTITY when the line found something but not enough,
    // PRODUCT_UNAVAILABLE when nothing was found at all. The estimate
    // fields below are the exact same `estimate` object already resolved
    // for the UnfulfilledDemand above, so totalEstimatedLostValue and
    // totalConfirmedLostValue can never diverge for this row.
    const reason = foundQuantity.isZero() ? "PRODUCT_UNAVAILABLE" : "INSUFFICIENT_QUANTITY";
    await tx.lostSaleRecord.create({
      data: {
        unfulfilledDemandId: created.id,
        quantity: line.unavailableQuantity!,
        reason,
        reasonDetail: null,
        decisionSource: "AUTOMATIC_SYSTEM_RECORDED",
        estimatedUnitPrice: estimate?.unitPrice ?? null,
        estimatedValue: estimate?.value ?? null,
        estimatedValueSource: estimate?.source ?? null,
        remarks: null,
        confirmedById: actorId,
        confirmedAt,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "LOST_SALE_CONFIRMED",
        entityType: "UnfulfilledDemand",
        entityId: created.id,
        afterData: {
          quantity: unavailableQuantityText,
          reason,
          decisionSource: "AUTOMATIC_SYSTEM_RECORDED",
          estimatedUnitPrice: estimate?.unitPrice ?? null,
          estimatedValue: estimate?.value ?? null,
          estimatedValueSource: estimate?.source ?? null,
        },
      },
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
