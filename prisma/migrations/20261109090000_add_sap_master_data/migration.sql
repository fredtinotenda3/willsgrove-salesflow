-- Milestone 1 (Master data from SAP). Entirely additive: no column is
-- dropped, no existing column's type or nullability changes, no table is
-- dropped. See docs/milestones/PROGRESS.md's Milestone 1 section and
-- CHANGES.md for the full rationale.

-- CreateTable
CREATE TABLE "TaxCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TaxCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListEntry" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "productId" TEXT,
    "sapItemCodeSnapshot" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "validFrom" TIMESTAMPTZ(6) NOT NULL,
    "validTo" TIMESTAMPTZ(6),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerContact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "unitOfMeasure" TEXT,
ADD COLUMN     "packSize" TEXT,
ADD COLUMN     "isVariableWeight" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vatCode" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "tin" TEXT,
ADD COLUMN     "vatNumber" TEXT,
ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "paymentTermsCode" TEXT,
ADD COLUMN     "branchCode" TEXT,
ADD COLUMN     "storeCode" TEXT,
ADD COLUMN     "creditLimit" DECIMAL(18,2),
ADD COLUMN     "creditHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priceListId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TaxCode_code_key" ON "TaxCode"("code");

-- CreateIndex
CREATE INDEX "TaxCode_isDemo_idx" ON "TaxCode"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_code_key" ON "PriceList"("code");

-- CreateIndex
CREATE INDEX "PriceList_isDemo_idx" ON "PriceList"("isDemo");

-- CreateIndex
CREATE INDEX "PriceListEntry_priceListId_sapItemCodeSnapshot_idx" ON "PriceListEntry"("priceListId", "sapItemCodeSnapshot");

-- CreateIndex
CREATE INDEX "PriceListEntry_validFrom_validTo_idx" ON "PriceListEntry"("validFrom", "validTo");

-- CreateIndex
CREATE INDEX "PriceListEntry_isDemo_idx" ON "PriceListEntry"("isDemo");

-- CreateIndex
CREATE INDEX "CustomerContact_customerId_idx" ON "CustomerContact"("customerId");

-- CreateIndex
CREATE INDEX "CustomerContact_isDemo_idx" ON "CustomerContact"("isDemo");

-- CreateIndex
CREATE INDEX "Product_vatCode_idx" ON "Product"("vatCode");

-- CreateIndex
CREATE INDEX "Customer_priceListId_idx" ON "Customer"("priceListId");

-- CreateIndex
CREATE INDEX "Customer_storeCode_idx" ON "Customer"("storeCode");

-- AddForeignKey
ALTER TABLE "PriceListEntry" ADD CONSTRAINT "PriceListEntry_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListEntry" ADD CONSTRAINT "PriceListEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
