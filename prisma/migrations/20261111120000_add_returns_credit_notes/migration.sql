-- Milestone 6B (Returns & Credit Notes).
-- Entirely additive: no column is dropped, no existing column's type or
-- nullability changes, no existing table is dropped or renamed, and no
-- existing enum value is removed. Every new table is brand new; every
-- new foreign key is on these new tables only. The "new relation fields"
-- on User/SapInvoice/InvoiceClaim/InvoiceClaimLine in
-- prisma/schema.prisma are pure Prisma inverse-relation sides with NO
-- new column on those existing tables -- every actual new column lives
-- on the 3 new tables below. InvoiceLineMatchMethod (Milestone 5) is
-- reused as-is for CreditNote.matchMethod; no change to that enum.

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('GOOD_RESALABLE', 'DAMAGED', 'EXPIRED', 'OTHER');

-- CreateEnum
CREATE TYPE "CreditNoteMatchStatus" AS ENUM ('UNMATCHED', 'AUTO_MATCHED', 'MANUALLY_MATCHED', 'CANNOT_LINK');

-- CreateTable
CREATE TABLE "CreditNoteImportBatch" (
    "id" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "importedCreditNoteCount" INTEGER NOT NULL,
    "duplicateRowCount" INTEGER NOT NULL,
    "invalidRowCount" INTEGER NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNoteImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT,
    "sapCreditNoteDocEntry" TEXT,
    "sapCreditNoteDocNum" TEXT NOT NULL,
    "sapInvoiceId" TEXT,
    "claimId" TEXT,
    "matchStatus" "CreditNoteMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchMethod" "InvoiceLineMatchMethod",
    "matchNote" TEXT,
    "matchedById" TEXT,
    "matchedAt" TIMESTAMPTZ(6),
    "creditNoteDate" DATE,
    "currencyCode" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "rawSourceData" JSONB,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimReturn" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "claimLineId" TEXT,
    "creditNoteId" TEXT,
    "returnReference" TEXT NOT NULL,
    "receivedQuantity" DECIMAL(18,4) NOT NULL,
    "condition" "ReturnCondition" NOT NULL,
    "conditionDetail" TEXT,
    "conditionNotes" TEXT,
    "receivedDate" DATE NOT NULL,
    "receivedById" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditNoteImportBatch_uploadedById_idx" ON "CreditNoteImportBatch"("uploadedById");

-- CreateIndex
CREATE INDEX "CreditNoteImportBatch_isDemo_idx" ON "CreditNoteImportBatch"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_sapCreditNoteDocEntry_key" ON "CreditNote"("sapCreditNoteDocEntry");

-- CreateIndex
CREATE INDEX "CreditNote_importBatchId_idx" ON "CreditNote"("importBatchId");

-- CreateIndex
CREATE INDEX "CreditNote_sapInvoiceId_idx" ON "CreditNote"("sapInvoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_claimId_idx" ON "CreditNote"("claimId");

-- CreateIndex
CREATE INDEX "CreditNote_matchStatus_idx" ON "CreditNote"("matchStatus");

-- CreateIndex
CREATE INDEX "CreditNote_isDemo_idx" ON "CreditNote"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimReturn_returnReference_key" ON "ClaimReturn"("returnReference");

-- CreateIndex
CREATE INDEX "ClaimReturn_claimId_idx" ON "ClaimReturn"("claimId");

-- CreateIndex
CREATE INDEX "ClaimReturn_claimLineId_idx" ON "ClaimReturn"("claimLineId");

-- CreateIndex
CREATE INDEX "ClaimReturn_creditNoteId_idx" ON "ClaimReturn"("creditNoteId");

-- CreateIndex
CREATE INDEX "ClaimReturn_isDemo_idx" ON "ClaimReturn"("isDemo");

-- AddForeignKey
ALTER TABLE "CreditNoteImportBatch" ADD CONSTRAINT "CreditNoteImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "CreditNoteImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_sapInvoiceId_fkey" FOREIGN KEY ("sapInvoiceId") REFERENCES "SapInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InvoiceClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_matchedById_fkey" FOREIGN KEY ("matchedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimReturn" ADD CONSTRAINT "ClaimReturn_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InvoiceClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimReturn" ADD CONSTRAINT "ClaimReturn_claimLineId_fkey" FOREIGN KEY ("claimLineId") REFERENCES "InvoiceClaimLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimReturn" ADD CONSTRAINT "ClaimReturn_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimReturn" ADD CONSTRAINT "ClaimReturn_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
