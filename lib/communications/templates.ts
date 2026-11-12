/**
 * Milestone 10 (Communication Channels & Fulfilment). Plain-text message
 * bodies for every OutboundMessageType -- deliberately plain text, not
 * HTML, so the exact same rendered string works unmodified whether the
 * channel adapter ends up being email (Postmark's TextBody) or WhatsApp
 * (a WhatsApp message IS plain text; there is no HTML variant). A real
 * production deployment may eventually want a nicer HTML email, but
 * that is a presentation layer this milestone deliberately keeps out of
 * scope -- see docs/milestones/PROGRESS.md's Milestone 10 section.
 *
 * Every function here is PURE (no I/O, no Prisma calls) -- callers
 * (lib/communications/send.ts) gather the data first and pass it in,
 * which is also what makes OutboundMessage.bodyText a genuinely
 * immutable snapshot: re-running the same template function later with
 * different input would produce different text, but the ALREADY-STORED
 * bodyText on a QUEUED/SENT/FAILED row is never recomputed.
 */

export type Money = { amount: string; currency: string };

function formatMoney(money: Money): string {
  return `${money.currency} ${money.amount}`;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function renderQuotationIssued(input: { customerName: string; quotationNumber: string; revisionNumber: number; validUntil: Date; total: Money }): { subject: string; bodyText: string } {
  const revisionNote = input.revisionNumber > 1 ? ` (revision ${input.revisionNumber})` : "";
  return {
    subject: `Your quotation ${input.quotationNumber}${revisionNote} from Willsgrove`,
    bodyText:
      `Dear ${input.customerName},\n\n` +
      `Please find attached quotation ${input.quotationNumber}${revisionNote}, total ${formatMoney(input.total)}, valid until ${formatDate(input.validUntil)}.\n\n` +
      `Please reply to confirm whether you would like to accept or decline this quotation.\n\n` +
      `Thank you for your business.\nWillsgrove Farm Enterprises`,
  };
}

export function renderQuotationResponseAcknowledged(input: { customerName: string; quotationNumber: string; decision: "ACCEPTED" | "REJECTED" }): { subject: string; bodyText: string } {
  const decisionText = input.decision === "ACCEPTED" ? "accepted" : "declined";
  return {
    subject: `We've recorded your response to quotation ${input.quotationNumber}`,
    bodyText:
      `Dear ${input.customerName},\n\n` +
      `Thank you -- we have recorded that quotation ${input.quotationNumber} was ${decisionText}.\n\n` +
      (input.decision === "ACCEPTED"
        ? `We will be in touch shortly to confirm your order.\n\n`
        : `If this was recorded in error, please contact us.\n\n`) +
      `Willsgrove Farm Enterprises`,
  };
}

export function renderOrderConfirmation(input: { customerName: string; orderReference: string; total: Money }): { subject: string; bodyText: string } {
  return {
    subject: `Order confirmation ${input.orderReference}`,
    bodyText:
      `Dear ${input.customerName},\n\n` +
      `Your order ${input.orderReference} (total ${formatMoney(input.total)}) has been confirmed and is now being prepared.\n\n` +
      `We will notify you when it is dispatched.\n\nWillsgrove Farm Enterprises`,
  };
}

export function renderPickingUpdate(input: { customerName: string; orderReference: string }): { subject: string; bodyText: string } {
  return {
    subject: `Order ${input.orderReference} is being prepared`,
    bodyText:
      `Dear ${input.customerName},\n\n` +
      `Your order ${input.orderReference} has been picked and authorised for dispatch. We will notify you once it is on its way.\n\n` +
      `Willsgrove Farm Enterprises`,
  };
}

export function renderDispatchNotification(input: { customerName: string; orderReference: string; vehicleOrCourierReference: string | null }): { subject: string; bodyText: string } {
  const vehicleNote = input.vehicleOrCourierReference ? ` (${input.vehicleOrCourierReference})` : "";
  return {
    subject: `Order ${input.orderReference} is on its way`,
    bodyText:
      `Dear ${input.customerName},\n\n` +
      `Your order ${input.orderReference} has been dispatched${vehicleNote} and is on its way to you.\n\n` +
      `Willsgrove Farm Enterprises`,
  };
}

export function renderDeliveryConfirmation(input: { customerName: string; orderReference: string }): { subject: string; bodyText: string } {
  return {
    subject: `Order ${input.orderReference} delivered`,
    bodyText:
      `Dear ${input.customerName},\n\n` +
      `Your order ${input.orderReference} has been delivered in full. Thank you for your business.\n\n` +
      `Willsgrove Farm Enterprises`,
  };
}

export function renderDeliveryException(input: { customerName: string; orderReference: string; outcome: "PARTIALLY_REJECTED" | "FULLY_REJECTED"; rejectionNotes: string | null }): { subject: string; bodyText: string } {
  const summary = input.outcome === "FULLY_REJECTED" ? "could not be accepted and has been returned" : "was only partially accepted; some items have been returned";
  return {
    subject: `Order ${input.orderReference}: delivery exception`,
    bodyText:
      `Dear ${input.customerName},\n\n` +
      `Your order ${input.orderReference} ${summary}.\n` +
      (input.rejectionNotes ? `Details: ${input.rejectionNotes}\n` : "") +
      `\nOur team will be in touch to resolve this. If you believe this was in error, please let us know.\n\n` +
      `Willsgrove Farm Enterprises`,
  };
}
