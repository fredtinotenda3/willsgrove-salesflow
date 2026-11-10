-- Milestone 4 (Lost-Sales Management).
-- Entirely additive: no column is dropped, no existing column's type or
-- nullability changes, no existing table is dropped or renamed, and no
-- existing enum value is removed. Every new table is brand new; every
-- new foreign key is on these new tables only, plus two new nullable
-- relation columns referenced from User/Customer/Product/CustomerOrder/
-- OrderLine/PickingSession/PickingLine are pure Prisma-relation inverse
-- sides with NO new column on any of those existing tables (every one of
-- those "additions" in schema.prisma is a `[]` or `?` relation field with
-- no @relation(fields: ...) of its own on that side -- the foreign key
-- lives entirely on the new UnfulfilledDemand/CustomerDecisionEvent/
-- LostSaleRecord tables below). Every existing row in every existing
-- table remains valid with no backfill needed.
-- See docs/milestones/PROGRESS.md's "Milestone 4" section, CHANGES.md,
-- and docs/milestones/ROADMAP.md for the full rationale.

-- CreateEnum
CREATE TYPE "CustomerDecisionType" AS ENUM ('ACCEPT_PARTIAL_CANCEL_REMAINDER', 'AWAIT_REMAINING_QUANTITY', 'SCHEDULE_LATER_SUPPLY', 'SUBSTITUTE_ACCEPTED', 'PARTIAL_CANCELLATION', 'ENTIRE_LINE_CANCELLED', 'ENTIRE_ORDER_CANCELLED');

-- CreateEnum
CREATE TYPE "DecisionSource" AS ENUM ('CUSTOMER_PHONE_CALL', 'CUSTOMER_EMAIL', 'CUSTOMER_WRITTEN_COMMUNICATION', 'CUSTOMER_IN_PERSON', 'CUSTOMER_PORTAL_OR_SYSTEM', 'SALESPERSON_JUDGEMENT_UNCONFIRMED', 'OTHER');

-- CreateEnum
CREATE TYPE "UnfulfilledDemandStatus" AS ENUM ('PENDING_DECISION', 'AWAITING_SUPPLY', 'PARTIALLY_CANCELLED', 'FULLY_CANCELLED', 'CONFIRMED_LOST', 'RESOLVED');

-- CreateEnum
CREATE TYPE "LostSaleReason" AS ENUM ('PRODUCT_UNAVAILABLE', 'INSUFFICIENT_QUANTITY', 'CUSTOMER_CANCELLED', 'CUSTOMER_SOURCED_ELSEWHERE', 'DELIVERY_OR_TIMING_ISSUE', 'QUALITY_RELATED_ISSUE', 'SUBSTITUTE_REJECTED', 'OTHER');

-- CreateEnum
CREATE TYPE "LostSaleValueSource" AS ENUM ('ORDER_LINE_APPROVED_PRICE', 'PRICE_LIST_ENTRY');

-- CreateTable
CREATE TABLE "UnfulfilledDemand" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "pickingSessionId" TEXT NOT NULL,
    "pickingLineId" TEXT NOT NULL,
    "productId" TEXT,
    "sapItemCodeSnapshot" TEXT,
    "productDescriptionSnapshot" TEXT NOT NULL,
    "requestedQuantity" DECIMAL(18,4) NOT NULL,
    "foundQuantity" DECIMAL(18,4) NOT NULL,
    "unavailableQuantity" DECIMAL(18,4) NOT NULL,
    "outstandingQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cancelledQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "substitutedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "confirmedLostQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "UnfulfilledDemandStatus" NOT NULL DEFAULT 'PENDING_DECISION',
    "expectedFollowUpDate" DATE,
    "followUpRemarks" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "UnfulfilledDemand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerDecisionEvent" (
    "id" TEXT NOT NULL,
    "unfulfilledDemandId" TEXT NOT NULL,
    "decisionType" "CustomerDecisionType" NOT NULL,
    "source" "DecisionSource" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "substituteProductId" TEXT,
    "substituteSapItemCodeSnapshot" TEXT,
    "substituteProductDescriptionSnapshot" TEXT,
    "customerContactName" TEXT,
    "reason" TEXT,
    "remarks" TEXT,
    "attachmentReference" TEXT,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerDecisionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LostSaleRecord" (
    "id" TEXT NOT NULL,
    "unfulfilledDemandId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "reason" "LostSaleReason" NOT NULL,
    "reasonDetail" TEXT,
    "decisionSource" "DecisionSource" NOT NULL,
    "estimatedUnitPrice" DECIMAL(18,4),
    "estimatedValue" DECIMAL(18,4),
    "estimatedValueSource" "LostSaleValueSource",
    "remarks" TEXT,
    "confirmedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LostSaleRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnfulfilledDemand_pickingLineId_key" ON "UnfulfilledDemand"("pickingLineId");

-- CreateIndex
CREATE INDEX "UnfulfilledDemand_orderId_idx" ON "UnfulfilledDemand"("orderId");

-- CreateIndex
CREATE INDEX "UnfulfilledDemand_customerId_idx" ON "UnfulfilledDemand"("customerId");

-- CreateIndex
CREATE INDEX "UnfulfilledDemand_productId_idx" ON "UnfulfilledDemand"("productId");

-- CreateIndex
CREATE INDEX "UnfulfilledDemand_status_idx" ON "UnfulfilledDemand"("status");

-- CreateIndex
CREATE INDEX "UnfulfilledDemand_isDemo_idx" ON "UnfulfilledDemand"("isDemo");

-- CreateIndex
CREATE INDEX "CustomerDecisionEvent_unfulfilledDemandId_idx" ON "CustomerDecisionEvent"("unfulfilledDemandId");

-- CreateIndex
CREATE INDEX "CustomerDecisionEvent_decisionType_idx" ON "CustomerDecisionEvent"("decisionType");

-- CreateIndex
CREATE INDEX "CustomerDecisionEvent_recordedById_idx" ON "CustomerDecisionEvent"("recordedById");

-- CreateIndex
CREATE INDEX "LostSaleRecord_unfulfilledDemandId_idx" ON "LostSaleRecord"("unfulfilledDemandId");

-- CreateIndex
CREATE INDEX "LostSaleRecord_reason_idx" ON "LostSaleRecord"("reason");

-- CreateIndex
CREATE INDEX "LostSaleRecord_confirmedById_idx" ON "LostSaleRecord"("confirmedById");

-- AddForeignKey
ALTER TABLE "UnfulfilledDemand" ADD CONSTRAINT "UnfulfilledDemand_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnfulfilledDemand" ADD CONSTRAINT "UnfulfilledDemand_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnfulfilledDemand" ADD CONSTRAINT "UnfulfilledDemand_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnfulfilledDemand" ADD CONSTRAINT "UnfulfilledDemand_pickingSessionId_fkey" FOREIGN KEY ("pickingSessionId") REFERENCES "PickingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnfulfilledDemand" ADD CONSTRAINT "UnfulfilledDemand_pickingLineId_fkey" FOREIGN KEY ("pickingLineId") REFERENCES "PickingLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnfulfilledDemand" ADD CONSTRAINT "UnfulfilledDemand_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDecisionEvent" ADD CONSTRAINT "CustomerDecisionEvent_unfulfilledDemandId_fkey" FOREIGN KEY ("unfulfilledDemandId") REFERENCES "UnfulfilledDemand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDecisionEvent" ADD CONSTRAINT "CustomerDecisionEvent_substituteProductId_fkey" FOREIGN KEY ("substituteProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDecisionEvent" ADD CONSTRAINT "CustomerDecisionEvent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostSaleRecord" ADD CONSTRAINT "LostSaleRecord_unfulfilledDemandId_fkey" FOREIGN KEY ("unfulfilledDemandId") REFERENCES "UnfulfilledDemand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostSaleRecord" ADD CONSTRAINT "LostSaleRecord_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
