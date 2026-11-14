import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import { parseScaledDecimal } from "@/lib/picking/validation";
import { recomputeClaimStatusAfterActuals } from "@/lib/returns-credits/apply-status-recompute";
import { returnConditionRequiresDetail, type RecordClaimReturnInput } from "@/lib/returns-credits/validation";

/**
 * Milestone 6B (Returns & Credit Notes). Recording that a physical return
 * was actually received back from a customer. Confirmed design decision:
 * no dedicated role for this action -- any authenticated user may record
 * one, the same "no dedicated role" convention as every other
 * investigation/recording-weight action in this project (e.g. 6A's own
 * createInvoiceClaim and recordClaimResolution). Only credit-note
 * recording (lib/returns-credits/credit-notes.ts) is SALES_MANAGER/
 * ADMINISTRATOR-gated; this function is role-agnostic, checked (or rather,
 * NOT checked beyond plain authentication) at the route layer
 * (app/api/invoice-claims/[id]/returns/route.ts).
 */

export function generateReturnReference(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = randomBytes(4).toString("hex").toUpperCase();
  return `RET-${datePart}-${randomPart}`;
}

export type RecordClaimReturnResult =
  | { ok: true; id: string; returnReference: string }
  | { ok: false; status: number; message: string; fieldErrors?: Record<string, string> };

export async function recordClaimReturn(
  claimId: string,
  input: RecordClaimReturnInput,
  receivedById: string
): Promise<RecordClaimReturnResult> {
  if (returnConditionRequiresDetail(input.condition) && !input.conditionDetail?.trim()) {
    return { ok: false, status: 400, message: "A detail is required when condition is OTHER.", fieldErrors: { conditionDetail: "Required when condition is OTHER." } };
  }

  const receivedQtyScaled = parseScaledDecimal(input.receivedQuantity);
  if (receivedQtyScaled === null || receivedQtyScaled <= BigInt(0)) {
    return { ok: false, status: 400, message: "Received quantity must be greater than zero.", fieldErrors: { receivedQuantity: "Must be greater than zero." } };
  }

  const claim = await prisma.invoiceClaim.findUnique({ where: { id: claimId }, select: { id: true, status: true } });
  if (!claim) {
    return { ok: false, status: 404, message: "Claim not found." };
  }
  // A physical return only settles a claim once a resolution has
  // actually been approved -- same gate as recordCreditNoteManually(),
  // and for the same reason: there is nothing yet for it to settle on an
  // OPEN/UNDER_INVESTIGATION/etc. claim. This is a plain precondition
  // check, not a status transition of its own -- recordClaimReturn never
  // writes InvoiceClaim.status directly; only the auto-advance pass
  // below (through the validated transition graph) ever does.
  if (claim.status !== "APPROVED" && claim.status !== "PARTIALLY_RESOLVED") {
    return {
      ok: false,
      status: 400,
      message: `Cannot record a return while the claim is ${claim.status}; a resolution must be approved first.`,
    };
  }

  if (input.claimLineId) {
    const line = await prisma.invoiceClaimLine.findUnique({ where: { id: input.claimLineId }, select: { id: true, claimId: true } });
    if (!line || line.claimId !== claimId) {
      return { ok: false, status: 400, message: "That claim line does not belong to this claim.", fieldErrors: { claimLineId: "Invalid claim line." } };
    }
  }

  const returnReference = generateReturnReference();

  // RecordClaimReturnInput.receivedDate (lib/returns-credits/validation.ts)
  // is a required, already-regex-validated "YYYY-MM-DD" string, never
  // null/undefined -- so dateOnlyStringToUtcDate (whose `Date | null`
  // return type exists only to accommodate its OTHER, genuinely-optional
  // call sites elsewhere in the app) can never actually return null here.
  // This guard is defensive, not a real code path: it exists so a future
  // change that made receivedDate optional couldn't silently produce an
  // invalid ClaimReturn row, rather than a bare non-null assertion that
  // would hide that same future mistake.
  const receivedDate = dateOnlyStringToUtcDate(input.receivedDate);
  if (receivedDate === null) {
    return { ok: false, status: 400, message: "A valid received date is required.", fieldErrors: { receivedDate: "Required." } };
  }

  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.claimReturn.create({
      data: {
        claimId,
        claimLineId: input.claimLineId ?? null,
        returnReference,
        receivedQuantity: input.receivedQuantity,
        condition: input.condition,
        conditionDetail: input.conditionDetail ?? null,
        conditionNotes: input.conditionNotes ?? null,
        receivedDate,
        receivedById,
      },
      select: { id: true },
    });

    await tx.auditEvent.create({
      data: {
        actorId: receivedById,
        action: "CLAIM_RETURN_RECORDED",
        entityType: "InvoiceClaim",
        entityId: claimId,
        afterData: {
          returnId: record.id,
          returnReference,
          receivedQuantity: input.receivedQuantity,
          condition: input.condition,
          claimLineId: input.claimLineId ?? null,
        },
      },
    });

    await recomputeClaimStatusAfterActuals(tx, claimId, receivedById);

    return record;
  }, TRANSACTION_OPTIONS);

  return { ok: true, id: created.id, returnReference };
}
