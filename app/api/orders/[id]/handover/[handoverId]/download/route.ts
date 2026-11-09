import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getStorageDriver } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string; handoverId: string }> };

/**
 * Milestone 2C. GET /api/orders/[id]/handover/[handoverId]/download --
 * same shape and the same reasoning as GET /api/files/[id] (Milestone 0):
 * `handoverId` is the OrderHandover row id, never a storage key, so
 * there's nothing in the URL for a client to guess or tamper with to
 * reach another file. A separate route from /api/files/[id] rather than
 * overloading it, since that one is specifically typed to OrderDocument.
 * Never reachable for a CLIPBOARD handover -- that format has no stored
 * file at all (see OrderHandover.storageKey's schema comment).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id: orderId, handoverId } = await context.params;
  if (!isValidId(orderId) || !isValidId(handoverId)) {
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  const handover = await prisma.orderHandover.findUnique({
    where: { id: handoverId },
    select: { orderId: true, storageKey: true, originalFileName: true, mimeType: true, fileSize: true },
  });

  if (!handover || handover.orderId !== orderId) {
    return NextResponse.json({ success: false, message: "Handover not found." }, { status: 404 });
  }

  if (!handover.storageKey || !handover.originalFileName || !handover.mimeType || handover.fileSize === null) {
    return NextResponse.json({ success: false, message: "This handover has no downloadable file." }, { status: 404 });
  }

  const storage = getStorageDriver();
  const data = await storage.get(handover.storageKey);

  if (!data) {
    console.error(`OrderHandover ${handoverId} has no bytes at storage key ${handover.storageKey}.`);
    return NextResponse.json({ success: false, message: "The stored file could not be found." }, { status: 404 });
  }

  const asciiFallback = handover.originalFileName.replace(/[^\x20-\x7e]/g, "_");
  const encodedName = encodeURIComponent(handover.originalFileName);

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": handover.mimeType,
      "Content-Length": String(handover.fileSize),
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
