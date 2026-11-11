-- Milestone 9 (SAP Business One Integration).
-- Entirely additive: no column is dropped, no existing column's type or
-- nullability changes, no existing table is dropped or renamed, and no
-- existing enum value is removed/reordered. Every new column lives on
-- the 4 new tables below. CustomerOrder.integrationOperation and the two
-- new User inverse-relation fields (prisma/schema.prisma) are pure Prisma
-- inverse-relation sides with NO new column on those existing tables.
--
-- SAP Business One remains authoritative for product/customer master
-- data, inventory, financial accounting, SAP sales orders, SAP invoices
-- and SAP credit notes. Inbound sync reuses the EXISTING Milestone 1/5/6B
-- tables unchanged (Product, Customer, SapInvoiceImportBatch, SapInvoice,
-- SapInvoiceLine, CreditNoteImportBatch, CreditNote) -- none of them are
-- touched by this migration. IntegrationOperation.customerOrderId is a
-- real, typed, RESTRICT foreign key onto CustomerOrder, not a generic
-- polymorphic entityType/entityId reference.

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('SAP_B1');

-- CreateEnum
CREATE TYPE "IntegrationMode" AS ENUM ('MOCK', 'LIVE');

-- CreateEnum
CREATE TYPE "IntegrationSyncJobType" AS ENUM ('PRODUCT_IMPORT', 'CUSTOMER_IMPORT', 'INVOICE_IMPORT', 'CREDIT_NOTE_IMPORT', 'SALES_ORDER_OUTBOX');

-- CreateEnum
CREATE TYPE "IntegrationSyncJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "IntegrationTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "IntegrationOperationType" AS ENUM ('SALES_ORDER_SUBMISSION');

-- CreateEnum
CREATE TYPE "IntegrationOperationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "IntegrationErrorCategory" AS ENUM ('AUTHENTICATION_FAILURE', 'PERMISSION_DENIED', 'NETWORK_UNAVAILABLE', 'TIMEOUT', 'VALIDATION_FAILURE', 'MISSING_CUSTOMER_MAPPING', 'MISSING_PRODUCT_MAPPING', 'DUPLICATE_EXTERNAL_REFERENCE', 'CURRENCY_MISMATCH', 'INVALID_QUANTITY', 'INVALID_PRICE', 'UNCERTAIN_SUBMISSION', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR');

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'SAP_B1',
    "mode" "IntegrationMode" NOT NULL DEFAULT 'MOCK',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "baseUrl" TEXT,
    "companyDb" TEXT,
    "username" TEXT,
    "lastTestedAt" TIMESTAMPTZ(6),
    "lastTestOk" BOOLEAN,
    "lastTestMessage" TEXT,
    "lastConnectionHealthCheckedAt" TIMESTAMPTZ(6),
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSyncJob" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'SAP_B1',
    "jobType" "IntegrationSyncJobType" NOT NULL,
    "status" "IntegrationSyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" "IntegrationTrigger" NOT NULL,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "summary" JSONB,
    "errorMessage" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationOperation" (
    "id" TEXT NOT NULL,
    "syncJobId" TEXT,
    "operationType" "IntegrationOperationType" NOT NULL,
    "status" "IntegrationOperationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "customerOrderId" TEXT NOT NULL,
    "submittedSnapshot" JSONB NOT NULL,
    "externalDocEntry" TEXT,
    "externalDocNum" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMPTZ(6),
    "lastErrorCategory" "IntegrationErrorCategory",
    "lastErrorMessage" TEXT,
    "resolvedAt" TIMESTAMPTZ(6),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "IntegrationOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_provider_key" ON "IntegrationConnection"("provider");

-- CreateIndex
CREATE INDEX "IntegrationConnection_provider_idx" ON "IntegrationConnection"("provider");

-- CreateIndex
CREATE INDEX "IntegrationSyncJob_jobType_idx" ON "IntegrationSyncJob"("jobType");

-- CreateIndex
CREATE INDEX "IntegrationSyncJob_status_idx" ON "IntegrationSyncJob"("status");

-- CreateIndex
CREATE INDEX "IntegrationSyncJob_createdAt_idx" ON "IntegrationSyncJob"("createdAt");

-- CreateIndex
CREATE INDEX "IntegrationSyncJob_isDemo_idx" ON "IntegrationSyncJob"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationOperation_idempotencyKey_key" ON "IntegrationOperation"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationOperation_customerOrderId_key" ON "IntegrationOperation"("customerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationOperation_externalDocEntry_key" ON "IntegrationOperation"("externalDocEntry");

-- CreateIndex
CREATE INDEX "IntegrationOperation_status_idx" ON "IntegrationOperation"("status");

-- CreateIndex
CREATE INDEX "IntegrationOperation_syncJobId_idx" ON "IntegrationOperation"("syncJobId");

-- CreateIndex
CREATE INDEX "IntegrationOperation_isDemo_idx" ON "IntegrationOperation"("isDemo");

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSyncJob" ADD CONSTRAINT "IntegrationSyncJob_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationOperation" ADD CONSTRAINT "IntegrationOperation_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "IntegrationSyncJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationOperation" ADD CONSTRAINT "IntegrationOperation_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
