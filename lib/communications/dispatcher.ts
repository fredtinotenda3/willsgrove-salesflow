import "server-only";
import { prisma } from "@/lib/prisma";
import { getChannelAdapter } from "@/lib/channels/get-adapter";
import { sanitizeChannelErrorMessage } from "@/lib/channels/config";
import type { ChannelSendResult } from "@/lib/channels/types";
import { createNotificationForRoles } from "@/lib/notifications/create";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Attempts to
 * actually send one QUEUED OutboundMessage through the resolved channel
 * adapter (lib/channels/get-adapter.ts), and records the outcome.
 * Deliberately the ONLY place that transitions an OutboundMessage out of
 * QUEUED -- lib/communications/send.ts calls this once, synchronously,
 * right after creating the row (so most sends resolve before the
 * triggering request returns), and app/api/communications/[id]/resend
 * (SALES_MANAGER/ADMINISTRATOR only) calls it again for a FAILED row.
 *
 * Never throws -- a channel adapter failure, or a thrown error from the
 * adapter itself (treated as a configuration bug, not a business
 * outcome -- see ChannelAdapter.send's own doc comment), both become an
 * ordinary FAILED status update here, so a misbehaving adapter can never
 * take down the route that triggered this.
 */
export async function attemptSend(outboundMessageId: string): Promise<void> {
  const message = await prisma.outboundMessage.findUnique({
    where: { id: outboundMessageId },
    select: { id: true, channel: true, toAddress: true, subject: true, bodyText: true, status: true },
  });
  if (!message) return;

  const attemptedAt = new Date();

  if (message.channel === "MANUAL" || !message.toAddress) {
    // Nothing to send electronically -- see OutboundMessage.toAddress's
    // own schema comment. This is not a transient failure; it is
    // recorded as FAILED so it surfaces in the same "needs attention"
    // queue a genuine send failure would, since a human phoning the
    // customer is exactly the manual intervention spec point 5 asks for.
    await markOutcome(outboundMessageId, { ok: false, message: "No email address or phone number on file for this customer -- contact them directly." }, attemptedAt);
    return;
  }

  let result: ChannelSendResult;
  try {
    const adapter = getChannelAdapter(message.channel);
    result = await adapter.send({ to: message.toAddress, subject: message.subject ?? undefined, bodyText: message.bodyText });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    result = { ok: false, message: sanitizeChannelErrorMessage(`Adapter error: ${detail}`) };
  }

  await markOutcome(outboundMessageId, result, attemptedAt);
}

async function markOutcome(outboundMessageId: string, result: ChannelSendResult, attemptedAt: Date): Promise<void> {
  if (result.ok) {
    await prisma.outboundMessage.update({
      where: { id: outboundMessageId },
      data: { status: "SENT", sentAt: attemptedAt, lastAttemptAt: attemptedAt, attemptCount: { increment: 1 }, lastErrorMessage: null },
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.outboundMessage.update({
      where: { id: outboundMessageId },
      data: { status: "FAILED", lastAttemptAt: attemptedAt, attemptCount: { increment: 1 }, lastErrorMessage: result.message },
      select: { id: true, type: true, customerId: true, customer: { select: { name: true } } },
    });
    await createNotificationForRoles(tx, ["SALES_MANAGER", "ADMINISTRATOR"], {
      type: "OUTBOUND_MESSAGE_FAILED",
      title: "A customer message failed to send",
      message: `A ${updated.type} message to ${updated.customer.name} could not be sent. It can be resent from Communications once the issue is fixed.`,
      link: `/communications/${updated.id}`,
    });
  });
}
