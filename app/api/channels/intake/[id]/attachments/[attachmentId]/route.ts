import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getStorageDriver } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string; attachmentId: string }> };

/**
 * GET /api/channels/intake/[id]/attachments/[attachmentId]
 *
 * Milestone 10 (Communication Channels & Fulfilment). Authorised
 * download for a MessageAttachment -- exact mirror of
 * app/api/files/[id]/route.ts's own OrderDocument download convention
 * (same "id in the URL, never the storage key" security boundary).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id, attachmentId } = await context.params;
  if (!isValidId(id) || !isValidId(attachmentId)) {
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  const attachment = await prisma.messageAttachment.findFirst({
    where: { id: attachmentId, messageIntakeId: id },
    select: { storageKey: true, originalFileName: true, mimeType: true, fileSize: true },
  });

  if (!attachment) {
    return NextResponse.json({ success: false, message: "Attachment not found." }, { status: 404 });
  }

  const storage = getStorageDriver();
  const data = await storage.get(attachment.storageKey);

  if (!data) {
    console.error(`MessageAttachment ${attachmentId} has no bytes at storage key ${attachment.storageKey}.`);
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
