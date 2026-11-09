-- Milestone 2A (PO intake + extraction). Entirely additive: no column is
-- dropped, no existing column's type or nullability changes, no table is
-- dropped, and the two existing enum values (OrderSource.EMAIL/WHATSAPP)
-- plus OrderDocument's previous columns are untouched -- every row written
-- before this migration reads back exactly as it did before. See
-- docs/milestones/PROGRESS.md's Milestone 2A section and CHANGES.md for
-- the full rationale, including why OrderDocument/OrderSource were
-- extended rather than a new PurchaseOrderDocument model introduced.

-- AlterEnum: new OrderSource values for upload-based intake channels.
-- Postgres requires each added value in its own ALTER TYPE statement.
ALTER TYPE "OrderSource" ADD VALUE 'PDF';
ALTER TYPE "OrderSource" ADD VALUE 'IMAGE';
ALTER TYPE "OrderSource" ADD VALUE 'EXCEL';
ALTER TYPE "OrderSource" ADD VALUE 'CSV';

-- CreateEnum
CREATE TYPE "DocumentClassification" AS ENUM ('CUSTOMER_PO', 'HANDWRITTEN_LIST', 'CHAT_SCREENSHOT', 'ORDER_SHEET', 'PRICE_LIST', 'DELIVERY_NOTE', 'UNRELATED');

-- CreateEnum
CREATE TYPE "DocumentIntakeStatus" AS ENUM ('RECEIVED', 'CLASSIFIED', 'EXTRACTING', 'EXTRACTED', 'EXTRACTION_FAILED');

-- CreateEnum
CREATE TYPE "ExtractionProvider" AS ENUM ('ANTHROPIC', 'MOCK', 'DETERMINISTIC');

-- CreateEnum
CREATE TYPE "ExtractionRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "OrderDocument" ADD COLUMN     "sourceChannel" "OrderSource",
ADD COLUMN     "classification" "DocumentClassification",
ADD COLUMN     "status" "DocumentIntakeStatus" NOT NULL DEFAULT 'RECEIVED',
ADD COLUMN     "documentGroupId" TEXT,
ADD COLUMN     "pageNumber" INTEGER;

-- CreateTable
CREATE TABLE "ExtractionRun" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "provider" "ExtractionProvider" NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "status" "ExtractionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "extractedHeader" JSONB,
    "extractedLines" JSONB,
    "rawResponse" JSONB,
    "errorMessage" TEXT,
    "processingTimeMs" INTEGER,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderDocument_documentGroupId_idx" ON "OrderDocument"("documentGroupId");

-- CreateIndex
CREATE INDEX "OrderDocument_status_idx" ON "OrderDocument"("status");

-- CreateIndex
CREATE INDEX "ExtractionRun_documentId_idx" ON "ExtractionRun"("documentId");

-- CreateIndex
CREATE INDEX "ExtractionRun_status_idx" ON "ExtractionRun"("status");

-- CreateIndex
CREATE INDEX "ExtractionRun_isDemo_idx" ON "ExtractionRun"("isDemo");

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "OrderDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
