import { NextRequest, NextResponse } from "next/server";
import { DocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getStorageDriver } from "@/lib/storage";
import { validateUploadContent } from "@/lib/storage/content-sniff";

type RouteContext = { params: Promise<{ id: string }> };

// 20 MB: generous for a scanned PO or invoice PDF/JPEG while still bounding
// memory use -- the whole file is held in memory for hashing and sniffing,
// which is fine at this volume but would need streaming if this limit
// grows substantially.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const VALID_DOCUMENT_TYPES = new Set<string>(Object.values(DocumentType));

function sanitizeFileName(name: string): string {
  // Only used for display/download purposes -- it is never used to build a
  // filesystem path (see lib/storage/local-disk-driver.ts for why).
  const base = name.split(/[/\\]/).pop() ?? "upload";
  return base.slice(0, 200).replace(/[\x00-\x1f]/g, "") || "upload";
}

/**
 * POST /api/orders/[id]/documents
 *
 * Uploads a supporting document (typically the customer's original PO)
 * and attaches it to an order. The upload is written to the storage layer
 * (never trusting the client's claimed MIME type -- see
 * lib/storage/content-sniff.ts), checksummed, and recorded with an audit
 * event, all before the file is downloadable via GET /api/files/[id].
 *
 * Note (open scope item): any authenticated user can currently upload to
 * and download any order's documents -- there is no per-order visibility
 * restriction (e.g. "only the order's own salesperson or a manager") at
 * this milestone, since the brief didn't specify one. Flag this if
 * document-level access control turns out to matter before go-live.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id: orderId } = await context.params;
  if (!isValidId(orderId)) {
    return NextResponse.json({ success: false, message: "Invalid order id." }, { status: 400 });
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (!order) {
    return NextResponse.json({ success: false, message: "Order not found." }, { status: 404 });
  }

  // Cheap early rejection by declared Content-Length before buffering the
  // body; the authoritative check is the actual byte count below.
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { success: false, message: "File exceeds the 20 MB upload limit." },
      { status: 413 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, message: "Expected multipart/form-data with a 'file' field." },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, message: "Missing 'file' field." }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ success: false, message: "The uploaded file is empty." }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { success: false, message: "File exceeds the 20 MB upload limit." },
      { status: 413 }
    );
  }

  const documentTypeRaw = formData.get("documentType");
  const documentType: DocumentType =
    typeof documentTypeRaw === "string" && VALID_DOCUMENT_TYPES.has(documentTypeRaw)
      ? (documentTypeRaw as DocumentType)
      : DocumentType.CUSTOMER_PO;

  const buffer = Buffer.from(await file.arrayBuffer());

  // Content-type sniffing: the stored/recorded MIME type is derived from
  // the actual bytes, never blindly trusted from the browser.
  const sniff = validateUploadContent(buffer, file.type || "application/octet-stream");
  if (!sniff.ok) {
    return NextResponse.json({ success: false, message: sniff.message }, { status: 415 });
  }

  const storage = getStorageDriver();
  const stored = await storage.put(buffer);

  const originalFileName = sanitizeFileName(file.name || "upload");

  try {
    const document = await prisma.$transaction(async (tx) => {
      const created = await tx.orderDocument.create({
        data: {
          orderId,
          uploadedById: user.id,
          documentType,
          originalFileName,
          storageKey: stored.storageKey,
          mimeType: sniff.resolvedMimeType,
          fileSize: BigInt(stored.fileSize),
          checksum: stored.checksum,
        },
        select: {
          id: true,
          originalFileName: true,
          mimeType: true,
          fileSize: true,
          documentType: true,
          createdAt: true,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "ORDER_DOCUMENT_UPLOADED",
          entityType: "OrderDocument",
          entityId: created.id,
          afterData: {
            orderId,
            originalFileName,
            documentType,
            mimeType: sniff.resolvedMimeType,
            fileSize: stored.fileSize,
            checksum: stored.checksum,
          },
        },
      });

      return created;
    });

    return NextResponse.json(
      {
        success: true,
        document: {
          id: document.id,
          originalFileName: document.originalFileName,
          mimeType: document.mimeType,
          fileSize: Number(document.fileSize),
          documentType: document.documentType,
          createdAt: document.createdAt,
          downloadUrl: `/api/files/${document.id}`,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    // The bytes are already on disk at this point. If the DB write that
    // records them failed, don't leave an orphaned, unreferenced file
    // sitting in the storage root indefinitely.
    await storage.delete(stored.storageKey).catch(() => {});
    console.error("Order document creation failed:", error);
    return NextResponse.json(
      { success: false, message: "Unable to save the uploaded document." },
      { status: 500 }
    );
  }
}
