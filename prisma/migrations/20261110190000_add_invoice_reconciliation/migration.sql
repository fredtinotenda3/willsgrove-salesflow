-- Milestone 5 (SAP Invoice Reconciliation).
-- Entirely additive: no column is dropped, no existing column's type or
-- nullability changes, no existing table is dropped or renamed, and no
-- existing enum value is removed. Every new table is brand new; every
-- new foreign key is on these new tables only. The "new relation fields"
-- on User/Customer/CustomerOrder/OrderLine in prisma/schema.prisma are
-- pure Prisma inverse-relation sides with NO new column on those existing
-- tables -- every actual new column lives on the 3 new tables below.

-- CreateEnum
CREATE TYPE "InvoiceLineMatchStatus" AS ENUM ('UNMATCHED', 'AUTO_MATCHED', 'MANUALLY_MATCHED', 'CANNOT_LINK');

-- CreateEnum
CREATE TYPE "InvoiceLineMatchMethod" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "InvoiceReconciliationStatus" AS ENUM ('UNMATCHED', 'PARTIALLY_MATCHED', 'RECONCILIATION_REQUIRED', 'MATCHED', 'CANCELLED_REVERSED');

-- CreateTable
CREATE TABLE "SapInvoiceImportBatch" (
    "id" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "importedInvoiceCount" INTEGER NOT NULL,
    "importedLineCount" INTEGER NOT NULL,
    "duplicateRowCount" INTEGER NOT NULL,
    "invalidRowCount" INTEGER NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SapInvoiceImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SapInvoice" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "sapDocEntry" TEXT,
    "sapDocNum" TEXT NOT NULL,
    "customerSapCode" TEXT,
    "customerName" TEXT,
    "matchedCustomerId" TEXT,
    "invoiceDate" DATE,
    "currencyCode" TEXT,
    "documentStatusRaw" TEXT,
    "isCancelledOrReversed" BOOLEAN NOT NULL DEFAULT false,
    "sapOrderReference" TEXT,
    "matchedOrderId" TEXT,
    "subtotal" DECIMAL(18,4),
    "taxTotal" DECIMAL(18,4),
    "total" DECIMAL(18,4),
    "reconciliationStatus" "InvoiceReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
    "reconciliationNotes" TEXT,
    "rawSourceData" JSONB NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SapInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SapInvoiceLine" (
    "id" TEXT NOT NULL,
    "sapInvoiceId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "sapItemCode" TEXT,
    "sapItemDescription" TEXT,
    "quantityInvoiced" DECIMAL(18,4) NOT NULL,
    "unitOfMeasure" TEXT,
    "unitPrice" DECIMAL(18,4),
    "discount" DECIMAL(18,4),
    "taxCode" TEXT,
    "lineTotal" DECIMAL(18,4),
    "sapDocLineNum" TEXT,
    "rawSourceData" JSONB NOT NULL,
    "matchedOrderId" TEXT,
    "matchedOrderLineId" TEXT,
    "matchStatus" "InvoiceLineMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchMethod" "InvoiceLineMatchMethod",
    "matchNote" TEXT,
    "matchedById" TEXT,
    "matchedAt" TIMESTAMPTZ(6),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SapInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SapInvoice_sapDocEntry_key" ON "SapInvoice"("sapDocEntry");

-- CreateIndex
CREATE INDEX "SapInvoiceImportBatch_uploadedById_idx" ON "SapInvoiceImportBatch"("uploadedById");

-- CreateIndex
CREATE INDEX "SapInvoiceImportBatch_isDemo_idx" ON "SapInvoiceImportBatch"("isDemo");

-- CreateIndex
CREATE INDEX "SapInvoice_importBatchId_idx" ON "SapInvoice"("importBatchId");

-- CreateIndex
CREATE INDEX "SapInvoice_matchedCustomerId_idx" ON "SapInvoice"("matchedCustomerId");

-- CreateIndex
CREATE INDEX "SapInvoice_matchedOrderId_idx" ON "SapInvoice"("matchedOrderId");

-- CreateIndex
CREATE INDEX "SapInvoice_reconciliationStatus_idx" ON "SapInvoice"("reconciliationStatus");

-- CreateIndex
CREATE INDEX "SapInvoice_sapDocNum_idx" ON "SapInvoice"("sapDocNum");

-- CreateIndex
CREATE INDEX "SapInvoice_isDemo_idx" ON "SapInvoice"("isDemo");

-- CreateIndex
CREATE INDEX "SapInvoiceLine_sapInvoiceId_idx" ON "SapInvoiceLine"("sapInvoiceId");

-- CreateIndex
CREATE INDEX "SapInvoiceLine_matchedOrderId_idx" ON "SapInvoiceLine"("matchedOrderId");

-- CreateIndex
CREATE INDEX "SapInvoiceLine_matchedOrderLineId_idx" ON "SapInvoiceLine"("matchedOrderLineId");

-- CreateIndex
CREATE INDEX "SapInvoiceLine_matchStatus_idx" ON "SapInvoiceLine"("matchStatus");

-- CreateIndex
CREATE INDEX "SapInvoiceLine_sapItemCode_idx" ON "SapInvoiceLine"("sapItemCode");

-- CreateIndex
CREATE INDEX "SapInvoiceLine_isDemo_idx" ON "SapInvoiceLine"("isDemo");

-- AddForeignKey
ALTER TABLE "SapInvoiceImportBatch" ADD CONSTRAINT "SapInvoiceImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SapInvoice" ADD CONSTRAINT "SapInvoice_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "SapInvoiceImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SapInvoice" ADD CONSTRAINT "SapInvoice_matchedCustomerId_fkey" FOREIGN KEY ("matchedCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SapInvoice" ADD CONSTRAINT "SapInvoice_matchedOrderId_fkey" FOREIGN KEY ("matchedOrderId") REFERENCES "CustomerOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SapInvoiceLine" ADD CONSTRAINT "SapInvoiceLine_sapInvoiceId_fkey" FOREIGN KEY ("sapInvoiceId") REFERENCES "SapInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SapInvoiceLine" ADD CONSTRAINT "SapInvoiceLine_matchedOrderId_fkey" FOREIGN KEY ("matchedOrderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SapInvoiceLine" ADD CONSTRAINT "SapInvoiceLine_matchedOrderLineId_fkey" FOREIGN KEY ("matchedOrderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SapInvoiceLine" ADD CONSTRAINT "SapInvoiceLine_matchedById_fkey" FOREIGN KEY ("matchedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
