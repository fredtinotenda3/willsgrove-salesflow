-- Milestone 8 (Validation and Approvals).
-- Entirely additive: no column is dropped, no existing column's type or
-- nullability changes, no existing table is dropped or renamed, and no
-- existing enum value is removed/reordered. Every new column lives on
-- the 4 new tables below. The "new relation fields" on User/Quotation/
-- CustomerOrder in prisma/schema.prisma are pure Prisma inverse-relation
-- sides with NO new column on those existing tables.
--
-- The legacy ProductVerification/PriceDecision/OrderApproval tables and
-- their VerificationStatus/PriceDecisionStatus/ApprovalStatus enums
-- (Milestone 0, confirmed unused by every lib/app/api code path) are
-- deliberately left untouched -- this migration neither reuses nor
-- removes them. See prisma/schema.prisma's Milestone 8 header comment.

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApprovalModule" AS ENUM ('QUOTATIONS', 'ORDERS');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD', 'ORDER_VALUE_EXCEEDS_THRESHOLD');

-- CreateEnum
CREATE TYPE "ApprovalEventType" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED', 'RESUBMITTED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPROVAL_SUBMITTED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'APPROVAL_WITHDRAWN', 'APPROVAL_OVERDUE');

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "module" "ApprovalModule" NOT NULL,
    "actionType" "ApprovalActionType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "thresholdPercent" DECIMAL(5,2),
    "thresholdAmount" DECIMAL(18,4),
    "currency" TEXT,
    "requiredApproverRole" "UserRole" NOT NULL DEFAULT 'SALES_MANAGER',
    "allowRequesterSelfApprove" BOOLEAN NOT NULL DEFAULT false,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "overdueAfterHours" INTEGER,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "module" "ApprovalModule" NOT NULL,
    "actionType" "ApprovalActionType" NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "quotationId" TEXT,
    "customerOrderId" TEXT,
    "previousRequestId" TEXT,
    "rootRequestId" TEXT,
    "policyId" TEXT,
    "requiredApproverRole" "UserRole" NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT,
    "evidence" TEXT,
    "previousValues" JSONB,
    "submittedValues" JSONB NOT NULL,
    "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(6),
    "decidedById" TEXT,
    "decisionReason" TEXT,
    "withdrawnAt" TIMESTAMPTZ(6),
    "withdrawnById" TEXT,
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalEvent" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "eventType" "ApprovalEventType" NOT NULL,
    "actorId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMPTZ(6),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_previousRequestId_key" ON "ApprovalRequest"("previousRequestId");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_module_actionType_active_idx" ON "ApprovalPolicy"("module", "actionType", "active");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_isDemo_idx" ON "ApprovalPolicy"("isDemo");

-- CreateIndex
CREATE INDEX "ApprovalRequest_module_idx" ON "ApprovalRequest"("module");

-- CreateIndex
CREATE INDEX "ApprovalRequest_actionType_idx" ON "ApprovalRequest"("actionType");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_idx" ON "ApprovalRequest"("status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_quotationId_idx" ON "ApprovalRequest"("quotationId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_customerOrderId_idx" ON "ApprovalRequest"("customerOrderId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedById_idx" ON "ApprovalRequest"("requestedById");

-- CreateIndex
CREATE INDEX "ApprovalRequest_decidedById_idx" ON "ApprovalRequest"("decidedById");

-- CreateIndex
CREATE INDEX "ApprovalRequest_submittedAt_idx" ON "ApprovalRequest"("submittedAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_rootRequestId_idx" ON "ApprovalRequest"("rootRequestId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_isDemo_idx" ON "ApprovalRequest"("isDemo");

-- CreateIndex
CREATE INDEX "ApprovalEvent_approvalRequestId_idx" ON "ApprovalEvent"("approvalRequestId");

-- CreateIndex
CREATE INDEX "ApprovalEvent_eventType_idx" ON "ApprovalEvent"("eventType");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_isDemo_idx" ON "Notification"("isDemo");

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_previousRequestId_fkey" FOREIGN KEY ("previousRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_withdrawnById_fkey" FOREIGN KEY ("withdrawnById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalEvent" ADD CONSTRAINT "ApprovalEvent_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalEvent" ADD CONSTRAINT "ApprovalEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
