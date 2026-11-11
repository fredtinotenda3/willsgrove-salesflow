-- Milestone 7 (Quotations Management).
-- Entirely additive: no column is dropped, no existing column's type or
-- nullability changes, no existing table is dropped or renamed, and no
-- existing enum value is removed. One existing enum (OrderSource) gains
-- one new value (QUOTATION); every other new column lives on the 3 new
-- tables below. The "new relation fields" on User/Customer/
-- CustomerContact/Product/CustomerOrder in prisma/schema.prisma are pure
-- Prisma inverse-relation sides with NO new column on those existing
-- tables.

-- AlterEnum
-- Postgres requires each added value in its own ALTER TYPE statement
-- (same constraint this project already hit in the Milestone 2A and 3A
-- migrations above).
ALTER TYPE "OrderSource" ADD VALUE 'QUOTATION';

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationEventType" AS ENUM ('CREATED', 'EDITED', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'REVISED', 'CONVERTED');

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "rootQuotationId" TEXT,
    "previousRevisionId" TEXT,
    "supersededAt" TIMESTAMPTZ(6),
    "supersededById" TEXT,
    "customerId" TEXT NOT NULL,
    "customerContactId" TEXT,
    "quotationDate" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "customerReference" TEXT,
    "preparedById" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "internalNotes" TEXT,
    "customerNotes" TEXT,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMPTZ(6),
    "issuedById" TEXT,
    "respondedAt" TIMESTAMPTZ(6),
    "respondedById" TEXT,
    "responseNotes" TEXT,
    "rejectionReason" TEXT,
    "customerResponseReference" TEXT,
    "nextFollowUpDate" DATE,
    "followUpNotes" TEXT,
    "expiredAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "convertedOrderId" TEXT,
    "convertedAt" TIMESTAMPTZ(6),
    "convertedById" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "productId" TEXT,
    "sapItemCodeSnapshot" TEXT,
    "sapItemDescriptionSnapshot" TEXT,
    "isUnlistedItem" BOOLEAN NOT NULL DEFAULT false,
    "unlistedItemDescription" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitOfMeasure" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountPercent" DECIMAL(5,2),
    "vatCodeSnapshot" TEXT,
    "vatRatePercentSnapshot" DECIMAL(5,2),
    "lineSubtotal" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationEvent" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "eventType" "QuotationEventType" NOT NULL,
    "actorId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_previousRevisionId_key" ON "Quotation"("previousRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_convertedOrderId_key" ON "Quotation"("convertedOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_quotationNumber_revisionNumber_key" ON "Quotation"("quotationNumber", "revisionNumber");

-- CreateIndex
CREATE INDEX "Quotation_quotationNumber_idx" ON "Quotation"("quotationNumber");

-- CreateIndex
CREATE INDEX "Quotation_rootQuotationId_idx" ON "Quotation"("rootQuotationId");

-- CreateIndex
CREATE INDEX "Quotation_customerId_idx" ON "Quotation"("customerId");

-- CreateIndex
CREATE INDEX "Quotation_status_idx" ON "Quotation"("status");

-- CreateIndex
CREATE INDEX "Quotation_quotationDate_idx" ON "Quotation"("quotationDate");

-- CreateIndex
CREATE INDEX "Quotation_validUntil_idx" ON "Quotation"("validUntil");

-- CreateIndex
CREATE INDEX "Quotation_salespersonId_idx" ON "Quotation"("salespersonId");

-- CreateIndex
CREATE INDEX "Quotation_preparedById_idx" ON "Quotation"("preparedById");

-- CreateIndex
CREATE INDEX "Quotation_supersededAt_idx" ON "Quotation"("supersededAt");

-- CreateIndex
CREATE INDEX "Quotation_nextFollowUpDate_idx" ON "Quotation"("nextFollowUpDate");

-- CreateIndex
CREATE INDEX "Quotation_isDemo_idx" ON "Quotation"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationLine_quotationId_lineNumber_key" ON "QuotationLine"("quotationId", "lineNumber");

-- CreateIndex
CREATE INDEX "QuotationLine_quotationId_idx" ON "QuotationLine"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationLine_productId_idx" ON "QuotationLine"("productId");

-- CreateIndex
CREATE INDEX "QuotationLine_isDemo_idx" ON "QuotationLine"("isDemo");

-- CreateIndex
CREATE INDEX "QuotationEvent_quotationId_idx" ON "QuotationEvent"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationEvent_eventType_idx" ON "QuotationEvent"("eventType");

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "CustomerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_previousRevisionId_fkey" FOREIGN KEY ("previousRevisionId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_convertedOrderId_fkey" FOREIGN KEY ("convertedOrderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationEvent" ADD CONSTRAINT "QuotationEvent_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationEvent" ADD CONSTRAINT "QuotationEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
