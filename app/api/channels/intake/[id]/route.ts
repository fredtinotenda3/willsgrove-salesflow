import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/channels/intake/[id] -- a single MessageIntake's full detail,
 * including its attachment list and candidate match suggestion, for the
 * review page (app/communications/inbox/[id]).
 */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid message id." }, { status: 400 });
  }

  const intake = await prisma.messageIntake.findUnique({
    where: { id },
    select: {
      id: true,
      channel: true,
      status: true,
      fromAddress: true,
      fromDisplayName: true,
      subject: true,
      bodyText: true,
      receivedAt: true,
      customerId: true,
      customer: { select: { id: true, name: true, email: true, phone: true } },
      customerContactId: true,
      customerContact: { select: { id: true, name: true, email: true, phone: true } },
      reviewedById: true,
      reviewedBy: { select: { id: true, name: true } },
      reviewedAt: true,
      reviewNotes: true,
      resultingOrderDocumentId: true,
      linkedOrderId: true,
      linkedOrder: { select: { id: true, reference: true } },
      linkedQuotationId: true,
      linkedQuotation: { select: { id: true, quotationNumber: true } },
      duplicateOfId: true,
      attachments: { select: { id: true, originalFileName: true, mimeType: true, fileSize: true } },
    },
  });

  if (!intake) {
    return NextResponse.json({ success: false, message: "Message not found." }, { status: 404 });
  }

  // fileSize is a Prisma BigInt column -- JSON.stringify (which
  // NextResponse.json calls internally) throws on a raw bigint, the same
  // reason app/api/orders/[id]/documents/route.ts's own upload response
  // always does Number(document.fileSize) before returning it. Converted
  // at this same API boundary, rather than changing what the select
  // returns; an attachment's size is always small enough that Number()
  // loses nothing.
  const responseIntake = {
    ...intake,
    attachments: intake.attachments.map((attachment) => ({ ...attachment, fileSize: Number(attachment.fileSize) })),
  };

  return NextResponse.json({ success: true, intake: responseIntake }, { headers: { "Cache-Control": "no-store" } });
}
