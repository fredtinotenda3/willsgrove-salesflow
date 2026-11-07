-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CustomerLocation" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CustomerOrder" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "receivedAt" TIMESTAMPTZ(6),
ADD COLUMN     "extractedAt" TIMESTAMPTZ(6),
ADD COLUMN     "reviewedAt" TIMESTAMPTZ(6),
ADD COLUMN     "approvedAt" TIMESTAMPTZ(6),
ADD COLUMN     "handedToSapAt" TIMESTAMPTZ(6),
ADD COLUMN     "invoicedAt" TIMESTAMPTZ(6),
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "userAgent" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "User_isDemo_idx" ON "User"("isDemo");

-- CreateIndex
CREATE INDEX "Customer_isDemo_idx" ON "Customer"("isDemo");

-- CreateIndex
CREATE INDEX "CustomerLocation_isDemo_idx" ON "CustomerLocation"("isDemo");

-- CreateIndex
CREATE INDEX "Product_isDemo_idx" ON "Product"("isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_idempotencyKey_key" ON "CustomerOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CustomerOrder_isDemo_idx" ON "CustomerOrder"("isDemo");

-- CreateIndex
CREATE INDEX "OrderLine_isDemo_idx" ON "OrderLine"("isDemo");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
