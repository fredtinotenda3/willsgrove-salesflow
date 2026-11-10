-- Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
-- Entirely additive: no column is dropped, no existing column's type or
-- nullability changes, no existing table is dropped or renamed. New
-- OrderStatus values are appended to the enum (Postgres preserves existing
-- rows/values unchanged); the two new OrderHandover columns are nullable,
-- so every existing handover row remains valid with no backfill needed.
-- See docs/milestones/PROGRESS.md's Milestone 3A section, CHANGES.md, and
-- docs/milestones/ROADMAP.md for the full rationale.

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'PICKING';
ALTER TYPE "OrderStatus" ADD VALUE 'READY_TO_INVOICE';

-- CreateEnum
CREATE TYPE "PickingSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'AUTHORIZED');

-- CreateTable
CREATE TABLE "PickingSession" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "PickingSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedById" TEXT,
    "completedAt" TIMESTAMPTZ(6),
    "authorizedById" TEXT,
    "authorizedAt" TIMESTAMPTZ(6),
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PickingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickingLine" (
    "id" TEXT NOT NULL,
    "pickingSessionId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "requestedQuantity" DECIMAL(18,4) NOT NULL,
    "foundQuantity" DECIMAL(18,4),
    "unavailableQuantity" DECIMAL(18,4),
    "notes" TEXT,
    "pickedById" TEXT,
    "pickedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PickingLine_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "OrderHandover" ADD COLUMN "pickingSessionId" TEXT,
                             ADD COLUMN "reference" TEXT;

-- CreateIndex
CREATE INDEX "PickingSession_orderId_idx" ON "PickingSession"("orderId");

-- CreateIndex
CREATE INDEX "PickingSession_status_idx" ON "PickingSession"("status");

-- CreateIndex
CREATE INDEX "PickingSession_isDemo_idx" ON "PickingSession"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "PickingLine_pickingSessionId_orderLineId_key" ON "PickingLine"("pickingSessionId", "orderLineId");

-- CreateIndex
CREATE INDEX "PickingLine_orderLineId_idx" ON "PickingLine"("orderLineId");

-- CreateIndex
CREATE INDEX "OrderHandover_pickingSessionId_idx" ON "OrderHandover"("pickingSessionId");

-- AddForeignKey
ALTER TABLE "PickingSession" ADD CONSTRAINT "PickingSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickingSession" ADD CONSTRAINT "PickingSession_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickingSession" ADD CONSTRAINT "PickingSession_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickingSession" ADD CONSTRAINT "PickingSession_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickingLine" ADD CONSTRAINT "PickingLine_pickingSessionId_fkey" FOREIGN KEY ("pickingSessionId") REFERENCES "PickingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickingLine" ADD CONSTRAINT "PickingLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickingLine" ADD CONSTRAINT "PickingLine_pickedById_fkey" FOREIGN KEY ("pickedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderHandover" ADD CONSTRAINT "OrderHandover_pickingSessionId_fkey" FOREIGN KEY ("pickingSessionId") REFERENCES "PickingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
