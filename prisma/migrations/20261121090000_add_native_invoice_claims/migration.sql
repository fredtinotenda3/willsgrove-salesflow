-- Real-world fix (native Invoice Claims): "Invoice Claims Management are
-- invoices that have products that have been return[ed] because of
-- different reason[s] like Price Claim etc[,] not a file to be
-- imported[.] Nothing is coming from sap." This business has no
-- automatic SAP invoice feed, so a claim must be expressible with NO
-- SapInvoice at all, anchored instead to this business's own
-- CustomerOrder/OrderLine (lib/invoice-claims/create-claim.ts).
--
-- Relaxing, not narrowing: InvoiceClaim.sapInvoiceId and
-- InvoiceClaimLine.sapInvoiceLineId go from required to nullable. Every
-- row created before this fix already has both columns NOT NULL, so this
-- is a pure widening -- no existing row is touched, no column or table
-- is dropped, no enum value is removed. Same binding delivery constraint
-- every prior migration in this history has followed: "do not execute a
-- destructive database operation."
--
-- orderLineId is new, on InvoiceClaimLine. InvoiceClaim.orderId is NOT
-- new -- it already existed as an optional cross-reference ("the
-- original SalesFlow order, where possible") for a SAP-linked claim;
-- this migration reuses it, unchanged in shape, as the required anchor
-- for a claim with no SapInvoice instead (see prisma/schema.prisma's own
-- comment on InvoiceClaim.orderId).
--
-- Two CHECK constraints enforce the claim-level/line-level linkage rules
-- at the database level, not just in application code -- defense in
-- depth, the same principle as every other hard business rule in this
-- schema that isn't left to the API route alone. Both pass trivially for
-- every existing row, since sapInvoiceId/sapInvoiceLineId were always
-- NOT NULL before this migration:
--   - InvoiceClaim_sap_or_order_required: at least one of
--     sapInvoiceId/orderId must be set (both may legitimately be set at
--     once -- the pre-existing SAP-linked-claim-with-cross-reference
--     case; only "neither" is invalid).
--   - InvoiceClaimLine_sap_or_order_xor: EXACTLY one of
--     sapInvoiceLineId/orderLineId must be set per line -- a line has
--     never had a dual-linkage concept, unlike the claim header.
--
-- NOTE: authored by hand, following this project's established
-- convention (see 20261116140000_remove_customer_decision_workflow's own
-- note) -- `prisma migrate`/`generate` cannot reach binaries.prisma.sh
-- from this sandbox (403 Forbidden, the same network-egress restriction
-- every prior milestone's delivery report has documented). Not applied
-- or tested against a live database here. The accompanying
-- prisma/schema.prisma was reviewed by hand, field by field, against
-- this file and against the original 20261111000000_add_invoice_claims_
-- management migration's constraint/index names, for a 1:1 match. Apply
-- with `prisma migrate deploy` (or `migrate dev` in development) against
-- a real database before relying on it.

-- DropForeignKey: re-added below, nullable this time (a NULL FK column
-- is simply exempt from the referential check, same Postgres semantics
-- as every other optional FK already in this schema -- e.g.
-- InvoiceClaim.assignedToId).
ALTER TABLE "InvoiceClaim" DROP CONSTRAINT "InvoiceClaim_sapInvoiceId_fkey";
ALTER TABLE "InvoiceClaimLine" DROP CONSTRAINT "InvoiceClaimLine_sapInvoiceLineId_fkey";

-- AlterTable: widen to nullable (see module comment above -- not destructive).
ALTER TABLE "InvoiceClaim" ALTER COLUMN "sapInvoiceId" DROP NOT NULL;
ALTER TABLE "InvoiceClaimLine" ALTER COLUMN "sapInvoiceLineId" DROP NOT NULL;

-- AlterTable: new native-linkage column.
ALTER TABLE "InvoiceClaimLine" ADD COLUMN "orderLineId" TEXT;

-- AddForeignKey
ALTER TABLE "InvoiceClaim" ADD CONSTRAINT "InvoiceClaim_sapInvoiceId_fkey" FOREIGN KEY ("sapInvoiceId") REFERENCES "SapInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceClaimLine" ADD CONSTRAINT "InvoiceClaimLine_sapInvoiceLineId_fkey" FOREIGN KEY ("sapInvoiceLineId") REFERENCES "SapInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceClaimLine" ADD CONSTRAINT "InvoiceClaimLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "InvoiceClaimLine_orderLineId_idx" ON "InvoiceClaimLine"("orderLineId");

-- CreateIndex: a SEPARATE unique index from the pre-existing
-- InvoiceClaimLine_claimId_sapInvoiceLineId_key, not a compound one --
-- Postgres treats NULL as distinct from NULL in a unique index, so each
-- index is a no-op across every row using the OTHER linkage (its own
-- column is NULL there), exactly as intended.
CREATE UNIQUE INDEX "InvoiceClaimLine_claimId_orderLineId_key" ON "InvoiceClaimLine"("claimId", "orderLineId");

-- AddCheckConstraint
ALTER TABLE "InvoiceClaim" ADD CONSTRAINT "InvoiceClaim_sap_or_order_required" CHECK (
  "sapInvoiceId" IS NOT NULL OR "orderId" IS NOT NULL
);

ALTER TABLE "InvoiceClaimLine" ADD CONSTRAINT "InvoiceClaimLine_sap_or_order_xor" CHECK (
  ("sapInvoiceLineId" IS NOT NULL AND "orderLineId" IS NULL) OR
  ("sapInvoiceLineId" IS NULL AND "orderLineId" IS NOT NULL)
);
