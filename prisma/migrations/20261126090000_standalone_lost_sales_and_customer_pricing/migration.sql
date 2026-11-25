-- Standalone lost-sales correction + customer-specific pricing.
--
-- ADDITIVE and BACKWARDS-COMPATIBLE: only nullable columns, new tables, new
-- indexes and a new enum. No existing row is modified, no column is dropped or
-- retyped, no table is rewritten. Safe to run on the live Neon database.
--
-- ROLLBACK (only if nothing has been written to the new structures yet, or you
-- accept losing that data -- historical claims/orders are unaffected either way):
--   DROP TABLE "CustomerProductPriceHistory";
--   DROP TABLE "CustomerProductPrice";
--   DROP TYPE  "CustomerPriceChangeType";
--   ALTER TABLE "InvoiceClaimLine" DROP CONSTRAINT "InvoiceClaimLine_deliveryLineId_fkey";
--   DROP INDEX "InvoiceClaimLine_deliveryLineId_key";
--   ALTER TABLE "InvoiceClaimLine" DROP COLUMN "deliveryLineId";
--   ALTER TABLE "InvoiceClaim" DROP CONSTRAINT "InvoiceClaim_deliveryRecordId_fkey";
--   DROP INDEX "InvoiceClaim_deliveryRecordId_key";
--   ALTER TABLE "InvoiceClaim" DROP COLUMN "deliveryRecordId";

-- CreateEnum
CREATE TYPE "CustomerPriceChangeType" AS ENUM ('CREATED', 'UPDATED', 'REMOVED');

-- AlterTable
ALTER TABLE "InvoiceClaim" ADD COLUMN "deliveryRecordId" TEXT;

-- AlterTable
ALTER TABLE "InvoiceClaimLine" ADD COLUMN "deliveryLineId" TEXT;

-- CreateTable
CREATE TABLE "CustomerProductPrice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CustomerProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerProductPriceHistory" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sapItemCodeSnapshot" TEXT,
    "currencyCode" TEXT NOT NULL,
    "changeType" "CustomerPriceChangeType" NOT NULL,
    "oldUnitPrice" DECIMAL(18,4),
    "newUnitPrice" DECIMAL(18,4),
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerProductPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceClaim_deliveryRecordId_key" ON "InvoiceClaim"("deliveryRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceClaimLine_deliveryLineId_key" ON "InvoiceClaimLine"("deliveryLineId");

-- CreateIndex
CREATE INDEX "CustomerProductPrice_productId_idx" ON "CustomerProductPrice"("productId");

-- CreateIndex
CREATE INDEX "CustomerProductPrice_customerId_updatedAt_idx" ON "CustomerProductPrice"("customerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProductPrice_customerId_productId_key" ON "CustomerProductPrice"("customerId", "productId");

-- CreateIndex
CREATE INDEX "CustomerProductPriceHistory_customerId_productId_createdAt_idx" ON "CustomerProductPriceHistory"("customerId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerProductPriceHistory_customerId_createdAt_idx" ON "CustomerProductPriceHistory"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerProductPriceHistory_createdAt_idx" ON "CustomerProductPriceHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "InvoiceClaim" ADD CONSTRAINT "InvoiceClaim_deliveryRecordId_fkey" FOREIGN KEY ("deliveryRecordId") REFERENCES "DeliveryRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceClaimLine" ADD CONSTRAINT "InvoiceClaimLine_deliveryLineId_fkey" FOREIGN KEY ("deliveryLineId") REFERENCES "DeliveryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProductPrice" ADD CONSTRAINT "CustomerProductPrice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProductPrice" ADD CONSTRAINT "CustomerProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
