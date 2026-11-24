-- Management Action Centre: tracks the human decisions taken on management
-- findings (acknowledge, assign, progress, complete, dismiss). Purely
-- additive: two new tables and three new enums. No existing table, column,
-- enum value or row is changed or removed. The findings themselves are
-- computed from live reports and are not stored here.

-- CreateEnum
CREATE TYPE "ManagementFunction" AS ENUM ('PURCHASING', 'WAREHOUSE', 'QUALITY_CONTROL', 'SALES', 'FINANCE', 'OPERATIONS', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "ManagementActionStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ManagementActionEventType" AS ENUM ('ACKNOWLEDGED', 'ASSIGNED', 'STARTED', 'COMPLETED', 'DISMISSED', 'REOPENED');

-- CreateTable
CREATE TABLE "ManagementAction" (
    "id" TEXT NOT NULL,
    "findingKey" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "finding" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "businessImpact" TEXT NOT NULL,
    "expectedOutcome" TEXT NOT NULL,
    "measurement" TEXT NOT NULL,
    "priority" "DecisionPriority" NOT NULL,
    "timeframe" TEXT NOT NULL,
    "responsibleFunction" "ManagementFunction" NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" "ManagementActionStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "assignedAt" TIMESTAMPTZ(6),
    "assignedById" TEXT,
    "statusNote" TEXT,
    "statusById" TEXT,
    "statusAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ManagementAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementActionEvent" (
    "id" TEXT NOT NULL,
    "managementActionId" TEXT NOT NULL,
    "eventType" "ManagementActionEventType" NOT NULL,
    "fromStatus" "ManagementActionStatus",
    "toStatus" "ManagementActionStatus" NOT NULL,
    "actorId" TEXT,
    "assigneeId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementActionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagementAction_findingKey_key" ON "ManagementAction"("findingKey");
CREATE INDEX "ManagementAction_status_idx" ON "ManagementAction"("status");
CREATE INDEX "ManagementAction_assignedToId_idx" ON "ManagementAction"("assignedToId");
CREATE INDEX "ManagementAction_reportId_idx" ON "ManagementAction"("reportId");
CREATE INDEX "ManagementActionEvent_managementActionId_idx" ON "ManagementActionEvent"("managementActionId");

-- AddForeignKey
ALTER TABLE "ManagementAction" ADD CONSTRAINT "ManagementAction_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagementActionEvent" ADD CONSTRAINT "ManagementActionEvent_managementActionId_fkey" FOREIGN KEY ("managementActionId") REFERENCES "ManagementAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagementActionEvent" ADD CONSTRAINT "ManagementActionEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
