-- Milestone 15 (Decision Intelligence).
-- Entirely additive: no column is dropped, no existing column's type or
-- nullability changes, no existing table is dropped or renamed, and no
-- existing enum value is removed/reordered. Every new column lives on
-- the 2 new tables below. The new relation fields on User/Customer/
-- Product/Quotation/CustomerOrder in prisma/schema.prisma are pure
-- Prisma inverse-relation sides with NO new column on those existing
-- tables.
--
-- NOTE: this migration was authored by hand (`prisma migrate dev` could
-- not run in the sandbox used to build this milestone -- the same
-- binaries.prisma.sh network-egress restriction documented in the
-- Milestone 14 delivery report blocks the schema-engine download). It
-- has not been applied or tested against a live database in this
-- environment. Apply it with `prisma migrate deploy` (or `migrate dev`
-- in development) against a real database before relying on it, and
-- treat this as a reviewed-but-unverified migration until that first
-- apply succeeds.

-- CreateEnum
CREATE TYPE "DecisionCategory" AS ENUM ('SALES', 'CUSTOMER', 'PRODUCT', 'COMMERCIAL_EXPOSURE', 'OPERATIONAL');

-- CreateEnum
CREATE TYPE "DecisionPriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "DecisionConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "DecisionRecommendationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "DecisionRecommendationEventType" AS ENUM ('CREATED', 'REEVALUATED', 'ACKNOWLEDGED', 'STARTED', 'RESOLVED', 'DISMISSED', 'REOPENED');

-- CreateTable
CREATE TABLE "DecisionRecommendation" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL DEFAULT 1,
    "decisionCategory" "DecisionCategory" NOT NULL,
    "priority" "DecisionPriority" NOT NULL,
    "confidence" "DecisionConfidence" NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "customerId" TEXT,
    "productId" TEXT,
    "sapItemCode" TEXT,
    "salespersonId" TEXT,
    "quotationId" TEXT,
    "customerOrderId" TEXT,
    "reportingPeriodFrom" DATE NOT NULL,
    "reportingPeriodTo" DATE NOT NULL,
    "currencyCode" TEXT,
    "recommendedNextAction" TEXT NOT NULL,
    "status" "DecisionRecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "statusNote" TEXT,
    "statusById" TEXT,
    "statusAt" TIMESTAMPTZ(6),
    "firstDetectedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvaluatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(6),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DecisionRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionRecommendationEvent" (
    "id" TEXT NOT NULL,
    "decisionRecommendationId" TEXT NOT NULL,
    "eventType" "DecisionRecommendationEventType" NOT NULL,
    "fromStatus" "DecisionRecommendationStatus",
    "toStatus" "DecisionRecommendationStatus" NOT NULL,
    "actorId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionRecommendationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DecisionRecommendation_dedupeKey_key" ON "DecisionRecommendation"("dedupeKey");

-- CreateIndex
CREATE INDEX "DecisionRecommendation_decisionCategory_idx" ON "DecisionRecommendation"("decisionCategory");

-- CreateIndex
CREATE INDEX "DecisionRecommendation_priority_idx" ON "DecisionRecommendation"("priority");

-- CreateIndex
CREATE INDEX "DecisionRecommendation_status_idx" ON "DecisionRecommendation"("status");

-- CreateIndex
CREATE INDEX "DecisionRecommendation_customerId_idx" ON "DecisionRecommendation"("customerId");

-- CreateIndex
CREATE INDEX "DecisionRecommendation_productId_idx" ON "DecisionRecommendation"("productId");

-- CreateIndex
CREATE INDEX "DecisionRecommendation_salespersonId_idx" ON "DecisionRecommendation"("salespersonId");

-- CreateIndex
CREATE INDEX "DecisionRecommendation_quotationId_idx" ON "DecisionRecommendation"("quotationId");

-- CreateIndex
CREATE INDEX "DecisionRecommendation_customerOrderId_idx" ON "DecisionRecommendation"("customerOrderId");

-- CreateIndex
CREATE INDEX "DecisionRecommendation_isDemo_idx" ON "DecisionRecommendation"("isDemo");

-- CreateIndex
CREATE INDEX "DecisionRecommendation_isDemo_status_idx" ON "DecisionRecommendation"("isDemo", "status");

-- CreateIndex
CREATE INDEX "DecisionRecommendationEvent_decisionRecommendationId_idx" ON "DecisionRecommendationEvent"("decisionRecommendationId");

-- CreateIndex
CREATE INDEX "DecisionRecommendationEvent_eventType_idx" ON "DecisionRecommendationEvent"("eventType");

-- AddForeignKey
ALTER TABLE "DecisionRecommendation" ADD CONSTRAINT "DecisionRecommendation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRecommendation" ADD CONSTRAINT "DecisionRecommendation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRecommendation" ADD CONSTRAINT "DecisionRecommendation_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRecommendation" ADD CONSTRAINT "DecisionRecommendation_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRecommendation" ADD CONSTRAINT "DecisionRecommendation_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRecommendation" ADD CONSTRAINT "DecisionRecommendation_statusById_fkey" FOREIGN KEY ("statusById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRecommendationEvent" ADD CONSTRAINT "DecisionRecommendationEvent_decisionRecommendationId_fkey" FOREIGN KEY ("decisionRecommendationId") REFERENCES "DecisionRecommendation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRecommendationEvent" ADD CONSTRAINT "DecisionRecommendationEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
