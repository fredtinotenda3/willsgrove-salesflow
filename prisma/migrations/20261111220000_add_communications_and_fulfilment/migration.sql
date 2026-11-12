-- Milestone 10 (Communication Channels & Fulfilment).
-- Entirely additive: no column is dropped, no existing column's type or
-- nullability changes, no existing table is dropped or renamed, and no
-- existing enum value is removed/reordered. Every new column lives on
-- the 7 new tables below. OrderLine.dispatchLines, OrderDocument.
-- sourceMessageIntake, Customer/CustomerContact/CustomerOrder/Quotation/
-- PickingSession's new list relations, and the 7 new User inverse-
-- relation fields (prisma/schema.prisma) are pure Prisma inverse-relation
-- sides with NO new column on those existing tables.
--
-- The existing PO extraction pipeline (OrderDocument, ExtractionRun,
-- ExtractedOrderLine, lib/po-intake.ts) is reused UNCHANGED -- this
-- migration adds the pre-extraction review layer (MessageIntake/
-- MessageAttachment) in front of it, plus two subsystems that did not
-- exist before this milestone (OutboundMessage; DispatchRecord/
-- DispatchLine/DeliveryRecord/DeliveryLine). OrderStatus is NOT touched --
-- dispatch/delivery gets its own separate DispatchStatus/DeliveryOutcome
-- lifecycle, the same precedent PickingSessionStatus and
-- IntegrationOperationStatus already set.

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'MANUAL');

-- CreateEnum
CREATE TYPE "MessageIntakeStatus" AS ENUM ('RECEIVED', 'CONVERTED', 'LINKED', 'IGNORED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "OutboundMessageType" AS ENUM ('QUOTATION_ISSUED', 'QUOTATION_RESPONSE_ACKNOWLEDGED', 'ORDER_CONFIRMATION', 'PICKING_UPDATE', 'DISPATCH_NOTIFICATION', 'DELIVERY_CONFIRMATION', 'DELIVERY_EXCEPTION');

-- CreateEnum
CREATE TYPE "OutboundMessageStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('PLANNED', 'DEPARTED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryOutcome" AS ENUM ('ACCEPTED_IN_FULL', 'PARTIALLY_REJECTED', 'FULLY_REJECTED');

-- AlterEnum
-- Postgres requires each added value in its own ALTER TYPE statement.
ALTER TYPE "NotificationType" ADD VALUE 'CHANNEL_INTAKE_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'OUTBOUND_MESSAGE_FAILED';

-- CreateTable
CREATE TABLE "MessageIntake" (
    "id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "externalMessageId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "fromDisplayName" TEXT,
    "subject" TEXT,
    "bodyText" TEXT,
    "rawPayload" JSONB,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL,
    "customerId" TEXT,
    "customerContactId" TEXT,
    "status" "MessageIntakeStatus" NOT NULL DEFAULT 'RECEIVED',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewNotes" TEXT,
    "resultingOrderDocumentId" TEXT,
    "linkedOrderId" TEXT,
    "linkedQuotationId" TEXT,
    "duplicateOfId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "MessageIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageIntakeId" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "checksum" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "type" "OutboundMessageType" NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "status" "OutboundMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerContactId" TEXT,
    "toAddress" TEXT,
    "subject" TEXT,
    "bodyText" TEXT NOT NULL,
    "relatedOrderId" TEXT,
    "relatedQuotationId" TEXT,
    "relatedDispatchRecordId" TEXT,
    "relatedDeliveryRecordId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMPTZ(6),
    "lastErrorMessage" TEXT,
    "sentAt" TIMESTAMPTZ(6),
    "triggeredById" TEXT NOT NULL,
    "lastResentById" TEXT,
    "lastResentAt" TIMESTAMPTZ(6),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchRecord" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'PLANNED',
    "pickingSessionId" TEXT,
    "vehicleOrCourierReference" TEXT,
    "plannedDepartureAt" TIMESTAMPTZ(6),
    "departedById" TEXT,
    "departedAt" TIMESTAMPTZ(6),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMPTZ(6),
    "cancellationReason" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DispatchRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchLine" (
    "id" TEXT NOT NULL,
    "dispatchRecordId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "dispatchedQuantity" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRecord" (
    "id" TEXT NOT NULL,
    "dispatchRecordId" TEXT NOT NULL,
    "outcome" "DeliveryOutcome" NOT NULL,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientName" TEXT,
    "proofPhotoStorageKey" TEXT,
    "proofSignatureStorageKey" TEXT,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DeliveryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryLine" (
    "id" TEXT NOT NULL,
    "deliveryRecordId" TEXT NOT NULL,
    "dispatchLineId" TEXT NOT NULL,
    "acceptedQuantity" DECIMAL(18,4) NOT NULL,
    "rejectedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageIntake_externalMessageId_key" ON "MessageIntake"("externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageIntake_resultingOrderDocumentId_key" ON "MessageIntake"("resultingOrderDocumentId");

-- CreateIndex
CREATE INDEX "MessageIntake_channel_idx" ON "MessageIntake"("channel");

-- CreateIndex
CREATE INDEX "MessageIntake_status_idx" ON "MessageIntake"("status");

-- CreateIndex
CREATE INDEX "MessageIntake_customerId_idx" ON "MessageIntake"("customerId");

-- CreateIndex
CREATE INDEX "MessageIntake_receivedAt_idx" ON "MessageIntake"("receivedAt");

-- CreateIndex
CREATE INDEX "MessageIntake_isDemo_idx" ON "MessageIntake"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAttachment_storageKey_key" ON "MessageAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "MessageAttachment_messageIntakeId_idx" ON "MessageAttachment"("messageIntakeId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_idempotencyKey_key" ON "OutboundMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboundMessage_status_idx" ON "OutboundMessage"("status");

-- CreateIndex
CREATE INDEX "OutboundMessage_customerId_idx" ON "OutboundMessage"("customerId");

-- CreateIndex
CREATE INDEX "OutboundMessage_type_idx" ON "OutboundMessage"("type");

-- CreateIndex
CREATE INDEX "OutboundMessage_relatedOrderId_idx" ON "OutboundMessage"("relatedOrderId");

-- CreateIndex
CREATE INDEX "OutboundMessage_relatedQuotationId_idx" ON "OutboundMessage"("relatedQuotationId");

-- CreateIndex
CREATE INDEX "OutboundMessage_isDemo_idx" ON "OutboundMessage"("isDemo");

-- CreateIndex
CREATE INDEX "DispatchRecord_orderId_idx" ON "DispatchRecord"("orderId");

-- CreateIndex
CREATE INDEX "DispatchRecord_status_idx" ON "DispatchRecord"("status");

-- CreateIndex
CREATE INDEX "DispatchRecord_isDemo_idx" ON "DispatchRecord"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchLine_dispatchRecordId_orderLineId_key" ON "DispatchLine"("dispatchRecordId", "orderLineId");

-- CreateIndex
CREATE INDEX "DispatchLine_orderLineId_idx" ON "DispatchLine"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRecord_dispatchRecordId_key" ON "DeliveryRecord"("dispatchRecordId");

-- CreateIndex
CREATE INDEX "DeliveryRecord_outcome_idx" ON "DeliveryRecord"("outcome");

-- CreateIndex
CREATE INDEX "DeliveryRecord_isDemo_idx" ON "DeliveryRecord"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryLine_dispatchLineId_key" ON "DeliveryLine"("dispatchLineId");

-- CreateIndex
CREATE INDEX "DeliveryLine_deliveryRecordId_idx" ON "DeliveryLine"("deliveryRecordId");

-- AddForeignKey
ALTER TABLE "MessageIntake" ADD CONSTRAINT "MessageIntake_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageIntake" ADD CONSTRAINT "MessageIntake_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "CustomerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageIntake" ADD CONSTRAINT "MessageIntake_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageIntake" ADD CONSTRAINT "MessageIntake_resultingOrderDocumentId_fkey" FOREIGN KEY ("resultingOrderDocumentId") REFERENCES "OrderDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageIntake" ADD CONSTRAINT "MessageIntake_linkedOrderId_fkey" FOREIGN KEY ("linkedOrderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageIntake" ADD CONSTRAINT "MessageIntake_linkedQuotationId_fkey" FOREIGN KEY ("linkedQuotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageIntake" ADD CONSTRAINT "MessageIntake_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "MessageIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageIntakeId_fkey" FOREIGN KEY ("messageIntakeId") REFERENCES "MessageIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "CustomerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_relatedOrderId_fkey" FOREIGN KEY ("relatedOrderId") REFERENCES "CustomerOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_relatedQuotationId_fkey" FOREIGN KEY ("relatedQuotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_relatedDispatchRecordId_fkey" FOREIGN KEY ("relatedDispatchRecordId") REFERENCES "DispatchRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_relatedDeliveryRecordId_fkey" FOREIGN KEY ("relatedDeliveryRecordId") REFERENCES "DeliveryRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_lastResentById_fkey" FOREIGN KEY ("lastResentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_pickingSessionId_fkey" FOREIGN KEY ("pickingSessionId") REFERENCES "PickingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_departedById_fkey" FOREIGN KEY ("departedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchLine" ADD CONSTRAINT "DispatchLine_dispatchRecordId_fkey" FOREIGN KEY ("dispatchRecordId") REFERENCES "DispatchRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchLine" ADD CONSTRAINT "DispatchLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_dispatchRecordId_fkey" FOREIGN KEY ("dispatchRecordId") REFERENCES "DispatchRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_deliveryRecordId_fkey" FOREIGN KEY ("deliveryRecordId") REFERENCES "DeliveryRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_dispatchLineId_fkey" FOREIGN KEY ("dispatchLineId") REFERENCES "DispatchLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
