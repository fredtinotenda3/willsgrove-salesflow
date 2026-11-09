-- Milestone 2C (handover, multi-store split, repeat orders).
-- Entirely additive: no column is dropped, no existing column's type or
-- nullability changes, no existing table is dropped or renamed. See
-- docs/milestones/PROGRESS.md's Milestone 2C section and CHANGES.md for
-- the full rationale. Multi-store splitting and repeat orders need no
-- schema change at all (see PROGRESS.md) -- this migration is entirely
-- for OrderHandover.

-- CreateEnum
CREATE TYPE "HandoverFormat" AS ENUM ('EXCEL', 'CSV', 'CLIPBOARD');

-- CreateTable
CREATE TABLE "OrderHandover" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "format" "HandoverFormat" NOT NULL,
    "generatedById" TEXT NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "matchedLineCount" INTEGER NOT NULL,
    "unmatchedLineCount" INTEGER NOT NULL,
    "storageKey" TEXT,
    "originalFileName" TEXT,
    "mimeType" TEXT,
    "fileSize" BIGINT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderHandover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderHandover_orderId_idx" ON "OrderHandover"("orderId");

-- CreateIndex
CREATE INDEX "OrderHandover_isDemo_idx" ON "OrderHandover"("isDemo");

-- AddForeignKey
ALTER TABLE "OrderHandover" ADD CONSTRAINT "OrderHandover_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderHandover" ADD CONSTRAINT "OrderHandover_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
