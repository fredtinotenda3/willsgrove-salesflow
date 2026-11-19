-- Real Business Data Onboarding round, Phase 6 (Returned-claim lost
-- sales). Entirely additive: one brand-new table, with foreign keys
-- pointing at it from nowhere but itself -- no existing column is
-- dropped, no existing column's type or nullability changes, no
-- existing table is dropped or renamed, and no existing enum value is
-- removed or added to. ReturnCondition and DecisionSource (both from
-- earlier migrations) are reused as-is; this migration defines no new
-- enum. See prisma/schema.prisma's own comment just above
-- "model ClaimReturnLostSale" for the full rationale behind this being
-- its own table rather than a reuse of LostSaleRecord.

-- CreateTable
CREATE TABLE "ClaimReturnLostSale" (
    "id" TEXT NOT NULL,
    "claimReturnId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "claimLineId" TEXT,
    "customerId" TEXT NOT NULL,
    "sapItemCodeSnapshot" TEXT,
    "sapItemDescriptionSnapshot" TEXT,
    "estimatedUnitPrice" DECIMAL(18,4),
    "estimatedValue" DECIMAL(18,4),
    "currencyCode" TEXT,
    "decisionSource" "DecisionSource" NOT NULL DEFAULT 'AUTOMATIC_SYSTEM_RECORDED',
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ClaimReturnLostSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaimReturnLostSale_claimReturnId_key" ON "ClaimReturnLostSale"("claimReturnId");

-- CreateIndex
CREATE INDEX "ClaimReturnLostSale_claimId_idx" ON "ClaimReturnLostSale"("claimId");

-- CreateIndex
CREATE INDEX "ClaimReturnLostSale_claimLineId_idx" ON "ClaimReturnLostSale"("claimLineId");

-- CreateIndex
CREATE INDEX "ClaimReturnLostSale_customerId_idx" ON "ClaimReturnLostSale"("customerId");

-- CreateIndex
CREATE INDEX "ClaimReturnLostSale_isDemo_idx" ON "ClaimReturnLostSale"("isDemo");

-- AddForeignKey
ALTER TABLE "ClaimReturnLostSale" ADD CONSTRAINT "ClaimReturnLostSale_claimReturnId_fkey" FOREIGN KEY ("claimReturnId") REFERENCES "ClaimReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimReturnLostSale" ADD CONSTRAINT "ClaimReturnLostSale_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InvoiceClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimReturnLostSale" ADD CONSTRAINT "ClaimReturnLostSale_claimLineId_fkey" FOREIGN KEY ("claimLineId") REFERENCES "InvoiceClaimLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimReturnLostSale" ADD CONSTRAINT "ClaimReturnLostSale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimReturnLostSale" ADD CONSTRAINT "ClaimReturnLostSale_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
