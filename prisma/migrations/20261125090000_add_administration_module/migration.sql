-- Administration module. Purely additive: three nullable/defaulted columns
-- and one new table. No existing row, column, enum value or constraint is
-- changed or removed, and nothing is backfilled.
--   User.department          optional operational function (ManagementFunction)
--   Customer.accountManagerId optional responsible salesperson
--   PriceList.status         ACTIVE for every existing list
--   SystemSetting            validated, audited business configuration

-- AlterTable
ALTER TABLE "User" ADD COLUMN "department" "ManagementFunction";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "accountManagerId" TEXT;

-- AlterTable
ALTER TABLE "PriceList" ADD COLUMN "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Customer_accountManagerId_idx" ON "Customer"("accountManagerId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_accountManagerId_fkey" FOREIGN KEY ("accountManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
