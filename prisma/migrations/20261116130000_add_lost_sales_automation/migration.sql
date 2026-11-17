-- Additional Implementation Requirements: Lost Sales Automation.
--
-- Entirely additive, same convention as every prior migration in this
-- history: no column dropped, no existing column's type/nullability
-- changed, no existing table/enum value removed, reordered or renamed.
-- Both new columns on "UnfulfilledDemand" are NULLable and
-- "supersededByDemandId" is a plain unique nullable FK, so every existing
-- row remains valid with no backfill. The one new enum value
-- ("SUPERSEDED") is appended, never inserted before an existing value.
--
-- NOTE: authored by hand -- `prisma validate`/`generate`/`migrate` cannot
-- reach binaries.prisma.sh from this sandbox (403 Forbidden, the same
-- network-egress restriction every prior milestone's delivery report has
-- documented; reconfirmed again this round with
-- PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 set). Not applied or tested
-- against a live database here. The accompanying prisma/schema.prisma was
-- reviewed by hand, field by field, against this file for a 1:1 match.
-- Apply with `prisma migrate deploy` (or `migrate dev` in development)
-- against a real database before relying on it.

-- AlterEnum: one new UnfulfilledDemandStatus value -- see that enum's own
-- schema.prisma comment for what it means and why it exists.
ALTER TYPE "UnfulfilledDemandStatus" ADD VALUE 'SUPERSEDED';

-- AlterTable: the automatic estimated-value columns (populated at
-- creation time by lib/lost-sales/create-unfulfilled-demand.ts, reusing
-- lib/lost-sales/estimate-value.ts's existing price resolution) and the
-- supersession link (set when a re-pick/correction replaces this row --
-- see UnfulfilledDemandStatus.SUPERSEDED's comment).
ALTER TABLE "UnfulfilledDemand" ADD COLUMN "estimatedUnitPrice" DECIMAL(18,4);
ALTER TABLE "UnfulfilledDemand" ADD COLUMN "estimatedValue" DECIMAL(18,4);
ALTER TABLE "UnfulfilledDemand" ADD COLUMN "estimatedValueSource" "LostSaleValueSource";
ALTER TABLE "UnfulfilledDemand" ADD COLUMN "supersededByDemandId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "UnfulfilledDemand_supersededByDemandId_key" ON "UnfulfilledDemand"("supersededByDemandId");

-- AddForeignKey
ALTER TABLE "UnfulfilledDemand" ADD CONSTRAINT "UnfulfilledDemand_supersededByDemandId_fkey" FOREIGN KEY ("supersededByDemandId") REFERENCES "UnfulfilledDemand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
