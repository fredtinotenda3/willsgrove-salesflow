-- Milestone 2B (matching, aliases, duplicate detection, human review).
-- Entirely additive: no column is dropped, no existing column's type or
-- nullability changes, no existing table is dropped or renamed. See
-- docs/milestones/PROGRESS.md's Milestone 2B section and CHANGES.md for
-- the full rationale.

-- AlterEnum: new terminal DocumentIntakeStatus value, set by
-- lib/review/confirm-review.ts in the same transaction as OrderDocument.orderId.
ALTER TYPE "DocumentIntakeStatus" ADD VALUE 'CONFIRMED';

-- CreateEnum
CREATE TYPE "ExtractedLineStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "ExtractedLineMatchSource" AS ENUM ('NONE', 'ALIAS', 'FUZZY', 'MANUAL');

-- CreateTable
CREATE TABLE "ExtractedOrderLine" (
    "id" TEXT NOT NULL,
    "extractionRunId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "originalDescription" TEXT NOT NULL,
    "extractedQuantity" DECIMAL(18,4),
    "extractedUnit" TEXT,
    "customerProvidedUnitPrice" DECIMAL(18,4),
    "extractionConfidence" DOUBLE PRECISION,
    "extractionWarnings" JSONB,
    "matchedProductId" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "matchSource" "ExtractedLineMatchSource" NOT NULL DEFAULT 'NONE',
    "matchCandidates" JSONB,
    "status" "ExtractedLineStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewNotes" TEXT,
    "resultingOrderLineId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ExtractedOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAlias" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "rawText" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "timesConfirmed" INTEGER NOT NULL DEFAULT 1,
    "lastConfirmedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAlias" (
    "id" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "timesConfirmed" INTEGER NOT NULL DEFAULT 1,
    "lastConfirmedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CustomerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedOrderLine_extractionRunId_lineNumber_key" ON "ExtractedOrderLine"("extractionRunId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedOrderLine_resultingOrderLineId_key" ON "ExtractedOrderLine"("resultingOrderLineId");

-- CreateIndex
CREATE INDEX "ExtractedOrderLine_extractionRunId_idx" ON "ExtractedOrderLine"("extractionRunId");

-- CreateIndex
CREATE INDEX "ExtractedOrderLine_matchedProductId_idx" ON "ExtractedOrderLine"("matchedProductId");

-- CreateIndex
CREATE INDEX "ExtractedOrderLine_status_idx" ON "ExtractedOrderLine"("status");

-- CreateIndex
CREATE INDEX "ExtractedOrderLine_isDemo_idx" ON "ExtractedOrderLine"("isDemo");

-- CreateIndex
-- Plain (non-unique) index for query planning/documentation -- see this
-- table's schema.prisma comment for why the two PARTIAL unique indexes
-- below, not this one, are what actually enforce uniqueness.
CREATE INDEX "ProductAlias_customerId_normalizedText_idx" ON "ProductAlias"("customerId", "normalizedText");

-- CreateIndex
CREATE INDEX "ProductAlias_normalizedText_idx" ON "ProductAlias"("normalizedText");

-- CreateIndex
CREATE INDEX "ProductAlias_productId_idx" ON "ProductAlias"("productId");

-- CreateIndex
CREATE INDEX "ProductAlias_isDemo_idx" ON "ProductAlias"("isDemo");

-- CreateIndex (partial, hand-added: NOT expressible in schema.prisma's DSL)
-- One global alias (customerId IS NULL) per normalized text.
CREATE UNIQUE INDEX "ProductAlias_global_normalizedText_key" ON "ProductAlias"("normalizedText") WHERE "customerId" IS NULL;

-- CreateIndex (partial, hand-added: NOT expressible in schema.prisma's DSL)
-- One per-customer alias per (customerId, normalized text); coexists
-- independently with a global alias of the same text -- the customer-
-- specific row always wins at lookup time (lib/matching/aliases.ts).
CREATE UNIQUE INDEX "ProductAlias_customer_normalizedText_key" ON "ProductAlias"("customerId", "normalizedText") WHERE "customerId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAlias_normalizedText_key" ON "CustomerAlias"("normalizedText");

-- CreateIndex
CREATE INDEX "CustomerAlias_customerId_idx" ON "CustomerAlias"("customerId");

-- CreateIndex
CREATE INDEX "CustomerAlias_isDemo_idx" ON "CustomerAlias"("isDemo");

-- AddForeignKey
ALTER TABLE "ExtractedOrderLine" ADD CONSTRAINT "ExtractedOrderLine_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "ExtractionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedOrderLine" ADD CONSTRAINT "ExtractedOrderLine_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedOrderLine" ADD CONSTRAINT "ExtractedOrderLine_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedOrderLine" ADD CONSTRAINT "ExtractedOrderLine_resultingOrderLineId_fkey" FOREIGN KEY ("resultingOrderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAlias" ADD CONSTRAINT "CustomerAlias_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAlias" ADD CONSTRAINT "CustomerAlias_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
