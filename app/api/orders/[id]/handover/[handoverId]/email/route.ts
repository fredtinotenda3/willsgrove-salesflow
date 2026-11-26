import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getStorageDriver } from "@/lib/storage";
import { canUseLiveEmailAdapter } from "@/lib/channels/config";
import { getChannelAdapter } from "@/lib/channels/get-adapter";

type RouteContext = { params: Promise<{ id: string; handoverId: string }> };

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_RECIPIENTS = 5;

const bodySchema = z.object({
  to: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .transform((value) => value.split(/[,;\s]+/).filter(Boolean)),
  note: z.string().trim().max(1000).optional(),
});

const emailSchema = z.string().email().max(254);

/**
 * POST /api/orders/[id]/handover/[handoverId]/email -- emails an
 * already-generated Excel/CSV handover to the invoice team (or anyone the
 * user types). Explicit, user-triggered, per handover; never automatic.
 *
 * Honest about configuration: with no live email provider configured
 * (CHANNEL_EMAIL_PROVIDER=live + key + from address) it answers 503 and
 * tells the user to download the file instead, rather than pretending a
 * mock send delivered anything.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id: orderId, handoverId } = await context.params;
  if (!isValidId(orderId) || !isValidId(handoverId)) {
    return Response.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return Response.json({ success: false, message: body.message }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) {
    return Response.json({ success: false, message: "Enter at least one recipient email address." }, { status: 400 });
  }
  const recipients = [...new Set(parsed.data.to.map((address) => address.toLowerCase()))];
  if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS) {
    return Response.json({ success: false, message: `Enter between 1 and ${MAX_RECIPIENTS} recipient addresses.` }, { status: 400 });
  }
  const invalid = recipients.find((address) => !emailSchema.safeParse(address).success);
  if (invalid) {
    return Response.json({ success: false, message: `"${invalid}" is not a valid email address.` }, { status: 400 });
  }

  if (!canUseLiveEmailAdapter()) {
    return Response.json(
      {
        success: false,
        message: "Email delivery is not configured on this server. Download the file and send it yourself, or ask an administrator to configure the email provider.",
      },
      { status: 503 }
    );
  }

  const handover = await prisma.orderHandover.findUnique({
    where: { id: handoverId },
    select: {
      orderId: true,
      reference: true,
      storageKey: true,
      originalFileName: true,
      mimeType: true,
      fileSize: true,
      order: { select: { reference: true, customer: { select: { name: true } } } },
    },
  });

  if (!handover || handover.orderId !== orderId) {
    return Response.json({ success: false, message: "Handover not found." }, { status: 404 });
  }
  if (!handover.storageKey || !handover.originalFileName || !handover.mimeType) {
    return Response.json({ success: false, message: "This handover has no file to email." }, { status: 404 });
  }
  if (handover.fileSize !== null && Number(handover.fileSize) > MAX_ATTACHMENT_BYTES) {
    return Response.json({ success: false, message: "This file is too large to email. Download it instead." }, { status: 413 });
  }

  let bytes: Buffer | null;
  try {
    bytes = await getStorageDriver().get(handover.storageKey);
  } catch (error) {
    console.error("Handover email: storage read failed:", error);
    return Response.json({ success: false, message: "The stored file could not be read." }, { status: 503 });
  }
  if (!bytes) {
    return Response.json({ success: false, message: "The stored file could not be found." }, { status: 404 });
  }

  const subject = `SAP invoice handover ${handover.reference ?? ""} - ${handover.order.reference}`.replace(/\s+/g, " ").trim();
  const lines = [
    `Please find attached the SAP invoice handover for order ${handover.order.reference} (${handover.order.customer.name}).`,
    handover.reference ? `Handover reference: ${handover.reference}` : null,
    parsed.data.note ? `\nNote from ${user.name}:\n${parsed.data.note}` : `\nSent by ${user.name}.`,
  ].filter((line): line is string => line !== null);

  const result = await getChannelAdapter("EMAIL").send({
    to: recipients.join(","),
    subject,
    bodyText: lines.join("\n"),
    attachments: [{ name: handover.originalFileName, contentType: handover.mimeType.split(";")[0], content: bytes }],
  });

  if (!result.ok) {
    return Response.json({ success: false, message: result.message }, { status: 502 });
  }

  await prisma.auditEvent
    .create({
      data: {
        actorId: user.id,
        action: "ORDER_HANDOVER_EMAILED",
        entityType: "OrderHandover",
        entityId: handoverId,
        afterData: { orderId, recipients, providerMessageId: result.providerMessageId },
      },
    })
    .catch((error) => console.error("Handover email: audit write failed:", error));

  return Response.json({ success: true, sentTo: recipients }, { headers: { "Cache-Control": "no-store" } });
}
