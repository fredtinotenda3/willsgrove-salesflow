import "server-only";
import type { Prisma, MessageChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/orders";
import { attemptSend } from "@/lib/communications/dispatcher";
import * as templates from "@/lib/communications/templates";

/**
 * Milestone 10 (Communication Channels & Fulfilment). One function per
 * customer-facing event this milestone actually sends (see
 * OutboundMessageType's own schema comment for the full list and where
 * each is triggered from). Every function here:
 *   1. Loads just enough data to render the message.
 *   2. Resolves a recipient channel/address (EMAIL if the customer/
 *      contact has an email, else WHATSAPP if they have a phone, else
 *      MANUAL -- see resolveRecipient below).
 *   3. Creates the OutboundMessage row with a deterministic
 *      idempotencyKey (safe to call twice for the same event; a repeat
 *      call is a silent, successful no-op -- see isUniqueViolation
 *      handling below).
 *   4. Immediately attempts the send (lib/communications/dispatcher.ts)
 *      so the common case resolves to SENT before the triggering request
 *      returns, without making the caller wait on a separate queue
 *      worker this project does not otherwise have.
 *
 * Called from the THIN API ROUTE LAYER, in a non-blocking try/catch,
 * AFTER the existing lib/quotations/*.ts or lib/picking/*.ts call has
 * already committed -- see this project's own Milestone 10 header
 * comment in prisma/schema.prisma for why this deliberately does not
 * live inside those existing transactions.
 */

async function resolveRecipient(customerId: string, customerContactId: string | null): Promise<{ channel: MessageChannel; toAddress: string | null; customerContactId: string | null }> {
  const contact = customerContactId ? await prisma.customerContact.findUnique({ where: { id: customerContactId }, select: { email: true, phone: true } }) : null;
  if (contact?.email) return { channel: "EMAIL", toAddress: contact.email, customerContactId };
  if (contact?.phone) return { channel: "WHATSAPP", toAddress: contact.phone, customerContactId };

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { email: true, phone: true } });
  if (customer?.email) return { channel: "EMAIL", toAddress: customer.email, customerContactId: null };
  if (customer?.phone) return { channel: "WHATSAPP", toAddress: customer.phone, customerContactId: null };

  return { channel: "MANUAL", toAddress: null, customerContactId: null };
}

async function createAndSend(data: {
  type: Prisma.OutboundMessageCreateInput["type"];
  idempotencyKey: string;
  customerId: string;
  customerContactId: string | null;
  channel: MessageChannel;
  toAddress: string | null;
  subject: string | null;
  bodyText: string;
  triggeredById: string;
  relatedOrderId?: string;
  relatedQuotationId?: string;
  relatedDispatchRecordId?: string;
  relatedDeliveryRecordId?: string;
  isDemo?: boolean;
}): Promise<{ queued: boolean; outboundMessageId: string }> {
  try {
    const created = await prisma.outboundMessage.create({
      data: {
        type: data.type,
        channel: data.channel,
        idempotencyKey: data.idempotencyKey,
        customerId: data.customerId,
        customerContactId: data.customerContactId,
        toAddress: data.toAddress,
        subject: data.subject,
        bodyText: data.bodyText,
        triggeredById: data.triggeredById,
        relatedOrderId: data.relatedOrderId,
        relatedQuotationId: data.relatedQuotationId,
        relatedDispatchRecordId: data.relatedDispatchRecordId,
        relatedDeliveryRecordId: data.relatedDeliveryRecordId,
        isDemo: data.isDemo ?? false,
      },
      select: { id: true },
    });
    await attemptSend(created.id);
    return { queued: true, outboundMessageId: created.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Already queued for this exact event (idempotencyKey collision) --
      // a silent, successful no-op, not an error. Most commonly hit when
      // a route's own retry logic (or a user double-click the UI didn't
      // fully debounce) calls the same queue*Message function twice for
      // the same entity.
      const existing = await prisma.outboundMessage.findUnique({ where: { idempotencyKey: data.idempotencyKey }, select: { id: true } });
      return { queued: false, outboundMessageId: existing?.id ?? "" };
    }
    throw error;
  }
}

export async function queueQuotationIssuedMessage(quotationId: string, triggeredById: string): Promise<void> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, quotationNumber: true, revisionNumber: true, validUntil: true, total: true, currency: true, customerId: true, customerContactId: true, isDemo: true, customer: { select: { name: true } } },
  });
  if (!quotation) return;

  const recipient = await resolveRecipient(quotation.customerId, quotation.customerContactId);
  const rendered = templates.renderQuotationIssued({
    customerName: quotation.customer.name,
    quotationNumber: quotation.quotationNumber,
    revisionNumber: quotation.revisionNumber,
    validUntil: quotation.validUntil,
    total: { amount: quotation.total.toFixed(2), currency: quotation.currency },
  });

  await createAndSend({
    type: "QUOTATION_ISSUED",
    idempotencyKey: `MSG-QUOTATION_ISSUED-${quotation.id}`,
    customerId: quotation.customerId,
    customerContactId: recipient.customerContactId,
    channel: recipient.channel,
    toAddress: recipient.toAddress,
    subject: rendered.subject,
    bodyText: rendered.bodyText,
    triggeredById,
    relatedQuotationId: quotation.id,
    isDemo: quotation.isDemo,
  });
}

export async function queueQuotationResponseAcknowledgedMessage(quotationId: string, triggeredById: string): Promise<void> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, quotationNumber: true, status: true, customerId: true, customerContactId: true, isDemo: true, customer: { select: { name: true } } },
  });
  if (!quotation || (quotation.status !== "ACCEPTED" && quotation.status !== "REJECTED")) return;

  const recipient = await resolveRecipient(quotation.customerId, quotation.customerContactId);
  const rendered = templates.renderQuotationResponseAcknowledged({
    customerName: quotation.customer.name,
    quotationNumber: quotation.quotationNumber,
    decision: quotation.status,
  });

  await createAndSend({
    type: "QUOTATION_RESPONSE_ACKNOWLEDGED",
    idempotencyKey: `MSG-QUOTATION_RESPONSE_ACKNOWLEDGED-${quotation.id}`,
    customerId: quotation.customerId,
    customerContactId: recipient.customerContactId,
    channel: recipient.channel,
    toAddress: recipient.toAddress,
    subject: rendered.subject,
    bodyText: rendered.bodyText,
    triggeredById,
    relatedQuotationId: quotation.id,
    isDemo: quotation.isDemo,
  });
}

export async function queueOrderConfirmationMessage(orderId: string, triggeredById: string): Promise<void> {
  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { id: true, reference: true, total: true, currency: true, customerId: true, isDemo: true, customer: { select: { name: true } } },
  });
  if (!order) return;

  const recipient = await resolveRecipient(order.customerId, null);
  const rendered = templates.renderOrderConfirmation({
    customerName: order.customer.name,
    orderReference: order.reference,
    total: { amount: (order.total ?? 0).toFixed(2), currency: order.currency },
  });

  await createAndSend({
    type: "ORDER_CONFIRMATION",
    idempotencyKey: `MSG-ORDER_CONFIRMATION-${order.id}`,
    customerId: order.customerId,
    customerContactId: recipient.customerContactId,
    channel: recipient.channel,
    toAddress: recipient.toAddress,
    subject: rendered.subject,
    bodyText: rendered.bodyText,
    triggeredById,
    relatedOrderId: order.id,
    isDemo: order.isDemo,
  });
}

export async function queuePickingUpdateMessage(orderId: string, triggeredById: string): Promise<void> {
  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { id: true, reference: true, customerId: true, isDemo: true, customer: { select: { name: true } } },
  });
  if (!order) return;

  const recipient = await resolveRecipient(order.customerId, null);
  const rendered = templates.renderPickingUpdate({ customerName: order.customer.name, orderReference: order.reference });

  await createAndSend({
    type: "PICKING_UPDATE",
    idempotencyKey: `MSG-PICKING_UPDATE-${order.id}`,
    customerId: order.customerId,
    customerContactId: recipient.customerContactId,
    channel: recipient.channel,
    toAddress: recipient.toAddress,
    subject: rendered.subject,
    bodyText: rendered.bodyText,
    triggeredById,
    relatedOrderId: order.id,
    isDemo: order.isDemo,
  });
}

export async function queueDispatchNotificationMessage(dispatchRecordId: string, triggeredById: string): Promise<void> {
  const dispatch = await prisma.dispatchRecord.findUnique({
    where: { id: dispatchRecordId },
    select: { id: true, vehicleOrCourierReference: true, isDemo: true, order: { select: { id: true, reference: true, customerId: true, customer: { select: { name: true } } } } },
  });
  if (!dispatch) return;

  const recipient = await resolveRecipient(dispatch.order.customerId, null);
  const rendered = templates.renderDispatchNotification({ customerName: dispatch.order.customer.name, orderReference: dispatch.order.reference, vehicleOrCourierReference: dispatch.vehicleOrCourierReference });

  await createAndSend({
    type: "DISPATCH_NOTIFICATION",
    idempotencyKey: `MSG-DISPATCH_NOTIFICATION-${dispatch.id}`,
    customerId: dispatch.order.customerId,
    customerContactId: recipient.customerContactId,
    channel: recipient.channel,
    toAddress: recipient.toAddress,
    subject: rendered.subject,
    bodyText: rendered.bodyText,
    triggeredById,
    relatedOrderId: dispatch.order.id,
    relatedDispatchRecordId: dispatch.id,
    isDemo: dispatch.isDemo,
  });
}

export async function queueDeliveryOutcomeMessage(deliveryRecordId: string, triggeredById: string): Promise<void> {
  const delivery = await prisma.deliveryRecord.findUnique({
    where: { id: deliveryRecordId },
    select: {
      id: true,
      outcome: true,
      notes: true,
      isDemo: true,
      dispatchRecord: { select: { order: { select: { id: true, reference: true, customerId: true, customer: { select: { name: true } } } } } },
    },
  });
  if (!delivery) return;

  const order = delivery.dispatchRecord.order;
  const recipient = await resolveRecipient(order.customerId, null);

  const rendered =
    delivery.outcome === "ACCEPTED_IN_FULL"
      ? templates.renderDeliveryConfirmation({ customerName: order.customer.name, orderReference: order.reference })
      : templates.renderDeliveryException({ customerName: order.customer.name, orderReference: order.reference, outcome: delivery.outcome, rejectionNotes: delivery.notes });

  await createAndSend({
    type: delivery.outcome === "ACCEPTED_IN_FULL" ? "DELIVERY_CONFIRMATION" : "DELIVERY_EXCEPTION",
    idempotencyKey: `MSG-${delivery.outcome === "ACCEPTED_IN_FULL" ? "DELIVERY_CONFIRMATION" : "DELIVERY_EXCEPTION"}-${delivery.id}`,
    customerId: order.customerId,
    customerContactId: recipient.customerContactId,
    channel: recipient.channel,
    toAddress: recipient.toAddress,
    subject: rendered.subject,
    bodyText: rendered.bodyText,
    triggeredById,
    relatedOrderId: order.id,
    relatedDeliveryRecordId: delivery.id,
    isDemo: delivery.isDemo,
  });
}

export type ResendResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * Re-sends a FAILED OutboundMessage's EXACT, already-rendered bodyText --
 * never re-rendered against whatever the underlying order/quotation
 * looks like now (see OutboundMessage's own schema comment). Restricted
 * to SALES_MANAGER/ADMINISTRATOR at the route layer (app/api/
 * communications/[id]/resend) -- a deliberately more sensitive action
 * than the ordinary operational actions elsewhere in this milestone,
 * since it re-attempts a send a human has specifically decided is worth
 * retrying (e.g. after fixing a customer's email address on file).
 */
export async function resendOutboundMessage(outboundMessageId: string, actorId: string): Promise<ResendResult> {
  const message = await prisma.outboundMessage.findUnique({ where: { id: outboundMessageId }, select: { id: true, status: true } });
  if (!message) return { ok: false, status: 404, message: "Message not found." };
  if (message.status !== "FAILED") {
    return { ok: false, status: 409, message: `Only a FAILED message can be resent (current status: ${message.status}).` };
  }

  await prisma.outboundMessage.update({ where: { id: outboundMessageId }, data: { lastResentById: actorId, lastResentAt: new Date(), status: "QUEUED" } });
  await attemptSend(outboundMessageId);
  return { ok: true };
}

/**
 * Sweeps any OutboundMessage rows stuck at QUEUED -- the only way this
 * can happen is the Node process dying between createAndSend()'s insert
 * and its own attemptSend() call, since every other path through this
 * file either succeeds to SENT or fails to FAILED in the same call. Not
 * wired to a schedule by this milestone (no crash has ever been observed
 * to produce one in testing) but kept available, and documented in
 * SETUP-WINDOWS.md, for an operator to run by hand or add to the
 * existing scripts/ cron convention (scripts/sap-sync.ts,
 * scripts/expire-quotations.ts) if a stuck row is ever actually found in
 * production.
 */
export async function sweepStuckQueuedMessages(olderThanMinutes = 10): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const stuck = await prisma.outboundMessage.findMany({
    where: { status: "QUEUED", createdAt: { lt: cutoff } },
    select: { id: true },
  });
  for (const row of stuck) {
    await attemptSend(row.id);
  }
  return stuck.length;
}
