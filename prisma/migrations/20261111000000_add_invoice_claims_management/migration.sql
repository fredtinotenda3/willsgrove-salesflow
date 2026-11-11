-- Milestone 6A (Invoice Claims Management).
-- Entirely additive: no column is dropped, no existing column's type or
-- nullability changes, no existing table is dropped or renamed, and no
-- existing enum value is removed. Every new table is brand new; every
-- new foreign key is on these new tables only. The "new relation fields"
-- on User/Customer/CustomerOrder/SapInvoice/SapInvoiceLine in
-- prisma/schema.prisma are pure Prisma inverse-relation sides with NO
-- new column on those existing tables -- every actual new column lives
-- on the 4 new tables below.

-- CreateEnum
CREATE TYPE "InvoiceClaimCategory" AS ENUM ('QUALITY_ISSUE', 'DAMAGED_PRODUCTS', 'SPOILAGE', 'SHORT_DELIVERY', 'MISSING_PRODUCTS', 'WRONG_PRODUCT_SUPPLIED', 'QUANTITY_DISCREPANCY', 'PRICING_DISPUTE', 'INCORRECT_INVOICE', 'CUSTOMER_REJECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceClaimPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "InvoiceClaimStatus" AS ENUM ('OPEN', 'UNDER_INVESTIGATION', 'AWAITING_CUSTOMER', 'AWAITING_INTERNAL_ACTION', 'APPROVED', 'PARTIALLY_RESOLVED', 'RESOLVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ClaimLineDisputeType" AS ENUM ('QUANTITY', 'AMOUNT_ONLY');

-- CreateEnum
CREATE TYPE "ClaimResolutionDecision" AS ENUM ('NO_ACTION_REQUIRED', 'CLAIM_REJECTED', 'REPLACEMENT_APPROVED', 'PHYSICAL_RETURN_REQUIRED', 'PARTIAL_CREDIT_RECOMMENDED', 'FULL_CREDIT_RECOMMENDED', 'PRICING_CORRECTION_REQUIRED', 'DELIVERY_INVESTIGATION_REQUIRED', 'OTHER');

-- CreateTable
CREATE TABLE "InvoiceClaim" (
    "id" TEXT NOT NULL,
    "claimReference" TEXT NOT NULL,
    "sapInvoiceId" TEXT NOT NULL,
    "orderId" TEXT,
    "customerId" TEXT NOT NULL,
    "customerComplaintReference" TEXT,
    "category" "InvoiceClaimCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "priority" "InvoiceClaimPriority" NOT NULL DEFAULT 'MEDIUM',
    "claimDate" DATE NOT NULL,
    "status" "InvoiceClaimStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),
    "customerCommunicationNotes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InvoiceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceClaimLine" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "sapInvoiceLineId" TEXT NOT NULL,
    "sapItemCodeSnapshot" TEXT,
    "sapItemDescriptionSnapshot" TEXT,
    "disputeType" "ClaimLineDisputeType" NOT NULL,
    "acceptedQuantity" DECIMAL(18,4),
    "rejectedQuantity" DECIMAL(18,4),
    "disputedAmount" DECIMAL(18,4),
    "disputedUnitPrice" DECIMAL(18,4),
    "reason" TEXT NOT NULL,
    "evidenceNotes" TEXT,
    "investigationOutcome" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InvoiceClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimResolution" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "findings" TEXT,
    "responsibleDepartment" TEXT,
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "customerResponse" TEXT,
    "decision" "ClaimResolutionDecision" NOT NULL,
    "decisionDetail" TEXT,
    "resolutionDate" DATE,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMPTZ(6),
    "approvedCreditAmount" DECIMAL(18,4),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMPTZ(6),
    "rejectionReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ClaimResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceClaimAttachment" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "claimLineId" TEXT,
    "originalFileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "checksum" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InvoiceClaimAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceClaim_claimReference_key" ON "InvoiceClaim"("claimReference");

-- CreateIndex
CREATE INDEX "InvoiceClaim_sapInvoiceId_idx" ON "InvoiceClaim"("sapInvoiceId");

-- CreateIndex
CREATE INDEX "InvoiceClaim_orderId_idx" ON "InvoiceClaim"("orderId");

-- CreateIndex
CREATE INDEX "InvoiceClaim_customerId_idx" ON "InvoiceClaim"("customerId");

-- CreateIndex
CREATE INDEX "InvoiceClaim_status_idx" ON "InvoiceClaim"("status");

-- CreateIndex
CREATE INDEX "InvoiceClaim_category_idx" ON "InvoiceClaim"("category");

-- CreateIndex
CREATE INDEX "InvoiceClaim_reportedById_idx" ON "InvoiceClaim"("reportedById");

-- CreateIndex
CREATE INDEX "InvoiceClaim_assignedToId_idx" ON "InvoiceClaim"("assignedToId");

-- CreateIndex
CREATE INDEX "InvoiceClaim_claimDate_idx" ON "InvoiceClaim"("claimDate");

-- CreateIndex
CREATE INDEX "InvoiceClaim_isDemo_idx" ON "InvoiceClaim"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceClaimLine_claimId_sapInvoiceLineId_key" ON "InvoiceClaimLine"("claimId", "sapInvoiceLineId");

-- CreateIndex
CREATE INDEX "InvoiceClaimLine_claimId_idx" ON "InvoiceClaimLine"("claimId");

-- CreateIndex
CREATE INDEX "InvoiceClaimLine_sapInvoiceLineId_idx" ON "InvoiceClaimLine"("sapInvoiceLineId");

-- CreateIndex
CREATE INDEX "InvoiceClaimLine_isDemo_idx" ON "InvoiceClaimLine"("isDemo");

-- CreateIndex
CREATE INDEX "ClaimResolution_claimId_idx" ON "ClaimResolution"("claimId");

-- CreateIndex
CREATE INDEX "ClaimResolution_decision_idx" ON "ClaimResolution"("decision");

-- CreateIndex
CREATE INDEX "ClaimResolution_isDemo_idx" ON "ClaimResolution"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceClaimAttachment_storageKey_key" ON "InvoiceClaimAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "InvoiceClaimAttachment_claimId_idx" ON "InvoiceClaimAttachment"("claimId");

-- CreateIndex
CREATE INDEX "InvoiceClaimAttachment_claimLineId_idx" ON "InvoiceClaimAttachment"("claimLineId");

-- CreateIndex
CREATE INDEX "InvoiceClaimAttachment_isDemo_idx" ON "InvoiceClaimAttachment"("isDemo");

-- AddForeignKey
ALTER TABLE "InvoiceClaim" ADD CONSTRAINT "InvoiceClaim_sapInvoiceId_fkey" FOREIGN KEY ("sapInvoiceId") REFERENCES "SapInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceClaim" ADD CONSTRAINT "InvoiceClaim_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceClaim" ADD CONSTRAINT "InvoiceClaim_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceClaim" ADD CONSTRAINT "InvoiceClaim_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceClaim" ADD CONSTRAINT "InvoiceClaim_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceClaimLine" ADD CONSTRAINT "InvoiceClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InvoiceClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceClaimLine" ADD CONSTRAINT "InvoiceClaimLine_sapInvoiceLineId_fkey" FOREIGN KEY ("sapInvoiceLineId") REFERENCES "SapInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimResolution" ADD CONSTRAINT "ClaimResolution_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InvoiceClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimResolution" ADD CONSTRAINT "ClaimResolution_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimResolution" ADD CONSTRAINT "ClaimResolution_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimResolution" ADD CONSTRAINT "ClaimResolution_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceClaimAttachment" ADD CONSTRAINT "InvoiceClaimAttachment_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InvoiceClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceClaimAttachment" ADD CONSTRAINT "InvoiceClaimAttachment_claimLineId_fkey" FOREIGN KEY ("claimLineId") REFERENCES "InvoiceClaimLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceClaimAttachment" ADD CONSTRAINT "InvoiceClaimAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
