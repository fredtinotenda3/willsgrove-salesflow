import "server-only";
import { prisma } from "@/lib/prisma";
import { getStorageDriver } from "@/lib/storage";
import { validateUploadContent } from "@/lib/storage/content-sniff";
import { sanitizeFileName } from "@/lib/http";

/**
 * Milestone 6A. Claim evidence attachments ("supporting attachments/
 * evidence" -- spec section 2 and 6).
 *
 * Reuses the existing generic lib/storage/ StorageDriver and
 * content-sniffing/upload-validation helpers unchanged (confirmed
 * reusable -- see PROGRESS.md's Milestone 6A section for why
 * app/api/files/[id]/route.ts itself is NOT generalized: it's tightly
 * coupled to OrderDocument, and the spec explicitly forbids unrelated
 * refactoring). InvoiceClaimAttachment is its own model with its own
 * storageKey column, following the same per-entity pattern
 * OrderDocument/OrderHandover already each use, rather than a shared
 * polymorphic attachments table.
 */

// Same ceiling as lib/po-intake.ts's MAX_PO_INTAKE_BYTES -- generous for a
// photo of damaged goods or a scanned delivery note, while still bounding
// per-request memory.
export const MAX_CLAIM_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export type UploadClaimAttachmentResult =
  | { ok: true; id: string }
  | { ok: false; status: number; message: string };

export async function uploadClaimAttachment(
  claimId: string,
  claimLineId: string | null,
  file: Buffer,
  originalFileName: string,
  claimedMimeType: string,
  uploadedById: string
): Promise<UploadClaimAttachmentResult> {
  const claim = await prisma.invoiceClaim.findUnique({ where: { id: claimId }, select: { id: true } });
  if (!claim) {
    return { ok: false, status: 404, message: "Claim not found." };
  }

  if (claimLineId) {
    const line = await prisma.invoiceClaimLine.findUnique({ where: { id: claimLineId }, select: { id: true, claimId: true } });
    if (!line || line.claimId !== claimId) {
      return { ok: false, status: 400, message: "This claim line does not belong to the specified claim." };
    }
  }

  if (file.length === 0) {
    return { ok: false, status: 400, message: "The uploaded file is empty." };
  }
  if (file.length > MAX_CLAIM_ATTACHMENT_BYTES) {
    return { ok: false, status: 413, message: "Attachment exceeds the 20 MB upload limit." };
  }

  const sniff = validateUploadContent(file, claimedMimeType);
  if (!sniff.ok) {
    return { ok: false, status: 415, message: sniff.message };
  }

  const storage = getStorageDriver();
  const stored = await storage.put(file);
  const safeFileName = sanitizeFileName(originalFileName);

  try {
    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.invoiceClaimAttachment.create({
        data: {
          claimId,
          claimLineId,
          originalFileName: safeFileName,
          storageKey: stored.storageKey,
          mimeType: sniff.resolvedMimeType,
          fileSize: BigInt(stored.fileSize),
          checksum: stored.checksum,
          uploadedById,
        },
        select: { id: true },
      });

      await tx.auditEvent.create({
        data: {
          actorId: uploadedById,
          action: "INVOICE_CLAIM_ATTACHMENT_UPLOADED",
          entityType: "InvoiceClaim",
          entityId: claimId,
          afterData: { attachmentId: created.id, claimLineId, originalFileName: safeFileName, fileSize: stored.fileSize },
        },
      });

      return created;
    });

    return { ok: true, id: attachment.id };
  } catch (error) {
    // The bytes are already on disk -- don't leave an orphaned,
    // unreferenced file in the storage root if the DB write failed (same
    // cleanup convention as app/api/orders/[id]/documents/route.ts).
    await storage.delete(stored.storageKey).catch(() => {});
    throw error;
  }
}

export type ClaimAttachmentForDownload = {
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  fileSize: bigint;
};

export async function getClaimAttachmentForDownload(attachmentId: string): Promise<ClaimAttachmentForDownload | null> {
  return prisma.invoiceClaimAttachment.findUnique({
    where: { id: attachmentId },
    select: { storageKey: true, originalFileName: true, mimeType: true, fileSize: true },
  });
}
