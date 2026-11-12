import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { parseScaledDecimal } from "@/lib/picking/validation";
import type { RecordDeliveryInput } from "@/lib/fulfilment/validation";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Delivery outcome
 * recording (spec point 4: "shortages, substitutions, rejected quantities
 * and delivery exceptions"). One DeliveryRecord per DispatchRecord
 * (DeliveryRecord.dispatchRecordId is @unique) covering EVERY line of
 * that dispatch in a single call -- a dispatch either arrived cleanly or
 * had exceptions, recorded as one event, never a line-by-line drip of
 * separate delivery calls for the same truck.
 *
 * Never creates an InvoiceClaim itself -- see DeliveryRecord's own schema
 * comment for why a rejection here is surfaced to the UI as a link into
 * the EXISTING /invoice-claims/new flow (Milestone 6A) rather than this
 * function reaching into that model.
 */

export type RecordDeliveryResult =
  | { ok: true; deliveryRecordId: string; outcome: "ACCEPTED_IN_FULL" | "PARTIALLY_REJECTED" | "FULLY_REJECTED" }
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

  const created = await prisma.$transaction(async (tx) => {
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

    await tx.auditEvent.create({
      data: { actorId, action: "DELIVERY_RECORDED", entityType: "DeliveryRecord", entityId: delivery.id, afterData: { dispatchRecordId, outcome } },
    });

    return delivery;
  }, TRANSACTION_OPTIONS);

  return { ok: true, deliveryRecordId: created.id, outcome };
}
