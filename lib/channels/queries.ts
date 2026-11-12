import "server-only";
import type { MessageIntakeStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Read-only helpers
 * for the message intake queue -- shared by app/api/channels/intake/
 * route.ts and app/communications/inbox/page.tsx, so there is exactly
 * one query behind both (the API route was written first, with this
 * logic inline; extracted here so the new page doesn't duplicate it).
 */

const VALID_STATUSES = new Set<string>(["RECEIVED", "CONVERTED", "LINKED", "IGNORED", "DUPLICATE"]);

export type MessageIntakeSummary = {
  id: string;
  channel: string;
  status: string;
  fromAddress: string;
  fromDisplayName: string | null;
  subject: string | null;
  receivedAt: string;
  customerId: string | null;
  customer: { id: string; name: string } | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  linkedOrderId: string | null;
  linkedQuotationId: string | null;
  resultingOrderDocumentId: string | null;
  attachmentCount: number;
};

/** statusFilter: a specific MessageIntakeStatus, or "ALL". Defaults to RECEIVED (the actual queue needing attention) for anything else, including an omitted/unrecognized value. */
export async function listMessageIntakes(statusFilter: string | null): Promise<MessageIntakeSummary[]> {
  const where =
    statusFilter === "ALL"
      ? {}
      : { status: (VALID_STATUSES.has(statusFilter ?? "") ? statusFilter : "RECEIVED") as MessageIntakeStatus };

  const intakes = await prisma.messageIntake.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: 200,
    select: {
      id: true,
      channel: true,
      status: true,
      fromAddress: true,
      fromDisplayName: true,
      subject: true,
      receivedAt: true,
      customerId: true,
      customer: { select: { id: true, name: true } },
      reviewedById: true,
      reviewedAt: true,
      linkedOrderId: true,
      linkedQuotationId: true,
      resultingOrderDocumentId: true,
      _count: { select: { attachments: true } },
    },
  });

  return intakes.map((intake) => ({
    id: intake.id,
    channel: intake.channel,
    status: intake.status,
    fromAddress: intake.fromAddress,
    fromDisplayName: intake.fromDisplayName,
    subject: intake.subject,
    receivedAt: intake.receivedAt.toISOString(),
    customerId: intake.customerId,
    customer: intake.customer,
    reviewedById: intake.reviewedById,
    reviewedAt: intake.reviewedAt ? intake.reviewedAt.toISOString() : null,
    linkedOrderId: intake.linkedOrderId,
    linkedQuotationId: intake.linkedQuotationId,
    resultingOrderDocumentId: intake.resultingOrderDocumentId,
    attachmentCount: intake._count.attachments,
  }));
}
