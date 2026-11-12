-- Milestone 11 (Operational BI). Adds the assigned-salesperson dimension
-- to CustomerOrder so sales-pipeline/performance reporting can filter and
-- group by salesperson across both quotations (which already had
-- Quotation.salespersonId) and orders (which, until now, did not).
--
-- This is purely additive: a new nullable column, its FK/index, and a
-- one-time backfill of EXISTING rows only. No existing column, constraint,
-- or table is altered or dropped, and no application code path is removed.

-- AlterTable
ALTER TABLE "CustomerOrder" ADD COLUMN     "salespersonId" TEXT;

-- CreateIndex
CREATE INDEX "CustomerOrder_salespersonId_idx" ON "CustomerOrder"("salespersonId");

-- CreateIndex (operational dashboard/pipeline reports' most common query
-- shape: non-demo orders filtered by status)
CREATE INDEX "CustomerOrder_isDemo_status_idx" ON "CustomerOrder"("isDemo", "status");

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data backfill. salespersonId did not exist before this migration, so
-- every order created before now has no real "assigned salesperson" to
-- recover -- the best available, non-invented approximation is the
-- person who created the order record (createdById), which is exactly
-- what lib/orders.ts's createOrderCore now defaults new orders to as
-- well (see that file's own comment) when no better value is supplied.
-- This keeps every existing and future order's salespersonId populated
-- (never left NULL for a plain reporting query to silently drop), while
-- the schema still allows NULL for defensive/future-proofing purposes
-- only -- no code in this codebase creates a CustomerOrder without one
-- after this migration.
UPDATE "CustomerOrder" SET "salespersonId" = "createdById" WHERE "salespersonId" IS NULL;
