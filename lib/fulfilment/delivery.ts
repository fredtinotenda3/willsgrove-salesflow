import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { parseScaledDecimal } from "@/lib/picking/validation";
import type { RecordDeliveryInput } from "@/lib/fulfilment/validation";
import { createClaimFromDelivery } from "@/lib/invoice-claims/create-delivery-claim";
import { mapRejectionReasonToCategory } from "@/lib/invoice-claims/delivery-claim-core";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Delivery outcome
 * recording (spec point 4: "shortages, substitutions, rejected quantities
 * and delivery exceptions"). One DeliveryRecord per DispatchRecord
 * (DeliveryRecord.dispatchRecordId is @unique) covering EVERY line of
 * that dispatch in a single call -- a dispatch either arrived cleanly or
 * had exceptions, recorded as one event, never a line-by-line drip of
 * separate delivery calls for the same truck.
 *
 * Standalone lost-sales correction: a rejection recorded here IS the
 * business's "claim" (goods refused at the customer and returned to
 * Willsgrove). So, in the SAME transaction as the delivery itself, every
 * delivery line with a rejected quantity is turned into a product-level claim
 * line (lib/invoice-claims/create-delivery-claim.ts). That is what feeds the
 * Invoice Claims register, the Confirmed Loss (Returned Goods) figure and the
 * lost-sales reports -- there is no separate manual step to forget.
 * Idempotent: DeliveryRecord is unique per dispatch, and the claim is unique
 * per delivery record / delivery line.
 */

export type RecordDeliveryResult =
  | {
      ok: true;
      deliveryRecordId: string;
      outcome: "ACCEPTED_IN_FULL" | "PARTIALLY_REJECTED" | "FULLY_REJECTED";
      /** Set when the rejected quantities were turned into a claim (null when nothing was rejected). */
      claim: { id: string; claimReference: string; lineCount: number } | null;
    }
  | { ok: false; status: number; message: string };

export async function recordDelivery(
  dispatchRecordId: string,
  actorId: string,
  input: RecordDeliveryInput,
  proof: { proofPhotoStorageKey?: string; proofSignatureStorageKey?: string }
): Promise<RecordDeliveryResult> {
  const dispatch = await prisma.dispatchRecord.findUnique({
    where: { id: dispatchRecordId },
    select: {
      id: true,
      status: true,
      deliveryRecord: { select: { id: true } },
      lines: { select: { id: true, dispatchedQuantity: true } },
    },
  });
  if (!dispatch) {
    return { ok: false, status: 404, message: "Dispatch record not found." };
  }
  if (dispatch.status !== "DEPARTED") {
    return { ok: false, status: 409, message: `A delivery outcome can only be recorded for a dispatch that has departed (current status: ${dispatch.status}).` };
  }
  if (dispatch.deliveryRecord) {
    return { ok: false, status: 409, message: "A delivery outcome has already been recorded for this dispatch." };
  }

  const dispatchLinesById = new Map(dispatch.lines.map((line) => [line.id, line]));
  const seenLineIds = new Set<string>();
  let anyAccepted = false;
  let anyRejected = false;

  for (const inputLine of input.lines) {
    if (seenLineIds.has(inputLine.dispatchLineId)) {
      return { ok: false, status: 400, message: "Each dispatch line can appear only once in a single delivery record." };
    }
    seenLineIds.add(inputLine.dispatchLineId);

    const dispatchLine = dispatchLinesById.get(inputLine.dispatchLineId);
    if (!dispatchLine) {
      return { ok: false, status: 400, message: `Dispatch line ${inputLine.dispatchLineId} does not belong to this dispatch.` };
    }

    const accepted = parseScaledDecimal(inputLine.acceptedQuantity);
    const rejected = parseScaledDecimal(inputLine.rejectedQuantity);
    const dispatched = parseScaledDecimal(dispatchLine.dispatchedQuantity.toString());
    if (accepted === null || rejected === null || dispatched === null) {
      return { ok: false, status: 400, message: "Accepted and rejected quantities must be valid non-negative decimals." };
    }
    if (accepted + rejected !== dispatched) {
      return {
        ok: false,
        status: 400,
        message: `Accepted (${inputLine.acceptedQuantity}) + rejected (${inputLine.rejectedQuantity}) must equal the dispatched quantity (${dispatchLine.dispatchedQuantity.toString()}) for dispatch line ${inputLine.dispatchLineId}.`,
      };
    }
    if (rejected > BigInt(0) && !inputLine.rejectionReason) {
      return { ok: false, status: 400, message: `A rejection reason is required for dispatch line ${inputLine.dispatchLineId} since it has a rejected quantity.` };
    }
    // A claim reason only means something on a rejected (= returned) quantity. Silently accepting a reason
    // beside a 0 rejected quantity is what made "Short Delivered" lines show as "Accepted in full" with no
    // claim, no lost sale and nothing on the Claims page -- so it is refused outright.
    if (rejected === BigInt(0) && inputLine.rejectionReason && inputLine.rejectionReason.trim() !== "") {
      return {
        ok: false,
        status: 400,
        message: `Dispatch line ${inputLine.dispatchLineId} has a claim reason but a rejected quantity of 0. Enter the rejected (returned) quantity, or clear the reason.`,
      };
    }
    // Rejected products are recorded ONLY with one of the standardised claim reasons.
    if (rejected > BigInt(0) && mapRejectionReasonToCategory(inputLine.rejectionReason) === null) {
      return {
        ok: false,
        status: 400,
        message: `Dispatch line ${inputLine.dispatchLineId}: choose one of the standardised claim reasons (Price Claim, Poor Quality Product, Short Delivered, OverSupply, Expire, No Barcode, Barcode Scanning Problems, Duplicates).`,
      };
    }
    if (accepted > BigInt(0)) anyAccepted = true;
    if (rejected > BigInt(0)) anyRejected = true;
  }

  if (seenLineIds.size !== dispatch.lines.length) {
    return { ok: false, status: 400, message: "A delivery outcome must be recorded for every line of this dispatch." };
  }

  const outcome: "ACCEPTED_IN_FULL" | "PARTIALLY_REJECTED" | "FULLY_REJECTED" = !anyRejected
    ? "ACCEPTED_IN_FULL"
    : anyAccepted
      ? "PARTIALLY_REJECTED"
      : "FULLY_REJECTED";

  let created: { id: string; claim: Awaited<ReturnType<typeof createClaimFromDelivery>> };
  try {
    created = await prisma.$transaction(async (tx) => {
    const delivery = await tx.deliveryRecord.create({
      data: {
        dispatchRecordId,
        outcome,
        recordedById: actorId,
        recipientName: input.recipientName ?? null,
        notes: input.notes ?? null,
        proofPhotoStorageKey: proof.proofPhotoStorageKey ?? null,
        proofSignatureStorageKey: proof.proofSignatureStorageKey ?? null,
        lines: {
          create: input.lines.map((line) => ({
            dispatchLineId: line.dispatchLineId,
            acceptedQuantity: line.acceptedQuantity,
            rejectedQuantity: line.rejectedQuantity,
            rejectionReason: line.rejectionReason ?? null,
          })),
        },
      },
      select: { id: true },
    });

    await tx.dispatchRecord.update({ where: { id: dispatchRecordId }, data: { status: "DELIVERED" } });

    const claimResult = await createClaimFromDelivery(tx, { deliveryRecordId: delivery.id, actorId });

    await tx.auditEvent.create({
      data: { actorId, action: "DELIVERY_RECORDED", entityType: "DeliveryRecord", entityId: delivery.id, afterData: { dispatchRecordId, outcome } },
    });

    return { id: delivery.id, claim: claimResult };
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    // Two simultaneous submissions for the same dispatch: DeliveryRecord is unique per
    // dispatch, so the loser rolls back completely (no half-created claim) and is told so.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, status: 409, message: "A delivery outcome has already been recorded for this dispatch." };
    }
    throw error;
  }

  return {
    ok: true,
    deliveryRecordId: created.id,
    outcome,
    claim: created.claim.created ? { id: created.claim.claimId, claimReference: created.claim.claimReference, lineCount: created.claim.lineCount } : null,
  };
}
