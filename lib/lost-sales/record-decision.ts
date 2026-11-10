import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { parseScaledDecimal } from "@/lib/picking/validation";
import {
  computeUndecidedQuantity,
  decisionTypeToBucket,
  deriveUnfulfilledDemandStatus,
  formatScaledDecimal,
  validateDecisionQuantity,
  WHOLE_REMAINDER_DECISION_TYPES,
  type CustomerDecisionTypeValue,
  type DecisionSourceValue,
} from "@/lib/lost-sales/validation";
import { resolveSubstituteFields } from "@/lib/lost-sales/resolve-fields";

/**
 * Milestone 4 (Lost-Sales Management).
 *
 * Records one CustomerDecisionEvent against an UnfulfilledDemand and
 * updates that record's quantity buckets + derived status in the same
 * transaction -- append-only on the event side (never edits/overwrites a
 * prior event), additive-only on the bucket side (always adds to
 * whichever bucket this decisionType maps to, after validating the
 * quantity against whatever is still undecided RIGHT NOW, never against
 * a stale client-supplied figure).
 *
 * No dedicated role -- any authenticated user can record a customer
 * decision, the same "no dedicated role, enforced at the route only
 * where a gate actually exists" convention as picking (see
 * lib/picking/start-picking.ts's own comment). Only lost-sale
 * CONFIRMATION (lib/lost-sales/confirm-lost-sale.ts) is role-restricted.
 */
export type RecordDecisionInput = {
  unfulfilledDemandId: string;
  decisionType: CustomerDecisionTypeValue;
  source: DecisionSourceValue;
  quantity?: string;
  substituteProductId?: string;
  customerContactName?: string;
  reason?: string;
  remarks?: string;
  attachmentReference?: string;
  expectedFollowUpDate?: string;
  decidedAt?: string;
};

export type RecordDecisionResult =
  | {
      ok: true;
      event: { id: string; decisionType: CustomerDecisionTypeValue; quantity: string };
      demand: { id: string; status: string };
    }
  | { ok: false; status: number; message: string };

export async function recordCustomerDecision(
  input: RecordDecisionInput,
  actorId: string
): Promise<RecordDecisionResult> {
  const demand = await prisma.unfulfilledDemand.findUnique({
    where: { id: input.unfulfilledDemandId },
    select: {
      id: true,
      unavailableQuantity: true,
      outstandingQuantity: true,
      cancelledQuantity: true,
      substitutedQuantity: true,
      confirmedLostQuantity: true,
    },
  });
  if (!demand) {
    return { ok: false, status: 404, message: "Unfulfilled demand record not found." };
  }

  const unavailableText = demand.unavailableQuantity.toString();
  const outstandingText = demand.outstandingQuantity.toString();
  const cancelledText = demand.cancelledQuantity.toString();
  const substitutedText = demand.substitutedQuantity.toString();

  const undecided = computeUndecidedQuantity(unavailableText, outstandingText, cancelledText, substitutedText);
  if (undecided === null) {
    return {
      ok: false,
      status: 500,
      message: "Could not determine the undecided remaining quantity on this record.",
    };
  }

  let quantity: string;
  if (WHOLE_REMAINDER_DECISION_TYPES.has(input.decisionType)) {
    const undecidedScaled = parseScaledDecimal(undecided);
    if (undecidedScaled === null || undecidedScaled <= BigInt(0)) {
      return {
        ok: false,
        status: 400,
        message: "There is no undecided quantity left on this record for this decision.",
      };
    }
    quantity = undecided;
  } else {
    if (!input.quantity) {
      return { ok: false, status: 400, message: "A quantity is required for this decision type." };
    }
    const check = validateDecisionQuantity(input.quantity, undecided);
    if (!check.ok) {
      return { ok: false, status: 400, message: check.message };
    }
    quantity = input.quantity;
  }

  let substituteSapItemCodeSnapshot: string | null = null;
  let substituteProductDescriptionSnapshot: string | null = null;
  if (input.decisionType === "SUBSTITUTE_ACCEPTED") {
    if (!input.substituteProductId) {
      return {
        ok: false,
        status: 400,
        message: "A substitute product is required for a SUBSTITUTE_ACCEPTED decision.",
      };
    }
    const substitute = await prisma.product.findUnique({
      where: { id: input.substituteProductId },
      select: { sapItemCode: true, itemName: true },
    });
    if (!substitute) {
      return { ok: false, status: 400, message: "Substitute product not found." };
    }
    const resolved = resolveSubstituteFields({
      substituteSapItemCode: substitute.sapItemCode,
      substituteItemName: substitute.itemName,
    });
    substituteSapItemCodeSnapshot = resolved.substituteSapItemCodeSnapshot;
    substituteProductDescriptionSnapshot = resolved.substituteProductDescriptionSnapshot;
  } else if (input.substituteProductId) {
    return {
      ok: false,
      status: 400,
      message: "A substitute product can only be set for a SUBSTITUTE_ACCEPTED decision.",
    };
  }

  const quantityScaled = parseScaledDecimal(quantity);
  if (quantityScaled === null) {
    return { ok: false, status: 400, message: "Quantity could not be parsed." };
  }

  const bucket = decisionTypeToBucket(input.decisionType);
  let newOutstanding = outstandingText;
  let newCancelled = cancelledText;
  let newSubstituted = substitutedText;

  if (bucket === "outstanding") {
    newOutstanding = formatScaledDecimal(parseScaledDecimal(outstandingText)! + quantityScaled);
  } else if (bucket === "cancelled") {
    newCancelled = formatScaledDecimal(parseScaledDecimal(cancelledText)! + quantityScaled);
  } else {
    newSubstituted = formatScaledDecimal(parseScaledDecimal(substitutedText)! + quantityScaled);
  }

  const newStatus = deriveUnfulfilledDemandStatus({
    unavailableQuantity: unavailableText,
    outstandingQuantity: newOutstanding,
    cancelledQuantity: newCancelled,
    substitutedQuantity: newSubstituted,
    confirmedLostQuantity: demand.confirmedLostQuantity.toString(),
  });

  let decidedAtDate = new Date();
  if (input.decidedAt) {
    const parsed = new Date(input.decidedAt);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, status: 400, message: "decidedAt is not a valid date." };
    }
    decidedAtDate = parsed;
  }

  let expectedFollowUpDate: Date | undefined;
  if (input.expectedFollowUpDate) {
    const parsed = new Date(input.expectedFollowUpDate);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, status: 400, message: "expectedFollowUpDate is not a valid date." };
    }
    expectedFollowUpDate = parsed;
  }

  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.customerDecisionEvent.create({
      data: {
        unfulfilledDemandId: demand.id,
        decisionType: input.decisionType,
        source: input.source,
        quantity,
        substituteProductId: input.substituteProductId ?? null,
        substituteSapItemCodeSnapshot,
        substituteProductDescriptionSnapshot,
        customerContactName: input.customerContactName ?? null,
        reason: input.reason ?? null,
        remarks: input.remarks ?? null,
        attachmentReference: input.attachmentReference ?? null,
        decidedAt: decidedAtDate,
        recordedById: actorId,
      },
      select: { id: true },
    });

    const updatedDemand = await tx.unfulfilledDemand.update({
      where: { id: demand.id },
      data: {
        outstandingQuantity: newOutstanding,
        cancelledQuantity: newCancelled,
        substitutedQuantity: newSubstituted,
        status: newStatus,
        ...(expectedFollowUpDate !== undefined ? { expectedFollowUpDate } : {}),
      },
      select: { id: true, status: true },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "CUSTOMER_DECISION_RECORDED",
        entityType: "UnfulfilledDemand",
        entityId: demand.id,
        beforeData: {
          outstandingQuantity: outstandingText,
          cancelledQuantity: cancelledText,
          substitutedQuantity: substitutedText,
        },
        afterData: {
          decisionType: input.decisionType,
          quantity,
          outstandingQuantity: newOutstanding,
          cancelledQuantity: newCancelled,
          substitutedQuantity: newSubstituted,
          status: newStatus,
        },
      },
    });

    return { eventId: event.id, demandId: updatedDemand.id, status: updatedDemand.status as string };
  }, TRANSACTION_OPTIONS);

  return {
    ok: true,
    event: { id: result.eventId, decisionType: input.decisionType, quantity },
    demand: { id: result.demandId, status: result.status },
  };
}
