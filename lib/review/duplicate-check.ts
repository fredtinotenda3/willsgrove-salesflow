/**
 * Milestone 2B. Duplicate-order detection -- computed fresh on every
 * read (review-session build AND confirm), never stored, since what
 * counts as a duplicate can change between the two (another order can
 * be created in between). Two independent signals, either or both of
 * which can fire:
 *
 *  - SAME_DOCUMENT_CHECKSUM: the exact same file/pasted-text bytes
 *    (OrderDocument.checksum) were already uploaded before AND that
 *    earlier document already became an order -- catches "the same
 *    photo of the same handwritten list was uploaded twice."
 *  - SAME_CUSTOMER_PO_REFERENCE: this resolved customer already has a
 *    non-cancelled/non-rejected order carrying the same customerPoReference
 *    -- catches "this PO number was already processed," which is a
 *    strong signal even across completely different documents/channels.
 *
 * Never auto-blocks and never silently proceeds: the caller
 * (lib/review/confirm-review.ts) must see these and have the human
 * explicitly acknowledge them before an order is created.
 */
import "server-only";
import { prisma } from "@/lib/prisma";

export type DuplicateWarning =
  | { kind: "SAME_DOCUMENT_CHECKSUM"; existingOrderId: string; existingOrderReference: string; message: string }
  | { kind: "SAME_CUSTOMER_PO_REFERENCE"; existingOrderId: string; existingOrderReference: string; message: string };

export async function checkForDuplicates(params: {
  documentId: string;
  documentChecksum: string | null;
  customerId: string | null;
  customerPoReference: string | null;
}): Promise<DuplicateWarning[]> {
  const warnings: DuplicateWarning[] = [];

  if (params.documentChecksum) {
    const sameChecksumDoc = await prisma.orderDocument.findFirst({
      where: {
        checksum: params.documentChecksum,
        id: { not: params.documentId },
        orderId: { not: null },
      },
      select: { order: { select: { id: true, reference: true } } },
      orderBy: { createdAt: "desc" },
    });
    if (sameChecksumDoc?.order) {
      warnings.push({
        kind: "SAME_DOCUMENT_CHECKSUM",
        existingOrderId: sameChecksumDoc.order.id,
        existingOrderReference: sameChecksumDoc.order.reference,
        message: `This exact file or pasted text was already submitted and turned into order ${sameChecksumDoc.order.reference}.`,
      });
    }
  }

  const trimmedPoReference = params.customerPoReference?.trim() ?? "";
  if (params.customerId && trimmedPoReference !== "") {
    const sameReferenceOrder = await prisma.customerOrder.findFirst({
      where: {
        customerId: params.customerId,
        customerPoReference: trimmedPoReference,
        status: { notIn: ["REJECTED", "CANCELLED"] },
      },
      select: { id: true, reference: true },
      orderBy: { createdAt: "desc" },
    });
    if (sameReferenceOrder) {
      warnings.push({
        kind: "SAME_CUSTOMER_PO_REFERENCE",
        existingOrderId: sameReferenceOrder.id,
        existingOrderReference: sameReferenceOrder.reference,
        message: `Customer PO reference "${trimmedPoReference}" was already used on order ${sameReferenceOrder.reference}.`,
      });
    }
  }

  return warnings;
}
