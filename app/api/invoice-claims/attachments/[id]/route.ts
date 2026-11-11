import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getClaimAttachmentForDownload } from "@/lib/invoice-claims/attachments";
import { getStorageDriver } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 6A. GET /api/invoice-claims/attachments/[id] -- authorized
 * download for a claim evidence attachment. `id` is the
 * InvoiceClaimAttachment row id, never the storage key (same security
 * boundary as app/api/files/[id]/route.ts, which this deliberately does
 * NOT reuse/generalize -- see that file's own comment and
 * docs/milestones/PROGRESS.md's Milestone 6A section for why a separate,
 * parallel route was built instead).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid attachment id." }, { status: 400 });
  }

  const attachment = await getClaimAttachmentForDownload(id);
  if (!attachment) {
    return NextResponse.json({ success: false, message: "Attachment not found." }, { status: 404 });
  }

  const storage = getStorageDriver();
  const data = await storage.get(attachment.storageKey);
  if (!data) {
    console.error(`InvoiceClaimAttachment ${id} has no bytes at storage key ${attachment.storageKey}.`);
    return NextResponse.json({ success: false, message: "The stored file could not be found." }, { status: 404 });
  }

  const asciiFallback = attachment.originalFileName.replace(/[^\x20-\x7e]/g, "_");
  const encodedName = encodeURIComponent(attachment.originalFileName);

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.fileSize),
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
