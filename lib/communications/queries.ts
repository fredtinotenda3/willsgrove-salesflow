import "server-only";
import type { Prisma, OutboundMessageStatus, MessageChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Read-only helpers
 * for the /communications log -- the spec's "communication reliability"
 * requirement made visible: every queued/sent/failed customer message,
 * with a way to see why one failed and resend it.
 */

export type OutboundMessageSummary = {
  id: string;
  type: string;
  channel: string;
  status: string;
  toAddress: string | null;
  subject: string | null;
  customerId: string;
  customerName: string;
  attemptCount: number;
  lastErrorMessage: string | null;
  sentAt: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
  relatedOrderId: string | null;
  relatedQuotationId: string | null;
};

export type OutboundMessageListResult = {
  messages: OutboundMessageSummary[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

const VALID_STATUSES = new Set(["QUEUED", "SENT", "FAILED"]);
const VALID_CHANNELS = new Set(["EMAIL", "WHATSAPP", "MANUAL"]);

export async function listOutboundMessages(options: {
  page: number;
  pageSize: number;
  status?: string | null;
  channel?: string | null;
  customerId?: string | null;
}): Promise<OutboundMessageListResult> {
  const where: Prisma.OutboundMessageWhereInput = {};
  if (options.status && VALID_STATUSES.has(options.status)) {
    where.status = options.status as OutboundMessageStatus;
  }
  if (options.channel && VALID_CHANNELS.has(options.channel)) {
    where.channel = options.channel as MessageChannel;
  }
  if (options.customerId) {
    where.customerId = options.customerId;
  }

  const [totalItems, rows] = await Promise.all([
    prisma.outboundMessage.count({ where }),
    prisma.outboundMessage.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      select: {
        id: true,
        type: true,
        channel: true,
        status: true,
        toAddress: true,
        subject: true,
        customerId: true,
        customer: { select: { name: true } },
        attemptCount: true,
        lastErrorMessage: true,
        sentAt: true,
        lastAttemptAt: true,
        createdAt: true,
        relatedOrderId: true,
        relatedQuotationId: true,
      },
    }),
  ]);

  return {
    messages: rows.map((row) => ({
      id: row.id,
      type: row.type,
      channel: row.channel,
      status: row.status,
      toAddress: row.toAddress,
      subject: row.subject,
      customerId: row.customerId,
      customerName: row.customer.name,
      attemptCount: row.attemptCount,
      lastErrorMessage: row.lastErrorMessage,
      sentAt: row.sentAt ? row.sentAt.toISOString() : null,
      lastAttemptAt: row.lastAttemptAt ? row.lastAttemptAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      relatedOrderId: row.relatedOrderId,
      relatedQuotationId: row.relatedQuotationId,
    })),
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / options.pageSize)),
    },
  };
}

export type OutboundMessageDetail = OutboundMessageSummary & {
  bodyText: string;
  triggeredById: string;
  lastResentById: string | null;
  lastResentAt: string | null;
  relatedDispatchRecordId: string | null;
  relatedDeliveryRecordId: string | null;
};

export async function getOutboundMessageDetail(id: string): Promise<OutboundMessageDetail | null> {
  const row = await prisma.outboundMessage.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      channel: true,
      status: true,
      toAddress: true,
      subject: true,
      bodyText: true,
      customerId: true,
      customer: { select: { name: true } },
      attemptCount: true,
      lastErrorMessage: true,
      sentAt: true,
      lastAttemptAt: true,
      createdAt: true,
      triggeredById: true,
      lastResentById: true,
      lastResentAt: true,
      relatedOrderId: true,
      relatedQuotationId: true,
      relatedDispatchRecordId: true,
      relatedDeliveryRecordId: true,
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    type: row.type,
    channel: row.channel,
    status: row.status,
    toAddress: row.toAddress,
    subject: row.subject,
    bodyText: row.bodyText,
    customerId: row.customerId,
    customerName: row.customer.name,
    attemptCount: row.attemptCount,
    lastErrorMessage: row.lastErrorMessage,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    lastAttemptAt: row.lastAttemptAt ? row.lastAttemptAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    triggeredById: row.triggeredById,
    lastResentById: row.lastResentById,
    lastResentAt: row.lastResentAt ? row.lastResentAt.toISOString() : null,
    relatedOrderId: row.relatedOrderId,
    relatedQuotationId: row.relatedQuotationId,
    relatedDispatchRecordId: row.relatedDispatchRecordId,
    relatedDeliveryRecordId: row.relatedDeliveryRecordId,
  };
}
