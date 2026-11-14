import "server-only";
import type { Prisma, MessageChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation, TRANSACTION_OPTIONS } from "@/lib/orders";
import { getStorageDriver } from "@/lib/storage";
import { validateUploadContent } from "@/lib/storage/content-sniff";
import { createPoIntake } from "@/lib/po-intake";
import { matchCustomerForAddress } from "@/lib/channels/match-customer";
import { createNotificationForRoles } from "@/lib/notifications/create";

/**
 * Milestone 10 (Communication Channels & Fulfilment). The pre-extraction
 * review layer in front of the EXISTING, unmodified lib/po-intake.ts
 * pipeline (spec point 1's "support human review before creating or
 * confirming commercial transactions" -- see MessageIntake's own schema
 * comment for why this is structurally guaranteed, not just a convention
 * followed here).
 *
 * recordInboundMessage() is called by BOTH channel webhook route handlers
 * (app/api/channels/email/webhook, app/api/channels/whatsapp/webhook) and
 * the manual-intake fallback route (app/api/channels/manual-intake) --
 * the one place a MessageIntake row is ever created. Every other
 * function here is a REVIEW ACTION, callable only by an authenticated
 * user (enforced at the route layer, not here -- see app/api/channels/
 * intake/[id]/*).
 */

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // same ceiling as lib/po-intake.ts's MAX_PO_INTAKE_BYTES

export type RecordInboundMessageInput = {
  channel: MessageChannel;
  externalMessageId?: string | null;
  fromAddress: string;
  fromDisplayName?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  rawPayload?: Prisma.InputJsonValue;
  receivedAt?: Date;
  attachments?: { bytes: Buffer; originalFileName: string; claimedMimeType: string }[];
  isDemo?: boolean;
};

export type RecordInboundMessageResult =
  | { ok: true; messageIntakeId: string; duplicate: boolean }
  | { ok: false; status: number; message: string };

/**
 * Creates a MessageIntake row (plus any MessageAttachment rows) with NO
 * User at all -- webhooks and the manual-intake form both call this
 * before anyone has reviewed anything, which is exactly why
 * reviewedById stays null on every row this function produces. See
 * MessageIntake's own schema comment for why that is the structural
 * guarantee behind "human review before creating/confirming commercial
 * transactions," not merely this function's intent.
 *
 * Idempotent on externalMessageId: a webhook redelivering the same
 * provider message id (the normal, expected behaviour of most webhook
 * providers' at-least-once delivery guarantee) returns the ORIGINAL row
 * with `duplicate: true` rather than creating a second MessageIntake --
 * spec point 1's "avoid duplicate intake," enforced at the database
 * level via MessageIntake.externalMessageId's own @unique constraint,
 * not by a racy "check then insert."
 */
export async function recordInboundMessage(input: RecordInboundMessageInput): Promise<RecordInboundMessageResult> {
  if (!input.fromAddress.trim()) {
    return { ok: false, status: 400, message: "A sender address is required." };
  }

  const attachmentsToStore = input.attachments ?? [];
  if (attachmentsToStore.some((a) => a.bytes.length === 0)) {
    return { ok: false, status: 400, message: "An attachment was empty." };
  }
  if (attachmentsToStore.some((a) => a.bytes.length > MAX_ATTACHMENT_BYTES)) {
    return { ok: false, status: 413, message: "An attachment exceeds the 20 MB limit." };
  }

  // Store bytes BEFORE opening a transaction -- same reasoning as
  // lib/po-intake.ts's own storeBytes(): a storage write may be real I/O
  // and must never happen while holding a Postgres transaction's
  // connection and locks.
  const storage = getStorageDriver();
  const storedAttachments: { originalFileName: string; storageKey: string; mimeType: string; fileSize: bigint; checksum: string }[] = [];
  const storedKeysToCleanupOnFailure: string[] = [];

  try {
    for (const attachment of attachmentsToStore) {
      const sniff = validateUploadContent(attachment.bytes, attachment.claimedMimeType);
      if (!sniff.ok) {
        return { ok: false, status: 415, message: `Attachment "${attachment.originalFileName}": ${sniff.message}` };
      }
      const stored = await storage.put(attachment.bytes);
      storedKeysToCleanupOnFailure.push(stored.storageKey);
      storedAttachments.push({
        originalFileName: attachment.originalFileName,
        storageKey: stored.storageKey,
        mimeType: sniff.resolvedMimeType,
        fileSize: BigInt(stored.fileSize), // Prisma BigInt columns require a JS bigint, never a number -- same conversion lib/po-intake.ts's storeBytes() caller already applies
        checksum: stored.checksum,
      });
    }

    const channelLabel = input.channel === "EMAIL" ? "email" : input.channel === "WHATSAPP" ? "WhatsApp" : "manually-entered";
    const matched = input.channel === "MANUAL" ? null : await matchCustomerForAddress(input.fromAddress, input.channel);

    const messageIntakeId = await prisma.$transaction(async (tx) => {
      const intake = await tx.messageIntake.create({
        data: {
          channel: input.channel,
          externalMessageId: input.externalMessageId ?? null,
          fromAddress: input.fromAddress,
          fromDisplayName: input.fromDisplayName ?? null,
          subject: input.subject ?? null,
          bodyText: input.bodyText ?? null,
          rawPayload: input.rawPayload ?? undefined,
          receivedAt: input.receivedAt ?? new Date(),
          customerId: matched?.customerId ?? null,
          customerContactId: matched?.customerContactId ?? null,
          isDemo: input.isDemo ?? false,
          attachments: { create: storedAttachments },
        },
        select: { id: true },
      });

      await createNotificationForRoles(tx, ["SALES_MANAGER", "ADMINISTRATOR"], {
        type: "CHANNEL_INTAKE_RECEIVED",
        title: "New customer message to review",
        message: `A new ${channelLabel} message from ${input.fromDisplayName || input.fromAddress} is waiting for review.`,
        link: `/communications/inbox/${intake.id}`,
      });

      return intake.id;
    }, TRANSACTION_OPTIONS);

    return { ok: true, messageIntakeId, duplicate: false };
  } catch (error) {
    if (isUniqueViolation(error) && input.externalMessageId) {
      const existing = await prisma.messageIntake.findUnique({ where: { externalMessageId: input.externalMessageId }, select: { id: true } });
      if (existing) {
        // Clean up any bytes we just stored for what turned out to be a
        // redelivery -- the original intake's own attachments (stored on
        // first delivery) are untouched.
        await Promise.all(storedKeysToCleanupOnFailure.map((key) => storage.delete(key).catch(() => {})));
        return { ok: true, messageIntakeId: existing.id, duplicate: true };
      }
    }
    await Promise.all(storedKeysToCleanupOnFailure.map((key) => storage.delete(key).catch(() => {})));
    console.error("recordInboundMessage failed:", error);
    return { ok: false, status: 500, message: "Unable to record the inbound message." };
  }
}

export type ReviewActionResult = { ok: true } | { ok: false; status: number; message: string };

async function loadReceivedIntake(messageIntakeId: string) {
  return prisma.messageIntake.findUnique({
    where: { id: messageIntakeId },
    select: { id: true, status: true, channel: true, bodyText: true, isDemo: true, attachments: { select: { id: true, storageKey: true, originalFileName: true, mimeType: true } } },
  });
}

/**
 * Converts a MessageIntake into a real PO intake via the EXISTING,
 * UNMODIFIED lib/po-intake.ts pipeline -- the one place this milestone
 * calls createPoIntake(). `attachmentId`, when given, selects WHICH of
 * the intake's attachments is the actual PO to extract (createPoIntake's
 * own CreateIntakeInput accepts exactly one file or one pasted text, not
 * several -- see that module's own CreateIntakeInput type); when omitted,
 * the intake's bodyText is submitted as pasted EMAIL/WHATSAPP text
 * instead. A MessageIntake with several attachments converts its ONE
 * selected attachment only -- this is a deliberate, documented scope
 * boundary (see docs/milestones/PROGRESS.md's Milestone 10 section),
 * not an oversight: any other attachment remains visible and downloadable
 * from the intake's own review page, and can be attached to the
 * resulting order afterward through the EXISTING per-order document
 * upload route (app/api/orders/[id]/documents) once that order exists.
 *
 * Deliberately re-stores the selected attachment's bytes through
 * createPoIntake's own storeBytes() path rather than reusing the
 * MessageAttachment's existing storageKey directly -- this keeps
 * lib/po-intake.ts completely untouched and self-contained, at the cost
 * of a second, harmless stored copy of the same bytes. The ORIGINAL
 * MessageAttachment row (and its own stored copy) is never deleted or
 * mutated by this function, preserving it as the immutable record of
 * exactly what the customer actually sent.
 */
export async function convertMessageIntakeToPoIntake(
  messageIntakeId: string,
  reviewerId: string,
  options: { attachmentId?: string; reviewNotes?: string } = {}
): Promise<ReviewActionResult & { resultingOrderDocumentId?: string }> {
  const intake = await loadReceivedIntake(messageIntakeId);
  if (!intake) return { ok: false, status: 404, message: "Message not found." };
  if (intake.status !== "RECEIVED") {
    return { ok: false, status: 409, message: `This message has already been reviewed (status: ${intake.status}).` };
  }
  const storage = getStorageDriver();
  let intakeResult: Awaited<ReturnType<typeof createPoIntake>>;

  if (options.attachmentId) {
    const attachment = intake.attachments.find((a) => a.id === options.attachmentId);
    if (!attachment) return { ok: false, status: 404, message: "Attachment not found on this message." };
    const bytes = await storage.get(attachment.storageKey);
    if (!bytes) return { ok: false, status: 500, message: "The attachment's stored content could not be found." };
    intakeResult = await createPoIntake(
      { submission: "file", file: bytes, originalFileName: attachment.originalFileName, claimedMimeType: attachment.mimeType },
      reviewerId,
      { isDemo: intake.isDemo }
    );
  } else {
    if (!intake.bodyText?.trim()) {
      return { ok: false, status: 400, message: "This message has no text content and no attachment was selected to convert." };
    }
    const pasteChannel = intake.channel === "WHATSAPP" ? "WHATSAPP" : "EMAIL";
    intakeResult = await createPoIntake({ submission: "paste", channel: pasteChannel, pastedText: intake.bodyText }, reviewerId, { isDemo: intake.isDemo });
  }

  if (!intakeResult.ok) {
    return { ok: false, status: intakeResult.status, message: intakeResult.message };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.messageIntake.update({
        where: { id: messageIntakeId },
        data: {
          status: "CONVERTED",
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          reviewNotes: options.reviewNotes ?? null,
          resultingOrderDocumentId: intakeResult.documentId,
        },
      });
      await tx.auditEvent.create({
        data: { actorId: reviewerId, action: "MESSAGE_INTAKE_CONVERTED", entityType: "MessageIntake", entityId: messageIntakeId, afterData: { resultingOrderDocumentId: intakeResult.documentId } },
      });
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    // The OrderDocument was created successfully (intakeResult.ok is
    // true) -- only the back-link update below failed. This leaves the
    // MessageIntake stuck at RECEIVED with a real OrderDocument already
    // existing but not yet linked back to it; a reviewer retrying the
    // same action will see the "already reviewed" 409 fail instead,
    // since the OrderDocument now exists. This narrow, documented gap
    // (not a silent data-loss risk -- the OrderDocument itself is intact
    // and reachable through the ordinary PO review queue) is reported
    // rather than hidden.
    console.error("MessageIntake back-link update failed after successful conversion:", error);
    return { ok: false, status: 500, message: "The document was created, but this message could not be marked as converted. Check the PO review queue for a new, unlinked document." };
  }

  return { ok: true, resultingOrderDocumentId: intakeResult.documentId };
}

export async function linkMessageIntakeToOrder(messageIntakeId: string, reviewerId: string, orderId: string, reviewNotes?: string): Promise<ReviewActionResult> {
  const order = await prisma.customerOrder.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!order) return { ok: false, status: 404, message: "Order not found." };
  return finishReview(messageIntakeId, reviewerId, "LINKED", { linkedOrderId: orderId }, reviewNotes, "MESSAGE_INTAKE_LINKED_ORDER");
}

export async function linkMessageIntakeToQuotation(messageIntakeId: string, reviewerId: string, quotationId: string, reviewNotes?: string): Promise<ReviewActionResult> {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { id: true } });
  if (!quotation) return { ok: false, status: 404, message: "Quotation not found." };
  return finishReview(messageIntakeId, reviewerId, "LINKED", { linkedQuotationId: quotationId }, reviewNotes, "MESSAGE_INTAKE_LINKED_QUOTATION");
}

export async function ignoreMessageIntake(messageIntakeId: string, reviewerId: string, reviewNotes?: string): Promise<ReviewActionResult> {
  return finishReview(messageIntakeId, reviewerId, "IGNORED", {}, reviewNotes, "MESSAGE_INTAKE_IGNORED");
}

export async function markMessageIntakeDuplicate(messageIntakeId: string, reviewerId: string, duplicateOfId: string, reviewNotes?: string): Promise<ReviewActionResult> {
  if (duplicateOfId === messageIntakeId) {
    return { ok: false, status: 400, message: "A message cannot be marked as a duplicate of itself." };
  }
  const original = await prisma.messageIntake.findUnique({ where: { id: duplicateOfId }, select: { id: true } });
  if (!original) return { ok: false, status: 404, message: "The original message was not found." };
  return finishReview(messageIntakeId, reviewerId, "DUPLICATE", { duplicateOfId }, reviewNotes, "MESSAGE_INTAKE_MARKED_DUPLICATE");
}

async function finishReview(
  messageIntakeId: string,
  reviewerId: string,
  status: "LINKED" | "IGNORED" | "DUPLICATE",
  // Unchecked, not checked: every caller below sets a scalar foreign key
  // (linkedOrderId/linkedQuotationId/duplicateOfId), never the relation
  // object (linkedOrder/linkedQuotation/duplicateOf) -- the same choice
  // the rest of this function already makes for reviewedById. Prisma's
  // *checked* update input only exposes the relation fields for a model
  // with explicit @relation(fields: ...) attributes like MessageIntake's;
  // the scalar FK fields exist only on the *unchecked* variant. Typing
  // this as the checked input was the root cause of this file's TS2561/
  // TS2322 errors -- not a real type mismatch in the call sites below.
  extra: Prisma.MessageIntakeUncheckedUpdateInput,
  reviewNotes: string | undefined,
  auditAction: string
): Promise<ReviewActionResult> {
  const intake = await prisma.messageIntake.findUnique({ where: { id: messageIntakeId }, select: { id: true, status: true } });
  if (!intake) return { ok: false, status: 404, message: "Message not found." };
  if (intake.status !== "RECEIVED") {
    return { ok: false, status: 409, message: `This message has already been reviewed (status: ${intake.status}).` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.messageIntake.update({
      where: { id: messageIntakeId },
      data: { status, reviewedById: reviewerId, reviewedAt: new Date(), reviewNotes: reviewNotes ?? null, ...extra },
    });
    await tx.auditEvent.create({
      data: { actorId: reviewerId, action: auditAction, entityType: "MessageIntake", entityId: messageIntakeId, afterData: extra as unknown as Prisma.InputJsonValue },
    });
  }, TRANSACTION_OPTIONS);

  return { ok: true };
}
