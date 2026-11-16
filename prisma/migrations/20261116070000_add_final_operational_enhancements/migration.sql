-- Final Operational Enhancements.
--
-- Entirely additive: no column is dropped, no existing column's type or
-- nullability changes, no existing table is dropped or renamed, and no
-- existing enum value is removed/reordered/renamed. Every new FK column
-- added to a pre-existing table (DispatchRecord.driverId/assistantId/
-- vehicleId, InvoiceClaim.invoiceDeliveryRecordId,
-- InvoiceClaimLine.reasonCategory) is NULLable, so every existing row in
-- every existing table remains valid with no backfill needed. Every new
-- table below is brand new.
--
-- NOTE: this migration was authored by hand (`prisma migrate dev`/
-- `prisma validate` could not run in the sandbox used to build this --
-- the same binaries.prisma.sh network-egress restriction (403 Forbidden
-- on the schema-engine/query-engine download) already documented in
-- every prior milestone's delivery report blocks it here too; confirmed
-- again in this round with PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 set).
-- It has not been applied or tested against a live database in this
-- environment. Apply it with `prisma migrate deploy` (or `migrate dev` in
-- development) against a real database before relying on it, and treat
-- this as a reviewed-but-unverified migration until that first apply
-- succeeds. The accompanying prisma/schema.prisma was reviewed by hand,
-- field by field, against this file for a 1:1 match.

-- AlterEnum: 7 new InvoiceClaimCategory values (spec Part 6's 10 required
-- claim reasons; 3 reused an exact existing value -- see schema.prisma's
-- own comment on this enum). Postgres requires each added value in its
-- own ALTER TYPE statement, same convention as every prior AlterEnum in
-- this migration history (e.g. 20261109100000_add_po_intake_extraction).
ALTER TYPE "InvoiceClaimCategory" ADD VALUE 'PRODUCT_NOT_ORDERED';
ALTER TYPE "InvoiceClaimCategory" ADD VALUE 'PRODUCT_NOT_DELIVERED';
ALTER TYPE "InvoiceClaimCategory" ADD VALUE 'OVERSUPPLY';
ALTER TYPE "InvoiceClaimCategory" ADD VALUE 'EXPIRED_PRODUCT';
ALTER TYPE "InvoiceClaimCategory" ADD VALUE 'NO_BARCODE';
ALTER TYPE "InvoiceClaimCategory" ADD VALUE 'BARCODE_SCANNING_ISSUE';
ALTER TYPE "InvoiceClaimCategory" ADD VALUE 'DUPLICATE_ENTRY';

-- CreateEnum
CREATE TYPE "PersonnelRole" AS ENUM ('DRIVER', 'DRIVER_ASSISTANT', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceDeliveryOutcome" AS ENUM ('NO_CLAIM', 'WITH_CLAIM');

-- CreateTable
CREATE TABLE "Personnel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "PersonnelRole" NOT NULL,
    "roleDetail" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "statusChangedById" TEXT,
    "statusChangedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Personnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "statusChangedById" TEXT,
    "statusChangedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceDeliveryRecord" (
    "id" TEXT NOT NULL,
    "sapInvoiceId" TEXT NOT NULL,
    "outcome" "InvoiceDeliveryOutcome" NOT NULL,
    "podReference" TEXT,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InvoiceDeliveryRecord_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "InvoiceClaimLine" ADD COLUMN "reasonCategory" "InvoiceClaimCategory";

-- AlterTable
ALTER TABLE "InvoiceClaim" ADD COLUMN "invoiceDeliveryRecordId" TEXT;

-- AlterTable
ALTER TABLE "DispatchRecord" ADD COLUMN "driverId" TEXT,
ADD COLUMN "assistantId" TEXT,
ADD COLUMN "vehicleId" TEXT;

-- CreateIndex
CREATE INDEX "Personnel_role_idx" ON "Personnel"("role");

-- CreateIndex
CREATE INDEX "Personnel_status_idx" ON "Personnel"("status");

-- CreateIndex
CREATE INDEX "Personnel_isDemo_idx" ON "Personnel"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_registrationNumber_key" ON "Vehicle"("registrationNumber");

-- CreateIndex
CREATE INDEX "Vehicle_status_idx" ON "Vehicle"("status");

-- CreateIndex
CREATE INDEX "Vehicle_isDemo_idx" ON "Vehicle"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceDeliveryRecord_sapInvoiceId_key" ON "InvoiceDeliveryRecord"("sapInvoiceId");

-- CreateIndex
CREATE INDEX "InvoiceDeliveryRecord_recordedById_idx" ON "InvoiceDeliveryRecord"("recordedById");

-- CreateIndex
CREATE INDEX "InvoiceDeliveryRecord_outcome_idx" ON "InvoiceDeliveryRecord"("outcome");

-- CreateIndex
CREATE INDEX "InvoiceDeliveryRecord_isDemo_idx" ON "InvoiceDeliveryRecord"("isDemo");

-- CreateIndex
CREATE INDEX "InvoiceClaimLine_reasonCategory_idx" ON "InvoiceClaimLine"("reasonCategory");

-- CreateIndex
CREATE INDEX "InvoiceClaim_invoiceDeliveryRecordId_idx" ON "InvoiceClaim"("invoiceDeliveryRecordId");

-- CreateIndex
CREATE INDEX "DispatchRecord_driverId_idx" ON "DispatchRecord"("driverId");

-- CreateIndex
CREATE INDEX "DispatchRecord_assistantId_idx" ON "DispatchRecord"("assistantId");

-- CreateIndex
CREATE INDEX "DispatchRecord_vehicleId_idx" ON "DispatchRecord"("vehicleId");

-- AddForeignKey
ALTER TABLE "Personnel" ADD CONSTRAINT "Personnel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Personnel" ADD CONSTRAINT "Personnel_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDeliveryRecord" ADD CONSTRAINT "InvoiceDeliveryRecord_sapInvoiceId_fkey" FOREIGN KEY ("sapInvoiceId") REFERENCES "SapInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDeliveryRecord" ADD CONSTRAINT "InvoiceDeliveryRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceClaim" ADD CONSTRAINT "InvoiceClaim_invoiceDeliveryRecordId_fkey" FOREIGN KEY ("invoiceDeliveryRecordId") REFERENCES "InvoiceDeliveryRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRecord" ADD CONSTRAINT "DispatchRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
